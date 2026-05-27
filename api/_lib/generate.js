// ─────────────────────────────────────────────────────────────────────────────
// /api/_lib/generate.js  —  server-side quest+lesson generation
// Used by:
//   - /api/pool.js (live fallback when pool is empty for a combo)
//   - /api/bootstrap-pool.js (one-time initial pool fill)
//   - /api/cron-refill-pool.js (bi-weekly refresh)
//
// Important:
//   - This generates GENERIC quests (no student name/pronouns baked in).
//   - The client substitutes name/pronouns at render time using placeholders.
//   - This is what makes the pool reusable across kids.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECT_LABELS = {
  math:    'Math',
  english: 'English / Language Arts',
  science: 'Science',
  history: 'History',
};

function difficultyLabel(level) {
  const labels = {
    1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5',
    6: 'Grade 6', 7: 'Grade 7 (Advanced)', 8: 'Grade 8 (Advanced)',
    9: 'Grade 9', 10: 'Grade 10', 11: 'Grade 11', 12: 'Grade 12',
  };
  return labels[level] || `Grade ${level}`;
}

async function callClaude({ model = 'claude-sonnet-4-6', system, user, maxTokens = 2400 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 50_000);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
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
      throw new Error(data?.error?.message || `Anthropic ${r.status}`);
    }
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    return parseJson(text);
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text) {
  let clean = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in response');
  }
  const jsonStr = clean.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    const fixed = jsonStr.replace(/,\s*([}\]])/g, '$1').replace(/[\u0000-\u001F]/g, ' ');
    return JSON.parse(fixed);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate a generic quest (no name/pronoun baked in)
// ─────────────────────────────────────────────────────────────────────────────
export async function generateQuest(subjectId, gradeLevel) {
  const subject = SUBJECT_LABELS[subjectId] || subjectId;
  const diff = difficultyLabel(gradeLevel);

  const system = `You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.`;

  const prompt = `Generate a ${subject} quest at difficulty "${diff}".

IMPORTANT: Match content to Grade ${gradeLevel} curriculum standards exactly. The student is genuinely working at this level — make questions challenging but fair.

If any word problem features a student, refer to them as "the student" or use the placeholder {NAME}. Do not assume a name or gender. Use the placeholder {PRONOUN_SUBJECT} (they/he/she) and {PRONOUN_POSSESSIVE} (their/his/her) where pronouns are needed. The app replaces these at display time.

STRUCTURE:
- Pick ONE focused concept appropriate for Grade ${gradeLevel} ${subject}.
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
- "requiredKnowledge" lists every term, unit, formula, or vocabulary word that appears in any question (e.g. ["joules (J)", "kinetic energy formula", "mass in kg"]). The lesson will teach these BEFORE the student answers.
- For science: if a question uses a unit (joules, newtons, m/s²) or formula, that unit/formula MUST appear in requiredKnowledge.
- correctAnswer must exactly match one option string.
- Make questions genuinely challenging at "${diff}" — these are accelerated learners.
- Vary style: word problems, application, conceptual reasoning.
- Output ONLY the JSON object.`;

  const result = await callClaude({ system, user: prompt, maxTokens: 2400 });

  // Validate structure
  if (!result.modules || result.modules.length < 5 || !result.miniBoss || !result.bigBoss) {
    throw new Error('Generated quest missing required sections');
  }

  // Normalize correctAnswer to match an option exactly
  const allQs = [...result.modules, result.miniBoss, result.bigBoss];
  for (const q of allQs) {
    if (!Array.isArray(q.options)) throw new Error('Question missing options array');
    if (!q.options.includes(q.correctAnswer)) {
      const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase());
      q.correctAnswer = match || q.options[0];
    }
  }

  // Tag kinds so the renderer knows boss types
  result.modules.forEach(q => { q.kind = 'module'; });
  result.miniBoss.kind = 'miniBoss';
  result.bigBoss.kind = 'bigBoss';

  // Flat shape for backwards compatibility with App.jsx render path
  result.questions = [...result.modules, result.miniBoss];
  result.bossQuestion = result.bigBoss;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate a lesson tied to a specific quest's concept and required knowledge.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateLesson(quest, subjectId, gradeLevel) {
  const subject = SUBJECT_LABELS[subjectId] || subjectId;
  const required = (quest.requiredKnowledge || []).join(', ');

  const system = `You are a warm, witty tutor writing a pre-quest lesson. Output ONLY raw JSON. Be conversational, not textbook-y. Be warm and direct, never patronizing.`;

  const prompt = `Write the lesson card for a Grade ${gradeLevel} ${subject} quest.

The quest tests this exact concept: ${quest.concept}
What's tested: ${quest.conceptSummary}

Terms, units, or formulas the student WILL ENCOUNTER in the questions: ${required || '(none specific)'}

Your lesson MUST teach every term/unit/formula listed above so the student is never tested on something they weren't taught. If any unit (joules, newtons, m/s²) or formula appears in the list, define it clearly with what it measures and show how to use it.

Return JSON:
{
  "topic": "Short topic name (≤ 5 words)",
  "hook": "One opening sentence — fun fact, real-world connection, or 'why this matters'",
  "lesson": "2-3 short paragraphs explaining the core concept clearly with one concrete worked example. Define every term in requiredKnowledge.",
  "watchOut": "One sentence about a common mistake students make on this topic",
  "keyTerms": [
    {"term": "joules (J)", "definition": "the unit of energy; 1 J = energy to lift a small apple ~1m"}
  ]
}

Keep total lesson length under 220 words. Include 1-5 keyTerms (only if requiredKnowledge had terms; otherwise empty array). Use "the student" or {NAME} placeholder if you refer to a student; do not assume a name. Output ONLY the JSON object.`;

  const result = await callClaude({ system, user: prompt, maxTokens: 900 });

  return {
    topic: result.topic || quest.concept || subject,
    hook: result.hook || '',
    lesson: result.lesson || '',
    watchOut: result.watchOut || '',
    keyTerms: Array.isArray(result.keyTerms) ? result.keyTerms : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate both in one go (sequential — lesson needs the quest's required
// knowledge). Used by the live-fallback path and bootstrap.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateQuestAndLesson(subjectId, gradeLevel) {
  const quest = await generateQuest(subjectId, gradeLevel);
  const lesson = await generateLesson(quest, subjectId, gradeLevel);
  return { quest, lesson };
}
