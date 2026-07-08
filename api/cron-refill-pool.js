// ─────────────────────────────────────────────────────────────────────────────
// /api/cron-refill-pool.js  —  v12  (BOUNDED DAILY LOOP)
//
// PROBLEM HISTORY:
//   v11 "topped up" each (subject, grade) pool TO a fixed target and never
//   retired anything, so once full it generated nothing more forever — the pool
//   froze and kids saw repeats. It also used the Batches API with day-to-day
//   polling, which needs the Hobby cron to fire every day (unreliable), and a
//   single big batch/synchronous fill blew past Vercel's 60-second limit (504).
//
// v12 DESIGN — small bounded work per invocation, run daily, self-healing:
//   Each daily cron run does AT MOST `MAX_GEN_PER_RUN` generations and returns
//   well under the timeout. Two phases, in priority order:
//
//     PHASE 1 — SELF-HEAL: if any (subject, grade) is below TARGET_POOL_SIZE,
//       generate toward the most-starved combos first. This is how the pool
//       fills from a cold/starved start — no bootstrap, no manual clicking.
//       It just fills a little each day until every combo reaches target.
//
//     PHASE 2 — ROTATE: once nothing is starved, retire the oldest few quests
//       from a small ROLLING SLICE of combos (a couple per day) and regenerate
//       them. Over ~2 weeks the whole fleet rotates. Bi-weekly cadence, spread
//       across daily runs so each run stays tiny.
//
//   Because each run is bounded, it CANNOT time out, and if Hobby skips a day
//   the next run simply picks up where it left off. Fully self-healing.
//
// COST: direct Haiku calls, ~20 quests/day max → pennies/day, well under $1/mo.
//
// Auth: CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
//   Manual nudge from a browser: ?secret=YOUR_CRON_SECRET&run=1
//   (&run=1 does exactly ONE bounded chunk — it also cannot time out.)
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor } from './_lib/concepts.js';

