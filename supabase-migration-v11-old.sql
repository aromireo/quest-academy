-- ─────────────────────────────────────────────────────────────────────────────
-- Quest Academy v11 migration
-- Run this in Supabase → SQL Editor → New Query → paste → Run
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- Pre-generated quest pool. The client never calls Claude directly for quests;
-- it pulls a row from here. The pool is refilled bi-weekly by a Vercel cron job.
create table if not exists quest_pool (
  id            uuid primary key default gen_random_uuid(),
  subject_id    text not null,                -- 'math' | 'english' | 'science' | 'history'
  grade_level   int  not null,                -- 1-12
  concept       text,                         -- e.g. "Linear equations with one variable"
  quest_json    jsonb not null,               -- full quest object (modules, bosses, etc.)
  lesson_json   jsonb not null,               -- full lesson object (hook, lesson, keyTerms…)
  times_served  int default 0,
  is_active     boolean default true,
  generated_at  timestamptz default now(),
  generated_by  text default 'manual'         -- 'cron' | 'bootstrap' | 'manual' | 'fallback'
);

-- Hot index: the read path always filters by (subject, grade, is_active) and orders by times_served
create index if not exists quest_pool_lookup_idx
  on quest_pool (subject_id, grade_level, is_active, times_served);

-- Index for the cron job to count what already exists per (subject, grade)
create index if not exists quest_pool_count_idx
  on quest_pool (subject_id, grade_level, generated_at desc);

-- Track which questions each profile has seen, so the read path can avoid serving
-- the same quest twice in a row to the same kid. Tiny table, autoexpires via TTL.
create table if not exists quest_served_log (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete cascade,
  quest_pool_id uuid references quest_pool(id) on delete cascade,
  served_at     timestamptz default now()
);

create index if not exists quest_served_log_profile_idx
  on quest_served_log (profile_id, served_at desc);

-- Enable RLS
alter table quest_pool       enable row level security;
alter table quest_served_log enable row level security;

-- Allow read-all for anon (kids' app), all writes go through service-role (server only)
drop policy if exists "Allow read for all" on quest_pool;
create policy "Allow read for all" on quest_pool
  for select using (true);

drop policy if exists "Allow all for served log" on quest_served_log;
create policy "Allow all for served log" on quest_served_log
  for all using (true) with check (true);

-- Persistent state for the cron job (tracks pending batch, last refresh, etc.)
create table if not exists cron_state (
  key   text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table cron_state enable row level security;
drop policy if exists "Allow read all on cron_state" on cron_state;
create policy "Allow read all on cron_state" on cron_state
  for select using (true);
-- Writes only via service-role key (server-side)

-- Optional cleanup: keep only the last 100 served_log rows per profile.
-- (Postgres trigger would work, but a daily cleanup is simpler and good enough.)
-- We'll handle this in the cron job.
