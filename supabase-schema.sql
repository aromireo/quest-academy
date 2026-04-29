-- Run this in your Supabase project's SQL Editor
-- Go to: supabase.com → your project → SQL Editor → New Query → paste and run
-- For existing v8 installs, run supabase-migration-v9.sql instead.

-- Profiles table
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  session_id    text,                   -- legacy, kept for backward compat
  household_code text,                  -- NEW: stable code shared across devices
  slot          int not null default 0,
  name          text,
  grade         text,
  base_grade_num int default 6,
  pronouns      text default 'they/them',
  hero_class    text,
  avatar        text,
  xp            int default 0,
  level         int default 1,
  badges        text[] default '{}',
  streak        int default 0,
  difficulty_levels jsonb default '{}',
  difficulty_locked jsonb default '{}', -- NEW: per-subject parent locks
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(household_code, slot)
);

create index if not exists profiles_household_code_idx on profiles(household_code);

-- Quest results table
create table if not exists quest_results (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete cascade,
  subject_id    text,
  subject_label text,
  score         int,
  correct       int,
  total         int,
  difficulty    int,
  created_at    timestamptz default now()
);

-- Enable Row Level Security (open read/write for now — uses household_code as soft auth)
alter table profiles      enable row level security;
alter table quest_results enable row level security;

create policy "Allow all" on profiles      for all using (true) with check (true);
create policy "Allow all" on quest_results for all using (true) with check (true);
