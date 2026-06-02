-- Quest Academy v11 migration
-- Run in Supabase SQL Editor: supabase.com → your project → SQL Editor → New Query

-- Add strand column to quest_results for MAP-aligned performance tracking
ALTER TABLE quest_results ADD COLUMN IF NOT EXISTS strand text;

-- Index for fast strand queries in the parent dashboard
CREATE INDEX IF NOT EXISTS quest_results_strand_idx ON quest_results(strand);
CREATE INDEX IF NOT EXISTS quest_results_profile_subject_idx ON quest_results(profile_id, subject_id);
