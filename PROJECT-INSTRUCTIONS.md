# Quest Academy — Project Instructions (for Claude)

## Who I am and how to work with me
I'm Kunle, a **non-technical builder** maintaining Quest Academy, an AI-powered
adaptive learning web app for my two kids (Teniola, he/him, Grade 8 level; Moyo,
she/her, Grade 5 level). I need **step-by-step terminal and deployment
instructions with expected outputs**. I work on **Windows** (Command Prompt /
PowerShell; `type`, `findstr`, backslash paths).

**Working style — follow these:**
- **Read the actual project files before writing any code.** Never assume file state.
- **Decisions before code:** explain the approach and confirm before implementing.
- **One consolidated batch** of changes, not incremental partial updates.
- **Never project false certainty.** Make claims (and write handover docs) only
  after behavior is confirmed, not before. If a diagnosis was wrong, say so plainly.
- **Read the actual error/log before theorizing.** Don't guess at causes when the
  log line names them.
- **Flag Windows pitfalls proactively** (PowerShell execution policy, path separators).
- **Wait for Vercel "Ready" before hitting any endpoint** — hitting mid-deploy runs stale code.
- **Cost awareness:** Haiku for generation, Sonnet only for real-time tutoring.

## What the app is
- **Frontend:** React + Vite, deployed on **Vercel** (Hobby plan, project `quest-academy`).
- **Database:** **Supabase** free tier — project "Tenimoyo Learning"
  (`ahbfmhgsousbuvpnecgg`). Tables: `profiles`, `quest_results`, `quest_pool`,
  `quest_served_log`, `cron_state`.
- **AI:** Anthropic API. Haiku for quest generation; Sonnet for in-session
  explanations (capped at 3 wrong answers/session, then Haiku) and stretch questions.
- **Repo:** `github.com/aromireo/quest-academy`. Local:
  `C:\Users\aromi\OneDrive\Desktop\quest-academy`.
- **Live:** https://quest-academy-weld.vercel.app
- Parent dashboard PIN: **7326**.

## How the quest pool works (v12 — important)
Quests are **pre-generated** into `quest_pool` and served in <1s by `api/pool.js`.
Generation runs on **GitHub Actions**, NOT on Vercel:
- `.github/workflows/refill-pool.yml` runs daily at 07:00 UTC (and on-demand via
  Actions → Refill Quest Pool → Run workflow).
- `scripts/refill-pool.mjs` self-heals any (subject,grade) below 45, then rotates
  the oldest 15 in a rolling 2-combos/day slice so the whole pool refreshes every
  ~2 weeks. This is why kids no longer see repeated questions.
- It runs on **Node 22** and reuses `api/_lib/concepts.js` for the concept bank.
- **Do NOT** reintroduce Vercel-side generation. `api/cron-refill-pool.js` and
  `api/bootstrap-pool.js` were removed in v12 because Vercel's Node-20 override
  hard-caps functions at 60s, which kept timing out.

**GitHub secrets** power the Action: `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (same values as Vercel).

## Files that matter
| File | Purpose |
|---|---|
| `scripts/refill-pool.mjs` | Pool generator (GitHub Action) — the ONLY generator |
| `.github/workflows/refill-pool.yml` | Daily schedule + manual trigger |
| `api/pool.js` | Serves quests; live fallback if pool empty; repeat-exhausted fix |
| `api/_lib/generate.js` | Live-fallback generation used by pool.js |
| `api/_lib/concepts.js` | Common Core concept bank (imported by the generator) |
| `api/claude.js` | Serverless proxy for in-session explanations/stretch |
| `src/App.jsx` | Main app, quest flow, wrongCount tracking |
| `src/lib/claude.js` | API calls with Sonnet cost cap |
| `src/pages/ParentScreen.jsx` | PIN dashboard: difficulty controls, strand breakdown, export |
| `HANDOVER-v12.md` | Canonical session-start reference |

## Cost expectations
- **Steady state (2 kids, 1–2 quests/day): ~$2–3/month.** Generation ~$0.40,
  Sonnet explanations/stretch ~$1.30, rest negligible. Lessons ship inside quests.
- Anthropic API is **prepaid** — if balance hits $0, every call returns HTTP 400.
  Keep a small balance; check console.anthropic.com if generation suddenly fails.
- Don't repeatedly re-run the generator to "test" — each full backfill costs a
  few dollars. One run is enough; it self-heals from wherever the pool is.

## Deploying changes
**Frontend / Vercel code:**
```
cd C:\Users\aromi\OneDrive\Desktop\quest-academy
git add .
git commit -m "description"
git push origin main
```
Wait for Vercel **Ready** before testing the live URL.

**Pool generator:** edit `scripts/refill-pool.mjs` or the workflow, commit, push.
Next scheduled run uses it; or trigger manually from the Actions tab.

## Session start ritual
I run `quest_snapshot.py` to zip the project and upload it. Read the actual files
(and `HANDOVER-v12.md`) before proposing changes.

## Roadmap (priority order)
1. **Misconception tagging** (highest value): tag error types on wrong answers, new table.
2. Strand-aligned retro analysis (Export Report → Opus chat).
3. Daily streak logic (field exists, not wired).
4. Weekly parent email digest (Supabase cron + Resend).
5. Language modules (Spanish/Yoruba; currently deep-linked to Duolingo/Drops).
6. Question variety beyond multiple choice.
7. Sibling leaderboard (age-adjusted XP).
8. Custom domain.
