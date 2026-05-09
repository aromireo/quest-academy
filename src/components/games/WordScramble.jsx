import { useState, useEffect } from 'react'
import GameOverlay from './GameOverlay.jsx'

// Expanded pool — mix of difficulty levels so kids get variety
const WORDS = [
  // Easier
  'GALAXY', 'VOLCANO', 'OXYGEN', 'PYRAMID', 'HABITAT', 'RHYTHM',
  'DESERT', 'JUNGLE', 'MAGNET', 'PLANET', 'COMPASS', 'CIRCUIT',
  // Medium
  'FRACTION', 'PARALLEL', 'EQUATION', 'GRAVITY', 'MINERAL', 'CLIMATE',
  'ORBIT', 'ENZYME', 'NUCLEUS', 'TRIANGLE', 'POLYGON', 'VARIABLE',
  // Harder
  'DEMOCRACY', 'METAMORPHOSIS', 'LONGITUDE', 'PHOTOSYNTHESIS',
  'HYPOTHESIS', 'PERIMETER', 'CONSTELLATION', 'EVAPORATION',
]

// Pick the daily word: changes once per UTC-ish day, same for everyone.
// Uses an integer day index modulo word count, with a stable seed offset.
function getDailyIndex() {
  const epoch = new Date(2026, 0, 1).getTime() // Jan 1, 2026 as anchor
  const days = Math.floor((Date.now() - epoch) / 86_400_000)
  // Simple hash so consecutive days don't pick adjacent words
  const hashed = (days * 2654435761) >>> 0
  return hashed % WORDS.length
}

function scramble(word) {
  let result = word
  let attempts = 0
  while (result === word && attempts < 20) {
    result = word.split('').sort(() => Math.random() - 0.5).join('')
    attempts++
  }
  return result
}

export default function WordScramble({ onClose }) {
  // Start at the daily word, then "Next Word" cycles forward through the list
  // (so kids who play multiple rounds in a session keep getting fresh words).
  const [idx, setIdx] = useState(() => getDailyIndex())
  const [scrambled, setScrambled] = useState('')
  const [input, setInput] = useState('')
  const [score, setScore] = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [solved, setSolved] = useState(false)

  useEffect(() => {
    setScrambled(scramble(WORDS[idx]))
    setInput(''); setFeedback(null); setSolved(false)
  }, [idx])

  const check = () => {
    if (input.toUpperCase() === WORDS[idx]) {
      setScore(s => s + 1); setFeedback('correct'); setSolved(true)
    } else {
      setFeedback('wrong')
    }
  }

  const reshuffle = () => {
    // Re-scramble the SAME word — different letter order, same answer
    let next = scramble(WORDS[idx])
    // Avoid identical scramble
    if (next === scrambled) next = scramble(WORDS[idx])
    setScrambled(next)
  }

  return (
    <GameOverlay title="Word Scramble" emoji="🔀" score={score} onClose={onClose}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 32, fontWeight: 900, letterSpacing: 10, color: '#6366f1',
          margin: '16px 0', fontFamily: 'monospace',
        }}>
          {scrambled}
        </div>
        <input
          autoFocus
          value={input}
          onChange={e => { setInput(e.target.value.toUpperCase()); setFeedback(null) }}
          onKeyDown={e => e.key === 'Enter' && !solved && input && check()}
          placeholder="Unscramble it…"
          maxLength={20}
          style={inputStyle}
        />
        {feedback === 'correct' && <div style={{ color: '#10b981', fontWeight: 800, margin: '8px 0' }}>✅ Correct!</div>}
        {feedback === 'wrong'   && <div style={{ color: '#ef4444', fontWeight: 800, margin: '8px 0' }}>❌ Try again!</div>}

        {!solved && (
          <button
            onClick={reshuffle}
            style={{
              fontSize: 12, fontWeight: 700, color: '#64748b',
              background: '#f1f5f9', borderRadius: 8, padding: '6px 12px',
              marginTop: 4, marginBottom: 4, border: 'none', cursor: 'pointer',
            }}
          >
            🔀 Reshuffle letters
          </button>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {!solved
            ? <button style={btnPrimary} onClick={check} disabled={!input}>Check</button>
            : <button style={btnPrimary} onClick={() => setIdx(i => (i + 1) % WORDS.length)}>Next Word →</button>
          }
          <button style={btnSecondary} onClick={onClose}>Done</button>
        </div>
      </div>
    </GameOverlay>
  )
}

const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '2px solid #e2e8f0', fontSize: 18, textAlign: 'center', fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box' }
const btnPrimary   = { flex: 1, padding: '11px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14 }
const btnSecondary = { flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 14 }
