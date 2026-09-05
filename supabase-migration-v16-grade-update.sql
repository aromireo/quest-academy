-- ============================================================================
-- Quest Academy v16 Migration — Grade level update (Fall school year)
-- Run this in your Supabase SQL Editor (one-time)
--
-- Teniola -> 7th grade base. School: Math 9th, English 9th, Science mix 8th/9th,
--            Social Studies mix 7th/8th. Auto-adjust ceiling = base+2 = 9, so
--            Science and Social Studies start at the lower end of their mix and
--            the (already-tested) auto-adjust engine promotes them based on
--            actual quiz performance.
-- Moyo     -> 4th grade base. School: mix 5th/6th across all four subjects.
--            Ceiling = base+2 = 6, so all four subjects start at 5 and
--            auto-adjust can promote to 6.
--
-- Also force-unlocks difficulty_locked for all 8 subject entries being
-- updated, in case any were locked from an earlier session, so auto-adjust
-- is guaranteed to run on all of them going forward.
-- ============================================================================

-- 1) Teniola: base grade, cosmetic label, per-subject starting levels, unlock
update profiles
   set base_grade_num = 7,
       grade = '7th',
       difficulty_levels = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_levels, '{}'::jsonb), '{math}',    '9'::jsonb, true),
                                                                  '{english}', '9'::jsonb, true),
                                                                  '{science}', '8'::jsonb, true),
                                                                  '{history}', '7'::jsonb, true),
       difficulty_locked = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_locked, '{}'::jsonb), '{math}',    'false'::jsonb, true),
                                                                  '{english}', 'false'::jsonb, true),
                                                                  '{science}', 'false'::jsonb, true),
                                                                  '{history}', 'false'::jsonb, true)
 where name in ('Teni', 'Teniola');

-- 2) Moyo: base grade, cosmetic label, per-subject starting levels, unlock
update profiles
   set base_grade_num = 4,
       grade = '4th',
       difficulty_levels = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_levels, '{}'::jsonb), '{math}',    '5'::jsonb, true),
                                                                  '{english}', '5'::jsonb, true),
                                                                  '{science}', '5'::jsonb, true),
                                                                  '{history}', '5'::jsonb, true),
       difficulty_locked = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_locked, '{}'::jsonb), '{math}',    'false'::jsonb, true),
                                                                  '{english}', 'false'::jsonb, true),
                                                                  '{science}', 'false'::jsonb, true),
                                                                  '{history}', 'false'::jsonb, true)
 where name = 'Moyo';

-- 3) Verify — check the result before closing the SQL editor tab
select name, grade, base_grade_num, difficulty_levels, difficulty_locked
  from profiles
 where name in ('Teni', 'Teniola', 'Moyo');

-- ============================================================================
-- ROLLBACK (run this if something looks wrong after the update)
-- ============================================================================
-- update profiles set base_grade_num = 6, grade = '6th',
--   difficulty_levels = jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(difficulty_levels,'{}'::jsonb),
--     '{math}','8'::jsonb,true),'{english}','7'::jsonb,true),'{science}','7'::jsonb,true),'{history}','7'::jsonb,true)
--   where name in ('Teni','Teniola');
-- update profiles set base_grade_num = 4, grade = '3rd',
--   difficulty_levels = jsonb_set(jsonb_set(jsonb_set(jsonb_set(coalesce(difficulty_levels,'{}'::jsonb),
--     '{math}','4'::jsonb,true),'{english}','4'::jsonb,true),'{science}','4'::jsonb,true),'{history}','4'::jsonb,true)
--   where name = 'Moyo';
-- (Rollback restores difficulty_levels to the v9 baseline values; it does not
-- restore difficulty_locked state, since we don't know what it was before this
-- migration — check the verify query output above and note it down first.)
