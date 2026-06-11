// ─────────────────────────────────────────────────────────────────────────────
// /api/cron-refill-pool.js  —  v11
// Daily cron job. Manages a bi-weekly refresh cycle using the Anthropic
// Message Batches API (50% cheaper than synchronous calls, separate rate limits).
//
// Each daily invocation does ONE of these:
//
//   A) If there's a pending batch → poll it. If complete, parse results and
//      insert into quest_pool. If still in_progress, exit.
//
//   B) If no pending batch AND it's been >= 14 days since last refresh →
//      submit a new batch (one request per (subject, grade, slot_to_fill)).
//
//   C) Otherwise → do nothing this day.
//
// State is tracked in a small `cron_state` row stored as JSON in Supabase.
//
// Secured by Vercel's CRON_SECRET header (Vercel sets x-vercel-cron-signature
// automatically; we also accept ?secret= for manual triggering).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor } from './_lib/concepts.js';

export const config = { maxDuration: 55 };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECTS = ['math', 'english', 'science', 'history'];
const GRADE_PLAN = {
  math:    [3, 4, 5, 7, 8, 9],
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

const TARGET_POOL_SIZE = 60;       // bi-weekly target per (subject, grade)
const REFRESH_INTERVAL_DAYS = 14;  // bi-weekly cadence
const MAX_PER_BATCH = 60;          // cap one batch at this many requests to keep things manageable

export default async function handler(req, res) {
  // Auth: Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically.
  // Also accept ?secret= for manual testing from the browser.
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

  // Load (or initialize) cron state
  let state = await loadState(db);

  // ─── Path A: poll an in-progress batch ────────────────────────────────────
  if (state.pending_batch_id) {
    const status = await pollBatch(ANTHROPIC_KEY, state.pending_batch_id);
    if (!status) {
      // Batch lookup failed — clear so we don't get stuck
      state.pending_batch_id = null;
      state.notes = 'Batch lookup failed, cleared';
      await saveState(db, state);
      return res.status(200).json({ action: 'cleared_stuck_batch', state });
    }
    if (status.processing_status === 'in_progress') {
      return res.status(200).json({
        action: 'still_processing',
        batchId: state.pending_batch_id,
        counts: status.request_counts,
      });
    }
    if (status.processing_status === 'ended') {
      const inserted = await consumeBatchResults(db, ANTHROPIC_KEY, status);
      state.pending_batch_id = null;
      state.last_refresh_at = new Date().toISOString();
      state.last_batch_inserted = inserted.count;
      await saveState(db, state);
      // Also clean old quest_served_log rows (keep last 200 per profile)
      await trimServedLog(db);
      return res.status(200).json({
        action: 'batch_complete',
        inserted: inserted.count,
        failed: inserted.failed,
      });
    }
  }

  // ─── Path B: maybe submit a new batch ─────────────────────────────────────
  const lastRefresh = state.last_refresh_at ? new Date(state.last_refresh_at) : null;
  const daysSinceRefresh = lastRefresh
    ? (Date.now() - lastRefresh.getTime()) / (24 * 60 * 60 * 1000)
    : Infinity;

  if (daysSinceRefresh < REFRESH_INTERVAL_DAYS) {
    return res.status(200).json({
      action: 'no_op',
      reason: 'not_yet_time_to_refresh',
      daysSinceRefresh: daysSinceRefresh.toFixed(1),
      nextRefreshIn: (REFRESH_INTERVAL_DAYS - daysSinceRefresh).toFixed(1),
    });
  }

  // Build the request list: top up every (subject, grade) to TARGET_POOL_SIZE
  const requests = await buildBatchRequests(db);
  if (requests.length === 0) {
    state.last_refresh_at = new Date().toISOString();
    state.notes = 'No top-up needed';
    await saveState(db, state);
    return res.status(200).json({ action: 'no_op', reason: 'pool_already_full' });
  }

  const batch = await submitBatch(ANTHROPIC_KEY, requests.slice(0, MAX_PER_BATCH));
  if (!batch?.id) {
    return res.status(500).json({ action: 'submit_failed', detail: batch });
  }

  state.pending_batch_id = batch.id;
  state.pending_batch_submitted_at = new Date().toISOString();
  state.pending_batch_request_count = requests.slice(0, MAX_PER_BATCH).length;
  await saveState(db, state);

  return res.status(200).json({
    action: 'batch_submitted',
    batchId: batch.id,
    requestCount: requests.slice(0, MAX_PER_BATCH).length,
    note: 'Daily cron will poll until complete.',
  });
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
  return data?.value || {
    pending_batch_id: null,
    last_refresh_at: null,
  };
}

async function saveState(db, value) {
  await db.from('cron_state').upsert({ key: 'pool_refresh', value }, { onConflict: 'key' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the batch requests array
// ─────────────────────────────────────────────────────────────────────────────
async function buildBatchRequests(db) {
  const out = [];
  for (const subject of SUBJECTS) {
    for (const grade of (GRADE_PLAN[subject] || [])) {
      const { count } = await db
        .from('quest_pool')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', subject)
        .eq('grade_level', grade)
        .eq('is_active', true);
      const need = Math.max(0, TARGET_POOL_SIZE - (count || 0));
      for (let i = 0; i < need; i++) {
        const concept = conceptFor(subject, grade, (count || 0) + i);
        out.push({
          custom_id: `${subject}_g${grade}_n${i}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
          params: {
            model: 'claude-haiku-4-5-20251001', // pool gen: Haiku is 10x cheaper, quality fine for MC questions
            max_tokens: 2400,
            system: 'You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.',
            messages: [{
              role: 'user',
              content: questPrompt(subject, grade, concept),
            }],
          },
          meta: { subject, grade }, // not sent to API, just used in our records
        });
      }
    }
  }
  return out;
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

// ─────────────────────────────────────────────────────────────────────────────
// Batch API calls
// ─────────────────────────────────────────────────────────────────────────────
async function submitBatch(apiKey, requests) {
  const r = await fetch(BATCHES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      requests: requests.map(r => ({ custom_id: r.custom_id, params: r.params })),
    }),
  });
  return r.json();
}

async function pollBatch(apiKey, batchId) {
  const r = await fetch(`${BATCHES_URL}/${batchId}`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
  });
  if (!r.ok) return null;
  return r.json();
}

async function consumeBatchResults(db, apiKey, batchStatus) {
  if (!batchStatus.results_url) return { count: 0, failed: 0 };
  const r = await fetch(batchStatus.results_url, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
  });
  if (!r.ok) return { count: 0, failed: 0 };
  const text = await r.text();
  const lines = text.split('\n').filter(Boolean);
  let inserted = 0, failed = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { failed++; continue; }
    if (entry.result?.type !== 'succeeded') { failed++; continue; }
    // Parse subject + grade from custom_id (format: "<subject>_g<grade>_n<i>_<rand>")
    const m = /^([a-z]+)_g(\d+)_/.exec(entry.custom_id || '');
    if (!m) { failed++; continue; }
    const subject = m[1];
    const grade = parseInt(m[2], 10);

    const content = entry.result.message?.content || [];
    const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
    let parsed;
    try { parsed = parseJsonLoose(text); } catch { failed++; continue; }

    // Validate shape
    if (!parsed.modules || parsed.modules.length < 5 || !parsed.miniBoss || !parsed.bigBoss || !parsed.lesson) {
      failed++; continue;
    }
    // Normalize correctAnswers
    const allQs = [...parsed.modules, parsed.miniBoss, parsed.bigBoss];
    let bad = false;
    for (const q of allQs) {
      if (!Array.isArray(q.options)) { bad = true; break; }
      if (!q.options.includes(q.correctAnswer)) {
        const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase());
        q.correctAnswer = match || q.options[0];
      }
    }
    if (bad) { failed++; continue; }
    parsed.modules.forEach(q => { q.kind = 'module'; });
    parsed.miniBoss.kind = 'miniBoss';
    parsed.bigBoss.kind = 'bigBoss';
    parsed.questions = [...parsed.modules, parsed.miniBoss];
    parsed.bossQuestion = parsed.bigBoss;

    const lesson = parsed.lesson;
    delete parsed.lesson; // store separately

    const { error } = await db.from('quest_pool').insert({
      subject_id: subject,
      grade_level: grade,
      concept: parsed.concept || null,
      quest_json: parsed,
      lesson_json: lesson,
      generated_by: 'cron',
    });
    if (error) failed++; else inserted++;
  }
  return { count: inserted, failed };
}

async function trimServedLog(db) {
  // Trim each profile's served log to keep only the last 200 rows.
  // Simple version: delete anything older than 60 days.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  await db.from('quest_served_log').delete().lt('served_at', cutoff);
}

function parseJsonLoose(text) {
  let clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no json');
  const j = clean.slice(s, e + 1);
  try { return JSON.parse(j); }
  catch { return JSON.parse(j.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ' ')); }
}
