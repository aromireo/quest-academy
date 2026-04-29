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
export const BASE_GRADE = { '6th': 6, '3rd': 3 }

// Starting working levels per slot per subject (separate from enrolled grade).
// These are the defaults for newly-created profiles. Existing profiles keep
// whatever's in their difficulty_levels jsonb. Parents can override anytime
// from the dashboard.
export const STARTING_LEVELS = {
  // Slot 0 = older kid (Teniola): doing 8th grade math, ~7th in others
  0: { math: 8, english: 7, science: 7, history: 7 },
  // Slot 1 = younger kid (Moyo): doing 4th grade across the board (accelerated)
  1: { math: 4, english: 4, science: 4, history: 4 },
}

export function getLevel(xp)        { return Math.floor((xp || 0) / XP_PER_LEVEL) + 1 }
export function getXPProgress(xp)   { return (((xp || 0) % XP_PER_LEVEL) / XP_PER_LEVEL) * 100 }
export function xpToNextLevel(xp)   { return XP_PER_LEVEL - ((xp || 0) % XP_PER_LEVEL) }
