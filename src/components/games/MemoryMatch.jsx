import { useState } from 'react'
import GameOverlay from './GameOverlay.jsx'

const EMOJI_PAIRS = ['🦁','🐉','⭐','🔮','🌙','🔥','💎','🌊']

function initCards() {
  return [...EMOJI_PAIRS, ...EMOJI_PAIRS]
    .map((emoji, i) => ({ id: i, emoji, matched: false, flipped: false }))
    .sort(() => Math.random() - 0.5)
}

export default function MemoryMatch({ onClose }) {
  const [cards, setCards]     = useState(initCards)
  const [selected, setSelected] = useState([])
  const [moves, setMoves]     = useState(0)
  const [won, setWon]         = useState(false)
  const [locked, setLocked]   = useState(false)

  const flip = (id) => {
    if (locked) return
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

  const reset = () => { setCards(initCards()); setSelected([]); setMoves(0); setWon(false); setLocked(false) }

  return (
    <GameOverlay title="Memory Match" emoji="🃏" score={null} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13, color: '#64748b' }}>
        <span>Moves: <strong>{moves}</strong></span>
        {won && <span style={{ color: '#10b981', fontWeight: 800 }}>🎉 You won!</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
        {cards.map(card => (
          <div
            key={card.id}
            onClick={() => flip(card.id)}
            style={{
              aspectRatio: '1', borderRadius: 10, cursor: card.matched ? 'default' : 'pointer',
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
