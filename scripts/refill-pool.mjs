// ─────────────────────────────────────────────────────────────────────────────
// scripts/refill-pool.mjs
//
// Pool generator that runs on GitHub Actions (NOT on Vercel), so it has NO
// 60-second ceiling — GitHub Actions allow up to 6 hours. It fills starved
// pools and rotates stale quests in ONE clean pass, then exits.
//
// This REPLACES the generation role of api/cron-refill-pool.js and
// api/bootstrap-pool.js. Vercel now only SERVES quests (api/pool.js); it no
// longer generates them.
//
// Reuses api/_lib/concepts.js (imported, not copied) so the concept bank lives
// in exactly one place.
//
// Env (provided by the GitHub Actions workflow from repo secrets):
//   ANTHROPIC_API_KEY
//   SUPABASE_URL                (your Supabase project URL)
//   SUPABASE_SERVICE_ROLE_KEY   (service role key)
//
// Run locally for testing:
//   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/refill-pool.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor } from '../api/_lib/concepts.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECTS = ['math', 'english', 'science', 'history'];
const GRADE_PLAN = {
  math:    [3, 4, 5, 6, 7, 8, 9],  // grade 6 added 2026-07-08: concepts.js has it; fills math_6 to target
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

// ─── Config ──────────────────────────────────────────────────────────────────
const TARGET_POOL_SIZE = 45;       // active quests to keep per (subject, grade)
const ROTATION_PER_COMBO = 15;     // retire+replace this many oldest per rotating combo
const COMBOS_PER_RUN = 2;          // how many combos to rotate each daily run
const CONCURRENCY = 5;             // parallel Haiku calls. The earlier 400s were a billing block,
                                    // NOT rate limits — 5 ran 250 quests in <7min with zero throttling.
const MAX_RETRIES = 3;             // per-quest retries for retryable (429/5xx) failures

// ─── Env ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!ANTHROPIC_KEY) missing.push('ANTHROPIC_API_KEY');
  if (missing.length) {
    console.error(`FATAL: missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Provide the `ws` transport explicitly so the client works on any Node version
// (Node < 22 has no native WebSocket, which @supabase/supabase-js needs when it
// initializes its realtime client). The Action also runs on Node 22, so this is
// belt-and-suspenders. This script does no realtime work — it's REST only.
const db = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  requireEnv();
  const supa = db();
  const startedAt = Date.now();
  console.log(`[refill] start ${new Date().toISOString()}`);

  const counts = await getCounts(supa);
  logCounts(counts);

  let state = await loadState(supa);

  // ─── PHASE 1: self-heal — fill EVERY starved combo to target, in one pass ───
  // No 60s ceiling here, so we don't cap the number of generations. We fill the
  // whole backlog. (A cold start of ~345 quests takes a few minutes — fine.)
  const starved = [];
  for (const { subject, grade } of allCombos()) {
    const active = counts[key(subject, grade)] || 0;
    const deficit = TARGET_POOL_SIZE - active;
    if (deficit > 0) starved.push({ subject, grade, active, deficit });
  }
  starved.sort((a, b) => b.deficit - a.deficit);

  let healInserted = 0, healFailed = 0;
  if (starved.length > 0) {
    const jobs = [];
    for (const s of starved) {
      for (let i = 0; i < s.deficit; i++) {
        jobs.push({ subject: s.subject, grade: s.grade, conceptIndex: s.active + i });
      }
    }
    console.log(`[refill] self-heal: ${starved.length} starved combos, generating ${jobs.length} quests`);
    const r = await runJobs(supa, jobs);
    healInserted = r.inserted; healFailed = r.failed;
    console.log(`[refill] self-heal done: +${healInserted} inserted, ${healFailed} failed`);
  } else {
    console.log('[refill] no starved combos — pools at/above target');
  }

  // ─── PHASE 2: rolling rotation — retire oldest + regenerate for a slice ─────
  // Only rotate combos that are actually at/above target (don't rotate a combo
  // we just healed; leave it fresh). Advance a rolling cursor so the whole fleet
  // turns over every ~13 days at 2 combos/run.
  const combos = allCombos();
  let cursor = Number.isInteger(state.rotation_cursor) ? state.rotation_cursor : 0;

  let rotRetired = 0, rotInserted = 0, rotFailed = 0;
  const rotatedSlice = [];
  // Re-fetch counts if we healed, so rotation sees the updated numbers.
  const postHealCounts = healInserted > 0 ? await getCounts(supa) : counts;

  let advanced = 0;
  for (let step = 0; step < combos.length && advanced < COMBOS_PER_RUN; step++) {
    const combo = combos[(cursor + step) % combos.length];
    const active = postHealCounts[key(combo.subject, combo.grade)] || 0;
    // Skip combos still below target (they were just healed or generation failed);
    // rotating them would only shrink them.
    if (active < TARGET_POOL_SIZE) continue;

    advanced++;
    rotatedSlice.push(`${combo.subject}_g${combo.grade}`);

    const retire = Math.min(ROTATION_PER_COMBO, active);
    if (retire > 0) {
      const { data: oldest } = await supa
        .from('quest_pool')
        .select('id')
        .eq('subject_id', combo.subject)
        .eq('grade_level', combo.grade)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(retire);
      const ids = (oldest || []).map(r => r.id);
      if (ids.length) {
        const { error } = await supa.from('quest_pool').update({ is_active: false }).in('id', ids);
        if (!error) rotRetired += ids.length;
        else console.error(`[refill] retire failed for ${combo.subject}_g${combo.grade}: ${error.message}`);
      }
    }

    const afterRetire = Math.max(0, active - retire);
    const need = Math.max(0, TARGET_POOL_SIZE - afterRetire);
    const jobs = [];
    for (let i = 0; i < need; i++) {
      jobs.push({ subject: combo.subject, grade: combo.grade, conceptIndex: afterRetire + i });
    }
    if (jobs.length) {
      const r = await runJobs(supa, jobs);
      rotInserted += r.inserted; rotFailed += r.failed;
    }
  }
  // Advance cursor past what we examined so next run continues the sweep.
  cursor = (cursor + COMBOS_PER_RUN) % combos.length;
  console.log(`[refill] rotation: slice=${JSON.stringify(rotatedSlice)} retired=${rotRetired} +${rotInserted} (failed ${rotFailed})`);

  // ─── Housekeeping + state ──────────────────────────────────────────────────
  await trimServedLog(supa);

  state = {
    ...state,
    rotation_cursor: cursor,
    generator: 'github_action',
    last_run_at: new Date().toISOString(),
    last_self_heal_inserted: healInserted,
    last_self_heal_failed: healFailed,
    last_rotation_slice: rotatedSlice,
    last_rotation_retired: rotRetired,
    last_rotation_inserted: rotInserted,
    last_rotation_failed: rotFailed,
    // clear any stale v11 batch fields so cron_state is clean
    pending_batch_id: null,
    pending_batch_submitted_at: null,
    pending_batch_request_count: null,
  };
  await saveState(supa, state);

  const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[refill] DONE in ${secs}s — heal +${healInserted}, rotate +${rotInserted}, retired ${rotRetired}`);

  // Non-zero exit if EVERYTHING failed (so the Action shows red and you notice).
  const totalInserted = healInserted + rotInserted;
  const totalFailed = healFailed + rotFailed;
  if (totalInserted === 0 && totalFailed > 0) {
    console.error('[refill] all generations failed — check ANTHROPIC_API_KEY / rate limits');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────
async function runJobs(supa, jobs) {
  let inserted = 0, failed = 0;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const group = jobs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map(j => generateOneWithRetry(supa, j)));
    for (const ok of results) { if (ok) inserted++; else failed++; }
    // small pause between groups (courtesy, not throttling avoidance)
    if (i + CONCURRENCY < jobs.length) await sleep(300);
  }
  return { inserted, failed };
}

async function generateOneWithRetry(supa, job) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await generateOne(supa, job);
    if (res.ok) return true;
    // Don't waste retries on non-retryable errors (bad request, parse, bad shape).
    if (!res.retryable) return false;
    if (attempt < MAX_RETRIES) {
      // Exponential backoff for rate-limit / overloaded: 2s, 4s, 8s.
      await sleep(2000 * Math.pow(2, attempt));
    }
  }
  return false;
}

