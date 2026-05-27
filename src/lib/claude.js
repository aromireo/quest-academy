// ─────────────────────────────────────────────────────────────────────────────
// src/lib/claude.js  —  v11
//
// Big change from v10:
//   - Quest + lesson NO LONGER generated live in the client. They come from the
//     pre-generated pool (see /api/pool.js). Loads in <1 second.
//   - Live explanations (for wrong answers) and stretch questions still
//     generate on demand, because they're personalized per attempt.
//
// All Claude calls now use Sonnet by default with automatic Haiku fallback on
// timeout/rate-limit. Haiku is ~3-4x faster and good enough for explanations
// and stretch questions.
// ─────────────────────────────────────────────────────────────────────────────

const PROXY_URL = '/api/claude';
const POOL_URL = '/api/pool';

const MODEL_PRIMARY = 'claude-sonnet-4-6';
const MODEL_FALLBACK = 'claude-haiku-4-5';

// ── Placeholder substitution (kids see their own name/pronouns in pool quests) ─
function personalize(text, profile) {
  if (typeof text !== 'string') return text;
  const name = profile?.name || 'the student';
  const pronouns = profile?.pronouns || 'they/them';
  const subj = (pronouns.split('/')[0] || 'they').trim();
  const obj  = (pronouns.split('/')[1] || subj).trim();
  // Simple possessive guess: he→his, she→her, they→their
  const possMap = { he: 'his', she: 'her', they: 'their' };
  const poss = possMap[subj.toLowerCase()] || `${obj}'s`;
  return text
    .replaceAll('{NAME}', name)
    .replaceAll('{name}', name)
    .replaceAll('{PRONOUN_SUBJECT}', subj)
    .replaceAll('{PRONOUN_OBJECT}', obj)
    .replaceAll('{PRONOUN_POSSESSIVE}', poss);
}

function personalizeQuest(quest, profile) {
  if (!quest) return quest;
  const replace = (s) => personalize(s, profile);
  const personalizeQ = (q) => ({
    ...q,
    question: replace(q.question),
    options: Array.isArray(q.options) ? q.options.map(replace) : q.options,
    correctAnswer: replace(q.correctAnswer),
    explanation: replace(q.explanation),
  });
  const out = {
    ...quest,
    storyIntro: replace(quest.storyIntro),
    questTitle: replace(quest.questTitle),
    victoryMessage: replace(quest.victoryMessage),
  };
  if (Array.isArray(quest.modules)) out.modules = quest.modules.map(personalizeQ);
  if (quest.miniBoss) out.miniBoss = personalizeQ(quest.miniBoss);
  if (quest.bigBoss) out.bigBoss = personalizeQ(quest.bigBoss);
  if (Array.isArray(quest.questions)) out.questions = quest.questions.map(personalizeQ);
  if (quest.bossQuestion) out.bossQuestion = personalizeQ(quest.bossQuestion);
  return out;
}

function personalizeLesson(lesson, profile) {
  if (!lesson) return lesson;
  return {
    ...lesson,
    hook: personalize(lesson.hook, profile),
    lesson: personalize(lesson.lesson, profile),
    watchOut: personalize(lesson.watchOut, profile),
    topic: personalize(lesson.topic, profile),
  };
}

// ── Pool fetch (the new fast path) ────────────────────────────────────────────
export async function fetchPoolQuest(subject, profile) {
  const gradeLevel = profile?.difficulty_levels?.[subject?.id] || profile?.base_grade_num || 6;
  const r = await fetch(POOL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profileId: profile?.id,
      subjectId: subject?.id,
      gradeLevel,
    }),
  });
  if (!r.ok) {
    let detail = `pool fetch failed (${r.status})`;
    try {
      const j = await r.json();
      detail = j?.error?.message || detail;
    } catch {}
    throw new Error(detail);
  }
  const { quest, lesson, source, poolId } = await r.json();
  return {
    quest: personalizeQuest(quest, profile),
    lesson: personalizeLesson(lesson, profile),
    source,
    poolId,
  };
}

