-- ─────────────────────────────────────────────────────────────────────────────
-- Quest Academy v13 migration
-- Run in Supabase → SQL Editor → New Query → paste → Run
-- Idempotent: safe to run more than once.
--
-- 1. Adds lesson_cache so a lesson is generated ONCE per (subject, grade,
--    concept) and reused by every quest on that concept.
-- 2. Deactivates pool rows for (subject, grade) combos no child is using.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Lesson cache ──────────────────────────────────────────────────────────
create table if not exists lesson_cache (
  id           uuid primary key default gen_random_uuid(),
  subject_id   text not null,
  grade_level  int  not null,
  concept      text not null,
  lesson_json  jsonb not null,
  created_at   timestamptz default now(),
  unique (subject_id, grade_level, concept)
);

create index if not exists lesson_cache_lookup_idx
  on lesson_cache (subject_id, grade_level, concept);

alter table lesson_cache enable row level security;

drop policy if exists "Allow read for all" on lesson_cache;
create policy "Allow read for all" on lesson_cache
  for select using (true);

-- ── 2. Deactivate out-of-scope pool rows ─────────────────────────────────────
-- In-scope = each profile's working grade per subject, plus one grade above.
-- Everything else is set is_active = false (rows are kept, not deleted, so this
-- is reversible with an UPDATE ... set is_active = true).

with scope as (
  select distinct
    s.subject_id,
    g.grade_level
  from profiles p
  cross join lateral (
    values ('math'), ('english'), ('science'), ('history')
  ) as s(subject_id)
  cross join lateral (
    select coalesce(
      (p.difficulty_levels ->> s.subject_id)::int,
      p.base_grade_num,
      6
    ) as base
  ) as b
  cross join lateral (
    values (b.base), (b.base + 1)
  ) as g(grade_level)
)
update quest_pool q
set is_active = false
where q.is_active = true
  and not exists (
    select 1 from scope
    where scope.subject_id = q.subject_id
      and scope.grade_level = q.grade_level
  );

-- ── Verify: what remains active, per combo ───────────────────────────────────
select subject_id, grade_level, count(*) as active_quests
from quest_pool
where is_active = true
group by subject_id, grade_level
order by subject_id, grade_level;
