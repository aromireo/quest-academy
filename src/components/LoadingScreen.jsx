export default function LoadingScreen({ message = 'Loading…' }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 20,
      background: 'var(--bg-deep)',
    }}>
      <div style={{ fontSize: 64, animation: 'pulse 1.5s ease-in-out infinite' }}>⚔️</div>
      <p style={{ color: 'var(--text-muted)', fontSize: 18, fontFamily: 'var(--font-body)', fontWeight: 700 }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  )
}
