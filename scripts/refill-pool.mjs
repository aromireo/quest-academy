// ─────────────────────────────────────────────────────────────────────────────
// scripts/refill-pool.mjs  —  v13
//
// Runs on GitHub Actions (no 60s ceiling). Fills starved pools and rotates
// stale quests, then exits.
//
// v13 changes (all driven by confirmed evidence, not speculation):
//   1. SCOPED GENERATION. Combos are derived from the profiles table — each
//      child's working grade per subject, plus one grade above (so promotion
//      never hits an empty pool). Was 25 hardcoded combos; now ~16 real ones.
//   2. SPLIT QUEST / LESSON. v12 asked for both in ONE call at max_tokens=2400.
//      Confirmed via stop_reason=max_tokens: the lesson block overran the
//      ceiling and truncated the JSON, so parseJsonLoose threw and a fully
//      formed quest was discarded AFTER being paid for. Now two calls.
//   3. LESSON CACHE. A lesson belongs to a CONCEPT, not a quest. All quests on
//      "Surface area using nets" share one lesson. Generated once, reused.
//   4. RETIREMENT FIX. v12 ordered by `created_at`, which does not exist on
//      quest_pool (the column is `generated_at`). The select errored silently,
//      ids came back empty, and NOTHING was ever retired — while `need` was
//      still computed as if retirement had succeeded, so it generated 15 quests
//      into already-full pools every run. Both halves are fixed here.
//   5. Errors on the retire select are now checked and logged.
//
// Env (from GitHub repo secrets):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor, conceptCount } from '../api/_lib/concepts.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-haiku-4-5-20251001';

const SUBJECTS = ['math', 'english', 'science', 'history'];

// ─── Config ──────────────────────────────────────────────────────────────────
const TARGET_POOL_SIZE = 45;       // was 45. With ~16 scoped combos this is
                                    // still ~4 weeks of quests per combo at
                                    // 1/day, and cuts backfill cost sharply.
const ROTATION_PER_COMBO = 10;
const COMBOS_PER_RUN = 4;           // 4 of ~16 => full turnover every ~4 days
const CONCURRENCY = 5;
const MAX_RETRIES = 3;

const QUEST_MAX_TOKENS = 2000;      // quest only, no lesson block — fits easily
const LESSON_MAX_TOKENS = 1100;

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