async function generateOne(supa, job) {
  const { subject, grade, conceptIndex } = job;
  const concept = conceptFor(subject, grade, conceptIndex);
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2400,
        system: 'You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.',
        messages: [{ role: 'user', content: questPrompt(subject, grade, concept) }],
      }),
    });
    if (!r.ok) {
      // Read the actual error body so we know WHY (invalid request vs rate limit
      // vs overloaded). Previously we only logged the status code, which hid the
      // real cause.
      let detail = '';
      try { detail = await r.text(); } catch {}
      const short = detail.slice(0, 300).replace(/\s+/g, ' ');
      console.error(`[gen] ${subject}_g${grade} HTTP ${r.status} — ${short}`);
      // Signal retryable conditions (rate limit / overloaded / server) to caller.
      if (r.status === 429 || r.status === 529 || r.status >= 500) {
        return { ok: false, retryable: true };
      }
      return { ok: false, retryable: false };
    }
    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    try { parsed = parseJsonLoose(text); } catch { return { ok: false, retryable: false }; }

    if (!parsed.modules || parsed.modules.length < 5 || !parsed.miniBoss || !parsed.bigBoss || !parsed.lesson) {
      console.error(`[gen] ${subject}_g${grade} bad shape (missing modules/boss/lesson)`);
      return { ok: false, retryable: false };
    }
    const allQs = [...parsed.modules, parsed.miniBoss, parsed.bigBoss];
    for (const q of allQs) {
      if (!Array.isArray(q.options)) return { ok: false, retryable: false };
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

    const { error } = await supa.from('quest_pool').insert({
      subject_id: subject,
      grade_level: grade,
      concept: parsed.concept || null,
      quest_json: parsed,
      lesson_json: lesson,
      generated_by: 'github_action',
    });
    if (error) { console.error(`[gen] insert failed ${subject}_g${grade}: ${error.message}`); return { ok: false, retryable: false }; }
    return { ok: true, retryable: false };
  } catch (err) {
    console.error(`[gen] ${subject}_g${grade} threw: ${err.message}`);
    return { ok: false, retryable: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────
function allCombos() {
  const out = [];
  for (const subject of SUBJECTS) {
    for (const grade of (GRADE_PLAN[subject] || [])) out.push({ subject, grade });
  }
  return out;
}
function key(subject, grade) { return `${subject}_${grade}`; }

async function getCounts(supa) {
  const counts = {};
  for (const { subject, grade } of allCombos()) {
    const { count } = await supa
      .from('quest_pool')
      .select('id', { count: 'exact', head: true })
      .eq('subject_id', subject)
      .eq('grade_level', grade)
      .eq('is_active', true);
    counts[key(subject, grade)] = count || 0;
  }
  return counts;
}

function logCounts(counts) {
  const below = Object.entries(counts).filter(([, v]) => v < TARGET_POOL_SIZE);
  console.log(`[refill] pool state: ${Object.keys(counts).length} combos, ${below.length} below target ${TARGET_POOL_SIZE}`);
  if (below.length) console.log(`[refill] below target: ${below.map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function loadState(supa) {
  const { data } = await supa
    .from('cron_state')
    .select('value')
    .eq('key', 'pool_refresh')
    .maybeSingle();
  return data?.value || { rotation_cursor: 0 };
}

async function saveState(supa, value) {
  const { error } = await supa.from('cron_state').upsert({ key: 'pool_refresh', value }, { onConflict: 'key' });
  if (error) console.error(`[refill] saveState failed: ${error.message}`);
}

async function trimServedLog(supa) {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await supa.from('quest_served_log').delete().lt('served_at', cutoff);
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Prompt + parse (same shape bootstrap/cron produced, so pool.js reads it identically)
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

main().catch(err => { console.error('[refill] FATAL', err); process.exit(1); });
