// ─────────────────────────────────────────────────────────────────────────────
// /api/_lib/generate.js  —  v11
// Server-side quest+lesson generation.
//
// v11 changes:
//   - Quest JSON now includes a `strand` field (tagged by Claude at generation)
//   - Lesson prompts are richer: more depth, worked example, "why this matters
//     at the next level" hook — appropriate for advanced/accelerated learners
//   - Tone profile support: caller can pass toneProfile to adjust voice
//     (used by live fallback; pool quests are generic, tone applied client-side)
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SUBJECT_LABELS = {
  math:    'Math',
  english: 'English / Language Arts',
  science: 'Science',
  history: 'History',
};

// Strand options passed into the prompt so Claude picks the closest match.
const STRAND_OPTIONS = {
  math:    ['Numbers & Operations','Fractions & Decimals','Algebra & Patterns','Geometry & Measurement','Statistics & Data','Real & Complex Numbers'],
  english: ['Story & Character Analysis','Informational Text','Vocabulary in Context',"Author's Craft & Structure",'Argument & Evidence'],
  science: ['Life Science','Earth Science','Physical Science','Scientific Method','Data & Experiments'],
  history: ['Ancient & World History','U.S. History','Government & Civics','Geography & Culture','Historical Thinking'],
};

function difficultyLabel(level) {
  const labels = {
    1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5',
    6: 'Grade 6', 7: 'Grade 7 (Advanced)', 8: 'Grade 8 (Advanced)',
    9: 'Grade 9', 10: 'Grade 10', 11: 'Grade 11', 12: 'Grade 12',
  };
  return labels[level] || `Grade ${level}`;
}

