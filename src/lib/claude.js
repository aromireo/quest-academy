const PROXY_URL = '/api/claude'

// ── Rate-limit pacing ─────────────────────────────────────────────────────────
// Tier 1 cap: 8,000 output tokens/min. We track the last call time globally
// so that pre-cache and stretch generations stagger themselves automatically
// instead of all firing in the same minute window.
let _lastCallEndedAt = 0
const MIN_GAP_MS = 1500 // minimum gap between calls to avoid bursting

async function paceCall() {
  const elapsed = Date.now() - _lastCallEndedAt
  if (elapsed < MIN_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS - elapsed))
  }
}

async function callClaude(system, user, maxTokens = 2000, opts = {}) {
  const { pace = false } = opts
  if (pace) await paceCall()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)

  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })

    clearTimeout(timeout)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `Server error ${response.status}`)
    }

    if (data.type === 'error' || data.error) {
      throw new Error(data.error?.message || 'API error')
    }

    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    if (!text) throw new Error('Empty response from API')

    let clean = text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start === -1 || end === -1) {
      throw new Error(`No JSON found in response. Got: ${clean.slice(0, 120)}`)
    }
    const jsonStr = clean.slice(start, end + 1)
    try {
      return JSON.parse(jsonStr)
    } catch (parseErr) {
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u001F]/g, ' ')
      return JSON.parse(fixed)
    }
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Request timed out — please try again')
    throw err
  } finally {
    _lastCallEndedAt = Date.now()
  }
}

// ── Profile context helper ────────────────────────────────────────────────────
function profileContext(profile, subject) {
  const workingLevel = profile?.difficulty_levels?.[subject?.id] || profile?.base_grade_num || 6
  const pronouns = profile?.pronouns || 'they/them'
  const subjectPronoun = (pronouns.split('/')[0] || 'they').trim()
  const name = profile?.name || 'the student'
  return {
    workingLevel,
    pronouns,
    subjectPronoun,
    name,
    block: `Student name: ${name}
Pronouns: ${pronouns} (use these consistently when addressing the student or writing word problems featuring them)
Working grade level for this subject: Grade ${workingLevel}
IMPORTANT: Match content to Grade ${workingLevel} curriculum standards. Do NOT default to the student's age or enrolled grade — match the working level exactly. Word problems and examples that feature the student should use ${pronouns} pronouns.`,
  }
}

// ── Coupled Quest + Lesson generation ─────────────────────────────────────────
// New approach: questions are generated FIRST around a single chosen concept.
// Then the lesson is generated FROM the questions, guaranteeing lesson coverage
// matches every question (including any units, vocab, or formulas they need).
//
// Quest structure (v10):
//   - 5 module questions (regular practice on the chosen concept)
//   - 1 mini-boss (synthesis of multiple aspects)
//   - 1 big boss (full transfer — apply concept in a new, harder context)

