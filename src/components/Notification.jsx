// ── Notification toast ────────────────────────────────────────────────────────
export default function Notification({ msg, emoji }) {
  return (
    <div style={{
      position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
      background: '#fff', color: '#1a1a2e', borderRadius: 50,
      padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8,
      fontWeight: 800, fontSize: 15, zIndex: 9999, whiteSpace: 'nowrap',
      boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
      animation: 'popIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <span style={{ fontSize: 22 }}>{emoji}</span> {msg}
    </div>
  )
}
