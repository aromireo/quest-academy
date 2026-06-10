// ─────────────────────────────────────────────────────────────────────────────
// /api/pool.js  —  v11
// Fetch a quest+lesson pair from the pre-generated pool.
//
// Request:  POST { profileId, subjectId, gradeLevel }
// Response: { quest, lesson, poolId }
//
// Strategy:
//   1. Find rows for (subject, grade, is_active) the profile has NOT seen recently
//   2. If empty, find any rows for (subject, grade, is_active)
//   3. If STILL empty, fall back to live generation and write it to the pool
//   4. Pick the row with the lowest times_served (rotate evenly)
//   5. Increment times_served, log the serve, return quest + lesson
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

export const config = { maxDuration: 55 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Recent-served window: don't show a kid the same quest twice within this many days
const RECENT_WINDOW_DAYS = 14;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed' } });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({
      error: { code: 'config_error', message: 'Supabase env vars missing on server' },
    });
  }

  const { profileId, subjectId, gradeLevel } = req.body || {};
  if (!profileId || !subjectId || !gradeLevel) {
    return res.status(400).json({
      error: { code: 'bad_request', message: 'profileId, subjectId, gradeLevel required' },
    });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  try {
    // Step 1: get IDs this profile has seen in the last N days, so we can exclude them
    const recentCutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentErr } = await db
      .from('quest_served_log')
      .select('quest_pool_id')
      .eq('profile_id', profileId)
      .gte('served_at', recentCutoff);

    if (recentErr) console.error('[pool] recent log read failed:', recentErr.message);
    const recentIds = (recent || []).map(r => r.quest_pool_id).filter(Boolean);

    // Step 2: find candidates the profile hasn't seen recently (filter in DB, not JS)
    let baseQuery = db
      .from('quest_pool')
      .select('id, quest_json, lesson_json, times_served')
      .eq('subject_id', subjectId)
      .eq('grade_level', gradeLevel)
      .eq('is_active', true)
      .order('times_served', { ascending: true })
      .limit(50);

    // Exclude recently-seen quests at the DB level so we're not capped by the fetch limit
    if (recentIds.length > 0) {
      baseQuery = baseQuery.not('id', 'in', `(${recentIds.join(',')})`);
    }

    let { data: candidates, error: candErr } = await baseQuery;

    if (candErr) {
      console.error('[pool] candidate read failed:', candErr.message);
      return res.status(500).json({ error: { code: 'db_error', message: candErr.message } });
    }

    let pick = candidates && candidates.length > 0 ? candidates[0] : null;

    // Step 3: all quests seen recently — fall back to least-served overall (no exclusion)
    if (!pick) {
      console.warn(`[pool] all recent for ${subjectId}/${gradeLevel}, serving least-served overall`);
      const { data: fallbackCandidates } = await db
        .from('quest_pool')
        .select('id, quest_json, lesson_json, times_served')
        .eq('subject_id', subjectId)
        .eq('grade_level', gradeLevel)
        .eq('is_active', true)
        .order('times_served', { ascending: true })
        .limit(1);
      pick = fallbackCandidates?.[0] || null;
    }

    // Step 4: pool empty for this combo — fall back to live generation
    if (!pick) {
      console.warn(`[pool] empty for ${subjectId}/${gradeLevel}, falling back to live gen`);
      const live = await generateLive(subjectId, gradeLevel);
      if (!live) {
        return res.status(503).json({
          error: {
            code: 'pool_empty_and_gen_failed',
            message: 'No quests available right now. Try again in a moment.',
          },
        });
      }
      // Write the live one into the pool so the next kid benefits
      const { data: inserted } = await db
        .from('quest_pool')
        .insert({
          subject_id: subjectId,
          grade_level: gradeLevel,
          concept: live.quest.concept || null,
          quest_json: live.quest,
          lesson_json: live.lesson,
          generated_by: 'fallback',
          times_served: 1,
        })
        .select('id')
        .single();
      if (inserted?.id) {
        await db.from('quest_served_log').insert({
          profile_id: profileId,
          quest_pool_id: inserted.id,
        });
      }
      return res.status(200).json({
        quest: live.quest,
        lesson: live.lesson,
        poolId: inserted?.id || null,
        source: 'live_fallback',
      });
    }

    // Step 5: log the serve BEFORE responding.
    // Vercel kills the serverless process immediately after res.send(), so
    // fire-and-forget DB writes are silently dropped. This was the root cause
    // of quest repeats: the seen record never wrote to quest_served_log.
    const { error: logErr } = await db.from('quest_served_log')
      .insert({ profile_id: profileId, quest_pool_id: pick.id });
    if (logErr) console.error('[pool] log insert failed:', logErr.message);

    // times_served is non-critical - safe to fire-and-forget
    db.from('quest_pool')
      .update({ times_served: (pick.times_served || 0) + 1 })
      .eq('id', pick.id)
      .then(() => {})
      .then(null, err => console.error('[pool] increment failed:', err.message));

    return res.status(200).json({
      quest: pick.quest_json,
      lesson: pick.lesson_json,
      poolId: pick.id,
      source: 'pool',
    });
  } catch (err) {
    console.error('[pool] unexpected error:', err);
    return res.status(500).json({
      error: { code: 'server_error', message: err.message || 'unknown' },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live fallback generator. Reuses the same prompts as the cron job so the
// shape stored is identical to bootstrap/cron output.
// ─────────────────────────────────────────────────────────────────────────────
async function generateLive(subjectId, gradeLevel) {
  const { generateQuestAndLesson } = await import('./_lib/generate.js');
  try {
    return await generateQuestAndLesson(subjectId, gradeLevel);
  } catch (err) {
    console.error('[pool] live gen failed:', err.message);
    return null;
  }
}