export async function generateQuestWithLesson(subject, profile) {
  const ctx = profileContext(profile, subject)
  const difficultyLabel = getDifficultyLabel(ctx.workingLevel)

  const system = `You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.`

  const prompt = `Generate a ${subject.label} quest at difficulty "${difficultyLabel}".

${ctx.block}

STRUCTURE (v10):
- Pick ONE focused concept appropriate for Grade ${ctx.workingLevel} ${subject.label}.
- ALL 7 questions in this quest must test that single concept (varying difficulty and angle).
- 5 "module" questions: progressive practice (easier → medium).
- 1 "miniBoss" question: synthesize multiple aspects of the concept.
- 1 "bigBoss" question: apply the concept in a new context (transfer).

Output this exact JSON:
{
  "concept": "Name of the focused concept (e.g. 'Linear equations with one variable')",
  "conceptSummary": "1 sentence describing what specifically is being tested",
  "requiredKnowledge": ["term or unit 1", "term or unit 2", "..."],
  "questTitle": "fun adventure title",
  "storyIntro": "2 sentence story setup",
  "victoryMessage": "congratulations message",
  "modules": [
    {"id":1,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"A) ...","explanation":"why correct"},
    {"id":2,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"B) ...","explanation":"why correct"},
    {"id":3,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"C) ...","explanation":"why correct"},
    {"id":4,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"A) ...","explanation":"why correct"},
    {"id":5,"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"D) ...","explanation":"why correct"}
  ],
  "miniBoss": {"id":"mini","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"...","explanation":"..."},
  "bigBoss": {"id":"big","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctAnswer":"...","explanation":"..."}
}

RULES:
- "requiredKnowledge" lists every term, unit, formula, or vocabulary word that appears in any question. Examples: ["joules (J)", "kinetic energy formula", "mass in kg"]. The lesson will teach these BEFORE the student answers.
- For science: if a question uses a unit (joules, newtons, m/s²) or formula, that unit/formula MUST appear in requiredKnowledge.
- correctAnswer must exactly match one option string.
- Make questions genuinely challenging at "${difficultyLabel}" — these are accelerated learners.
- Vary style: word problems, application, conceptual reasoning.
- Output ONLY the JSON object.`

  const result = await callClaude(system, prompt, 2400)

  if (!result.modules || result.modules.length < 5 || !result.miniBoss || !result.bigBoss) {
    throw new Error('Quest incomplete — please retry')
  }

  // Normalize: ensure correctAnswer matches an option exactly
  const allQs = [...result.modules, result.miniBoss, result.bigBoss]
  for (const q of allQs) {
    if (!q.options || !Array.isArray(q.options)) {
      throw new Error('Question missing options — please retry')
    }
    if (!q.options.includes(q.correctAnswer)) {
      const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase())
      q.correctAnswer = match || q.options[0]
    }
  }

  // Tag questions with their kind so QuestScreen can label progress / bosses
  result.modules.forEach(q => { q.kind = 'module' })
  result.miniBoss.kind = 'miniBoss'
  result.bigBoss.kind = 'bigBoss'

  // Backwards-compat shape for any caller that still expects the v9 structure:
  //   quest.questions = 5 module + 1 mini-boss (treated as "module" path)
  //   quest.bossQuestion = bigBoss
  // QuestScreen reads the new fields directly; App.jsx flattens via these.
  result.questions = [...result.modules, result.miniBoss]
  result.bossQuestion = result.bigBoss

  // Now generate the lesson from the actual questions
  const lesson = await generateLessonFromQuest(result, subject, profile)

  return { quest: result, lesson }
}

// ── Lesson generation FROM the quest ─────────────────────────────────────────
// Given the quest, write a lesson that teaches the concept AND every term in
// requiredKnowledge. This guarantees every term/unit a kid sees was taught.

async function generateLessonFromQuest(quest, subject, profile) {
  const ctx = profileContext(profile, subject)

  const system = `You are a warm, witty tutor writing a 60-second pre-quest lesson. Output ONLY raw JSON. Be conversational, not textbook-y. Be warm and direct, never patronizing.`

  const required = (quest.requiredKnowledge || []).join(', ')

  const prompt = `Write the lesson card for a ${subject.label} quest at Grade ${ctx.workingLevel} level.

${ctx.block}

The quest tests this exact concept: ${quest.concept}
What's tested: ${quest.conceptSummary}

Terms, units, or formulas the student WILL ENCOUNTER in the questions: ${required || '(none specific)'}

Your lesson MUST teach every term/unit/formula listed above so the student is never tested on something they weren't taught. If "joules" or "kinetic energy" or any unit appears in the list, define it clearly with what it measures.

Return JSON:
{
  "topic": "Short topic name (≤ 5 words)",
  "hook": "One opening sentence — fun fact, real-world connection, or 'why this matters'",
  "lesson": "2-3 short paragraphs explaining the core concept clearly with one concrete worked example. Define every term in requiredKnowledge. Use ${ctx.pronouns} pronouns if you address the student.",
  "watchOut": "One sentence about a common mistake students make on this topic",
  "keyTerms": [
    {"term": "joules (J)", "definition": "the unit of energy; 1 J = energy to lift a small apple ~1m"},
    {"term": "...", "definition": "..."}
  ]
}

Keep total lesson length under 200 words. Include 1-4 keyTerms (only if requiredKnowledge had terms; otherwise empty array). Output ONLY the JSON object.`

  try {
    const result = await callClaude(system, prompt, 800)
    return {
      topic: result.topic || quest.concept || subject.label,
      hook: result.hook || '',
      lesson: result.lesson || '',
      watchOut: result.watchOut || '',
      keyTerms: Array.isArray(result.keyTerms) ? result.keyTerms : [],
    }
  } catch (err) {
    return {
      topic: quest.concept || subject.label,
      hook: `Time to dive into ${quest.concept || subject.label}!`,
      lesson: `In this quest you'll work on: ${quest.conceptSummary || quest.concept}. Read each question carefully and trust your reasoning.`,
      watchOut: 'Read each question twice before answering — small details matter.',
      keyTerms: [],
    }
  }
}

