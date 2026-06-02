export const SUBJECTS = [
  { id: 'math',    label: 'Math Realm',      emoji: '🔢', color: '#FF6B35', bg: '#FFF3EE', world: 'The Numeral Kingdom'   },
  { id: 'english', label: 'Language Forest', emoji: '📖', color: '#06B6D4', bg: '#ECFEFF', world: 'The Enchanted Library' },
  { id: 'science', label: 'Science Lab',     emoji: '🔬', color: '#3B82F6', bg: '#EFF6FF', world: 'The Discovery Dome'    },
  { id: 'history', label: 'History Citadel', emoji: '🏰', color: '#8B5CF6', bg: '#F5F3FF', world: 'The Time Archives'     },
]

export const COMING_SOON = [
  { id: 'spanish', label: 'Spanish Isles', emoji: '🌊', color: '#F59E0B', desc: 'Coming Soon' },
  { id: 'yoruba',  label: 'Yoruba Lands',  emoji: '🌍', color: '#10B981', desc: 'Coming Soon' },
]

export const HERO_CLASSES = [
  { id: 'wizard',    label: 'Wizard',    emoji: '🧙', desc: 'Master of spells & logic' },
  { id: 'explorer',  label: 'Explorer',  emoji: '🧭', desc: 'Seeker of hidden truths'  },
  { id: 'scientist', label: 'Scientist', emoji: '🔭', desc: 'Questioner of everything' },
  { id: 'knight',    label: 'Knight',    emoji: '⚔️', desc: 'Brave & never gives up'   },
]

export const AVATARS = ['🦁','🐉','🦊','🐺','🦋','🦅','🐬','🐯','🦄','🐸','🦉','🐻']

export const PRONOUN_OPTIONS = [
  { id: 'he/him',     label: 'He / Him'   },
  { id: 'she/her',    label: 'She / Her'  },
  { id: 'they/them',  label: 'They / Them' },
]

export const BADGES = [
  { id: 'first_quest',  label: 'First Quest',   emoji: '🌟', desc: 'Completed your first quest!'         },
  { id: 'perfect',      label: 'Flawless',      emoji: '💎', desc: 'Perfect score on a quest'            },
  { id: 'deep_thinker', label: 'Deep Thinker',  emoji: '🧠', desc: 'Showed deep understanding 10 times'  },
  { id: 'polyglot',     label: 'Polyglot',      emoji: '🌐', desc: 'Completed Spanish & Yoruba quests'   },
  { id: 'leveled_up',   label: 'Level Up!',     emoji: '⬆️', desc: 'Advanced difficulty in a subject'    },
  { id: 'streak_3',     label: 'On Fire',       emoji: '🔥', desc: '3 quests in a row'                   },
  { id: 'math_ace',     label: 'Math Ace',      emoji: '🔢', desc: 'Scored 85%+ on 3 Math quests'        },
  { id: 'word_wizard',  label: 'Word Wizard',   emoji: '📚', desc: 'Scored 85%+ on 3 English quests'     },
  { id: 'stretch',      label: 'Stretch Goal',  emoji: '🚀', desc: 'Crushed a stretch question'          },
]

export const XP_PER_LEVEL = 250

// Enrolled grade by slot (the grade they're actually in at school).
export const BASE_GRADE = { '7th': 7, '4th': 4 }

// Starting working levels per slot per subject.
// Updated for v11 based on MAP Spring 2026 scores:
//   Slot 0 = Teniola (incoming 7th grade): MAP Math 258 RIT / Reading 227 RIT — all subjects Grade 8
//   Slot 1 = Moyo (incoming 4th grade): MAP Math 235 RIT (exceptional growth) / Reading 226 RIT — all subjects Grade 5
export const STARTING_LEVELS = {
  0: { math: 8, english: 8, science: 8, history: 8 },
  1: { math: 5, english: 5, science: 5, history: 5 },
}

// Strand labels by subject — used for quest tagging and parent dashboard breakdown.
// These map to MAP Growth goal strands for cross-referencing over time.
export const STRANDS = {
  math: [
    'Numbers & Operations',
    'Fractions & Decimals',
    'Algebra & Patterns',
    'Geometry & Measurement',
    'Statistics & Data',
    'Real & Complex Numbers',
  ],
  english: [
    'Story & Character Analysis',
    'Informational Text',
    'Vocabulary in Context',
    "Author's Craft & Structure",
    'Argument & Evidence',
  ],
  science: [
    'Life Science',
    'Earth Science',
    'Physical Science',
    'Scientific Method',
    'Data & Experiments',
  ],
  history: [
    'Ancient & World History',
    'U.S. History',
    'Government & Civics',
    'Geography & Culture',
    'Historical Thinking',
  ],
}

// Tone profiles per slot.
// Slot 0 (Teniola, incoming 7th): peer-level, intellectually direct, no hand-holding.
// Slot 1 (Moyo, incoming 4th): warm and encouraging, age-appropriate energy.
export const TONE_PROFILES = {
  0: {
    style: 'peer',
    instructions: `Tone: direct and intellectually serious. Treat the student as a capable young adult. No exclamation points in praise. No baby-ish affirmations. Light wit is fine. Skip the hand-holding — get to the point. Never say things like "Great job!", "Amazing!", "You're so smart!" Academic but not stuffy.`,
  },
  1: {
    style: 'warm',
    instructions: `Tone: warm, encouraging, and age-appropriate. Celebrate effort genuinely without being over-the-top. Friendly energy is good. Clear and simple language.`,
  },
}

export function getLevel(xp)        { return Math.floor((xp || 0) / XP_PER_LEVEL) + 1 }
export function getXPProgress(xp)   { return (((xp || 0) % XP_PER_LEVEL) / XP_PER_LEVEL) * 100 }
export function xpToNextLevel(xp)   { return XP_PER_LEVEL - ((xp || 0) % XP_PER_LEVEL) }
