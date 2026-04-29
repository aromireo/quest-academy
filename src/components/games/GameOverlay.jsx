export default function GameOverlay({ title, emoji, score, onClose, children }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 16,
    }}>
      <div style={{
        background: '#fff', borderRadius: 24, padding: '28px 24px',
        maxWidth: 440, width: '100%', color: '#1a1a2e',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }} className="animate-pop">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ fontSize: 28 }}>{emoji}</span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, flex: 1 }}>{title}</h2>
          {score !== null && score !== undefined && (
            <span style={{ fontWeight: 800, color: '#6366f1', fontSize: 15 }}>Score: {score}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