// ── Direct Claude proxy call with automatic Haiku fallback ────────────────────
async function callClaudeRaw({ model, system, user, maxTokens, timeoutMs = 30_000 }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(PROXY_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    clearTimeout(t);
    const data = await r.json();
    if (!r.ok) {
      const err = new Error(data?.error?.message || `proxy ${r.status}`);
      err.code = data?.error?.code;
      err.status = r.status;
      throw err;
    }
    return data;
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') {
      const err = new Error('Request timed out');
      err.code = 'client_timeout';
      throw err;
    }
    throw e;
  }
}

async function callClaude({ system, user, maxTokens = 800 }) {
  try {
    const data = await callClaudeRaw({
      model: MODEL_PRIMARY,
      system, user, maxTokens,
      timeoutMs: 25_000, // short — fallback to Haiku quickly
    });
    return extractJson(data);
  } catch (primaryErr) {
    // Auto-fallback to Haiku on timeout, rate limit, or overload
    const shouldFallback =
      primaryErr.code === 'client_timeout' ||
      primaryErr.code === 'upstream_timeout' ||
      primaryErr.status === 429 ||
      primaryErr.status === 529;
    if (!shouldFallback) throw primaryErr;
    const data = await callClaudeRaw({
      model: MODEL_FALLBACK,
      system, user, maxTokens,
      timeoutMs: 20_000,
    });
    return extractJson(data);
  }
}

function extractJson(data) {
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if (!text) throw new Error('Empty response from API');
  let clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error(`No JSON in response`);
  const j = clean.slice(s, e + 1);
  try { return JSON.parse(j); }
  catch { return JSON.parse(j.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ' ')); }
}

// ── Explanation + MC transfer (when kid gets one wrong) ──────────────────────
export async function generateExplanation(question, wrongAnswer, correctAnswer, profile, subject) {
  const workingLevel = profile?.difficulty_levels?.[subject?.id] || profile?.base_grade_num || 6;
  const name = profile?.name || 'the student';
  const pronouns = profile?.pronouns || 'they/them';

  const system = `You are a warm, direct tutor for ${name}, a Grade ${workingLevel} student.
Output ONLY a valid JSON object, no markdown.

TONE RULES (CRITICAL):
- Be warm but never sycophantic.
- Do NOT flatter or praise the student's intelligence, confidence, ability, or effort.
- BANNED phrases (do not use these or close variants): "you clearly", "real confidence", "you obviously", "great thinking", "you're so close", "smart move", "you've got this", "amazing work", "love how you", "I can tell you".
- "Good try" or "Nice attempt" are fine. One short acknowledgment max.
- Get to the explanation fast. The student wants to understand the error, not be cheered on.
- Use ${pronouns} pronouns when addressing or describing the student.`;

  const prompt = `${name} is working on ${subject.label} at Grade ${workingLevel} level.

QUESTION: ${question}
${name.toUpperCase()}'S ANSWER (wrong): ${wrongAnswer}
CORRECT ANSWER: ${correctAnswer}

Step 1: Identify the SPECIFIC misconception revealed by the wrong answer.
Step 2: Write a brief, warm-but-direct explanation of why the correct answer is right and where the wrong answer went off track.
Step 3: Generate a multiple-choice "lock it in" question that tests the SAME UNDERSTANDING in a NEW context (different scenario, different numbers, different application — NOT just the same problem reskinned).

Return JSON:
{
  "encouragement": "One short, non-flattering acknowledgment (≤ 10 words)",
  "explanation": "2-3 sentences. State why the correct answer is right and what specifically went wrong in the chosen answer.",
  "memoryTip": "A clever trick, pattern, or hook to remember this concept (1 sentence)",
  "transferQuestion": "A NEW multiple-choice question in a DIFFERENT context that tests the same understanding.",
  "transferOptions": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "transferCorrect": "the exact string of the correct option",
  "transferRationale": "1 sentence — why the correct option is correct"
}

DISTRACTOR RULES for transferOptions:
- Each wrong option should reflect a plausible misconception (sign error, off-by-one, unit confusion, formula mix-up). NOT random noise.
- transferCorrect MUST exactly match one of the four option strings.

Output ONLY the JSON object.`;

  try {
    const result = await callClaude({ system, user: prompt, maxTokens: 800 });
    let transferOptions = Array.isArray(result.transferOptions) ? result.transferOptions : null;
    let transferCorrect = result.transferCorrect || null;
    if (transferOptions && transferOptions.length === 4) {
      if (!transferOptions.includes(transferCorrect)) {
        const match = transferOptions.find(o => o.trim().toLowerCase() === (transferCorrect || '').trim().toLowerCase());
        transferCorrect = match || transferOptions[0];
      }
    } else {
      transferOptions = null;
      transferCorrect = null;
    }
    return {
      encouragement: result.encouragement || "Good try — let's break it down.",
      explanation: result.explanation || `The correct answer is: ${correctAnswer}.`,
      memoryTip: result.memoryTip || 'Review this concept and it will stick next time.',
      transferQuestion: result.transferQuestion || null,
      transferOptions,
      transferCorrect,
      transferRationale: result.transferRationale || '',
    };
  } catch {
    return {
      encouragement: "Good try — let's break it down.",
      explanation: `The correct answer is: ${correctAnswer}.`,
      memoryTip: 'Review this concept and it will stick next time.',
      transferQuestion: null,
      transferOptions: null,
      transferCorrect: null,
      transferRationale: '',
    };
  }
}

