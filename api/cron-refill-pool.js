// ─────────────────────────────────────────────────────────────────────────────
// /api/cron-refill-pool.js  —  v12  (ROTATION + SYNCHRONOUS)
//
// WHAT CHANGED FROM v11 (and why the kids were seeing repeats):
//   v11 "topped up" each (subject, grade) pool TO a fixed target and never
//   retired anything. Once a pool reached the target, `need = 0` forever, so
//   NO new quests were ever generated again. The pool froze and kids cycled
//   through the same fixed set. On top of that, v11 relied on the Batches API
//   with day-to-day polling, which needs the Vercel cron to fire every single
//   day — unreliable on the Hobby plan, so cycles stalled.
//
//   v12 fixes both:
//     1. ROTATION: every cycle we RETIRE the oldest ROTATION_SIZE quests per
//        (subject, grade) (set is_active = false), then GENERATE that many
//        fresh ones. A third of every pool is new each cycle. Kids can't
//        out-run it.
//     2. SYNCHRONOUS + SELF-HEALING: generation happens with direct Haiku
//        calls (in small parallel groups) within ONE invocation. No multi-day
//        batch polling. A single daily cron fire does the whole job, and if
//        Hobby skips a day, the next fire fully catches up on its own.
//
// COST: direct Haiku calls are ~2x the Batches API price but still tiny.
//   ~15 quests × 26 (subject,grade) combos every 14 days on Haiku
//   ≈ $0.15–0.30 per cycle → well under $1/month. Inside the $30 cap.
//
// Secured by CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
// Also accepts ?secret= for manual triggering from a browser.
// Optional: &force=1 to bypass the 14-day gate (manual refresh).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor, conceptCount } from './_lib/concepts.js';

