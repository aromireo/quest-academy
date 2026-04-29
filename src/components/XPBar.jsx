import { getLevel, getXPProgress, xpToNextLevel, XP_PER_LEVEL } from '../lib/constants.js'

export default function XPBar({ xp, showLabel = true }) {
  const progress = getXPProgress(xp)
  const level    = getLevel(xp)
  const toNext   = xpToNextLevel(xp)

  return (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 800 }}>Level {level}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{toNext} XP to next</span>
        </div>
      )}
      <div style={{
        height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${progress}%`,
          background: 'linear-gradient(90deg, var(--accent), var(--gold))',
          borderRadius: 4, transition: 'width 0.8s cubic-bezier(0.34,1.2,0.64,1)',
        }} />
      </div>
    </div>
  )
}
