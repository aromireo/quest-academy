import { SUBJECTS } from '../lib/constants.js'
import XPBar from '../components/XPBar.jsx'

export default function ResultScreen({ results, subject, quest, profile, onBack }) {
  const { score, correct, total } = results
  const trophy = score >= 85 ? '🏆' : score >= 65 ? '⭐' : '🌱'
  const message = score >= 85 ? 'Quest Complete!' : score >= 65 ? 'Well Done!' : 'Keep Going!'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 16px' }}>
      <div style={{
        background: '#fff', borderRadius: 28, padding: '36px 28px',
        maxWidth: 480, width: '100%', textAlign: 'center',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)', color: '#1a1a2e',
      }} className="animate-pop">

        <div style={{ fontSize: 72, marginBottom: 4 }}>{trophy}</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, marginBottom: 6 }}>{message}</h2>

        <div style={{
          fontSize: 64, fontWeight: 900, color: subject?.color || '#6366f1',
          lineHeight: 1, marginBottom: 4,
        }}>
          {score}%
        </div>
        <div style={{ color: '#64748b', marginBottom: 20 }}>{correct} / {total} correct</div>

        {quest?.victoryMessage && (
          <div style={{
            background: '#f8fafc', borderRadius: 12, padding: 16,
            fontSize: 14, color: '#334155', fontStyle: 'italic',
            borderLeft: `4px solid ${subject?.color}`, textAlign: 'left', marginBottom: 24,
          }}>
            {quest.victoryMessage}
          </div>
        )}

        {/* XP display */}
        {profile && (
          <div style={{
            background: '#f8fafc', borderRadius: 12, padding: '12px 16px',
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, fontWeight: 700 }}>
              Level {profile.level || 1}
            </div>
            <XPBar xp={profile.xp || 0} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onBack}
            style={{
              padding: '14px', background: `linear-gradient(135deg, ${subject?.color || '#6366f1'}, ${subject?.color || '#8b5cf6'}cc)`,
              color: '#fff', borderRadius: 12, fontWeight: 800, fontSize: 15,
            }}
          >
            ⚔️ More Quests
          </button>
        </div>
      </div>
    </div>
  )
}
