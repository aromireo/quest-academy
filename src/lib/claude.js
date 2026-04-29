const PROXY_URL = '/api/claude'

async function callClaude(system, user, maxTokens = 3000) {
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

    // Aggressively extract JSON — strip fences, find outermost { }
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
      // Try to fix common issues: trailing commas, unescaped chars
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')      // remove trailing commas
        .replace(/[\u0000-\u001F]/g, ' ')    // remove control chars
      return JSON.parse(fixed)
    }
  } catch (err) {
    clearTimeout(timeout)
    if (err.name === 'AbortError') throw new Error('Request timed out — please try again')
    throw err
  }
}

// ── Profile context helper ────────────────────────────────────────────────────
// Builds the profile description block that gets injected into every prompt.
// Centralizing this guarantees pronouns, working level, and name are always consistent.
function profileContext(profile, subject) {
  const workingLevel = profile?.difficulty_levels?.[subject?.id] || profile?.base_grade_num || 6
  const pronouns = profile?.pronouns || 'they/them'
  const name = profile?.name || 'the student'
  return {
    workingLevel,
    pronouns,
    name,
    block: `Student name: ${name}
Pronouns: ${pronouns} (use these consistently when addressing the student or writing word problems featuring them)
Working grade level for this subject: Grade ${workingLevel}
IMPORTANT: Match content to Grade ${workingLevel} curriculum standards. Do NOT default to the student's age or enrolled grade — match the working level exactly. Word problems and examples that feature the student should use ${pronouns} pronouns.`,
  }
}

// ── Quest generation ──────────────────────────────────────────────────────────

export async function generateQuest(subject, profile) {
  const ctx = profileContext(profile, subject)
  const difficultyLabel = getDifficultyLabel(ctx.workingLevel)

  const system = `You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown. No explanation. No code fences. Start with { and end with }.`

  const prompt = `Generate a ${subject.label} quiz at difficulty "${difficultyLabel}".

${ctx.block}

Output this exact JSON structure with real educational content (no placeholder text):
{"questTitle":"title here","storyIntro":"2 sentence story intro","victoryMessage":"congratulations message","questions":[{"id":1,"question":"real question","options":["A) real option","B) real option","C) real option","D) real option"],"correctAnswer":"A) real option","explanation":"why this is correct","followUp":"follow-up question","followUpAnswer":"follow-up answer"},{"id":2,"question":"real question","options":["A) real option","B) real option","C) real option","D) real option"],"correctAnswer":"B) real option","explanation":"why this is correct","followUp":"follow-up question","followUpAnswer":"follow-up answer"},{"id":3,"question":"real question","options":["A) real option","B) real option","C) real option","D) real option"],"correctAnswer":"C) real option","explanation":"why this is correct","followUp":"follow-up question","followUpAnswer":"follow-up answer"}],"bossQuestion":{"id":"boss","question":"harder synthesis question","options":["A) real option","B) real option","C) real option","D) real option"],"correctAnswer":"A) real option","explanation":"why correct","followUp":"follow-up question","followUpAnswer":"follow-up answer"}}

Rules:
- correctAnswer must exactly match one option string.
- Make questions genuinely challenging at "${difficultyLabel}" — these students are accelerated learners and bored by content below their working level.
- Vary question style: include word problems, application problems, and conceptual reasoning.
- Output ONLY the JSON object.`

  const result = await callClaude(system, prompt, 2500)

  if (!result.questions || result.questions.length < 3 || !result.bossQuestion) {
    throw new Error('Quest incomplete — please retry')
  }

  // Normalize: ensure correctAnswer exactly matches an option (case-insensitive fix)
  const allQs = [...result.questions, result.bossQuestion]
  for (const q of allQs) {
    if (!q.options || !Array.isArray(q.options)) {
      throw new Error('Question missing options — please retry')
    }
    if (!q.options.includes(q.correctAnswer)) {
      const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase())
      if (match) q.correctAnswer = match
      else q.correctAnswer = q.options[0]
    }
  }

  return result
}

// ── Lesson generation (NEW) ───────────────────────────────────────────────────
// Short pre-quest lesson that masks cold-start latency and provides context
// before the student is tested. Designed to be < ~250 tokens for fast generation.

export async function generateLesson(subject, profile) {
  const ctx = profileContext(profile, subject)

  const system = `You are a warm, witty tutor writing a 60-second pre-quest lesson for an accelerated student. Output ONLY raw JSON.`

  const prompt = `Write a brief lesson card for a ${subject.label} quest at Grade ${ctx.workingLevel} level.

${ctx.block}

Pick ONE specific topic appropriate for Grade ${ctx.workingLevel} ${subject.label} (e.g. for Grade 8 math: "linear equations" or "Pythagorean theorem"). The quest questions will cover this topic.

Return JSON:
{
  "topic": "Short topic name (e.g. 'Linear Equations')",
  "hook": "One opening sentence — a fun fact, real-world connection, or 'why this matters' angle",
  "lesson": "2-3 short paragraphs explaining the core concept clearly, with one concrete worked example. Use ${ctx.pronouns} pronouns if you address the student. Be conversational, not textbook-y.",
  "watchOut": "One sentence about a common mistake students make on this topic"
}

Keep total length under 180 words. Output ONLY the JSON object.`

  try {
    const result = await callClaude(system, prompt, 700)
    return {
      topic: result.topic || subject.label,
      hook: result.hook || '',
      lesson: result.lesson || '',
      watchOut: result.watchOut || '',
    }
  } catch (err) {
    // Graceful fallback — a generic lesson card so the UI never breaks
    return {
      topic: subject.label,
      hook: `Time to dive into ${subject.label}!`,
      lesson: `Get ready for some ${subject.label} challenges. Take your time, read each question carefully, and trust your reasoning. If you get stuck, look for patterns and connections to things you already know.`,
      watchOut: 'Read each question twice before answering — small details matter.',
    }
  }
}

