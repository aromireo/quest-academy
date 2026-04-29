import { useState } from 'react'

export default function HouseholdSetup({ currentCode, onSwitch, onNew, onBack, showNotif }) {
  const [mode, setMode]         = useState('view') // view | join | confirmNew
  const [inputCode, setInputCode] = useState('')
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)

  const copyCode = () => {
    if (!currentCode) return
    navigator.clipboard?.writeText(currentCode)
      .then(() => showNotif?.('Code copied!', '📋', 1800))
      .catch(() => {})
  }

  const submitJoin = async () => {
    setError('')
    const code = inputCode.trim().toUpperCase()
    if (!code) { setError('Enter a code first'); return }
    setBusy(true)
    const ok = await onSwitch(code)
    setBusy(false)
    if (ok) {
      showNotif?.('Switched households!', '✅', 2200)
      onBack()
    } else {
      setError('Could not load that household')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '36px 28px',
        maxWidth: 460, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        color: '#1a1a2e',
      }} className="animate-pop">
        <button onClick={onBack} style={{
          background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 700,
          marginBottom: 16, padding: 0,
        }}>← Back</button>

        <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 8 }}>🔗</div>
        <h2 style={{
          fontFamily: 'var(--font-display)', fontSize: 22, color: '#1a1a2e',
          marginBottom: 8, textAlign: 'center',
        }}>
          Sync Across Devices
        </h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24, textAlign: 'center', lineHeight: 1.5 }}>
          Use your household code to access the same profiles and progress
          on any phone, tablet, or computer.
        </p>

        {/* Current code display */}
        <div style={{
          background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
          border: '2px solid #c7d2fe', borderRadius: 14,
          padding: '18px 16px', marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 800, letterSpacing: 1.5, marginBottom: 6 }}>
            YOUR HOUSEHOLD CODE
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 26, color: '#1a1a2e',
            fontWeight: 900, letterSpacing: 2, marginBottom: 10,
          }}>
            {currentCode || '—'}
          </div>
          <button
            onClick={copyCode}
            disabled={!currentCode}
            style={{
              background: '#6366f1', color: '#fff', borderRadius: 8,
              padding: '7px 16px', fontSize: 13, fontWeight: 800,
            }}
          >
            📋 Copy Code
          </button>
        </div>

        <p style={{ color: '#475569', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
          On a new device, open Quest Academy, tap{' '}
          <strong>Sync Across Devices</strong>, then tap{' '}
          <strong>Use Existing Code</strong> and enter the code above.
        </p>

        {mode === 'view' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => setMode('join')}
              style={{
                width: '100%', padding: '13px',
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', borderRadius: 12, fontSize: 15, fontWeight: 800,
              }}
            >
              ↪️ Use Existing Code
            </button>
            <button
              onClick={() => setMode('confirmNew')}
              style={{
                width: '100%', padding: '12px', background: '#f1f5f9',
                color: '#475569', borderRadius: 12, fontSize: 14, fontWeight: 700,
              }}
            >
              🆕 Start Fresh Household
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
              Enter household code:
            </div>
            <input
              autoFocus
              value={inputCode}
              onChange={e => { setInputCode(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && !busy && submitJoin()}
              placeholder="QUEST-XXXX"
              maxLength={20}
              style={{
                width: '100%', padding: '13px 16px', borderRadius: 12,
                border: `2px solid ${error ? '#ef4444' : '#e2e8f0'}`,
                fontSize: 18, textAlign: 'center', letterSpacing: 2,
                fontFamily: 'var(--font-display)', fontWeight: 800,
                outline: 'none', textTransform: 'uppercase', boxSizing: 'border-box',
              }}
            />
            {error && <p style={{ color: '#ef4444', fontSize: 13, marginTop: 6 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setMode('view')}
                style={{
                  flex: 1, padding: '12px', background: '#f1f5f9',
                  color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitJoin}
                disabled={busy || !inputCode.trim()}
                style={{
                  flex: 2, padding: '12px',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 14,
                }}
              >
                {busy ? 'Loading…' : 'Switch'}
              </button>
            </div>
          </div>
        )}

        {mode === 'confirmNew' && (
          <div style={{
            background: '#fff7ed', border: '2px solid #fed7aa', borderRadius: 12,
            padding: 14, color: '#9a3412',
          }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>⚠️ Are you sure?</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
              Starting fresh creates a brand-new code. Your current profiles
              will still exist under code <strong>{currentCode}</strong>, but
              this device will no longer see them unless you re-enter the code.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setMode('view')}
                style={{
                  flex: 1, padding: '10px', background: '#fff',
                  color: '#475569', borderRadius: 10, fontWeight: 700, fontSize: 13,
                  border: '1px solid #e2e8f0',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { onNew(); showNotif?.('New household started', '🆕') }}
                style={{
                  flex: 1, padding: '10px', background: '#dc2626',
                  color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13,
                }}
              >
                Yes, start fresh
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