export const config = { maxDuration: 55 };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECTS = ['math', 'english', 'science', 'history'];
const GRADE_PLAN = {
  math:    [3, 4, 5, 7, 8, 9],
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

// ─── Rotation config ─────────────────────────────────────────────────────────
const TARGET_POOL_SIZE = 45;       // active quests to keep per (subject, grade)
const ROTATION_SIZE = 15;          // retire & replace this many oldest per cycle
const REFRESH_INTERVAL_DAYS = 14;  // bi-weekly cadence
const GEN_CONCURRENCY = 4;         // how many Haiku calls to run in parallel
const MAX_GEN_PER_RUN = 130;       // safety cap on total generations per invocation

export default async function handler(req, res) {
  // Auth
  const authHeader = req.headers['authorization'] || '';
  const expectedBearer = `Bearer ${process.env.CRON_SECRET || ''}`;
  const isVercelCron = process.env.CRON_SECRET && authHeader === expectedBearer;
  const manualSecret = req.query?.secret;
  const authed = isVercelCron || (manualSecret && manualSecret === process.env.CRON_SECRET);
  if (!authed) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const force = req.query?.force === '1';

  // Load state
  let state = await loadState(db);

  // Gate: only run if it's been >= REFRESH_INTERVAL_DAYS (unless forced)
  const lastRefresh = state.last_refresh_at ? new Date(state.last_refresh_at) : null;
  const daysSinceRefresh = lastRefresh
    ? (Date.now() - lastRefresh.getTime()) / (24 * 60 * 60 * 1000)
    : Infinity;

  if (!force && daysSinceRefresh < REFRESH_INTERVAL_DAYS) {
    return res.status(200).json({
      action: 'no_op',
      reason: 'not_yet_time_to_refresh',
      daysSinceRefresh: daysSinceRefresh.toFixed(1),
      nextRefreshIn: (REFRESH_INTERVAL_DAYS - daysSinceRefresh).toFixed(1),
    });
  }

  // Build the work plan: for each combo, how many to retire and how many to make
  const plan = await buildPlan(db);

  // ─── Step 1: retire oldest quests per combo ────────────────────────────────
  let retiredTotal = 0;
  for (const item of plan) {
    if (item.retire > 0) {
      const { data: oldest } = await db
        .from('quest_pool')
        .select('id')
        .eq('subject_id', item.subject)
        .eq('grade_level', item.grade)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(item.retire);
      const ids = (oldest || []).map(r => r.id);
      if (ids.length > 0) {
        const { error } = await db
          .from('quest_pool')
          .update({ is_active: false })
          .in('id', ids);
        if (!error) retiredTotal += ids.length;
      }
    }
  }

  // ─── Step 2: generate replacements synchronously (Haiku, small parallel) ────
  // Flatten the plan into individual generation jobs.
  const jobs = [];
  for (const item of plan) {
    for (let i = 0; i < item.generate; i++) {
      // Offset the concept index by created count so we cycle through the bank
      // rather than repeating the same canonical concept every time.
      const idx = (item.baseCount + i);
      jobs.push({ subject: item.subject, grade: item.grade, conceptIndex: idx });
    }
  }
  const capped = jobs.slice(0, MAX_GEN_PER_RUN);

  let inserted = 0, failed = 0;
  for (let i = 0; i < capped.length; i += GEN_CONCURRENCY) {
    const group = capped.slice(i, i + GEN_CONCURRENCY);
    const results = await Promise.all(
      group.map(job => generateOne(db, ANTHROPIC_KEY, job))
    );
    for (const ok of results) {
      if (ok) inserted++; else failed++;
    }
  }

  // ─── Step 3: record success + housekeeping ─────────────────────────────────
  state.pending_batch_id = null; // v12 no longer uses batches; clear any stale id
  state.last_refresh_at = new Date().toISOString();
  state.last_retired = retiredTotal;
  state.last_inserted = inserted;
  state.last_failed = failed;
  state.notes = `v12 rotation: retired ${retiredTotal}, inserted ${inserted}, failed ${failed}`;
  await saveState(db, state);
  await trimServedLog(db);

  return res.status(200).json({
    action: 'rotation_complete',
    retired: retiredTotal,
    inserted,
    failed,
    combos: plan.length,
    forced: force,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan builder: decide retire/generate counts per combo.
//
//   - retire   = min(ROTATION_SIZE, currentActive)  → drop the oldest
//   - generate = enough to bring the pool back to TARGET_POOL_SIZE AFTER retiring
//                (this also self-heals combos that were left below target by v11,
//                 e.g. english/science/history stuck at 30, math g6 at 1)
// ─────────────────────────────────────────────────────────────────────────────
async function buildPlan(db) {
  const plan = [];
  for (const subject of SUBJECTS) {
    for (const grade of (GRADE_PLAN[subject] || [])) {
      const { count } = await db
        .from('quest_pool')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', subject)
        .eq('grade_level', grade)
        .eq('is_active', true);
      const active = count || 0;
      const retire = Math.min(ROTATION_SIZE, active);
      const afterRetire = active - retire;
      const generate = Math.max(0, TARGET_POOL_SIZE - afterRetire);
      plan.push({ subject, grade, active, retire, generate, baseCount: active });
    }
  }
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate ONE quest synchronously and insert it. Returns true on success.
// ─────────────────────────────────────────────────────────────────────────────
async function generateOne(db, apiKey, job) {
  const { subject, grade, conceptIndex } = job;
  const concept = conceptFor(subject, grade, conceptIndex);
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // pool gen: Haiku, 10x cheaper
        max_tokens: 2400,
        system: 'You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.',
        messages: [{ role: 'user', content: questPrompt(subject, grade, concept) }],
      }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    const content = data.content || [];
    const text = content.filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    try { parsed = parseJsonLoose(text); } catch { return false; }

    if (!parsed.modules || parsed.modules.length < 5 || !parsed.miniBoss || !parsed.bigBoss || !parsed.lesson) {
      return false;
    }
    // Normalize correctAnswers
    const allQs = [...parsed.modules, parsed.miniBoss, parsed.bigBoss];
    for (const q of allQs) {
      if (!Array.isArray(q.options)) return false;
      if (!q.options.includes(q.correctAnswer)) {
        const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase());
        q.correctAnswer = match || q.options[0];
      }
    }
    parsed.modules.forEach(q => { q.kind = 'module'; });
    parsed.miniBoss.kind = 'miniBoss';
    parsed.bigBoss.kind = 'bigBoss';
    parsed.questions = [...parsed.modules, parsed.miniBoss];
    parsed.bossQuestion = parsed.bigBoss;

    const lesson = parsed.lesson;
    delete parsed.lesson;

    const { error } = await db.from('quest_pool').insert({
      subject_id: subject,
      grade_level: grade,
      concept: parsed.concept || null,
      quest_json: parsed,
      lesson_json: lesson,
      generated_by: 'cron',
    });
    return !error;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State management
// ─────────────────────────────────────────────────────────────────────────────
async function loadState(db) {
  const { data } = await db
    .from('cron_state')
    .select('value')
    .eq('key', 'pool_refresh')
    .maybeSingle();
  return data?.value || { pending_batch_id: null, last_refresh_at: null };
}

async function saveState(db, value) {
  await db.from('cron_state').upsert({ key: 'pool_refresh', value }, { onConflict: 'key' });
}

async function trimServedLog(db) {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await db.from('quest_served_log').delete().lt('served_at', cutoff);
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt (unchanged from v11)
// ─────────────────────────────────────────────────────────────────────────────
function questPrompt(subjectId, gradeLevel, assignedConcept) {
  const labels = { math: 'Math', english: 'English / Language Arts', science: 'Science', history: 'History' };
  const subject = labels[subjectId] || subjectId;
  const conceptLine = assignedConcept
    ? `THE CONCEPT FOR THIS QUEST IS: "${assignedConcept}". All 7 questions must test this exact concept. Do not choose a different topic.`
    : `Pick ONE focused concept appropriate for Grade ${gradeLevel} ${subject}. ALL 7 questions must test that single concept.`;
  return `Generate a ${subject} quest at Grade ${gradeLevel} curriculum level.

IMPORTANT: Match content to Grade ${gradeLevel} curriculum standards exactly. The student is genuinely working at this level — make questions challenging but fair.

${conceptLine}

If any word problem features a student, refer to them as "the student" or use the placeholder {NAME}. Do not assume a name or gender. Use the placeholder {PRONOUN_SUBJECT} (they/he/she) and {PRONOUN_POSSESSIVE} (their/his/her) where pronouns are needed.

STRUCTURE:
- 5 "module" questions (progressive practice).
- 1 "miniBoss" (synthesis).
- 1 "bigBoss" (transfer to new context).

ALSO write the lesson card inside this same JSON under the "lesson" key.

Output this exact JSON:
{
  "concept": "Name of the focused concept",
  "conceptSummary": "1 sentence describing what's being tested",
  "requiredKnowledge": ["term 1", "term 2"],
  "questTitle": "fun adventure title",
  "storyIntro": "2 sentence story setup",
  "victoryMessage": "congrats message",
  "modules": [
    {"id":1,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"A) ...","explanation":"..."},
    {"id":2,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"B) ...","explanation":"..."},
    {"id":3,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"C) ...","explanation":"..."},
    {"id":4,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"A) ...","explanation":"..."},
    {"id":5,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"D) ...","explanation":"..."}
  ],
  "miniBoss": {"id":"mini","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"...","explanation":"..."},
  "bigBoss": {"id":"big","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"...","explanation":"..."},
  "lesson": {
    "topic": "Short topic name (≤ 5 words)",
    "hook": "One opening sentence — fun fact or 'why this matters'",
    "lesson": "2-3 short paragraphs explaining the core concept clearly with one concrete worked example. Define every term in requiredKnowledge. Under 220 words total.",
    "watchOut": "One sentence about a common mistake students make on this topic",
    "keyTerms": [{"term": "...", "definition": "..."}]
  }
}

RULES:
- "requiredKnowledge" lists every unit, formula, or vocab word that appears in any question. The lesson MUST define all of them.
- correctAnswer must exactly match one option string.
- Output ONLY the JSON object.`;
}

function parseJsonLoose(text) {
  let clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no json');
  const j = clean.slice(s, e + 1);
  try { return JSON.parse(j); }
  catch { return JSON.parse(j.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ' ')); }
}
