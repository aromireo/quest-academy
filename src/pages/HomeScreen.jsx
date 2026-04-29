import { HERO_CLASSES } from '../lib/constants.js'
import XPBar from '../components/XPBar.jsx'

export default function HomeScreen({
  profiles, householdCode,
  onSelectProfile, onSetupProfile, onParentDash, onHouseholdSetup,
}) {
  const slots = [
    { slot: 0, grade: '6th', label: 'Kid 1' },
    { slot: 1, grade: '3rd', label: 'Kid 2' },
  ]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }} className="animate-fade">
        <div style={{ fontSize: 56, marginBottom: 8 }}>⚔️</div>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 7vw, 48px)',
          color: 'var(--gold)', letterSpacing: '0.04em', lineHeight: 1.1,
          textShadow: '0 0 40px rgba(245,200,66,0.4)',
        }}>Quest Academy</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 15, fontStyle: 'italic' }}>
          Where Learning Becomes Legend
        </p>
      </div>

      {/* Profile cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: '100%', maxWidth: 480, marginBottom: 24 }}>
        {slots.map(({ slot, grade, label }, i) => {
          const profile = profiles.find(p => p.slot === slot)
          const isSetup = !profile?.name
          const heroClass = HERO_CLASSES.find(h => h.id === profile?.hero_class)

          return (
            <div
              key={slot}
              className={`animate-fade delay-${i + 1}`}
              onClick={() => isSetup ? onSetupProfile(slot) : onSelectProfile(profile)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 20, padding: '24px 16px', textAlign: 'center',
                cursor: 'pointer', transition: 'transform 0.2s, border-color 0.2s',
                position: 'relative', overflow: 'hidden',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <div style={{
                position: 'absolute', top: 10, right: 10, fontSize: 10,
                background: 'rgba(124,106,247,0.2)', color: 'var(--accent2)',
                borderRadius: 20, padding: '2px 8px', fontWeight: 800, letterSpacing: 0.5,
              }}>
                {grade}
              </div>

              <div style={{ fontSize: 48, marginBottom: 10 }}>{isSetup ? '👤' : profile.avatar}</div>

              {isSetup ? (
                <>
                  <div style={{ fontWeight: 800, color: 'var(--text-muted)', marginBottom: 12 }}>{label}</div>
                  <div style={{
                    background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                    color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 800,
                  }}>
                    ✨ Set Up Hero
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 900, fontSize: 17, color: 'var(--text)', marginBottom: 2 }}>{profile.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                    {heroClass?.emoji} {heroClass?.label}
                  </div>
                  <XPBar xp={profile.xp || 0} />
                  <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 800, marginTop: 6 }}>
                    {profile.xp || 0} XP
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Household code mini-pill — visible reminder of cross-device code */}
      {householdCode && (
        <div
          onClick={onHouseholdSetup}
          className="animate-fade delay-3"
          style={{
            background: 'var(--bg-glass)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', borderRadius: 20, padding: '6px 14px',
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            marginBottom: 16, cursor: 'pointer',
          }}
        >
          🔗 {householdCode} · Tap to sync devices
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          className="animate-fade delay-3"
          onClick={onParentDash}
          style={{
            background: 'var(--bg-glass)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', borderRadius: 12, padding: '10px 24px',
            fontSize: 14, fontWeight: 700,
          }}
        >
          📊 Parent Dashboard
        </button>
      </div>
    </div>
  )
}