// Backwards-compat: App.jsx calls generateQuest and generateLesson as separate
// concurrent calls. We pair them with a tiny one-shot cache so the second caller
// (whichever lands second, lesson or quest) reuses the coupled result without
// hitting the API again. This is intentionally a 1-deep cache keyed by
// subject+profile+slot, with a short TTL so stale entries can't poison things.
const _pairCache = new Map() // key -> { promise, ts }
const _PAIR_TTL_MS = 60_000

function pairKey(subject, profile) {
  return `${subject?.id}::${profile?.household_code || 'x'}::${profile?.slot ?? 'x'}::${profile?.difficulty_levels?.[subject?.id] || 'x'}`
}

function getOrStartPair(subject, profile) {
  const key = pairKey(subject, profile)
  const existing = _pairCache.get(key)
  if (existing && Date.now() - existing.ts < _PAIR_TTL_MS) return existing.promise
  const promise = generateQuestWithLesson(subject, profile)
    .catch(err => {
      // Drop the cache entry on error so retries actually re-run
      _pairCache.delete(key)
      throw err
    })
  _pairCache.set(key, { promise, ts: Date.now() })
  return promise
}

function consumePair(subject, profile) {
  const key = pairKey(subject, profile)
  const entry = _pairCache.get(key)
  _pairCache.delete(key)
  return entry?.promise || null
}

// Backwards-compat shim for any code still calling these separately.
// Both now route through the coupled generator so behavior stays consistent.
export async function generateQuest(subject, profile) {
  // If a pair is already in flight (e.g. generateLesson started first), reuse it.
  // Otherwise start one and let generateLesson reuse the same promise.
  const promise = getOrStartPair(subject, profile)
  const { quest } = await promise
  // Don't consume — let generateLesson also pull from this same promise.
  // Cache entry will TTL out on its own.
  return quest
}

export async function generateLesson(subject, profile) {
  const cached = consumePair(subject, profile)
  if (cached) {
    try {
      const { lesson } = await cached
      return lesson
    } catch {
      // fall through to fallback
    }
  }
  // Standalone lesson — used only as a degraded fallback if coupled call failed.
  const ctx = profileContext(profile, subject)
  return {
    topic: subject.label,
    hook: `Get ready for ${subject.label}!`,
    lesson: `This quest will challenge your Grade ${ctx.workingLevel} ${subject.label} skills. Read carefully, and look for patterns.`,
    watchOut: 'Take your time on each question.',
    keyTerms: [],
  }
}

// ── Explanation + multiple-choice transfer (UPGRADED v10) ─────────────────────
// Changes from v9:
//   - Tone: warm and direct, NOT flattering. Banned phrases enforced.
//   - Transfer is now multiple choice (4 options) — kills the typo problem.
//   - Distractors reflect plausible misconceptions, not random noise.

