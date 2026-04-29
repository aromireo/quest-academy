import { useState, useEffect } from 'react'
import GameOverlay from './GameOverlay.jsx'

const WORDS = ['GALAXY','VOLCANO','FRACTION','HABITAT','RHYTHM','PYRAMID','OXYGEN','PARALLEL','EQUATION','DEMOCRACY','METAMORPHOSIS','LONGITUDE']

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
  const [idx, setIdx]           = useState(0)
  const [scrambled, setScrambled] = useState('')
  const [input, setInput]       = useState('')
  const [score, setScore]       = useState(0)
  const [feedback, setFeedback] = useState(null)
  const [solved, setSolved]     = useState(false)

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
          maxLength={15}
          style={inputStyle}
        />
        {feedback === 'correct' && <div style={{ color: '#10b981', fontWeight: 800, margin: '8px 0' }}>✅ Correct!</div>}
        {feedback === 'wrong'   && <div style={{ color: '#ef4444', fontWeight: 800, margin: '8px 0' }}>❌ Try again!</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
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
