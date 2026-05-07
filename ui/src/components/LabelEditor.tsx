import { useRef, useState, useEffect, useCallback } from 'react'
import { AnnotationBox, ImageSample, sessionsApi } from '../api/client'
import { HudBox, hudColor } from './HudOverlay'

interface EditableBox extends AnnotationBox {
  _id: string
}

interface Props {
  sample: ImageSample
  classNames: string[]
  sessionId: string
  onClose: () => void
  onSaved: () => void
}

type Mode = 'select' | 'draw'

export function LabelEditor({ sample, classNames, sessionId, onClose, onSaved }: Props) {
  const [boxes, setBoxes]           = useState<EditableBox[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode]             = useState<Mode>('select')
  const [activeClass, setActiveClass] = useState(0)
  const [drawing, setDrawing]       = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [imgDims, setImgDims]       = useState({ w: 0, h: 0 })
  const [saving, setSaving]         = useState(false)
  const [saveOk, setSaveOk]         = useState(false)
  const [hasEdits, setHasEdits]     = useState(false)

  const imgRef = useRef<HTMLImageElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const imgUrl = `/filesystem/image?path=${encodeURIComponent(sample.image_path)}`

  // Initialise boxes from sample
  useEffect(() => {
    setBoxes(sample.annotations.map((a, i) => ({ ...a, _id: `orig_${i}` })))
    setHasEdits(false)
  }, [sample])

  // Keyboard shortcuts
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        setBoxes(prev => prev.filter(b => b._id !== selectedId))
        setSelectedId(null)
        setHasEdits(true)
      }
      if (e.key === 'Escape') { setDrawing(null); setMode('select') }
      if (e.key === 'd') setMode('draw')
      if (e.key === 's') setMode('select')
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [selectedId])

  const handleImgLoad = () => {
    if (imgRef.current) {
      setImgDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
    }
  }

  const svgCoords = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top)  / r.height)),
    }
  }, [])

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'draw') return
    const { x, y } = svgCoords(e)
    setDrawing({ x0: x, y0: y, x1: x, y1: y })
    e.preventDefault()
  }

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawing) return
    const { x, y } = svgCoords(e)
    setDrawing(d => d ? { ...d, x1: x, y1: y } : null)
  }

  const onMouseUp = () => {
    if (!drawing) return
    const w = Math.abs(drawing.x1 - drawing.x0)
    const h = Math.abs(drawing.y1 - drawing.y0)
    if (w > 0.015 && h > 0.015) {
      const nb: EditableBox = {
        _id: `new_${Date.now()}`,
        class_id:   activeClass,
        class_name: classNames[activeClass] ?? `class_${activeClass}`,
        cx: Math.min(drawing.x0, drawing.x1) + w / 2,
        cy: Math.min(drawing.y0, drawing.y1) + h / 2,
        w, h,
      }
      setBoxes(prev => [...prev, nb])
      setSelectedId(nb._id)
      setHasEdits(true)
    }
    setDrawing(null)
    setMode('select')
  }

  // Change class of selected box
  const changeSelectedClass = (cls: number) => {
    setActiveClass(cls)
    if (!selectedId) return
    setBoxes(prev => prev.map(b =>
      b._id === selectedId
        ? { ...b, class_id: cls, class_name: classNames[cls] ?? `class_${cls}` }
        : b
    ))
    setHasEdits(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: AnnotationBox[] = boxes.map(({ _id, ...rest }) => rest)
      await sessionsApi.saveAnnotations(sessionId, sample.image_path, payload)
      setSaveOk(true)
      setHasEdits(false)
      setTimeout(() => { setSaveOk(false); onSaved() }, 700)
    } catch (err: any) {
      alert(err.response?.data?.detail ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRevert = async () => {
    try {
      await sessionsApi.clearAnnotations(sessionId, sample.image_path)
      setBoxes(sample.annotations.map((a, i) => ({ ...a, _id: `orig_${i}` })))
      setSelectedId(null)
      setHasEdits(false)
    } catch (err: any) {
      alert(err.response?.data?.detail ?? err.message)
    }
  }

  const selectedBox = boxes.find(b => b._id === selectedId)

  // Drawing preview rect in pixel space
  const drawPx = drawing ? {
    x:  Math.min(drawing.x0, drawing.x1) * imgDims.w,
    y:  Math.min(drawing.y0, drawing.y1) * imgDims.h,
    w:  Math.abs(drawing.x1 - drawing.x0) * imgDims.w,
    h:  Math.abs(drawing.y1 - drawing.y0) * imgDims.h,
  } : null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: '#000',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        height: 52, display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)', flexShrink: 0,
      }}>
        {/* Mode */}
        <button className={`btn ${mode === 'select' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMode('select')}
                style={{ fontSize: 12, height: 30 }}>
          ↖ Select <span style={{ opacity: 0.5, marginLeft: 4 }}>S</span>
        </button>
        <button className={`btn ${mode === 'draw' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setMode('draw')}
                style={{ fontSize: 12, height: 30 }}>
          ✚ Draw <span style={{ opacity: 0.5, marginLeft: 4 }}>D</span>
        </button>

        <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />

        {/* Class selector */}
        <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Class</span>
        <select
          value={activeClass}
          onChange={e => changeSelectedClass(Number(e.target.value))}
          style={{
            fontFamily: 'var(--mono)', fontSize: 12, height: 30,
            background: 'var(--surface2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0 8px',
          }}
        >
          {classNames.map((name, i) => (
            <option key={i} value={i}>{name}</option>
          ))}
        </select>

        {/* Color swatch for active class */}
        <span style={{
          width: 10, height: 10, borderRadius: 2,
          background: hudColor(activeClass), flexShrink: 0,
        }} />

        {selectedId && (
          <>
            <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
            <button
              className="btn btn-ghost"
              onClick={() => { setBoxes(prev => prev.filter(b => b._id !== selectedId)); setSelectedId(null); setHasEdits(true) }}
              style={{ fontSize: 12, height: 30, color: 'var(--red)' }}
            >
              ✕ Delete <span style={{ opacity: 0.5, marginLeft: 4 }}>Del</span>
            </button>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasEdits && (
            <button className="btn btn-ghost" onClick={handleRevert}
                    style={{ fontSize: 11, height: 28, color: 'var(--text-muted)' }}>
              Revert
            </button>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {boxes.length} ann
          </span>
          <button
            className={`btn ${saveOk ? 'btn-ghost' : 'btn-primary'}`}
            onClick={handleSave}
            disabled={saving || saveOk || !hasEdits}
            style={{ fontSize: 12, height: 30, color: saveOk ? 'var(--green)' : undefined }}
          >
            {saveOk ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} style={{ fontSize: 12, height: 30 }}>
            Close
          </button>
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, overflow: 'hidden',
      }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            ref={imgRef}
            src={imgUrl}
            alt=""
            onLoad={handleImgLoad}
            draggable={false}
            style={{
              display: 'block',
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: 'calc(100vh - 110px)',
              userSelect: 'none',
            }}
          />

          {imgDims.w > 0 && (
            <svg
              ref={svgRef}
              style={{
                position: 'absolute', top: 0, left: 0,
                width: imgDims.w, height: imgDims.h,
                overflow: 'visible',
                cursor: mode === 'draw' ? 'crosshair' : 'default',
              }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onClick={mode === 'select' ? () => setSelectedId(null) : undefined}
            >
              {/* HUD boxes */}
              {boxes.map((box, idx) => {
                const { _id, ...ann } = box
                return (
                  <HudBox
                    key={_id}
                    ann={ann}
                    imgW={imgDims.w}
                    imgH={imgDims.h}
                    trackId={idx}
                    selected={selectedId === _id}
                    dimmed={mode === 'draw'}
                    interactive={mode === 'select'}
                    onClick={mode === 'select' ? e => { e.stopPropagation(); setSelectedId(prev => prev === _id ? null : _id); setActiveClass(ann.class_id) } : undefined}
                  />
                )
              })}

              {/* Drawing preview */}
              {drawPx && (() => {
                const c = hudColor(activeClass)
                return (
                  <g>
                    <rect x={drawPx.x} y={drawPx.y} width={drawPx.w} height={drawPx.h}
                          fill={`${c}10`} stroke={c} strokeWidth={1.5} strokeDasharray="6 3" />
                    {/* Center guides */}
                    <line x1={drawPx.x} y1={drawPx.y + drawPx.h/2}
                          x2={drawPx.x + drawPx.w} y2={drawPx.y + drawPx.h/2}
                          stroke={c} strokeWidth={0.5} opacity={0.4} />
                    <line x1={drawPx.x + drawPx.w/2} y1={drawPx.y}
                          x2={drawPx.x + drawPx.w/2} y2={drawPx.y + drawPx.h}
                          stroke={c} strokeWidth={0.5} opacity={0.4} />
                  </g>
                )
              })()}
            </svg>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div style={{
        height: 28, display: 'flex', alignItems: 'center', gap: 20,
        padding: '0 16px', borderTop: '1px solid var(--border)',
        background: 'var(--bg)', flexShrink: 0,
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)',
      }}>
        <span>{sample.source_name}</span>
        <span>{sample.image_path.split('/').pop()}</span>
        {selectedBox && (
          <span style={{ color: 'var(--text-dim)' }}>
            {selectedBox.class_name} · cx={selectedBox.cx.toFixed(3)} cy={selectedBox.cy.toFixed(3)} w={selectedBox.w.toFixed(3)} h={selectedBox.h.toFixed(3)}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {mode === 'draw' ? 'DRAW — click & drag to create box' : 'SELECT — click box to select · Del to delete'}
        </span>
      </div>
    </div>
  )
}
