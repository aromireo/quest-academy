import { useEffect, useRef, useState } from 'react'

// A floating notepad available on every quest. Defaults to draw mode.
// Persists drawing + typed text across question changes within a single quest
// (state lives here; mounting/unmounting is controlled by QuestScreen, which
// keeps it mounted for the whole quest and just toggles `open`).
//
// Touch-optimized for iPad and Surface (Pointer Events covers stylus + finger).

export default function Notepad({ open, onToggle, subjectColor = '#6366f1' }) {
  const [mode, setMode] = useState('draw') // 'draw' | 'type'
  const [text, setText] = useState('')
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef(null)
  // We persist the canvas image as an ImageBitmap so re-mounts (e.g. mode flip)
  // can restore the drawing.
  const savedImageRef = useRef(null)

  // Initialize canvas — runs whenever the canvas mounts (mode switches in & out)
  useEffect(() => {
    if (!open || mode !== 'draw') return
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr

    const ctx = canvas.getContext && canvas.getContext('2d')
    if (!ctx) return // canvas unsupported (rare; fail gracefully)
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2.5
    ctxRef.current = ctx

    // Restore previous drawing if any
    if (savedImageRef.current) {
      ctx.drawImage(savedImageRef.current, 0, 0, rect.width, rect.height)
    }
  }, [open, mode])

  // Save canvas content when leaving draw mode or closing notepad
  const persistCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas || !canvas.toDataURL) return
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const img = new Image()
      img.onload = () => { savedImageRef.current = img }
      img.src = dataUrl
    } catch {
      // toDataURL can throw on tainted canvases or sandboxed envs — ignore
    }
  }

  const getPoint = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left
    const y = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top
    return { x, y }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const ctx = ctxRef.current
    if (!ctx) return
    const p = getPoint(e)
    if (!p) return
    drawingRef.current = true
    lastPointRef.current = p
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    // Draw a tiny dot so single taps register
    ctx.lineTo(p.x + 0.1, p.y + 0.1)
    ctx.stroke()
  }

  const moveDraw = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const ctx = ctxRef.current
    if (!ctx) return
    const p = getPoint(e)
    if (!p) return
    ctx.beginPath()
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPointRef.current = p
  }

  const endDraw = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    persistCanvas()
  }

  const clearAll = () => {
    if (mode === 'draw') {
      const canvas = canvasRef.current
      const ctx = ctxRef.current
      if (canvas && ctx) {
        const rect = canvas.getBoundingClientRect()
        ctx.clearRect(0, 0, rect.width, rect.height)
        savedImageRef.current = null
      }
    } else {
      setText('')
    }
  }

  const switchMode = (next) => {
    if (mode === 'draw') persistCanvas()
    setMode(next)
  }

  // Floating launcher button (always rendered)
  if (!open) {
    return (
      <button
        onClick={onToggle}
        aria-label="Open notepad"
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 80,
          width: 56, height: 56, borderRadius: 28,
          background: `linear-gradient(135deg, ${subjectColor}, ${subjectColor}cc)`,
          color: '#fff', fontSize: 24, fontWeight: 800,
          boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', cursor: 'pointer',
        }}
      >
        📝
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', right: 12, bottom: 12, zIndex: 90,
      width: 'min(92vw, 380px)', height: 'min(70vh, 480px)',
      background: '#fff', borderRadius: 16,
      boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column',
      borderTop: `4px solid ${subjectColor}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', borderBottom: '1px solid #e2e8f0',
        background: '#f8fafc',
      }}>
        <div style={{ display: 'flex', gap: 4, background: '#e2e8f0', borderRadius: 8, padding: 2 }}>
          <button
            onClick={() => switchMode('draw')}
            style={modeBtn(mode === 'draw', subjectColor)}
          >
            ✏️ Draw
          </button>
          <button
            onClick={() => switchMode('type')}
            style={modeBtn(mode === 'type', subjectColor)}
          >
            ⌨️ Type
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={clearAll}
            style={{
              padding: '6px 10px', fontSize: 12, fontWeight: 700,
              background: '#fef2f2', color: '#b91c1c', borderRadius: 6,
              border: '1px solid #fecaca', cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => { persistCanvas(); onToggle() }}
            aria-label="Close notepad"
            style={{
              padding: '6px 10px', fontSize: 14, fontWeight: 800,
              background: '#1e293b', color: '#fff', borderRadius: 6,
              border: 'none', cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: 'relative', background: '#fafaf6' }}>
        {mode === 'draw' ? (
          <canvas
            ref={canvasRef}
            onPointerDown={startDraw}
            onPointerMove={moveDraw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            onPointerCancel={endDraw}
            style={{
              width: '100%', height: '100%', display: 'block',
              touchAction: 'none', cursor: 'crosshair',
              // Faint grid for math working
              backgroundImage: 'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
        ) : (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type your scratch work…"
            style={{
              width: '100%', height: '100%', padding: 12,
              border: 'none', outline: 'none', resize: 'none',
              fontSize: 15, lineHeight: 1.5, fontFamily: 'var(--font-body)',
              background: '#fafaf6', color: '#1e293b',
              boxSizing: 'border-box',
            }}
          />
        )}
      </div>
    </div>
  )
}

function modeBtn(active, color) {
  return {
    padding: '6px 12px', fontSize: 12, fontWeight: 700,
    background: active ? '#fff' : 'transparent',
    color: active ? color : '#64748b',
    borderRadius: 6, border: 'none', cursor: 'pointer',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
  }
}
