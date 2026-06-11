// ─────────────────────────────────────────────────────────────────────────────
// /api/bootstrap-pool.js  —  v11.1
// One-time pool fill using the Anthropic Message Batches API.
//
// Workflow:
//   1. First call:  submit a batch with all needed quests, returns batch_id
//   2. Wait 5-30 min (sometimes a few hours) while Anthropic processes
//   3. Second call: poll the batch, if done, consume results and insert
//                   into quest_pool
//   4. Repeat #3 if not done yet
//
// State is persisted in the cron_state table under key 'bootstrap'.
//
// Why Batches API?
//   - 50% cheaper than synchronous calls
//   - One submit handles ~140 quests in one HTTP call (5 seconds)
//   - Doesn't count against your normal rate limits
//   - You only refresh the URL 2-3 times total instead of 144 times
//
// Protected by ?secret=... matching CRON_SECRET env var.
// Reset state: append &reset=1 to clear any stuck batch.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { conceptFor } from './_lib/concepts.js';

export const config = { maxDuration: 55 };

const ANTHROPIC_VERSION = '2023-06-01';
const BATCHES_URL = 'https://api.anthropic.com/v1/messages/batches';

const SUBJECTS = ['math', 'english', 'science', 'history'];
const GRADE_PLAN = {
  math:    [3, 4, 5, 7, 8, 9],
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

const BOOTSTRAP_TARGET = 30; // quests per (subject, grade) at bootstrap

export default async function handler(req, res) {
  // Auth
  const secret = req.query?.secret || req.headers['x-bootstrap-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Env vars missing' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // Optional reset flag — clear stuck state
  if (req.query?.reset === '1') {
    await db.from('cron_state').delete().eq('key', 'bootstrap');
    return res.status(200).json({
      ok: true,
      reset: true,
      message: 'Bootstrap state cleared. Call this URL again (without reset=1) to submit a new batch.',
    });
  }

  // Load state
  const { data: stateRow } = await db
    .from('cron_state')
    .select('value')
    .eq('key', 'bootstrap')
    .maybeSingle();
  const state = stateRow?.value || {};

  // ─── Phase 1: no pending batch → submit one ───────────────────────────────
  if (!state.pending_batch_id) {
    const requests = await buildBatchRequests(db);
    if (requests.length === 0) {
      return res.status(200).json({
        ok: true,
        done: true,
        message: 'Pool is already full. Nothing to do.',
      });
    }

    const submit = await fetch(BATCHES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        requests: requests.map(r => ({ custom_id: r.custom_id, params: r.params })),
      }),
    });

    const submitData = await submit.json();
    if (!submit.ok || !submitData?.id) {
      return res.status(500).json({
        ok: false,
        message: 'Failed to submit batch',
        detail: submitData,
      });
    }

    await db.from('cron_state').upsert({
      key: 'bootstrap',
      value: {
        pending_batch_id: submitData.id,
        submitted_at: new Date().toISOString(),
        request_count: requests.length,
      },
    }, { onConflict: 'key' });

    return res.status(200).json({
      ok: true,
      phase: 'submitted',
      batch_id: submitData.id,
      request_count: requests.length,
      estimated_wait: '5-30 minutes (sometimes up to a few hours)',
      next_step: 'Wait at least 5 minutes, then refresh this same URL. It will check progress.',
    });
  }

  // ─── Phase 2: poll & consume ──────────────────────────────────────────────
  const pollRes = await fetch(`${BATCHES_URL}/${state.pending_batch_id}`, {
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': ANTHROPIC_VERSION },
  });

  if (!pollRes.ok) {
    return res.status(500).json({
      ok: false,
      message: 'Failed to poll batch',
      batch_id: state.pending_batch_id,
      hint: 'If this persists, append &reset=1 to the URL to clear state and start over.',
    });
  }

  const batchStatus = await pollRes.json();
  const submittedAt = state.submitted_at ? new Date(state.submitted_at) : null;
  const minutesElapsed = submittedAt ? Math.round((Date.now() - submittedAt.getTime()) / 60000) : 0;

  if (batchStatus.processing_status === 'in_progress') {
    return res.status(200).json({
      ok: true,
      phase: 'in_progress',
      batch_id: state.pending_batch_id,
      counts: batchStatus.request_counts,
      minutes_elapsed: minutesElapsed,
      next_step: 'Still processing. Refresh again in 5-10 minutes.',
    });
  }

  if (batchStatus.processing_status !== 'ended') {
    return res.status(200).json({
      ok: true,
      phase: batchStatus.processing_status,
      batch_id: state.pending_batch_id,
      counts: batchStatus.request_counts,
    });
  }

  // Batch is done — consume results
  if (!batchStatus.results_url) {
    return res.status(500).json({
      ok: false,
      message: 'Batch ended but no results_url present',
      batchStatus,
    });
  }

  const resultsRes = await fetch(batchStatus.results_url, {
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': ANTHROPIC_VERSION },
  });
  if (!resultsRes.ok) {
    return res.status(500).json({
      ok: false,
      message: 'Failed to fetch results',
      status: resultsRes.status,
    });
  }

  const text = await resultsRes.text();
  const lines = text.split('\n').filter(Boolean);
  let inserted = 0, failed = 0;
  const failureDetails = [];

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { failed++; continue; }

    if (entry.result?.type !== 'succeeded') {
      failed++;
      if (failureDetails.length < 5) {
        failureDetails.push({
          id: entry.custom_id,
          type: entry.result?.type,
          error: entry.result?.error?.message,
        });
      }
      continue;
    }

    const m = /^([a-z]+)_g(\d+)_/.exec(entry.custom_id || '');
    if (!m) { failed++; continue; }
    const subject = m[1];
    const grade = parseInt(m[2], 10);

    const content = entry.result.message?.content || [];
    const textOut = content.filter(b => b.type === 'text').map(b => b.text).join('');

    let parsed;
    try { parsed = parseJsonLoose(textOut); }
    catch {
      failed++;
      if (failureDetails.length < 5) {
        failureDetails.push({ id: entry.custom_id, error: 'JSON parse failed', preview: textOut.slice(0, 200) });
      }
      continue;
    }

    // Validate required shape
    if (!parsed.modules || !Array.isArray(parsed.modules) || parsed.modules.length < 5
        || !parsed.miniBoss || !parsed.bigBoss || !parsed.lesson) {
      failed++;
      if (failureDetails.length < 5) failureDetails.push({
        id: entry.custom_id,
        error: 'missing sections',
        hasModules: parsed.modules?.length,
        hasMini: !!parsed.miniBoss,
        hasBig: !!parsed.bigBoss,
        hasLesson: !!parsed.lesson,
      });
      continue;
    }

    // Normalize correctAnswer
    const allQs = [...parsed.modules, parsed.miniBoss, parsed.bigBoss];
    for (const q of allQs) {
      if (!Array.isArray(q.options)) { q.options = []; continue; }
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

    const { error: insErr } = await db.from('quest_pool').insert({
      subject_id: subject,
      grade_level: grade,
      concept: parsed.concept || null,
      quest_json: parsed,
      lesson_json: lesson,
      generated_by: 'bootstrap',
    });
    if (insErr) {
      failed++;
      if (failureDetails.length < 5) failureDetails.push({ id: entry.custom_id, error: insErr.message });
    } else {
      inserted++;
    }
  }

  // Clear the pending batch state — done with this batch
  await db.from('cron_state').delete().eq('key', 'bootstrap');

  // Check what's left across all combos
  const remaining = await countRemaining(db);

  return res.status(200).json({
    ok: true,
    phase: 'completed',
    inserted,
    failed,
    failure_details: failureDetails,
    remaining,
    done: remaining.totalRemaining === 0,
    next_step: remaining.totalRemaining === 0
      ? 'Bootstrap complete! Kids can use the app now.'
      : `Some quests failed validation. ${remaining.totalRemaining} short. Refresh this URL once to submit another batch for the gaps.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the batch requests list — one entry per quest needed
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
      const need = Math.max(0, BOOTSTRAP_TARGET - (count || 0));
      for (let i = 0; i < need; i++) {
        const concept = conceptFor(subject, grade, (count || 0) + i);
        out.push({
          custom_id: `${subject}_g${grade}_n${i}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,
          params: {
            model: 'claude-haiku-4-5-20251001', // pool gen: Haiku is 10x cheaper, quality fine for MC questions
            max_tokens: 2400,
            system: 'You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }. The JSON must include modules (array of 5), miniBoss, bigBoss, AND lesson — all four sections are mandatory.',
            messages: [{ role: 'user', content: questPrompt(subject, grade, concept) }],
          },
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
    : `All 7 questions test ONE focused concept appropriate for Grade ${gradeLevel} ${subject}.`;
  return `Generate a ${subject} quest at Grade ${gradeLevel} curriculum level.

IMPORTANT: Match content to Grade ${gradeLevel} curriculum standards exactly. Make questions challenging but fair.

${conceptLine}

If any word problem features a student, refer to them as "the student" or use {NAME}. Use the placeholder {PRONOUN_SUBJECT} (they/he/she) and {PRONOUN_POSSESSIVE} (their/his/her) where pronouns are needed.

STRUCTURE — all four sections are MANDATORY:
- "modules": exactly 5 questions, progressive practice
- "miniBoss": exactly 1 question, synthesis
- "bigBoss": exactly 1 question, transfer to new context
- "lesson": pre-quest teaching card

All 7 questions test the assigned concept.

Output this EXACT JSON shape (do not omit any top-level key):
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
- All 4 sections (modules, miniBoss, bigBoss, lesson) are REQUIRED — output is invalid if any is missing.
- "requiredKnowledge" lists every unit, formula, or vocab word that appears in any question. The lesson MUST define all of them.
- correctAnswer must exactly match one option string.
- Output ONLY the JSON object.`;
}

async function countRemaining(db) {
  const byCombo = {};
  let totalRemaining = 0;
  for (const subject of SUBJECTS) {
    for (const grade of (GRADE_PLAN[subject] || [])) {
      const { count } = await db
        .from('quest_pool')
        .select('id', { count: 'exact', head: true })
        .eq('subject_id', subject)
        .eq('grade_level', grade)
        .eq('is_active', true);
      const have = count || 0;
      const remaining = Math.max(0, BOOTSTRAP_TARGET - have);
      byCombo[`${subject}_g${grade}`] = { have, target: BOOTSTRAP_TARGET, remaining };
      totalRemaining += remaining;
    }
  }
  return { totalRemaining, byCombo };
}

function parseJsonLoose(text) {
  let clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('no json');
  const j = clean.slice(s, e + 1);
  try { return JSON.parse(j); }
  catch { return JSON.parse(j.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ' ')); }
}