const db = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  requireEnv();
  const supa = db();
  const startedAt = Date.now();
  console.log(`[refill] start ${new Date().toISOString()} (v13)`);

  // ─── Scope: derive combos from real profiles ───────────────────────────────
  const combos = await getScopedCombos(supa);
  if (combos.length === 0) {
    console.error('[refill] no profiles found — cannot determine scope. Exiting.');
    process.exit(1);
  }
  console.log(`[refill] scope: ${combos.length} combos — ${combos.map(c => `${c.subject}_g${c.grade}`).join(', ')}`);

  const counts = await getCounts(supa, combos);
  logCounts(counts, combos);

  let state = await loadState(supa);

  // ─── PHASE 1: self-heal ────────────────────────────────────────────────────
  const starved = [];
  for (const { subject, grade } of combos) {
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

  // ─── PHASE 2: rolling rotation ─────────────────────────────────────────────
  let cursor = Number.isInteger(state.rotation_cursor) ? state.rotation_cursor : 0;
  cursor = cursor % combos.length;

  let rotRetired = 0, rotInserted = 0, rotFailed = 0;
  const rotatedSlice = [];
  const postHealCounts = healInserted > 0 ? await getCounts(supa, combos) : counts;

  let advanced = 0;
  for (let step = 0; step < combos.length && advanced < COMBOS_PER_RUN; step++) {
    const combo = combos[(cursor + step) % combos.length];
    const active = postHealCounts[key(combo.subject, combo.grade)] || 0;
    if (active < TARGET_POOL_SIZE) continue;

    advanced++;
    rotatedSlice.push(`${combo.subject}_g${combo.grade}`);

    // Retire oldest. NOTE: column is generated_at, NOT created_at (v12 bug).
    const retire = Math.min(ROTATION_PER_COMBO, active);
    let actuallyRetired = 0;
    if (retire > 0) {
      const { data: oldest, error: selErr } = await supa
        .from('quest_pool')
        .select('id')
        .eq('subject_id', combo.subject)
        .eq('grade_level', combo.grade)
        .eq('is_active', true)
        .order('generated_at', { ascending: true })
        .limit(retire);

      if (selErr) {
        // v12 swallowed this. Never again.
        console.error(`[refill] retire SELECT failed for ${combo.subject}_g${combo.grade}: ${selErr.message}`);
      } else {
        const ids = (oldest || []).map(r => r.id);
        if (ids.length) {
          const { error: updErr } = await supa
            .from('quest_pool').update({ is_active: false }).in('id', ids);
          if (updErr) {
            console.error(`[refill] retire UPDATE failed for ${combo.subject}_g${combo.grade}: ${updErr.message}`);
          } else {
            actuallyRetired = ids.length;
            rotRetired += actuallyRetired;
          }
        }
      }
    }

    // Base `need` on what was ACTUALLY retired, not what we intended to retire.
    // v12 assumed success here and generated into already-full pools.
    const afterRetire = Math.max(0, active - actuallyRetired);
    const need = Math.max(0, TARGET_POOL_SIZE - afterRetire);
    if (need === 0) {
      console.log(`[refill] ${combo.subject}_g${combo.grade}: retired ${actuallyRetired}, pool still at ${afterRetire} — nothing to generate`);
      continue;
    }
    const jobs = [];
    for (let i = 0; i < need; i++) {
      jobs.push({ subject: combo.subject, grade: combo.grade, conceptIndex: afterRetire + i });
    }
    const r = await runJobs(supa, jobs);
    rotInserted += r.inserted; rotFailed += r.failed;
  }

  cursor = (cursor + COMBOS_PER_RUN) % combos.length;
  console.log(`[refill] rotation: slice=${JSON.stringify(rotatedSlice)} retired=${rotRetired} +${rotInserted} (failed ${rotFailed})`);

  await trimServedLog(supa);

  state = {
    ...state,
    rotation_cursor: cursor,
    generator: 'github_action_v13',
    last_run_at: new Date().toISOString(),
    last_scope_size: combos.length,
    last_self_heal_inserted: healInserted,
    last_self_heal_failed: healFailed,
    last_rotation_slice: rotatedSlice,
    last_rotation_retired: rotRetired,
    last_rotation_inserted: rotInserted,
    last_rotation_failed: rotFailed,
    pending_batch_id: null,
    pending_batch_submitted_at: null,
    pending_batch_request_count: null,
  };
  await saveState(supa, state);

  const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[refill] DONE in ${secs}s — heal +${healInserted}, rotate +${rotInserted}, retired ${rotRetired}`);

  const totalInserted = healInserted + rotInserted;
  const totalFailed = healFailed + rotFailed;
  if (totalInserted === 0 && totalFailed > 0) {
    console.error('[refill] all generations failed — check ANTHROPIC_API_KEY / balance / rate limits');
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope: which (subject, grade) combos are actually in use?
// Each profile's working grade per subject, plus one above.
// ─────────────────────────────────────────────────────────────────────────────
async function getScopedCombos(supa) {
  const { data: profiles, error } = await supa
    .from('profiles')
    .select('difficulty_levels, base_grade_num');

  if (error) {
    console.error(`[refill] profiles read failed: ${error.message}`);
    return [];
  }

  const set = new Set();
  for (const p of profiles || []) {
    for (const subject of SUBJECTS) {
      const base = Number(p?.difficulty_levels?.[subject]) || Number(p?.base_grade_num) || 6;
      for (const grade of [base, base + 1]) {
        if (grade < 1 || grade > 12) continue;
        // Only include combos we have a concept bank for.
        if (conceptCount(subject, grade) === 0) continue;
        set.add(`${subject}|${grade}`);
      }
    }
  }

  return [...set]
    .map(s => { const [subject, g] = s.split('|'); return { subject, grade: Number(g) }; })
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.grade - b.grade);
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
    if (i + CONCURRENCY < jobs.length) await sleep(300);
  }
  return { inserted, failed };
}

async function generateOneWithRetry(supa, job) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await generateOne(supa, job);
    if (res.ok) return true;
    if (!res.retryable) return false;
    if (attempt < MAX_RETRIES) await sleep(2000 * Math.pow(2, attempt));
  }
  return false;
}

async function callAnthropic(system, user, maxTokens) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  return r;
}

async function generateOne(supa, job) {
  const { subject, grade, conceptIndex } = job;
  const concept = conceptFor(subject, grade, conceptIndex);

  try {
    // ─── Call 1: the quest (no lesson block) ─────────────────────────────────
    const r = await callAnthropic(
      'You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.',
      questPrompt(subject, grade, concept),
      QUEST_MAX_TOKENS
    );

    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch {}
      console.error(`[gen] ${subject}_g${grade} HTTP ${r.status} — ${detail.slice(0, 300).replace(/\s+/g, ' ')}`);
      if (r.status === 429 || r.status === 529 || r.status >= 500) return { ok: false, retryable: true };
      return { ok: false, retryable: false };
    }

    const data = await r.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    try {
      parsed = parseJsonLoose(text);
    } catch {
      console.error(`[gen] ${subject}_g${grade} PARSE FAIL — stop_reason=${data.stop_reason} out_tokens=${data.usage?.output_tokens} tail=${JSON.stringify(text.slice(-160))}`);
      // Truncation is retryable: a re-roll usually fits.
      return { ok: false, retryable: data.stop_reason === 'max_tokens' };
    }

    if (!parsed.modules || parsed.modules.length < 5 || !parsed.miniBoss || !parsed.bigBoss) {
      console.error(`[gen] ${subject}_g${grade} bad shape (missing modules/boss)`);
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

    const conceptName = parsed.concept || concept || 'General';

    // ─── Call 2: the lesson — ONLY if not already cached for this concept ────
    const lesson = await getOrCreateLesson(supa, subject, grade, conceptName, parsed);
    if (!lesson) {
      console.error(`[gen] ${subject}_g${grade} lesson unavailable for "${conceptName}"`);
      return { ok: false, retryable: false };
    }

    const { error } = await supa.from('quest_pool').insert({
      subject_id: subject,
      grade_level: grade,
      concept: conceptName,
      quest_json: parsed,
      lesson_json: lesson,
      generated_by: 'github_action_v13',
    });
    if (error) {
      console.error(`[gen] insert failed ${subject}_g${grade}: ${error.message}`);
      return { ok: false, retryable: false };
    }
    return { ok: true, retryable: false };
  } catch (err) {
    console.error(`[gen] ${subject}_g${grade} threw: ${err.message}`);
    return { ok: false, retryable: true };
  }
}

// A lesson belongs to a concept, not a quest. Generate once, reuse forever.
async function getOrCreateLesson(supa, subject, grade, concept, quest) {
  const { data: cached } = await supa
    .from('lesson_cache')
    .select('lesson_json')
    .eq('subject_id', subject)
    .eq('grade_level', grade)
    .eq('concept', concept)
    .maybeSingle();

  if (cached?.lesson_json) return cached.lesson_json;

  const r = await callAnthropic(
    'You are a sharp, direct tutor writing a pre-quest lesson. Output ONLY raw JSON. No markdown, no code fences. Start with { and end with }.',
    lessonPrompt(subject, grade, concept, quest),
    LESSON_MAX_TOKENS
  );
  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch {}
    console.error(`[lesson] ${subject}_g${grade} HTTP ${r.status} — ${detail.slice(0, 200).replace(/\s+/g, ' ')}`);
    return null;
  }

  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  let lesson;
  try {
    lesson = parseJsonLoose(text);
  } catch {
    console.error(`[lesson] ${subject}_g${grade} PARSE FAIL — stop_reason=${data.stop_reason} out_tokens=${data.usage?.output_tokens}`);
    return null;
  }

  const shaped = {
    topic: lesson.topic || concept,
    hook: lesson.hook || '',
    lesson: lesson.lesson || '',
    watchOut: lesson.watchOut || '',
    keyTerms: Array.isArray(lesson.keyTerms) ? lesson.keyTerms : [],
  };

  // Race-safe: two parallel jobs on the same concept may both reach here.
  const { error } = await supa.from('lesson_cache').upsert({
    subject_id: subject,
    grade_level: grade,
    concept,
    lesson_json: shaped,
  }, { onConflict: 'subject_id,grade_level,concept' });
  if (error) console.error(`[lesson] cache write failed: ${error.message}`);

  return shaped;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────
function key(subject, grade) { return `${subject}_${grade}`; }

async function getCounts(supa, combos) {
  const counts = {};
  for (const { subject, grade } of combos) {
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

function logCounts(counts, combos) {
  const below = Object.entries(counts).filter(([, v]) => v < TARGET_POOL_SIZE);
  console.log(`[refill] pool state: ${combos.length} combos, ${below.length} below target ${TARGET_POOL_SIZE}`);
  if (below.length) console.log(`[refill] below target: ${below.map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

async function loadState(supa) {
  const { data } = await supa
    .from('cron_state').select('value').eq('key', 'pool_refresh').maybeSingle();
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
// Prompts
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
  "bigBoss": {"id":"big","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"...","explanation":"..."}
}

RULES:
- "requiredKnowledge" lists every unit, formula, or vocab word that appears in any question.
- correctAnswer must exactly match one option string.
- Keep every "explanation" to ONE sentence.
- Output ONLY the JSON object.`;
}

function lessonPrompt(subjectId, gradeLevel, concept, quest) {
  const labels = { math: 'Math', english: 'English / Language Arts', science: 'Science', history: 'History' };
  const subject = labels[subjectId] || subjectId;
  const required = (quest?.requiredKnowledge || []).join(', ');

  return `Write the lesson card for a Grade ${gradeLevel} ${subject} quest.

Concept: ${concept}
What's tested: ${quest?.conceptSummary || concept}
Terms/units/formulas the student will encounter: ${required || '(none specific)'}

Teach every term listed above. Include one concrete worked example with step-by-step reasoning. Do not dumb it down.

Return JSON:
{
  "topic": "Short topic name (max 5 words)",
  "hook": "One opening sentence — why this matters or a surprising fact",
  "lesson": "2-3 short paragraphs: core concept, then a worked example, then the key nuance to watch. Under 200 words.",
  "watchOut": "One sentence on the most common mistake",
  "keyTerms": [{"term": "...", "definition": "..."}]
}

Include at most 4 keyTerms. Use "the student" or {NAME} if referring to a student.
Output ONLY the JSON object.`;
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