// v13: default changed from claude-sonnet-4-6 to Haiku. pool.js calls this on
// the live-fallback path; every pool miss was silently generating on Sonnet at
// ~15x the cost. Callers may still pass an explicit model to override.
async function callClaude({ model = 'claude-haiku-4-5-20251001', system, user, maxTokens = 2400 }) {
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
// Generate a generic quest (no name/pronoun baked in).
// v11: now includes strand tagging.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateQuest(subjectId, gradeLevel) {
  const subject = SUBJECT_LABELS[subjectId] || subjectId;
  const diff = difficultyLabel(gradeLevel);
  const strandList = (STRAND_OPTIONS[subjectId] || []).join(', ');

  const system = `You are a quiz generator for an adaptive learning app. Output ONLY raw JSON. No markdown, no explanation, no code fences. Start with { and end with }.`;

  const prompt = `Generate a ${subject} quest at difficulty "${diff}".

IMPORTANT: Match content to Grade ${gradeLevel} curriculum standards exactly. Students using this app are genuinely working at or above this level — make questions challenging, precise, and intellectually substantive. Avoid oversimplified or trivial questions.

If any word problem features a student, refer to them as "the student" or use the placeholder {NAME}. Do not assume a name or gender. Use the placeholder {PRONOUN_SUBJECT} (they/he/she) and {PRONOUN_POSSESSIVE} (their/his/her) where pronouns are needed. The app replaces these at display time.

STRAND: Pick the single best matching strand for this quest's concept from this list: ${strandList || 'use your judgment'}

STRUCTURE:
- Pick ONE focused concept appropriate for Grade ${gradeLevel} ${subject}.
- ALL 7 questions must test that single concept (varying difficulty and angle).
- 5 "module" questions: progressive practice (easier → medium).
- 1 "miniBoss" question: synthesize multiple aspects of the concept.
- 1 "bigBoss" question: apply the concept in a genuinely new context (transfer).

Output this exact JSON:
{
  "concept": "Name of the focused concept (e.g. 'Linear equations with one variable')",
  "conceptSummary": "1 sentence describing what specifically is being tested",
  "strand": "Exact strand label from the list above",
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
- "requiredKnowledge" lists every term, unit, formula, or vocabulary word that appears in any question. The lesson will teach these BEFORE the student answers.
- For science: if a question uses a unit or formula, it MUST appear in requiredKnowledge.
- correctAnswer must exactly match one option string.
- Questions should be genuinely challenging — these are advanced, accelerated learners.
- Vary style: word problems, application, conceptual reasoning, data interpretation.
- Output ONLY the JSON object.`;

  const result = await callClaude({ system, user: prompt, maxTokens: 2400 });

  if (!result.modules || result.modules.length < 5 || !result.miniBoss || !result.bigBoss) {
    throw new Error('Generated quest missing required sections');
  }

  // Validate and normalize correctAnswer for every question
  const allQs = [...result.modules, result.miniBoss, result.bigBoss];
  for (const q of allQs) {
    if (!Array.isArray(q.options)) throw new Error('Question missing options array');
    if (!q.options.includes(q.correctAnswer)) {
      const match = q.options.find(o => o.trim().toLowerCase() === (q.correctAnswer || '').trim().toLowerCase());
      q.correctAnswer = match || q.options[0];
    }
  }

  // Tag kinds for renderer
  result.modules.forEach(q => { q.kind = 'module'; });
  result.miniBoss.kind = 'miniBoss';
  result.bigBoss.kind = 'bigBoss';

  // Flat shape for backwards compatibility with App.jsx render path
  result.questions = [...result.modules, result.miniBoss];
  result.bossQuestion = result.bigBoss;

  // Ensure strand is a string; fall back gracefully
  if (!result.strand || typeof result.strand !== 'string') {
    result.strand = (STRAND_OPTIONS[subjectId] || [])[0] || 'General';
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate a richer lesson tied to the quest's concept and required knowledge.
// v11: deeper explanation, worked example, "why this matters" forward hook.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateLesson(quest, subjectId, gradeLevel) {
  const subject = SUBJECT_LABELS[subjectId] || subjectId;
  const required = (quest.requiredKnowledge || []).join(', ');
  const diff = difficultyLabel(gradeLevel);

  const system = `You are a sharp, direct tutor writing a pre-quest lesson for an advanced learner. Output ONLY raw JSON. Be substantive — explain the concept properly, not superficially. Assume the student is capable and curious. Do not pad with fluff or over-reassure.`;

  const prompt = `Write the lesson card for a ${diff} ${subject} quest.

The quest tests this concept: ${quest.concept}
What's specifically tested: ${quest.conceptSummary}
Terms, units, or formulas the student WILL ENCOUNTER: ${required || '(none specific)'}

LESSON REQUIREMENTS:
1. Teach every term/unit/formula listed above — define it clearly, show what it measures or means, and demonstrate how to use it.
2. Include at least one concrete worked example that walks through the reasoning step by step.
3. End with a brief "why this matters" note — connect the concept to something at the next level of study or a real application they'll actually encounter.
4. Do not dumb it down. These are advanced learners encountering new-ish material. Explain it properly.

Return JSON:
{
  "topic": "Short topic name (≤ 5 words)",
  "hook": "One opening sentence — a compelling real-world connection, surprising fact, or genuine reason this concept matters",
  "lesson": "3-4 short paragraphs: (1) core concept explained clearly, (2) worked example with step-by-step reasoning, (3) key nuances or conditions to know, (4) why this matters / what it connects to next",
  "watchOut": "One sentence about the most common mistake students make on this specific concept",
  "keyTerms": [
    {"term": "term name", "definition": "precise, useful definition — not vague"}
  ]
}

Total lesson length: 250-320 words (longer than before — depth matters here).
Include 1-6 keyTerms covering everything in requiredKnowledge.
Use "the student" or {NAME} placeholder if referring to a student. Do not assume a name.
Output ONLY the JSON object.`;

  const result = await callClaude({ system, user: prompt, maxTokens: 1200 });

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
// knowledge). Used by the live-fallback path and bootstrap/cron.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateQuestAndLesson(subjectId, gradeLevel) {
  const quest = await generateQuest(subjectId, gradeLevel);
  const lesson = await generateLesson(quest, subjectId, gradeLevel);
  return { quest, lesson };
}
