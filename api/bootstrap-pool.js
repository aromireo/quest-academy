// ─────────────────────────────────────────────────────────────────────────────
// /api/bootstrap-pool.js  —  v11
// One-time pool fill, RESUMABLE for Vercel Hobby plan (60s function limit).
//
// Each call does as many quests as fit in 50s, then returns what's left.
// The deploy guide tells the user to call it ~5-8 times in a row.
//
// Protected by ?secret=... query param matching CRON_SECRET env var.
//
// Usage:
//   curl "https://<your-app>.vercel.app/api/bootstrap-pool?secret=YOUR_SECRET"
//   (returns JSON with progress; call again until done.remaining === 0)
//
// Or paste the URL in your browser. Each call shows progress.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { generateQuestAndLesson } from './_lib/generate.js';

export const config = { maxDuration: 55 };

const SUBJECTS = ['math', 'english', 'science', 'history'];

// Grade levels: cover both kids' current levels + one above for headroom.
// Teniola (slot 0): Math 8, others 7  →  math: 7,8,9; others: 6,7,8
// Moyo (slot 1):    4 across the board → all: 3,4,5
// Combined unique per subject:
const GRADE_PLAN = {
  math:    [3, 4, 5, 7, 8, 9],
  english: [3, 4, 5, 6, 7, 8],
  science: [3, 4, 5, 6, 7, 8],
  history: [3, 4, 5, 6, 7, 8],
};

const BOOTSTRAP_TARGET = 12; // quests per (subject, grade) at bootstrap; cron tops up later
const TIME_BUDGET_MS = 48_000; // leave ~7s buffer before Vercel kills the function
const PER_QUEST_BUDGET_MS = 25_000; // typical generation is ~15-20s; stop early if one is slow

export default async function handler(req, res) {
  // Auth
  const secret = req.query?.secret || req.headers['x-bootstrap-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars missing on server' });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const summary = { created: 0, failed: 0, byCombo: {} };

  // Build work queue: every (subject, grade) that doesn't have enough yet
  const work = await buildQueue(db);

  // Process until budget exhausted
  for (const item of work) {
    const elapsed = Date.now() - startedAt;
    if (elapsed + PER_QUEST_BUDGET_MS > TIME_BUDGET_MS) {
      // Not enough time left to safely run another generation
      break;
    }
    try {
      const { quest, lesson } = await generateQuestAndLesson(item.subject, item.grade);
      const { error: insertErr } = await db.from('quest_pool').insert({
        subject_id: item.subject,
        grade_level: item.grade,
        concept: quest.concept || null,
        quest_json: quest,
        lesson_json: lesson,
        generated_by: 'bootstrap',
      });
      const comboKey = `${item.subject}_g${item.grade}`;
      if (insertErr) {
        summary.failed += 1;
        summary.byCombo[comboKey] = (summary.byCombo[comboKey] || 0);
      } else {
        summary.created += 1;
        summary.byCombo[comboKey] = (summary.byCombo[comboKey] || 0) + 1;
      }
    } catch (err) {
      summary.failed += 1;
      // On rate limit, bail out of the whole call so the user retries after the minute resets
      if (/rate.?limit/i.test(err.message) || /429/.test(err.message)) {
        const remaining = await countRemaining(db);
        return res.status(200).json({
          ok: true,
          rate_limited: true,
          message: 'Hit Anthropic rate limit. Wait ~60s and call this URL again.',
          summary,
          remaining,
          elapsed_ms: Date.now() - startedAt,
        });
      }
    }
  }

  const remaining = await countRemaining(db);
  const done = remaining.totalRemaining === 0;

  return res.status(200).json({
    ok: true,
    done,
    summary,
    remaining,
    elapsed_ms: Date.now() - startedAt,
    next_step: done
      ? 'Pool is fully bootstrapped! Kids can use the app now.'
      : `Call this URL again to continue. ${remaining.totalRemaining} quests still needed.`,
  });
}

async function buildQueue(db) {
  // Read current counts and figure out what needs creating
  const queue = [];
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
        queue.push({ subject, grade });
      }
    }
  }
  // Interleave subjects so each call makes broad progress instead of finishing one subject first
  queue.sort((a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject));
  return queue;
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
