# Quest Academy — Project Handover (v12)

## What changed from v11.2 → v12

The quest pool is no longer generated on Vercel. **Generation now runs as a
GitHub Action** (`.github/workflows/refill-pool.yml` → `scripts/refill-pool.mjs`).
Vercel only *serves* quests now. This was done to escape Vercel's function
timeout, which repeatedly killed pool generation.

Two problems drove the change:
1. **v11 pools froze.** The old cron "topped up" to a fixed target and never
   retired anything, so once full it generated nothing more — kids saw repeats.
2. **Generation kept timing out on Vercel.** Root cause (finally): the project's
   `package.json` pins `"engines": { "node": "20.x" }`, which is not eligible for
   Vercel's extended (300s) function duration, so functions were hard-capped at
   60s regardless of the `maxDuration: 300` setting or Fluid Compute being on.
   Synchronous generation of many quests can't fit in 60s. Moving generation to
   GitHub Actions (6-hour ceiling) removed the constraint entirely.

## Current architecture

```
Browser → Vercel Frontend (React)
        → /api/claude.js   (serverless proxy → Anthropic; in-session explanations/stretch)
        → /api/pool.js     (serves pre-generated quests from Supabase; live fallback if empty)
        → Supabase (profiles, quest_results, quest_pool, quest_served_log, cron_state)

GitHub Actions (daily 07:00 UTC)
        → scripts/refill-pool.mjs
             PHASE 1 self-heal: fill any (subject,grade) below TARGET_POOL_SIZE
             PHASE 2 rotate: retire oldest ROTATION_PER_COMBO in a rolling slice, regenerate
        → Supabase quest_pool (writes new quests, deactivates old)
```

**Generation lives in exactly one place now:** `scripts/refill-pool.mjs`.
`api/cron-refill-pool.js` and `api/bootstrap-pool.js` have been removed.

## The GitHub Action (how the pool stays fresh)

- **File:** `.github/workflows/refill-pool.yml` (schedule + manual trigger) and
  `scripts/refill-pool.mjs` (the generator).
- **Runs daily at 07:00 UTC**, automatically, no manual step. Also runnable on
  demand: repo → **Actions → Refill Quest Pool → Run workflow**.
- **Node 22** (has native WebSocket, which @supabase/supabase-js needs).
- **Reuses** `api/_lib/concepts.js` by import — the concept bank is not duplicated.
- **Self-healing:** if a run is skipped or fails, the next run picks up from the
  current pool state. No multi-day polling, no manual URL-poking.

### Config (top of scripts/refill-pool.mjs)
| Setting | Value | Meaning |
|---|---|---|
| `TARGET_POOL_SIZE` | 45 | active quests kept per (subject, grade) |
| `ROTATION_PER_COMBO` | 15 | oldest quests retired+replaced per rotating combo |
| `COMBOS_PER_RUN` | 2 | combos rotated per daily run (~13-day full sweep) |
| `CONCURRENCY` | 5 | parallel Haiku calls (proven safe) |
| `MAX_RETRIES` | 3 | retries for retryable (429/5xx) failures |
| `timeout-minutes` | 60 | GitHub job ceiling (workflow yml) |

### Grade plan (scripts/refill-pool.mjs)
```
math:    [3, 4, 5, 6, 7, 8, 9]   # grade 6 added in v12
english: [3, 4, 5, 6, 7, 8]
science: [3, 4, 5, 6, 7, 8]
history: [3, 4, 5, 6, 7, 8]
```

