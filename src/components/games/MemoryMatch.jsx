import { useState, useEffect, useRef } from 'react'
import GameOverlay from './GameOverlay.jsx'

const EMOJI_PAIRS = ['🦁','🐉','⭐','🔮','🌙','🔥','💎','🌊']

function initCards() {
  // Cards start face-up during preview; we flip them all to face-down after preview.
  return [...EMOJI_PAIRS, ...EMOJI_PAIRS]
    .map((emoji, i) => ({ id: i, emoji, matched: false, flipped: true }))
    .sort(() => Math.random() - 0.5)
}

// Pick preview duration based on the kid's enrolled grade.
// 6th grade and up = 2s; younger = 4s.
function pickPreviewMs(profile) {
  const grade = profile?.base_grade_num
              ?? profile?.grade
              ?? (parseInt(profile?.enrolled_grade, 10) || 6)
  return grade >= 6 ? 2000 : 4000
}

export default function MemoryMatch({ profile, onClose }) {
  const previewMs = pickPreviewMs(profile)

  const [cards, setCards]       = useState(initCards)
  const [selected, setSelected] = useState([])
  const [moves, setMoves]       = useState(0)
  const [won, setWon]           = useState(false)
  const [locked, setLocked]     = useState(true) // locked during preview
  const [phase, setPhase]       = useState('preview') // 'preview' | 'play'
  const [countdown, setCountdown] = useState(Math.ceil(previewMs / 1000))
  const previewTimerRef = useRef(null)
  const tickTimerRef = useRef(null)

  // Run preview countdown then flip all cards face-down
  useEffect(() => {
    if (phase !== 'preview') return

    setCountdown(Math.ceil(previewMs / 1000))
    tickTimerRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)

    previewTimerRef.current = setTimeout(() => {
      setCards(prev => prev.map(c => ({ ...c, flipped: false })))
      setPhase('play')
      setLocked(false)
      clearInterval(tickTimerRef.current)
    }, previewMs)

    return () => {
      clearTimeout(previewTimerRef.current)
      clearInterval(tickTimerRef.current)
    }
  }, [phase, previewMs])

  const flip = (id) => {
    if (locked || phase !== 'play') return
    const card = cards.find(c => c.id === id)
    if (!card || card.flipped || card.matched || selected.length === 2) return

    const newSelected = [...selected, id]
    setCards(prev => prev.map(c => c.id === id ? { ...c, flipped: true } : c))
    setSelected(newSelected)

    if (newSelected.length === 2) {
      setMoves(m => m + 1)
      setLocked(true)
      const [idA, idB] = newSelected
      const cardA = cards.find(c => c.id === idA)
      const cardB = id === idB ? card : cards.find(c => c.id === idB)

      if (cardA.emoji === cardB.emoji) {
        setTimeout(() => {
          setCards(prev => {
            const updated = prev.map(c => newSelected.includes(c.id) ? { ...c, matched: true, flipped: true } : c)
            if (updated.every(c => c.matched)) setWon(true)
            return updated
          })
          setSelected([])
          setLocked(false)
        }, 400)
      } else {
        setTimeout(() => {
          setCards(prev => prev.map(c => newSelected.includes(c.id) ? { ...c, flipped: false } : c))
          setSelected([])
          setLocked(false)
        }, 800)
      }
    }
  }

  const reset = () => {
    clearTimeout(previewTimerRef.current)
    clearInterval(tickTimerRef.current)
    setCards(initCards())
    setSelected([])
    setMoves(0)
    setWon(false)
    setLocked(true)
    setPhase('preview')
    setCountdown(Math.ceil(previewMs / 1000))
  }

  return (
    <GameOverlay title="Memory Match" emoji="🃏" score={null} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13, color: '#64748b' }}>
        <span>Moves: <strong>{moves}</strong></span>
        {phase === 'preview' && (
          <span style={{ color: '#f59e0b', fontWeight: 800 }}>
            👀 Memorize! {countdown}s
          </span>
        )}
        {won && <span style={{ color: '#10b981', fontWeight: 800 }}>🎉 You won!</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
        {cards.map(card => (
          <div
            key={card.id}
            onClick={() => flip(card.id)}
            style={{
              aspectRatio: '1', borderRadius: 10,
              cursor: card.matched || phase === 'preview' ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, transition: 'all 0.2s',
              background: card.matched ? '#d1fae5' : card.flipped ? '#fff' : '#6366f1',
              border: `2px solid ${card.matched ? '#6ee7b7' : card.flipped ? '#6366f1' : 'transparent'}`,
              transform: card.flipped || card.matched ? 'scale(1.05)' : 'none',
            }}
          >
            {card.flipped || card.matched ? card.emoji : '❓'}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {won
          ? <button style={btnPrimary} onClick={reset}>Play Again</button>
          : <button style={btnSecondary} onClick={reset}>Restart</button>
        }
        <button style={btnSecondary} onClick={onClose}>Done</button>
      </div>
    </GameOverlay>
  )
}

const btnPrimary   = { flex: 1, padding: '11px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14 }
const btnSecondary = { flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 14 }
