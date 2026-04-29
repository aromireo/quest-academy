-- ============================================================================
-- Quest Academy v9 Migration
-- Run this in your Supabase SQL Editor (one-time)
-- ============================================================================

-- 1) Add household_code for cross-device sync
--    This replaces session_id as the way profiles are tied to a household.
--    Existing profiles' session_id values will be auto-promoted to a code on first load.
alter table profiles add column if not exists household_code text;
create index if not exists profiles_household_code_idx on profiles(household_code);

-- 2) Add pronouns field
alter table profiles add column if not exists pronouns text default 'they/them';

-- 3) Add a flag for parent-only manual difficulty override
--    (so the adaptive engine doesn't auto-adjust subjects the parent has manually set)
alter table profiles add column if not exists difficulty_locked jsonb default '{}';

-- 4) Update Teni → Teniola if the row exists, and set sensible starting levels
--    These are safe no-ops if the names don't exist.
update profiles
   set name = 'Teniola',
       pronouns = 'he/him',
       difficulty_levels = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_levels, '{}'::jsonb), '{math}',    '8'::jsonb, true),
                                                                  '{english}', '7'::jsonb, true),
                                                                  '{science}', '7'::jsonb, true),
                                                                  '{history}', '7'::jsonb, true)
 where name in ('Teni', 'Teniola');

update profiles
   set pronouns = 'she/her',
       difficulty_levels = jsonb_set(
         jsonb_set(
           jsonb_set(
             jsonb_set(coalesce(difficulty_levels, '{}'::jsonb), '{math}',    '4'::jsonb, true),
                                                                  '{english}', '4'::jsonb, true),
                                                                  '{science}', '4'::jsonb, true),
                                                                  '{history}', '4'::jsonb, true)
 where name = 'Moyo';

-- 5) (Optional but recommended) Backfill household_code from session_id
--    so existing profiles immediately become discoverable via their old session_id.
--    The first device to load with a given session_id will adopt that as the household code.
update profiles
   set household_code = session_id
 where household_code is null;
