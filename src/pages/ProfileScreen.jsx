import { useState } from 'react'
import { SUBJECTS, COMING_SOON, HERO_CLASSES, BADGES } from '../lib/constants.js'
import { getDifficultyLabel } from '../lib/claude.js'
import XPBar from '../components/XPBar.jsx'
import WordScramble from '../components/games/WordScramble.jsx'
import MathBlitz from '../components/games/MathBlitz.jsx'
import MemoryMatch from '../components/games/MemoryMatch.jsx'

const GAMES = [
  { id: 'word_scramble', label: 'Word Scramble', emoji: '🔀', desc: 'Unscramble the letters!' },
  { id: 'math_blitz',    label: 'Math Blitz',    emoji: '⚡', desc: 'Answer as fast as you can!' },
  { id: 'memory_match',  label: 'Memory Match',  emoji: '🃏', desc: 'Find matching pairs!' },
]

export default function ProfileScreen({ profile, onStartQuest, onBack }) {
  const [showGames, setShowGames]   = useState(false)
  const [activeGame, setActiveGame] = useState(null)
  const heroClass = HERO_CLASSES.find(h => h.id === profile?.hero_class)

  if (!profile) return null

  return (
    <div style={{ minHeight: '100vh', padding: '20px 16px 60px' }}>
      {/* Header */}
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <button onClick={onBack} style={{
          background: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 700,
          marginBottom: 16, padding: 0,
        }}>← Home</button>

        {/* Hero card */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '20px', marginBottom: 16, display: 'flex',
          alignItems: 'center', gap: 16,
        }} className="animate-fade">
          <div style={{ fontSize: 52 }}>{profile.avatar}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: 'var(--text)' }}>{profile.name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
              {heroClass?.emoji} {heroClass?.label} · Grade {profile.grade} · Level {profile.level || 1}
            </div>
            <XPBar xp={profile.xp || 0} />
          </div>
        </div>

        {/* Badges */}
        {(profile.badges || []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }} className="animate-fade delay-1">
            {(profile.badges || []).map(bid => {
              const b = BADGES.find(x => x.id === bid)
              return b ? (
                <div key={bid} title={b.label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text)',
                }}>
                  {b.emoji} {b.label}
                </div>
              ) : null
            })}
          </div>
        )}

        {/* Subject grid */}
        <h3 style={{
          fontFamily: 'var(--font-display)', color: 'var(--text-muted)', fontSize: 13,
          letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12,
        }}>
          Choose Your Quest
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {SUBJECTS.map((s, i) => {
            const diffLevel = profile.difficulty_levels?.[s.id] || profile.base_grade_num
            return (
              <div
                key={s.id}
                className={`animate-fade delay-${Math.min(i+1,5)}`}
                onClick={() => onStartQuest(s.id)}
                style={{
                  background: s.bg, border: `2px solid ${s.color}33`,
                  borderRadius: 16, padding: '18px 14px', textAlign: 'center',
                  cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s',
                  position: 'relative',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = s.color }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = `${s.color}33` }}
              >
                <div style={{ fontSize: 34, marginBottom: 4 }}>{s.emoji}</div>
                <div style={{ fontWeight: 800, color: s.color, fontSize: 14 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.world}</div>
                <div style={{
                  position: 'absolute', top: 8, right: 8, fontSize: 10,
                  background: `${s.color}22`, color: s.color,
                  borderRadius: 20, padding: '2px 6px', fontWeight: 800,
                }}>
                  {getDifficultyLabel(diffLevel)}
                </div>
              </div>
            )
          })}
        </div>

        {/* Coming soon */}
        <h3 style={{
          fontFamily: 'var(--font-display)', color: 'var(--text-muted)', fontSize: 13,
          letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, marginTop: 8,
        }}>
          Coming Soon
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20, opacity: 0.5 }}>
          {COMING_SOON.map(s => (
            <div key={s.id} style={{
              background: '#f8fafc', border: `2px dashed ${s.color}55`,
              borderRadius: 16, padding: '18px 14px', textAlign: 'center',
              cursor: 'not-allowed', position: 'relative',
            }}>
              <div style={{ fontSize: 34, marginBottom: 4 }}>{s.emoji}</div>
              <div style={{ fontWeight: 800, color: s.color, fontSize: 14 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>🔒 Language Module Coming Soon</div>
            </div>
          ))}
        </div>

        {/* Mini-games button */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={() => setShowGames(true)}
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
              color: '#fff', borderRadius: 12, padding: '12px 28px',
              fontSize: 15, fontWeight: 800,
            }}
          >
            🎮 Mini-Game Break
          </button>
        </div>
      </div>

      {/* Mini-game picker */}
      {showGames && !activeGame && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, padding: 20,
        }}>
          <div style={{
            background: '#fff', borderRadius: 24, padding: '28px 24px',
            maxWidth: 400, width: '100%', color: '#1a1a2e',
          }} className="animate-pop">
            <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: 20, fontSize: 20 }}>
              🎮 Choose a Game
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {GAMES.map(g => (
                <div key={g.id}
                  onClick={() => { setActiveGame(g.id); setShowGames(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 16px', background: '#f8fafc',
                    borderRadius: 12, cursor: 'pointer', border: '2px solid #e2e8f0',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#eef2ff' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}
                >
                  <span style={{ fontSize: 28 }}>{g.emoji}</span>
                  <div>
                    <div style={{ fontWeight: 800 }}>{g.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{g.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowGames(false)} style={{
              width: '100%', padding: 12, background: '#f1f5f9',
              color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 14,
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeGame === 'word_scramble' && <WordScramble onClose={() => setActiveGame(null)} />}
      {activeGame === 'math_blitz'    && <MathBlitz    onClose={() => setActiveGame(null)} />}
      {activeGame === 'memory_match'  && <MemoryMatch  onClose={() => setActiveGame(null)} />}
    </div>
  )
}
