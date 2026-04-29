import { useState, useEffect, useCallback } from 'react'
import GameOverlay from './GameOverlay.jsx'

function makeQuestion() {
  const ops = ['+', '-', '×']
  const op = ops[Math.floor(Math.random() * ops.length)]
  const a = Math.floor(Math.random() * 12) + 1
  const b = Math.floor(Math.random() * 12) + 1
  const ans = op === '+' ? a + b : op === '-' ? a - b : a * b
  return { text: `${a} ${op} ${b}`, answer: ans }
}

export default function MathBlitz({ onClose }) {
  const [started, setStarted] = useState(false)
  const [ended, setEnded]     = useState(false)
  const [q, setQ]             = useState(null)
  const [input, setInput]     = useState('')
  const [score, setScore]     = useState(0)
  const [timeLeft, setTimeLeft] = useState(30)
  const [feedback, setFeedback] = useState(null)

  const nextQ = useCallback(() => { setQ(makeQuestion()); setInput(''); setFeedback(null) }, [])

  useEffect(() => { if (started && !ended) nextQ() }, [started])

  useEffect(() => {
    if (!started || ended) return
    const t = setInterval(() => {
      setTimeLeft(s => {
        if (s <= 1) { setEnded(true); clearInterval(t); return 0 }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [started, ended])

  const check = () => {
    if (!q) return
    if (parseInt(input, 10) === q.answer) {
      setScore(s => s + 1); setFeedback('correct'); setTimeout(nextQ, 350)
    } else {
      setFeedback('wrong'); setInput('')
    }
  }

  return (
    <GameOverlay title="Math Blitz" emoji="⚡" score={started ? score : null} onClose={onClose}>
      {!started && !ended && (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#64748b', marginBottom: 20 }}>Answer as many as you can in 30 seconds!</p>
          <button style={btnPrimary} onClick={() => setStarted(true)}>Start! ⚡</button>
        </div>
      )}

      {started && !ended && q && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: 13, fontWeight: 800, marginBottom: 8,
            color: timeLeft <= 10 ? '#ef4444' : '#10b981',
          }}>
            ⏱ {timeLeft}s
          </div>
          <div style={{ fontSize: 44, fontWeight: 900, color: '#1a1a2e', margin: '12px 0', fontFamily: 'Georgia, serif' }}>
            {q.text} = ?
          </div>
          <input
            autoFocus
            type="number"
            value={input}
            onChange={e => { setInput(e.target.value); setFeedback(null) }}
            onKeyDown={e => e.key === 'Enter' && input && check()}
            style={{ ...inputStyle, fontSize: 22 }}
            placeholder="?"
          />
          {feedback === 'correct' && <div style={{ color: '#10b981', fontWeight: 900, fontSize: 20, marginTop: 6 }}>⚡ Yes!</div>}
          {feedback === 'wrong'   && <div style={{ color: '#ef4444', fontWeight: 800, marginTop: 6 }}>❌ Try again</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button style={btnPrimary} onClick={check} disabled={!input}>Submit</button>
            <button style={btnSecondary} onClick={onClose}>Exit</button>
          </div>
        </div>
      )}

      {ended && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 52 }}>🏆</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#6366f1', margin: '8px 0' }}>{score}</div>
          <p style={{ color: '#64748b', marginBottom: 20 }}>
            {score >= 20 ? 'Lightning fast! 🌩️' : score >= 12 ? 'Great job! 🎉' : 'Keep practicing! 💪'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnPrimary} onClick={() => { setScore(0); setTimeLeft(30); setEnded(false); setStarted(false) }}>Play Again</button>
            <button style={btnSecondary} onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </GameOverlay>
  )
}

const inputStyle = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '2px solid #e2e8f0', textAlign: 'center', fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box' }
const btnPrimary   = { flex: 1, padding: '11px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14 }
const btnSecondary = { flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 14 }
