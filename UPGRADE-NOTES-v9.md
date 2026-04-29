# Quest Academy v9 — Upgrade Notes

This release addresses every piece of feedback from the kids' test session
plus the cross-device sync bug.

---

## What's new

### Fixes
- **Cross-device sync (real fix).** Replaced the per-browser `session_id`
  with a household code (e.g. `QUEST-K7M4`) shared across devices.
  Existing profiles auto-migrate on first load — no data loss.
- **Pronouns.** Setup now asks for `he/him`, `she/her`, or `they/them`.
  Pronouns are injected into every quest, lesson, and explanation prompt
  so word problems use the right pronoun and feedback addresses each kid
  correctly.
- **Grade-level mismatch.** `STARTING_LEVELS` now seeds Teniola at Grade 8
  math + Grade 7 across other subjects, and Moyo at Grade 4 across the
  board. The migration SQL also bumps existing profiles to these levels.
  Parents can manually adjust per-subject from the dashboard and lock the
  level so the auto-adjuster doesn't override.

### New features
- **Pre-quest lesson card.** Every quest now opens with a 60-90 second
  topic lesson that loads in ~2-3s — kids read it while questions are
  generated in the background, masking the cold-start delay.
- **Smart "lock-it-in" follow-up.** When a kid answers wrong, Claude now
  generates a *transfer* question targeting the specific misconception
  revealed by their wrong answer — not a re-skin of the original. (This
  is the 6th-grader's direct request.)
- **Stretch questions.** After every 3 consecutive correct answers, an
  optional bonus question appears one grade level above. +30 XP and a
  "Stretch Goal 🚀" badge on success. Skippable.
- **Edit & delete profiles.** Parent dashboard now has Edit Hero (re-runs
  setup with current values pre-filled) and Delete (with confirmation).
- **Per-subject difficulty controls.** Parent dashboard has +/- buttons
  per subject and a 🔒/🔓 toggle to lock manual choices.
- **Household code UI.** Tap the household code on the home screen to
  copy it, switch to a different household, or start fresh.

---

## How to deploy

### 1. Run the SQL migration in Supabase

Go to your Supabase project → SQL Editor → New Query, paste the contents
of `supabase-migration-v9.sql`, and run it.

This:
- Adds `household_code`, `pronouns`, `difficulty_locked` columns
- Renames `Teni` → `Teniola`
- Sets pronouns: Teniola `he/him`, Moyo `she/her`
- Sets starting working levels: Teniola Math Gr 8, English/Science/History Gr 7;
  Moyo all Gr 4
- Backfills `household_code` from existing `session_id` so all current
  profiles remain accessible

### 2. Push the code

```bash
cd C:\Users\aromi\OneDrive\Desktop\quest-academy
git add .
git commit -m "v9: cross-device sync, pronouns, grade-level fix, lessons, smart follow-ups"
git push origin main
```

Vercel auto-deploys in ~60s.

### 3. After it's live

- Open on your phone first. You'll be assigned a NEW household code on
  this device.
- Open on the desktop where the kids have been playing — you'll see the
  EXISTING data because the legacy session_id auto-migrates.
- On the desktop, tap the household code pill on the home screen to see
  what it is. Copy it.
- On the phone, tap the home-screen household code → "Use Existing Code"
  → paste the desktop's code. Now both devices show identical profiles
  and progress.

For any third device, just enter the same code.

---

## Cost impact

The pre-quest lesson and transfer-question generation are extra Claude
calls. Estimated impact: ~30-40% more API cost (lessons are short, ~700
tokens each; transfer questions piggyback on the existing wrong-answer
explanation call so cost only grows when answers are wrong). At your
current ~$4-5/month run rate, expect ~$5.50-7/month.

If cost matters more than freshness, you can remove `generateLesson` and
`generateStretchQuestion` from `App.jsx` — the rest of the v9 features
have no extra API cost.

---

## Files changed

- `supabase-schema.sql` — updated canonical schema
- `supabase-migration-v9.sql` — **NEW** — run this once in Supabase
- `src/App.jsx` — household code, lesson flow, stretch + transfer wiring
- `src/lib/supabase.js` — household_code lookups + delete helper
- `src/lib/claude.js` — `generateLesson`, `generateStretchQuestion`, transfer-question logic
- `src/lib/constants.js` — `PRONOUN_OPTIONS`, `STARTING_LEVELS`
- `src/pages/HomeScreen.jsx` — household code pill
- `src/pages/SetupScreen.jsx` — pronouns step + edit mode
- `src/pages/QuestScreen.jsx` — lesson card + stretch modal + transfer rendering
- `src/pages/ParentScreen.jsx` — edit/delete + difficulty +/- + lock toggle
- `src/pages/HouseholdSetup.jsx` — **NEW** — sync devices UI

No changes to: components/, ProfileScreen, ResultScreen, mini-games, api/.

---

## Things to test after deploying

1. **Cross-device sync.** Open on two devices. Should show same data.
2. **Pronouns.** Start a Math quest as Teniola — word problems should
   use "he" not "she" or "they". Same for Moyo with "she".
3. **Grade level.** Teniola's first Math quest should feel like 8th grade
   work (algebra, multi-step equations). Moyo's first Math quest should
   feel like 4th grade (long multiplication, fractions, multi-step word
   problems).
4. **Lesson card.** Should appear immediately when starting any quest.
   Button should say "Preparing questions…" then change to "I'm ready —
   Start Questions →" when questions arrive.
5. **Smart follow-up.** Intentionally answer one wrong. The "Apply it in
   a new way" question should be different from the static one — a new
   scenario, not just rephrased numbers.
6. **Stretch question.** Answer 3 in a row correctly. The 🚀 modal should
   appear with a question one grade above your current level.
7. **Parent dashboard edits.** PIN 7326. Verify you can change names
   (rename Teni → Teniola if migration didn't), adjust difficulty +/-,
   and lock a subject.