## GitHub secrets (Settings → Secrets and variables → Actions)
| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | same key as Vercel |
| `SUPABASE_URL` | `https://ahbfmhgsousbuvpnecgg.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | same service role key as Vercel |

## pool.js serving (unchanged logic, v12 repeat-fix confirmed present)
1. Fetch quest IDs this profile has seen in the last `RECENT_WINDOW_DAYS` (30).
2. Query unseen quests, filtering recentIds at the DB level, `times_served ASC`.
3. If all seen recently → serve the **least-recently-seen** quest (tagged
   `source: 'repeat_exhausted'`) instead of silently repeating a recent one.
4. If pool empty for combo → live fallback via `api/_lib/generate.js`, write to pool.
5. `quest_served_log` insert is awaited before responding.

## Model usage & cost
| Call | Model | Notes |
|---|---|---|
| Pool generation (GitHub Action) | `claude-haiku-4-5-20251001` | ~$0.40/mo steady state |
| Explanation (wrong, first 3) | `claude-sonnet-4-6` | capped at 3/session then Haiku |
| Explanation (wrong, 4+) | `claude-haiku-4-5` | auto-switch |
| Stretch question | `claude-sonnet-4-6` | falls back to Haiku on timeout/429 |

**Realistic monthly cost (2 kids, 1–2 quests/day): ~$2–3/month.** Lessons ship
inside pool quests (no extra call). Anthropic API is **prepaid** — if the balance
hits $0, generation returns HTTP 400 on every call (this happened once during v12
setup; adding funds fixed it). Keep a small balance topped up.

## Retired in v12 (do not use)
- `api/cron-refill-pool.js` — removed. Generation is on GitHub Actions.
- `api/bootstrap-pool.js` — removed. The Action self-heals cold starts too.
- `crons` block in `vercel.json` — removed.
- The old two-phase Batches-API bootstrap process — gone. No more URL-polling.

## Profiles (unchanged)
| Slot | Name | Pronouns | Working level |
|---|---|---|---|
| 0 | Teniola | he/him | Grade 8 all subjects |
| 1 | Moyo | she/her | Grade 5 all subjects |

Working levels live in Supabase `difficulty_levels` jsonb; adjust via Parent
Dashboard (PIN 7326). `STARTING_LEVELS` in `constants.js` only affects new profiles.

## Deploy updates (frontend / Vercel code)
```bash
cd C:\Users\aromi\OneDrive\Desktop\quest-academy
git add .
git commit -m "description"
git push origin main
```
Vercel auto-deploys in ~60s. Wait for **Ready** in the Vercel dashboard before
hitting any endpoint (hitting mid-deploy serves stale code).

## Deploy updates (pool generator)
Edit `scripts/refill-pool.mjs` or `.github/workflows/refill-pool.yml`, commit,
push. The next scheduled run uses the new version; or trigger manually from the
Actions tab.

## Key learnings (v12)
- **Vercel Node 20 override caps functions at 60s.** `maxDuration: 300` + Fluid
  Compute are ignored unless the runtime is eligible (Node 20.x is not). This was
  the real cause of every "504 timeout" during pool generation.
- **Move heavy/long generation off Vercel.** GitHub Actions (6h) is the right home
  for batch generation; Vercel serves.
- **Anthropic API is prepaid; $0 balance = HTTP 400 on every call.** A run that
  "starts working then fails uniformly" mid-way is the fingerprint of hitting $0.
- **@supabase/supabase-js needs WebSocket** on createClient(); use Node 22 or pass
  the `ws` transport. Node 20 throws.
- **`npm ci` is strict about lockfile sync**; the Action uses `npm install`.
- **math skips grade 7 entry? No — math skips nothing now.** v12 added grade 6.
- **Read the actual error body/logs before theorizing.** Several detours came from
  guessing at causes instead of reading the log line that named them.

## Roadmap (unchanged priority)
1. Misconception tagging (highest value) — error-type tags on wrong answers, new table.
2. Strand-aligned retro analysis (Export Report → Opus).
3. Daily streak logic (field exists, not wired).
4. Weekly parent email digest (Supabase cron + Resend).
5. Language modules (currently deep-linked to Duolingo/Drops).
6. Question variety beyond MC.
7. Sibling leaderboard (age-adjusted XP).
8. Custom domain.

## Development principles
- Non-technical builder: give step-by-step terminal instructions with expected output.
- Read actual project files before writing code.
- Batch changes into one consolidated commit; no incremental partials.
- Confirm decisions before implementing.
- Never project false certainty — write handover claims only after behavior is confirmed.
- Flag Windows pitfalls proactively.
- Cost awareness: Haiku for generation, Sonnet only for real-time tutoring.
