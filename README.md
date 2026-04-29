# Quest Academy 🏆

An AI-powered adaptive learning app for kids, built with React + Vite, deployed on Vercel, with Supabase for persistent cross-device progress.

---

## One-Time Setup (about 20 minutes total)

### Step 1 — Set up Supabase (free database, ~5 min)

1. Go to [supabase.com](https://supabase.com) and click **Start your project**
2. Sign in with GitHub
3. Click **New project**, give it a name (e.g. `quest-academy`), choose a region, set a database password
4. Wait ~2 minutes for it to provision
5. In your project, click **SQL Editor** in the left sidebar
6. Click **New Query**, paste the entire contents of `supabase-schema.sql`, and click **Run**
7. Go to **Project Settings → API**
8. Copy these two values (you'll need them in Step 3):
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / public key** → `VITE_SUPABASE_ANON_KEY`

---

### Step 2 — Push to GitHub (~5 min)

1. Go to [github.com](https://github.com) → **New repository**
2. Name it `quest-academy`, make it **Private**, click **Create repository**
3. On your computer, open Terminal and run:

```bash
# Navigate to the project folder you downloaded/unzipped
cd path/to/quest-academy

# Initialize git and push
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quest-academy.git
git push -u origin main
```

---

### Step 3 — Deploy to Vercel (~5 min)

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **Add New → Project**
3. Find and import your `quest-academy` repository
4. Before clicking Deploy, click **Environment Variables** and add these three:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (sk-ant-...) |

5. Click **Deploy**
6. In ~2 minutes you'll have a live URL like `https://quest-academy-xyz.vercel.app`

That's it! Share the URL with your kids on any device.

---

## Making Updates

Whenever you want to update the app (new features, fixes, etc.):

```bash
git add .
git commit -m "describe your change"
git push
```

Vercel auto-deploys on every push — live in ~60 seconds.

---

## Local Development

To run locally:

```bash
# Install dependencies
npm install

# Create local env file
cp .env.example .env.local
# Fill in your values in .env.local

# Start dev server
npm run dev
```

Note: The API proxy (`/api/claude`) only works on Vercel. For local dev, it will also work
because Vite dev server + Vercel CLI can simulate it. Run `npm i -g vercel` then `vercel dev`
instead of `npm run dev` to get the full local experience including the API route.

---

## How Adaptive Difficulty Works

- Each kid starts at their actual grade level (6th → Grade 6, 3rd → Grade 3)
- After each quest, if they score **≥ 85% twice in a row** in a subject, difficulty advances one level
- If they score **below 60%**, difficulty steps back down
- Your 6th grader doing 7th grade work will naturally advance to Grade 7 difficulty quickly
- The parent dashboard shows each kid's current difficulty level per subject

---

## Subjects Covered

- 🔢 Math Realm
- 📖 Language Forest (English)
- 🔬 Science Lab
- 🏰 History Citadel
- 🌊 Spanish Isles
- 🌍 Yoruba Lands

---

## Tech Stack

- **Frontend**: React 18 + Vite
- **API Proxy**: Vercel Serverless Function (`/api/claude.js`)
- **AI**: Anthropic Claude (claude-sonnet-4-6)
- **Database**: Supabase (PostgreSQL)
- **Fonts**: Cinzel (display) + Nunito (body)