export async function generateExplanation(question, wrongAnswer, correctAnswer, profile, subject) {
  const ctx = profileContext(profile, subject)

  const system = `You are a warm, direct tutor for ${ctx.name}, an accelerated Grade ${ctx.workingLevel} student.
Output ONLY a valid JSON object, no markdown.

TONE RULES (CRITICAL):
- Be warm but never sycophantic.
- Do NOT flatter or praise the student's intelligence, confidence, ability, or effort.
- BANNED phrases (do not use these or close variants): "you clearly", "real confidence", "you obviously", "great thinking", "you're so close", "smart move", "you've got this", "amazing work", "love how you", "I can tell you".
- "Good try" or "Nice attempt" are fine. One short acknowledgment max.
- Get to the explanation fast. The student wants to understand the error, not be cheered on.
- Use ${ctx.pronouns} pronouns when addressing or describing the student.`

  const prompt = `${ctx.name} is working on ${subject.label} at Grade ${ctx.workingLevel} level.

QUESTION: ${question}
${ctx.name.toUpperCase()}'S ANSWER (wrong): ${wrongAnswer}
CORRECT ANSWER: ${correctAnswer}

Step 1: Identify the SPECIFIC misconception revealed by the wrong answer.
Step 2: Write a brief, warm-but-direct explanation of why the correct answer is right and where the wrong answer went off track.
Step 3: Generate a multiple-choice "lock it in" question that tests the SAME UNDERSTANDING in a NEW context (different scenario, different numbers, different application — NOT just the same problem reskinned).

Return JSON:
{
  "encouragement": "One short, non-flattering acknowledgment (≤ 10 words). E.g. 'Good try — let's break it down.' or 'Close, but here's the key.'",
  "explanation": "2-3 sentences. State why the correct answer is right and what specifically went wrong in the chosen answer. Use a concrete analogy or visual if helpful.",
  "memoryTip": "A clever trick, pattern, or hook to remember this concept (1 sentence)",
  "transferQuestion": "A NEW multiple-choice question in a DIFFERENT context that tests the same understanding. Must NOT be a near-duplicate of the original.",
  "transferOptions": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "transferCorrect": "the exact string of the correct option",
  "transferRationale": "1 sentence — why the correct option is correct, used as feedback after answering"
}

DISTRACTOR RULES for transferOptions:
- Each wrong option should reflect a plausible misconception (e.g. sign error, off-by-one, unit confusion, formula mix-up). NOT random noise.
- Make them tempting but unambiguously wrong.
- transferCorrect MUST exactly match one of the four option strings.

Output ONLY the JSON object.`

  try {
    const result = await callClaude(system, prompt, 800)

    // Validate / normalize transfer MC
    let transferOptions = Array.isArray(result.transferOptions) ? result.transferOptions : null
    let transferCorrect = result.transferCorrect || null
    if (transferOptions && transferOptions.length === 4) {
      if (!transferOptions.includes(transferCorrect)) {
        const match = transferOptions.find(
          o => o.trim().toLowerCase() === (transferCorrect || '').trim().toLowerCase()
        )
        transferCorrect = match || transferOptions[0]
      }
    } else {
      transferOptions = null
      transferCorrect = null
    }

    return {
      encouragement: result.encouragement || "Good try — let's break it down.",
      explanation: result.explanation || `The correct answer is: ${correctAnswer}.`,
      memoryTip: result.memoryTip || 'Review this concept and it will stick next time.',
      transferQuestion: result.transferQuestion || null,
      transferOptions,
      transferCorrect,
      transferRationale: result.transferRationale || '',
    }
  } catch {
    return {
      encouragement: "Good try — let's break it down.",
      explanation: `The correct answer is: ${correctAnswer}.`,
      memoryTip: 'Review this concept and it will stick next time.',
      transferQuestion: null,
      transferOptions: null,
      transferCorrect: null,
      transferRationale: '',
    }
  }
}

// ── Stretch question (paced for Tier 1) ───────────────────────────────────────
export async function generateStretchQuestion(subject, profile) {
  const ctx = profileContext(profile, subject)
  const stretchLevel = Math.min(ctx.workingLevel + 1, 12)

  const system = `You are a quiz generator. Output ONLY raw JSON.`

  const prompt = `Generate a single STRETCH question — one grade above ${ctx.name}'s normal work — to reward a correct streak.

${ctx.block}

Subject: ${subject.label}
Stretch level: Grade ${stretchLevel}

Return JSON:
{
  "question": "Challenging question at Grade ${stretchLevel} level",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correctAnswer": "exact match of one option",
  "explanation": "why correct"
}

Genuinely harder — a real stretch, not just trickier wording. Output ONLY the JSON object.`

  try {
    // Pace stretch calls to avoid bursting against Tier 1 cap
    const result = await callClaude(system, prompt, 500, { pace: true })
    if (!result.options || !Array.isArray(result.options) || !result.correctAnswer) {
      throw new Error('Malformed stretch question')
    }
    if (!result.options.includes(result.correctAnswer)) {
      const match = result.options.find(
        o => o.trim().toLowerCase() === (result.correctAnswer || '').trim().toLowerCase()
      )
      result.correctAnswer = match || result.options[0]
    }
    return result
  } catch {
    return null
  }
}

// ── Difficulty helpers ────────────────────────────────────────────────────────
export function getDifficultyLabel(level) {
  const labels = {
    1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5',
    6: 'Grade 6', 7: 'Grade 7 (Advanced)', 8: 'Grade 8 (Advanced)',
    9: 'Grade 9 / Early High School', 10: 'Grade 10', 11: 'Grade 11', 12: 'Grade 12',
  }
  return labels[level] || `Grade ${level}`
}

export function calcNextDifficulty(currentLevel, recentScores, isLocked = false) {
  if (isLocked) return currentLevel
  if (recentScores.length < 2) return currentLevel
  const last2 = recentScores.slice(0, 2)
  const avg = last2.reduce((a, b) => a + b, 0) / 2
  if (avg >= 85 && currentLevel < 12) return currentLevel + 1
  if (avg < 60 && currentLevel > 1) return currentLevel - 1
  return currentLevel
}