// Fluid Compute is ENABLED on this project and the Function Max Duration default
// is 300s (confirmed in Settings → Functions, 2026-07-06). 300s is build-safe here.
export const config = { maxDuration: 300 };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECTS = ['math', 'english', 'science', 'history'];
const GRADE_PLAN = {
  math:    [3, 4, 5, 7, 8, 9],
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

// ─── Config ──────────────────────────────────────────────────────────────────
const TARGET_POOL_SIZE = 45;       // active quests to keep per (subject, grade)
const ROTATION_PER_COMBO = 15;     // when rotating, retire+replace this many oldest
const COMBOS_PER_DAY = 2;          // how many combos to rotate per daily run
const REFRESH_INTERVAL_DAYS = 14;  // full-fleet rotation cadence (spread across days)
// SIZED FROM LOG EVIDENCE (2026-07-08): 25 gens measured at ~56s wall-clock and hit
// a hard 60s ceiling (maxDuration:300 is NOT applying — see the "Node.Js Version
// Override" warning on the deployment; extended duration needs a supported Node
// runtime). 12 gens ≈ 25-30s at 5-wide — safely inside 60s with margin.
// If you fix the Node version so 300s takes effect, you can raise this to ~25.
const MAX_GEN_PER_RUN = 12;
const GEN_CONCURRENCY = 5;         // parallel Haiku calls per group

export default async function handler(req, res) {
  // Auth
  const authHeader = req.headers['authorization'] || '';
  const expectedBearer = `Bearer ${process.env.CRON_SECRET || ''}`;
  const isVercelCron = process.env.CRON_SECRET && authHeader === expectedBearer;
  const manualSecret = req.query?.secret;
  const authed = isVercelCron || (manualSecret && manualSecret === process.env.CRON_SECRET);
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

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

  let state = await loadState(db);

  // Snapshot active counts for every combo (one lightweight query per combo).
  const counts = await getCounts(db);

  // ─── PHASE 1: self-heal starved combos ─────────────────────────────────────
  // Sort combos by how far below target they are (most starved first).
  const starved = [];
  for (const { subject, grade } of allCombos()) {
    const active = counts[key(subject, grade)] || 0;
    const deficit = TARGET_POOL_SIZE - active;
    if (deficit > 0) starved.push({ subject, grade, active, deficit });
  }
  starved.sort((a, b) => b.deficit - a.deficit);

  if (starved.length > 0) {
    const jobs = [];
    for (const s of starved) {
      for (let i = 0; i < s.deficit && jobs.length < MAX_GEN_PER_RUN; i++) {
        jobs.push({ subject: s.subject, grade: s.grade, conceptIndex: s.active + i });
      }
      if (jobs.length >= MAX_GEN_PER_RUN) break;
    }

    const { inserted, failed } = await runJobs(db, ANTHROPIC_KEY, jobs);

    // Recompute remaining deficit for the report (cheap: derive from counts).
    const totalDeficit = starved.reduce((sum, s) => sum + s.deficit, 0);

    state.pending_batch_id = null;      // clear any stale v11 batch cruft
    state.pending_batch_submitted_at = null;
    state.pending_batch_request_count = null;
    state.last_batch_inserted = null;
    state.phase = 'self_heal';
    state.last_run_at = new Date().toISOString();
    state.last_inserted = inserted;
    state.last_failed = failed;
    state.notes = `v12 self-heal: +${inserted} (failed ${failed}); ~${Math.max(0, totalDeficit - inserted)} still needed across pools`;
    await saveState(db, state);
    await trimServedLog(db);

    return res.status(200).json({
      action: 'self_heal',
      inserted,
      failed,
      combos_still_starved: Math.max(0, starved.length - starved.filter(s => s.deficit <= inserted).length),
      approx_remaining: Math.max(0, totalDeficit - inserted),
      note: 'Runs again daily until all pools reach target. No action needed.',
    });
  }

  // ─── PHASE 2: rolling rotation (only once nothing is starved) ───────────────
  // Gate rotation so the full fleet turns over roughly every REFRESH_INTERVAL_DAYS.
  // We advance a rolling cursor by COMBOS_PER_DAY each run; pacing works out to
  // (26 combos / COMBOS_PER_DAY) days per full sweep ≈ 13 days at 2/day.
  const combos = allCombos();
  let cursor = Number.isInteger(state.rotation_cursor) ? state.rotation_cursor : 0;

  // Only rotate if it's been at least ~ (REFRESH_INTERVAL_DAYS / sweepDays) since
  // last rotation step — but simplest robust approach: rotate a slice every run,
  // which naturally paces the fleet. We still record last_rotation_at for clarity.
  const slice = [];
  for (let i = 0; i < COMBOS_PER_DAY; i++) {
    slice.push(combos[(cursor + i) % combos.length]);
  }
  cursor = (cursor + COMBOS_PER_DAY) % combos.length;

  let retiredTotal = 0;
  const jobs = [];
  for (const { subject, grade } of slice) {
    const active = counts[key(subject, grade)] || 0;
    const retire = Math.min(ROTATION_PER_COMBO, active);
    if (retire > 0) {
      const { data: oldest } = await db
        .from('quest_pool')
        .select('id')
        .eq('subject_id', subject)
        .eq('grade_level', grade)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(retire);
      const ids = (oldest || []).map(r => r.id);
      if (ids.length > 0) {
        const { error } = await db.from('quest_pool').update({ is_active: false }).in('id', ids);
        if (!error) retiredTotal += ids.length;
      }
    }
    // Regenerate to restore target after retiring.
    const afterRetire = Math.max(0, active - retire);
    const need = Math.max(0, TARGET_POOL_SIZE - afterRetire);
    for (let i = 0; i < need && jobs.length < MAX_GEN_PER_RUN; i++) {
      jobs.push({ subject, grade, conceptIndex: afterRetire + i });
    }
  }

  const { inserted, failed } = await runJobs(db, ANTHROPIC_KEY, jobs);

  state.pending_batch_id = null;
  state.rotation_cursor = cursor;
  state.phase = 'rotate';
  state.last_run_at = new Date().toISOString();
  state.last_rotation_at = new Date().toISOString();
  state.last_retired = retiredTotal;
  state.last_inserted = inserted;
  state.last_failed = failed;
  state.notes = `v12 rotate: slice ${JSON.stringify(slice.map(s => `${s.subject}${s.grade}`))}, retired ${retiredTotal}, +${inserted} (failed ${failed})`;
  await saveState(db, state);
  await trimServedLog(db);

  return res.status(200).json({
    action: 'rotate',
    slice: slice.map(s => `${s.subject}_g${s.grade}`),
    retired: retiredTotal,
    inserted,
    failed,
    next_cursor: cursor,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a set of generation jobs in bounded parallel groups.
// ─────────────────────────────────────────────────────────────────────────────
async function runJobs(db, apiKey, jobs) {
  let inserted = 0, failed = 0;
  for (let i = 0; i < jobs.length; i += GEN_CONCURRENCY) {
    const group = jobs.slice(i, i + GEN_CONCURRENCY);
    const results = await Promise.all(group.map(j => generateOne(db, apiKey, j)));
    for (const ok of results) { if (ok) inserted++; else failed++; }
  }
  return { inserted, failed };
}

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
        model: 'claude-haiku-4-5-20251001',
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function allCombos() {
  const out = [];
  for (const subject of SUBJECTS) {
    for (const grade of (GRADE_PLAN[subject] || [])) out.push({ subject, grade });
  }
  return out;
}

function key(subject, grade) { return `${subject}_${grade}`; }

async function getCounts(db) {
  const counts = {};
  for (const { subject, grade } of allCombos()) {
    const { count } = await db
      .from('quest_pool')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', subject)
      .eq('grade_level', grade)
      .eq('is_active', true);
    counts[key(subject, grade)] = count || 0;
  }
  return counts;
}

async function loadState(db) {
  const { data } = await db
    .from('cron_state')
    .select('value')
    .eq('key', 'pool_refresh')
    .maybeSingle();
  return data?.value || { rotation_cursor: 0, last_run_at: null };
}

async function saveState(db, value) {
  await db.from('cron_state').upsert({ key: 'pool_refresh', value }, { onConflict: 'key' });
}

async function trimServedLog(db) {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await db.from('quest_served_log').delete().lt('served_at', cutoff);
}

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