// ── Stretch question (one grade above current level) ─────────────────────────
export async function generateStretchQuestion(subject, profile) {
  const workingLevel = profile?.difficulty_levels?.[subject?.id] || profile?.base_grade_num || 6;
  const stretchLevel = Math.min(workingLevel + 1, 12);
  const name = profile?.name || 'the student';
  const pronouns = profile?.pronouns || 'they/them';

  const system = `You are a quiz generator. Output ONLY raw JSON.`;
  const prompt = `Generate a single STRETCH question — one grade above the student's normal work — to reward a correct streak.

Student: ${name}, pronouns ${pronouns}
Subject: ${subject.label}
Stretch level: Grade ${stretchLevel}

Return JSON:
{
  "question": "Challenging question at Grade ${stretchLevel} level",
  "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "correctAnswer": "exact match of one option",
  "explanation": "why correct"
}

Genuinely harder — a real stretch, not just trickier wording. Output ONLY the JSON object.`;

  try {
    const result = await callClaude({ system, user: prompt, maxTokens: 500 });
    if (!result.options || !Array.isArray(result.options) || !result.correctAnswer) {
      throw new Error('Malformed stretch question');
    }
    if (!result.options.includes(result.correctAnswer)) {
      const match = result.options.find(o => o.trim().toLowerCase() === (result.correctAnswer || '').trim().toLowerCase());
      result.correctAnswer = match || result.options[0];
    }
    return result;
  } catch {
    return null;
  }
}

// ── Difficulty helpers (unchanged) ────────────────────────────────────────────
export function getDifficultyLabel(level) {
  const labels = {
    1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5',
    6: 'Grade 6', 7: 'Grade 7 (Advanced)', 8: 'Grade 8 (Advanced)',
    9: 'Grade 9 / Early High School', 10: 'Grade 10', 11: 'Grade 11', 12: 'Grade 12',
  };
  return labels[level] || `Grade ${level}`;
}

export function calcNextDifficulty(currentLevel, recentScores, isLocked = false) {
  if (isLocked) return currentLevel;
  if (recentScores.length < 2) return currentLevel;
  const last2 = recentScores.slice(0, 2);
  const avg = last2.reduce((a, b) => a + b, 0) / 2;
  if (avg >= 85 && currentLevel < 12) return currentLevel + 1;
  if (avg < 60 && currentLevel > 1) return currentLevel - 1;
  return currentLevel;
}
