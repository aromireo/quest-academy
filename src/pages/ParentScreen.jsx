import { useEffect, useState } from 'react'
import { SUBJECTS, HERO_CLASSES } from '../lib/constants.js'

const PARENT_PIN = '7326' // Change this to your preferred PIN

export default function ParentScreen({
  profiles, questHistory, householdCode,
  onLoadHistory, onUpdateProfile, onEditProfile, onDeleteProfile,
  onBack, showNotif,
}) {
  const [unlocked, setUnlocked] = useState(false)
  const [pin, setPin]           = useState('')
  const [pinError, setPinError] = useState(false)
  const [busySubj, setBusySubj] = useState(null) // `${profileId}_${subjectId}`
  const [confirmDelete, setConfirmDelete] = useState(null) // profileId

  const checkPin = () => {
    if (pin === PARENT_PIN) { setUnlocked(true); setPinError(false) }
    else { setPinError(true); setPin('') }
  }

  useEffect(() => {
    if (unlocked) profiles.forEach(p => { if (p?.id) onLoadHistory(p.id) })
  }, [unlocked, profiles.map(p => p?.id).join(',')])

  // PIN lock screen
  if (!unlocked) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '36px 28px', maxWidth: 340, width: '100%', textAlign: 'center', color: '#1a1a2e', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🔒</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 6 }}>Parent Dashboard</h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Enter your PIN to continue</p>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={e => { setPin(e.target.value); setPinError(false) }}
          onKeyDown={e => e.key === 'Enter' && pin.length === 4 && checkPin()}
          placeholder="····"
          style={{
            width: '100%', padding: '14px', borderRadius: 12,
            border: `2px solid ${pinError ? '#ef4444' : '#e2e8f0'}`,
            fontSize: 28, textAlign: 'center', letterSpacing: 12, fontFamily: 'var(--font-body)',
            outline: 'none', marginBottom: 8, boxSizing: 'border-box',
          }}
        />
        {pinError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 8 }}>Incorrect PIN — try again</p>}
        <button
          disabled={pin.length !== 4}
          onClick={checkPin}
          style={{ width: '100%', padding: '13px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', borderRadius: 12, fontWeight: 800, fontSize: 15, marginBottom: 12 }}
        >
          Unlock
        </button>
        <button onClick={onBack} style={{ background: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 700, padding: 0 }}>← Back</button>
      </div>
    </div>
  )

  const adjustDifficulty = async (profile, subjectId, delta) => {
    const key = `${profile.id}_${subjectId}`
    if (busySubj === key) return
    setBusySubj(key)
    const current = profile.difficulty_levels?.[subjectId] || profile.base_grade_num
    const next = Math.max(1, Math.min(12, current + delta))
    if (next === current) { setBusySubj(null); return }
    const newLevels = { ...(profile.difficulty_levels || {}), [subjectId]: next }
    const newLocked = { ...(profile.difficulty_locked || {}), [subjectId]: true }
    await onUpdateProfile({ ...profile, difficulty_levels: newLevels, difficulty_locked: newLocked })
    showNotif?.(`${SUBJECTS.find(s => s.id === subjectId)?.label}: Grade ${next}`, '⚙️', 1800)
    setBusySubj(null)
  }

  const toggleLock = async (profile, subjectId) => {
    const isLocked = !!(profile.difficulty_locked || {})[subjectId]
    const newLocked = { ...(profile.difficulty_locked || {}) }
    if (isLocked) delete newLocked[subjectId]
    else newLocked[subjectId] = true
    await onUpdateProfile({ ...profile, difficulty_locked: newLocked })
    showNotif?.(isLocked ? 'Auto-adjust on' : 'Locked by parent', isLocked ? '🔓' : '🔒', 1500)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={onBack} style={{ background: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 700, marginBottom: 16, padding: 0 }}>
          ← Home
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: 24, marginBottom: 8, textAlign: 'center' }}>
          📊 Parent Dashboard
        </h2>

        {/* Household code reminder */}
        {householdCode && (
          <div style={{
            textAlign: 'center', fontSize: 11, color: 'var(--text-muted)',
            marginBottom: 24, letterSpacing: 1.5, fontWeight: 700,
          }}>
            HOUSEHOLD: {householdCode}
          </div>
        )}

        {profiles.filter(p => p?.name).length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 40 }}>
            No profiles set up yet.
          </div>
        )}

        {profiles.filter(p => p?.name).map(profile => {
          const heroClass = HERO_CLASSES.find(h => h.id === profile.hero_class)
          const history = questHistory.filter(h => h.profile_id === profile.id)
          const avg = history.length
            ? Math.round(history.reduce((s, h) => s + h.score, 0) / history.length)
            : null

          const bySubject = {}
          history.forEach(h => {
            if (!bySubject[h.subject_id]) bySubject[h.subject_id] = []
            bySubject[h.subject_id].push(h.score)
          })

          const weakSubjects = Object.entries(bySubject)
            .filter(([id, scores]) =>
              ['math','english','science','history'].includes(id) &&
              scores.reduce((a, b) => a + b, 0) / scores.length < 65
            )
            .map(([id]) => SUBJECTS.find(s => s.id === id)?.label || id)

          return (
            <div key={profile.id} style={{
              background: '#fff', borderRadius: 20, padding: 24, marginBottom: 20,
              boxShadow: '0 8px 40px rgba(0,0,0,0.25)', color: '#1a1a2e',
            }} className="animate-fade">

              {/* Profile header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <span style={{ fontSize: 36 }}>{profile.avatar}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>{profile.name}</div>
                  <div style={{ color: '#64748b', fontSize: 13 }}>
                    {heroClass?.emoji} {heroClass?.label} · Grade {profile.grade} · Level {profile.level || 1}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                    Pronouns: {profile.pronouns || 'they/them'}
                  </div>
                </div>
                <div style={{
                  background: '#eef2ff', color: '#6366f1', borderRadius: 8,
                  padding: '4px 12px', fontWeight: 800, fontSize: 14,
                }}>
                  {profile.xp || 0} XP
                </div>
              </div>

              {/* Edit / delete row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <button
                  onClick={() => onEditProfile(profile)}
                  style={{
                    flex: 2, padding: '8px', background: '#eef2ff',
                    color: '#6366f1', borderRadius: 8, fontWeight: 800, fontSize: 12,
                  }}
                >
                  ✏️ Edit Hero
                </button>
                <button
                  onClick={() => setConfirmDelete(profile.id)}
                  style={{
                    flex: 1, padding: '8px', background: '#fef2f2',
                    color: '#dc2626', borderRadius: 8, fontWeight: 800, fontSize: 12,
                  }}
                >
                  🗑️ Delete
                </button>
              </div>

              {/* Delete confirmation */}
              {confirmDelete === profile.id && (
                <div style={{
                  background: '#fef2f2', border: '2px solid #fca5a5', borderRadius: 12,
                  padding: 14, marginBottom: 18,
                }}>
                  <div style={{ color: '#991b1b', fontWeight: 800, marginBottom: 6, fontSize: 14 }}>
                    Delete {profile.name}?
                  </div>
                  <div style={{ color: '#7f1d1d', fontSize: 12, marginBottom: 10, lineHeight: 1.4 }}>
                    All quest history and progress will be permanently deleted.
                    This can't be undone.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      style={{ flex: 1, padding: '8px', background: '#fff', color: '#475569', borderRadius: 8, fontWeight: 700, fontSize: 12, border: '1px solid #e2e8f0' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => { await onDeleteProfile(profile.id); setConfirmDelete(null); showNotif?.('Profile deleted', '🗑️', 2000) }}
                      style={{ flex: 1, padding: '8px', background: '#dc2626', color: '#fff', borderRadius: 8, fontWeight: 800, fontSize: 12 }}
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              )}

              {/* Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
                {[
                  { label: 'Quests',    value: history.length },
                  { label: 'Avg Score', value: avg !== null ? `${avg}%` : '—' },
                  { label: 'Badges',    value: (profile.badges || []).length },
                  { label: 'Streak 🔥', value: profile.streak || 0 },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 900 }}>{value}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Difficulty levels — now interactive */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', marginBottom: 8 }}>
                  Difficulty Per Subject
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUBJECTS.map(s => {
                    const lvl = profile.difficulty_levels?.[s.id] || profile.base_grade_num
                    const isLocked = !!(profile.difficulty_locked || {})[s.id]
                    const busy = busySubj === `${profile.id}_${s.id}`
                    return (
                      <div key={s.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: '#f8fafc', borderRadius: 10, padding: '8px 12px',
                      }}>
                        <span style={{ fontSize: 18 }}>{s.emoji}</span>
                        <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{s.label}</span>
                        <button
                          onClick={() => adjustDifficulty(profile, s.id, -1)}
                          disabled={busy || lvl <= 1}
                          style={diffBtnStyle}
                        >
                          −
                        </button>
                        <span style={{
                          background: `${s.color}22`, color: s.color,
                          borderRadius: 6, padding: '3px 10px', fontWeight: 800, fontSize: 12,
                          minWidth: 50, textAlign: 'center',
                        }}>
                          Gr {lvl}
                        </span>
                        <button
                          onClick={() => adjustDifficulty(profile, s.id, +1)}
                          disabled={busy || lvl >= 12}
                          style={diffBtnStyle}
                        >
                          +
                        </button>
                        <button
                          onClick={() => toggleLock(profile, s.id)}
                          title={isLocked ? 'Locked: app won\'t auto-adjust' : 'Auto-adjusting'}
                          style={{
                            background: isLocked ? '#fef3c7' : 'transparent',
                            border: 'none', fontSize: 14, cursor: 'pointer',
                            padding: 4, borderRadius: 6,
                          }}
                        >
                          {isLocked ? '🔒' : '🔓'}
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.4 }}>
                  Tip: 🔒 = locked at this grade. 🔓 = auto-adjusts based on quest scores.
                </div>
              </div>

              {/* Weak areas */}
              {weakSubjects.length > 0 && (
                <div style={{
                  background: '#fff7ed', borderRadius: 8, padding: '10px 14px',
                  color: '#92400e', fontSize: 13, marginBottom: 16,
                }}>
                  ⚠️ <strong>Needs Practice:</strong> {weakSubjects.join(', ')}
                </div>
              )}

              {/* Subject breakdown */}
              {Object.entries(bySubject).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', marginBottom: 8 }}>Performance by Subject</div>
                  {Object.entries(bySubject).filter(([subId]) => ['math','english','science','history'].includes(subId)).map(([subId, scores]) => {
                    const subInfo = SUBJECTS.find(s => s.id === subId)
                    const subAvg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                    const barColor = subAvg >= 80 ? '#10b981' : subAvg >= 60 ? '#f59e0b' : '#ef4444'
                    return (
                      <div key={subId} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 16, width: 24 }}>{subInfo?.emoji}</span>
                        <span style={{ flex: 1, fontSize: 13, color: '#334155' }}>{subInfo?.label}</span>
                        <div style={{ width: 80, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${subAvg}%`, background: barColor, borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: barColor, width: 36, textAlign: 'right' }}>{subAvg}%</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Recent quests */}
              {history.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', marginBottom: 8 }}>Recent Quests</div>
                  {history.filter(h => ['math','english','science','history'].includes(h.subject_id)).slice(0, 6).map((h, i) => {
                    const subInfo = SUBJECTS.find(s => s.id === h.subject_id)
                    const scoreColor = h.score >= 80 ? '#10b981' : h.score >= 60 ? '#f59e0b' : '#ef4444'
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13,
                      }}>
                        <span>{subInfo?.emoji} {subInfo?.label}</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>Gr {h.difficulty}</span>
                        <span style={{ fontWeight: 800, color: scoreColor }}>{h.score}%</span>
                        <span style={{ color: '#94a3b8', fontSize: 11 }}>
                          {new Date(h.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const diffBtnStyle = {
  width: 28, height: 28, borderRadius: 6, background: '#fff',
  border: '1px solid #cbd5e1', color: '#475569', fontWeight: 800,
  fontSize: 16, cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 0,
}
