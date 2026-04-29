import { useState } from 'react'
import { HERO_CLASSES, AVATARS, PRONOUN_OPTIONS } from '../lib/constants.js'

export default function SetupScreen({ slot, editing, onComplete, onBack }) {
  // Pre-fill values when editing an existing profile
  const [step, setStep]         = useState(0)
  const [name, setName]         = useState(editing?.name || '')
  const [pronouns, setPronouns] = useState(editing?.pronouns || '')
  const [heroClass, setHeroClass] = useState(editing?.hero_class || '')
  const [avatar, setAvatar]     = useState(editing?.avatar || '🦁')
  const grade = slot === 0 ? '6th' : '3rd'

  const isEdit = !!editing

  const steps = [
    { title: "What's your name, hero?" },
    { title: 'Which pronouns do you use?' },
    { title: 'Choose your hero class' },
    { title: 'Pick your avatar' },
  ]

  const totalSteps = steps.length

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '36px 28px',
        maxWidth: 480, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        color: '#1a1a2e',
      }} className="animate-pop">
        <button onClick={onBack} style={{
          background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 700,
          marginBottom: 20, padding: 0,
        }}>← Back</button>

        <div style={{
          display: 'inline-block', background: '#eef2ff', color: '#6366f1',
          borderRadius: 20, padding: '3px 12px', fontSize: 12, fontWeight: 800,
          marginBottom: 12,
        }}>
          {isEdit ? 'Editing Hero' : `Grade ${grade}`}
        </div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: '#1a1a2e', marginBottom: 6 }}>
          {isEdit ? 'Edit Your Hero' : 'Create Your Hero'}
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>{steps[step].title}</p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{
              flex: i === step ? 3 : 1, height: 4, borderRadius: 4,
              background: i <= step ? '#6366f1' : '#e2e8f0',
              transition: 'all 0.3s',
            }} />
          ))}
        </div>

        {/* Step 0 — Name */}
        {step === 0 && (
          <div>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(1)}
              placeholder="Enter your name…"
              maxLength={20}
              style={{
                width: '100%', padding: '14px 18px', borderRadius: 12,
                border: '2px solid #e2e8f0', fontSize: 18, textAlign: 'center',
                fontFamily: 'var(--font-body)', fontWeight: 700,
                outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = '#6366f1'}
              onBlur={e => e.target.style.borderColor = '#e2e8f0'}
            />
            <button
              disabled={!name.trim()}
              onClick={() => setStep(1)}
              style={{
                width: '100%', marginTop: 16, padding: '14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', borderRadius: 12, fontSize: 16, fontWeight: 800,
              }}
            >
              Next →
            </button>
          </div>
        )}

        {/* Step 1 — Pronouns */}
        {step === 1 && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {PRONOUN_OPTIONS.map(p => (
                <div
                  key={p.id}
                  onClick={() => setPronouns(p.id)}
                  style={{
                    border: `2px solid ${pronouns === p.id ? '#6366f1' : '#e2e8f0'}`,
                    background: pronouns === p.id ? '#eef2ff' : '#f8fafc',
                    borderRadius: 14, padding: '14px 18px', textAlign: 'center',
                    cursor: 'pointer', transition: 'all 0.2s',
                    fontWeight: 800, fontSize: 16, color: '#1a1a2e',
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>
            <p style={{
              fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 14,
              lineHeight: 1.5,
            }}>
              We'll use these in word problems and feedback so quests feel
              personal to you.
            </p>
            <button
              disabled={!pronouns}
              onClick={() => setStep(2)}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', borderRadius: 12, fontSize: 16, fontWeight: 800,
              }}
            >
              Next →
            </button>
          </div>
        )}

        {/* Step 2 — Hero class */}
        {step === 2 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {HERO_CLASSES.map(hc => (
                <div
                  key={hc.id}
                  onClick={() => setHeroClass(hc.id)}
                  style={{
                    border: `2px solid ${heroClass === hc.id ? '#6366f1' : '#e2e8f0'}`,
                    background: heroClass === hc.id ? '#eef2ff' : '#f8fafc',
                    borderRadius: 14, padding: '16px 12px', textAlign: 'center',
                    cursor: 'pointer', transition: 'all 0.2s',
                    transform: heroClass === hc.id ? 'scale(1.03)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 4 }}>{hc.emoji}</div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>{hc.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hc.desc}</div>
                </div>
              ))}
            </div>
            <button
              disabled={!heroClass}
              onClick={() => setStep(3)}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', borderRadius: 12, fontSize: 16, fontWeight: 800,
              }}
            >
              Next →
            </button>
          </div>
        )}

        {/* Step 3 — Avatar */}
        {step === 3 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
              {AVATARS.map(av => (
                <div
                  key={av}
                  onClick={() => setAvatar(av)}
                  style={{
                    fontSize: 30, textAlign: 'center', padding: 10,
                    borderRadius: 12, cursor: 'pointer',
                    border: `2px solid ${avatar === av ? '#6366f1' : 'transparent'}`,
                    background: avatar === av ? '#eef2ff' : '#f8fafc',
                    transition: 'all 0.15s',
                    transform: avatar === av ? 'scale(1.15)' : 'none',
                  }}
                >
                  {av}
                </div>
              ))}
            </div>
            <button
              onClick={() => onComplete({
                name: name.trim(),
                pronouns,
                heroClass,
                avatar,
              })}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', borderRadius: 12, fontSize: 16, fontWeight: 800,
              }}
            >
              {isEdit ? 'Save Changes ✓' : 'Begin Adventure! ⚔️'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