// ── Explanation + transfer follow-up (UPGRADED) ───────────────────────────────
// When a student answers wrong, we generate:
//   1. An explanation tailored to THEIR specific wrong answer
//   2. A NEW transfer-style follow-up question that targets the misconception
//      revealed by their wrong answer (rather than reusing the static followUp)
// This is the "lock it in" upgrade requested by the 6th grader.

export async function generateExplanation(question, wrongAnswer, correctAnswer, profile, subject) {
  const ctx = profileContext(profile, subject)

  const system = `You are a warm, encouraging tutor for ${ctx.name}, an accelerated Grade ${ctx.workingLevel} student.
Output ONLY a valid JSON object, no markdown. Use ${ctx.pronouns} pronouns.`

  const prompt = `${ctx.name} is working on ${subject.label} at Grade ${ctx.workingLevel} level.

QUESTION: ${question}
${ctx.name.toUpperCase()}'S ANSWER (wrong): ${wrongAnswer}
CORRECT ANSWER: ${correctAnswer}

First, identify the SPECIFIC misconception revealed by ${ctx.pronouns.split('/')[0]} answer. Then generate a "lock it in" question that forces ${ctx.pronouns.split('/')[0]} to apply the corrected understanding in a NEW context — not just the same problem with different numbers.

Return JSON:
{
  "encouragement": "One warm sentence acknowledging the attempt — not condescending, treat ${ctx.name} as smart",
  "explanation": "2-3 sentences explaining WHY the correct answer is right, addressing the specific error in ${ctx.pronouns.split('/')[0]} chosen answer. Use a memorable analogy or visual.",
  "memoryTip": "A clever trick, pattern, or hook to remember this concept",
  "transferQuestion": "A NEW question in a DIFFERENT context that tests whether ${ctx.name} has truly internalized the corrected concept. Should require applying the insight, not just repeating the same calculation. Open-ended or short-answer is fine.",
  "transferAnswer": "Model answer to the transfer question, with brief reasoning"
}

CRITICAL: The transferQuestion must NOT be a near-duplicate of the original question. It should test the SAME UNDERSTANDING in a new scenario, real-world application, or by asking ${ctx.name} to spot the same mistake elsewhere.`

  try {
    const result = await callClaude(system, prompt, 900)
    return {
      encouragement: result.encouragement || "Good try — let's look at this together!",
      explanation: result.explanation || `The correct answer is: ${correctAnswer}.`,
      memoryTip: result.memoryTip || "Review this concept and it'll stick next time!",
      transferQuestion: result.transferQuestion || null,
      transferAnswer: result.transferAnswer || null,
    }
  } catch {
    // Graceful fallback — quest continues even if explanation fails
    return {
      encouragement: "Good try — let's look at this one together!",
      explanation: `The correct answer is: ${correctAnswer}.`,
      memoryTip: "Review this concept and it'll stick next time!",
      transferQuestion: null,
      transferAnswer: null,
    }
  }
}

// ── Stretch question (NEW) ────────────────────────────────────────────────────
// After a streak of correct answers, offer an optional bonus question
// one grade level above the current working level. Pure opt-in.

export async function generateStretchQuestion(subject, profile) {
  const ctx = profileContext(profile, subject)
  const stretchLevel = Math.min(ctx.workingLevel + 1, 12)

  const system = `You are a quiz generator. Output ONLY raw JSON.`

  const prompt = `Generate a single STRETCH question — one grade level above ${ctx.name}'s normal work — to reward ${ctx.pronouns.split('/')[0]} for a correct streak.

${ctx.block}

Subject: ${subject.label}
Stretch level: Grade ${stretchLevel} (one above current)

Return JSON:
{
  "question": "Challenging question at Grade ${stretchLevel} level",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correctAnswer": "exact match of one option",
  "explanation": "why this is correct"
}

Make it genuinely harder — a real stretch, not just trickier. Output ONLY the JSON object.`

  try {
    const result = await callClaude(system, prompt, 600)
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
    return null // caller will skip stretch UI on failure
  }
}

// ── Difficulty helpers ────────────────────────────────────────────────────────

export function getDifficultyLabel(level) {
  const labels = {
    1: 'Grade 1',
    2: 'Grade 2',
    3: 'Grade 3',
    4: 'Grade 4',
    5: 'Grade 5',
    6: 'Grade 6',
    7: 'Grade 7 (Advanced)',
    8: 'Grade 8 (Advanced)',
    9: 'Grade 9 / Early High School',
    10: 'Grade 10',
    11: 'Grade 11',
    12: 'Grade 12',
  }
  return labels[level] || `Grade ${level}`
}

// Compute the next difficulty level based on recent scores.
// Respects parent locks: if a subject is locked, never auto-adjust.
export function calcNextDifficulty(currentLevel, recentScores, isLocked = false) {
  if (isLocked) return currentLevel
  if (recentScores.length < 2) return currentLevel
  const last2 = recentScores.slice(0, 2)
  const avg = last2.reduce((a, b) => a + b, 0) / 2
  if (avg >= 85 && currentLevel < 12) return currentLevel + 1
  if (avg < 60 && currentLevel > 1) return currentLevel - 1
  return currentLevel
}
