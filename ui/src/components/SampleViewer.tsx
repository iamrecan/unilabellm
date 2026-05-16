import { useEffect, useRef, useState, useCallback, type WheelEvent as RWheelEvent } from 'react'
import { sessionsApi, validationApi, ImageSample, ImageValidationResult, DetectedBox } from '../api/client'
import { HudBox, hudColor, BoxStyle } from './HudOverlay'
import { LabelEditor } from './LabelEditor'

interface Props {
  sessionId: string
  classNames: string[]
}

type FilterMode = 'all' | 'suspicious'

export function SampleViewer({ sessionId, classNames }: Props) {
  const [open, setOpen]         = useState(false)
  const [samples, setSamples]   = useState<ImageSample[]>([])
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<ImageSample | null>(null)
  const [editing, setEditing]   = useState<ImageSample | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  // ── CLIP validation state ──────────────────────────────────────────────────
  const [clipRunning, setClipRunning]     = useState(false)
  const [clipPhase, setClipPhase]         = useState('')
  const [clipProgress, setClipProgress]   = useState(0)
  const [validationMap, setValidationMap] = useState<Map<string, ImageValidationResult>>(new Map())
  const [threshold, setThreshold]         = useState(0.25)
  const [filter, setFilter]               = useState<FilterMode>('all')
  const [clipDone, setClipDone]           = useState(false)
  const [clipError, setClipError]         = useState<string | null>(null)
  const [showClip, setShowClip]           = useState(true)
  const [backend, setBackend]             = useState<'owl-vit' | 'siglip' | 'clip'>('owl-vit')
  const [boxStyle, setBoxStyle]           = useState<BoxStyle>('corners')

  // ── Per-image lightbox state ───────────────────────────────────────────────
  const [imgValidating, setImgValidating] = useState(false)
  const [imgDetecting, setImgDetecting]   = useState(false)
  const [allDetectedBoxes, setAllDetectedBoxes] = useState<DetectedBox[]>([])   // raw from model
  const [detectThreshold, setDetectThreshold]   = useState(0.10)               // client-side filter
  const [dismissedIdxs, setDismissedIdxs]       = useState<Set<number>>(new Set())

  // client-side filtered suggestions (by threshold + not dismissed)
  const suggestedBoxes = allDetectedBoxes.filter(b => b.confidence >= detectThreshold)

  // ── Cross-panel hover highlight ───────────────────────────────────────────
  const [hoveredBox, setHoveredBox] = useState<number | null>(null)

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  const [zoom, setZoom]     = useState(1)
  const [pan, setPan]       = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const zoomContainerRef = useRef<HTMLDivElement>(null)

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }) }

  // Attach non-passive wheel listener so we can preventDefault
  useEffect(() => {
    const el = zoomContainerRef.current
    if (!el) return
    const onWheel = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom(z => {
        const nz = Math.max(1, Math.min(12, z * factor))
        if (nz === 1) { setPan({ x: 0, y: 0 }); return 1 }
        setPan(p => ({
          x: cx - (nz / z) * (cx - p.x),
          y: cy - (nz / z) * (cy - p.y),
        }))
        return nz
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [selected])   // re-bind when lightbox opens/closes

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    setPan({
      x: dragStart.current.px + e.clientX - dragStart.current.mx,
      y: dragStart.current.py + e.clientY - dragStart.current.my,
    })
  }
  const onMouseUp = () => setDragging(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Suspicious set — recomputed when threshold changes (client-side)
  const suspiciousFiltered = new Set(
    [...validationMap.values()]
      .filter(r => {
        const assignedScore = r.scores.find(s => r.assigned_labels.includes(s.class_name))
        return assignedScore ? assignedScore.confidence < threshold : r.is_suspicious
      })
      .map(r => r.image_path)
  )

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }
  useEffect(() => () => stopPolling(), [])

  const runClip = useCallback(async () => {
    setClipRunning(true)
    setClipError(null)
    setClipDone(false)
    setClipProgress(0)
    setClipPhase('Loading CLIP model…')
    try {
      await validationApi.start(sessionId, backend, threshold, 100)
      pollRef.current = setInterval(async () => {
        try {
          const s = await validationApi.status(sessionId)
          if (s.total > 0) setClipProgress(Math.round(s.done / s.total * 100))
          setClipPhase(s.phase || 'Scoring…')
          if (s.status === 'done') {
            stopPolling()
            setValidationMap(new Map(s.results.map(r => [r.image_path, r])))
            setClipRunning(false)
            setClipDone(true)
          } else if (s.status === 'failed') {
            stopPolling()
            setClipRunning(false)
            setClipError(s.error || 'Validation failed')
          }
        } catch {}
      }, 1500)
    } catch (e: any) {
      setClipRunning(false)
      setClipError(e.response?.data?.detail ?? e.message)
    }
  }, [sessionId, threshold])

  const load = async () => {
    setLoading(true)
    try { setSamples(await sessionsApi.samples(sessionId, 12)) }
    finally { setLoading(false) }
  }

  const handleOpen = () => { setOpen(true); if (!samples.length) load() }
  const handleEditorSaved = () => { setEditing(null); load() }

  const hasResults = validationMap.size > 0
  const suspiciousCount = suspiciousFiltered.size
  const displayedSamples = filter === 'suspicious'
    ? samples.filter(s => suspiciousFiltered.has(s.image_path))
    : samples

  // Reset per-image state when switching images
  const openLightbox = (s: typeof selected, idx = 0) => {
    setSelected(s)
    setSelectedIdx(idx)
    setAllDetectedBoxes([])
    setDismissedIdxs(new Set())
    setHoveredBox(null)
    resetZoom()
  }

  const navigateLightbox = (delta: number) => {
    if (!selected) return
    const next = displayedSamples[(selectedIdx + delta + displayedSamples.length) % displayedSamples.length]
    if (next) openLightbox(next, (selectedIdx + delta + displayedSamples.length) % displayedSamples.length)
  }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      // Don't steal from inputs/textareas
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Escape') { setSelected(null); if (!editing) setOpen(false) }
      if (!selected) return
      if (e.key === 'ArrowRight') { e.preventDefault(); navigateLightbox(1) }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateLightbox(-1) }
      if (e.key === 'e' || e.key === 'E') { setEditing(selected); setSelected(null) }
      if (e.key === 'v' || e.key === 'V') { handleValidateImage() }
      if (e.key === 'd' || e.key === 'D') { handleDetectBoxes() }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [editing, selected, selectedIdx, displayedSamples])

  const handleValidateImage = async () => {
    if (!selected) return
    setImgValidating(true)
    try {
      const result = await validationApi.validateImage(sessionId, selected.image_path, backend)
      setValidationMap(prev => new Map(prev).set(selected.image_path, result))
      setShowClip(true)
    } catch (e: any) {
      alert(e.response?.data?.detail ?? e.message)
    } finally { setImgValidating(false) }
  }

  const handleDetectBoxes = async () => {
    if (!selected) return
    setImgDetecting(true)
    setAllDetectedBoxes([])
    setDismissedIdxs(new Set())
    try {
      // Run with a low base threshold — client slider does the filtering
      const boxes = await validationApi.detectBoxes(sessionId, selected.image_path, backend, 0.01)
      setAllDetectedBoxes(boxes)
    } catch (e: any) {
      alert(e.response?.data?.detail ?? e.message)
    } finally { setImgDetecting(false) }
  }

  const acceptSuggestion = async (allIdx: number) => {
    if (!selected) return
    const box = allDetectedBoxes[allIdx]
    const newAnnotations = [
      ...selected.annotations,
      { class_name: box.class_name, class_id: box.class_id, cx: box.cx, cy: box.cy, w: box.w, h: box.h },
    ]
    try {
      await sessionsApi.saveAnnotations(sessionId, selected.image_path, newAnnotations)
      setSelected({ ...selected, annotations: newAnnotations })
      setDismissedIdxs(prev => new Set([...prev, allIdx]))
    } catch (e: any) { alert(e.message) }
  }

  const dismissSuggestion = (allIdx: number) =>
    setDismissedIdxs(prev => new Set([...prev, allIdx]))

  return (
    <>
      {/* ── Trigger button ── */}
      <button className="btn btn-ghost" onClick={handleOpen}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
        Preview Labels
        {hasResults && suspiciousCount > 0 && (
          <span style={{
            marginLeft: 8, fontSize: 11, padding: '1px 7px', borderRadius: 10,
            background: 'rgba(238,0,0,0.15)', color: 'var(--red)',
            border: '1px solid rgba(238,0,0,0.3)', fontWeight: 700,
          }}>
            {suspiciousCount} ⚠
          </span>
        )}
      </button>

      {/* ── Modal ── */}
      {open && (
        <div onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
             style={{
               position: 'fixed', inset: 0, zIndex: 200,
               background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
               display: 'flex', flexDirection: 'column', overflow: 'hidden',
             }}>

          {/* Header */}
          <div style={{
            height: 56, flexShrink: 0, display: 'flex', alignItems: 'center',
            padding: '0 20px', gap: 10,
            borderBottom: '1px solid var(--border)', background: 'var(--bg)',
          }}>
            <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Label Preview</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Threshold slider — visible only after results */}
              {hasResults && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>threshold</span>
                  <input
                    type="range" min={0.10} max={0.50} step={0.01}
                    value={threshold}
                    onChange={e => setThreshold(parseFloat(e.target.value))}
                    style={{ width: 80, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--accent)', width: 30 }}>
                    {threshold.toFixed(2)}
                  </span>
                </div>
              )}

              {/* All / Suspicious toggle */}
              {hasResults && (
                <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  {(['all', 'suspicious'] as FilterMode[]).map(m => (
                    <button key={m} onClick={() => setFilter(m)} style={{
                      padding: '4px 10px', fontSize: 11, height: 28, borderRadius: 0,
                      background: filter === m ? 'var(--accent)' : 'transparent',
                      color: filter === m ? '#fff' : 'var(--text-dim)',
                      borderRight: m === 'all' ? '1px solid var(--border)' : 'none',
                    }}>
                      {m === 'all' ? 'All' : `⚠ ${suspiciousCount}`}
                    </button>
                  ))}
                </div>
              )}

              {/* Backend selector */}
              {!clipRunning && (
                <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  {(['owl-vit', 'siglip', 'clip'] as const).map((b, i, arr) => (
                    <button key={b} onClick={() => setBackend(b)} style={{
                      padding: '0 10px', fontSize: 11, height: 28, borderRadius: 0,
                      background: backend === b ? 'var(--surface2)' : 'transparent',
                      color: backend === b ? 'var(--text)' : b === 'clip' ? 'var(--text-muted)' : 'var(--text-dim)',
                      borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                      fontFamily: 'var(--mono)',
                      opacity: b === 'clip' ? 0.6 : 1,
                    }}>
                      {b === 'clip' ? 'clip (legacy)' : b}
                    </button>
                  ))}
                </div>
              )}

              {/* Validate button */}
              <button
                className="btn btn-ghost"
                onClick={runClip}
                disabled={clipRunning}
                style={{
                  fontSize: 12, height: 30, padding: '0 12px',
                  color: hasResults ? 'var(--accent)' : undefined,
                  borderColor: hasResults ? 'rgba(var(--accent-rgb),0.4)' : undefined,
                  opacity: clipRunning ? 0.6 : 1,
                }}
              >
                {clipRunning ? `✦ ${clipProgress}%` : hasResults ? '↻ Re-validate' : '✦ Validate'}
              </button>

              <button className="btn btn-ghost" onClick={load} disabled={loading}
                      style={{ fontSize: 12, height: 30 }}>
                {loading ? '…' : 'Resample'}
              </button>

              <button onClick={() => setOpen(false)}
                      style={{ background: 'none', color: 'var(--text-dim)', fontSize: 22, padding: '0 4px', height: 'auto', lineHeight: 1 }}>
                ×
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {clipRunning && (
            <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ height: 3, background: 'var(--surface2)' }}>
                <div style={{ height: '100%', background: 'var(--accent)', width: `${clipProgress}%`, transition: 'width 0.4s ease' }} />
              </div>
              <div style={{ padding: '4px 20px', fontSize: 11, color: 'var(--text-dim)' }}>
                {clipPhase}{clipProgress > 0 ? ` — ${clipProgress}%` : ''}
              </div>
            </div>
          )}

          {/* Summary strip */}
          {clipDone && !clipRunning && (
            <div style={{
              flexShrink: 0, padding: '5px 20px',
              borderBottom: '1px solid var(--border)',
              background: suspiciousCount > 0 ? 'rgba(238,0,0,0.06)' : 'rgba(0,200,100,0.06)',
              display: 'flex', alignItems: 'center', gap: 16, fontSize: 12,
            }}>
              <span style={{ fontWeight: 600, color: suspiciousCount > 0 ? 'var(--red)' : 'var(--green)' }}>
                {suspiciousCount > 0 ? `⚠ ${suspiciousCount} suspicious` : '✓ All labels look good'}
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {validationMap.size} images scored · drag slider to refilter
              </span>
            </div>
          )}

          {/* Error strip */}
          {clipError && (
            <div style={{
              flexShrink: 0, padding: '7px 20px', fontSize: 12,
              background: 'rgba(238,0,0,0.08)', color: 'var(--red)',
              borderBottom: '1px solid rgba(238,0,0,0.2)',
            }}>
              ✗ {clipError}
            </div>
          )}

          {/* Legend */}
          <div style={{
            flexShrink: 0, display: 'flex', gap: 12, padding: '7px 20px',
            borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
            background: 'var(--surface)', fontSize: 12,
          }}>
            {classNames.map((name, id) => (
              <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: hudColor(id), flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{name}</span>
              </span>
            ))}
          </div>

          {/* Grid */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {loading && !samples.length && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', paddingTop: 60 }}>Loading…</div>
            )}
            {!loading && displayedSamples.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', paddingTop: 60 }}>
                {filter === 'suspicious'
                  ? 'No suspicious images in this sample — try Resample.'
                  : 'No images found.'}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              {displayedSamples.map((s, i) => (
                <ImageCard
                  key={i}
                  sample={s}
                  validationResult={validationMap.get(s.image_path)}
                  isSuspicious={suspiciousFiltered.has(s.image_path)}
                  onClick={() => openLightbox(s, i)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#000', display: 'flex', flexDirection: 'column' }}
        >
          {/* Stop propagation on inner wrapper */}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

            {/* ── Top bar ── */}
            <div style={{
              flexShrink: 0, height: 48,
              display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(8,8,8,0.98)',
            }}>
              {/* Image navigation */}
              {displayedSamples.length > 1 && (
                <>
                  <button onClick={() => navigateLightbox(-1)} style={{
                    background: 'none', color: 'var(--text-dim)', fontSize: 18, padding: '0 6px',
                    height: 'auto', lineHeight: 1, flexShrink: 0,
                  }}>‹</button>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                    {selectedIdx + 1}/{displayedSamples.length}
                  </span>
                  <button onClick={() => navigateLightbox(1)} style={{
                    background: 'none', color: 'var(--text-dim)', fontSize: 18, padding: '0 6px',
                    height: 'auto', lineHeight: 1, flexShrink: 0,
                  }}>›</button>
                </>
              )}

              <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selected.source_name} · {selected.annotations.length} annotation{selected.annotations.length !== 1 ? 's' : ''}
              </span>

              {/* Validate this image */}
              <button
                onClick={handleValidateImage}
                disabled={imgValidating}
                title="Validate (V)"
                style={{
                  fontSize: 11, height: 28, padding: '0 10px', borderRadius: 6, flexShrink: 0,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: imgValidating ? 'var(--text-muted)' : 'var(--text-dim)',
                  cursor: imgValidating ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {imgValidating ? '…' : '✦'} Validate
              </button>

              {/* Detect boxes */}
              <button
                onClick={handleDetectBoxes}
                disabled={imgDetecting}
                title="Detect (D)"
                style={{
                  fontSize: 11, height: 28, padding: '0 10px', borderRadius: 6, flexShrink: 0,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: imgDetecting ? 'var(--text-muted)' : 'var(--text-dim)',
                  cursor: imgDetecting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {imgDetecting ? '…' : '◈'} Detect
              </button>

              {/* Toggle CLIP scores panel */}
              {validationMap.has(selected.image_path) && (
                <button
                  onClick={() => setShowClip(v => !v)}
                  style={{
                    fontSize: 11, height: 28, padding: '0 10px', borderRadius: 6, flexShrink: 0,
                    border: `1px solid ${showClip ? 'rgba(99,179,237,0.5)' : 'var(--border)'}`,
                    background: showClip ? 'rgba(99,179,237,0.12)' : 'transparent',
                    color: showClip ? '#63b3ed' : 'var(--text-dim)',
                    cursor: 'pointer', transition: 'all 0.15s',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span>▤</span> Scores
                </button>
              )}

              {/* Box style picker */}
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
                flexShrink: 0,
              }}>
                {(['corners', 'box', 'minimal', 'filled'] as BoxStyle[]).map((s, i) => {
                  const icons: Record<BoxStyle, string> = { corners: '⌐¬', box: '▭', minimal: '◻', filled: '◼' }
                  const tips:  Record<BoxStyle, string> = { corners: 'Corners (HUD)', box: 'Full box', minimal: 'Minimal', filled: 'Filled' }
                  const active = boxStyle === s
                  return (
                    <button key={s} onClick={() => setBoxStyle(s)} title={tips[s]}
                      style={{
                        height: 28, padding: '0 9px', fontSize: 12, border: 'none',
                        borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                        background: active ? 'rgba(99,179,237,0.18)' : 'transparent',
                        color: active ? '#63b3ed' : 'var(--text-muted)',
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >
                      {icons[s]}
                    </button>
                  )
                })}
              </div>

              <button className="btn btn-ghost"
                      onClick={() => { setEditing(selected); setSelected(null) }}
                      title="Edit (E)"
                      style={{ fontSize: 12, height: 28, padding: '0 10px', flexShrink: 0 }}>
                ✎ Edit Labels
              </button>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', color: 'var(--text-dim)', fontSize: 24, padding: '0 4px', height: 'auto', lineHeight: 1, flexShrink: 0 }}
              >×</button>
            </div>

            {/* ── Suspicion banner ── */}
            {suspiciousFiltered.has(selected.image_path) && (
              <div style={{
                flexShrink: 0, padding: '7px 14px', fontSize: 12, color: 'var(--red)',
                background: 'rgba(238,0,0,0.1)', borderBottom: '1px solid rgba(238,0,0,0.2)',
              }}>
                ⚠ {validationMap.get(selected.image_path)?.suspicion_reason}
              </div>
            )}

            {/* ── Box quality issues banner ── */}
            {(() => {
              const qi = sampleQualityIssues(selected)
              if (qi.length === 0) return null
              return (
                <div style={{
                  flexShrink: 0, padding: '6px 14px', fontSize: 12,
                  background: 'rgba(255,140,0,0.10)', borderBottom: '1px solid rgba(255,140,0,0.25)',
                  color: '#f0a040', display: 'flex', gap: 12, flexWrap: 'wrap',
                }}>
                  <span style={{ fontWeight: 600 }}>⚑ Box issues:</span>
                  {qi.map((issue, i) => (
                    <span key={i} style={{ opacity: 0.85 }}>
                      #{issue.boxIdx} {issue.className} — {issue.label}
                    </span>
                  ))}
                </div>
              )
            })()}

            {/* ── Split body ── */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

              {/* Image panel — fills remaining width */}
              <div style={{
                flex: 1, minWidth: 0, minHeight: 0,
                display: 'flex', flexDirection: 'column',
                background: '#080808', overflow: 'hidden', position: 'relative',
              }}>
                {/* Zoomable / pannable container */}
                <div
                  ref={zoomContainerRef}
                  onMouseDown={onMouseDown}
                  onMouseMove={onMouseMove}
                  onMouseUp={onMouseUp}
                  onMouseLeave={onMouseUp}
                  style={{
                    flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0,
                    cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
                    userSelect: 'none',
                  }}
                >
                  {/* Transform layer — origin top-left of container */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    transformOrigin: '0 0',
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <AnnotatedImageHud
                      sample={selected}
                      lightbox
                      suggestedBoxes={allDetectedBoxes}
                      detectThreshold={detectThreshold}
                      dismissedIdxs={dismissedIdxs}
                      onAccept={acceptSuggestion}
                      onDismiss={dismissSuggestion}
                      hoveredBox={hoveredBox}
                      onHoverBox={setHoveredBox}
                      boxStyle={boxStyle}
                    />
                  </div>
                </div>

                {/* Zoom controls — bottom-center overlay */}
                <div style={{
                  position: 'absolute', bottom: allDetectedBoxes.length > 0 ? 50 : 10,
                  left: '50%', transform: 'translateX(-50%)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)',
                  border: '1px solid var(--border)', borderRadius: 6,
                  padding: '3px 6px',
                }}>
                  <button onClick={() => setZoom(z => { const nz = Math.min(12, z * 1.3); return nz })}
                    style={{ background: 'none', color: 'var(--text-dim)', fontSize: 16, padding: '0 4px', height: 'auto', lineHeight: 1 }}>+</button>
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', minWidth: 36, textAlign: 'center' }}>
                    {zoom === 1 ? 'fit' : `${Math.round(zoom * 100)}%`}
                  </span>
                  <button onClick={() => {
                    const nz = Math.max(1, zoom / 1.3)
                    if (nz <= 1) resetZoom()
                    else setZoom(nz)
                  }}
                    style={{ background: 'none', color: 'var(--text-dim)', fontSize: 16, padding: '0 4px', height: 'auto', lineHeight: 1 }}>−</button>
                  {zoom > 1 && (
                    <button onClick={resetZoom}
                      style={{ background: 'none', color: 'var(--text-muted)', fontSize: 10, padding: '0 2px', height: 'auto', marginLeft: 2 }}>
                      ⊠
                    </button>
                  )}
                </div>

                {/* Suggestion action bar */}
                {allDetectedBoxes.length > 0 && (
                  <div style={{
                    flexShrink: 0, padding: '6px 14px', borderTop: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', gap: 10,
                    fontSize: 12,
                  }}>
                    {/* Threshold slider */}
                    <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>min</span>
                    <input
                      type="range" min={0.01} max={0.80} step={0.01}
                      value={detectThreshold}
                      onChange={e => {
                        setDetectThreshold(parseFloat(e.target.value))
                        setDismissedIdxs(new Set())   // reset dismissals when threshold changes
                      }}
                      style={{ width: 90, accentColor: '#f0c040' }}
                    />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#f0c040', width: 30, flexShrink: 0 }}>
                      {Math.round(detectThreshold * 100)}%
                    </span>

                    <span style={{ color: 'var(--text-dim)', flex: 1 }}>
                      ◈ {allDetectedBoxes.filter((b, i) =>
                          b.confidence >= detectThreshold &&
                          !dismissedIdxs.has(i) &&
                          !selected!.annotations.some(ann => boxIou(b, ann) > 0.4)
                        ).length} / {allDetectedBoxes.length} shown
                    </span>

                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, height: 26, flexShrink: 0 }}
                      onClick={() => {
                        const idxs = allDetectedBoxes.map((_, i) => i)
                        setDismissedIdxs(new Set(idxs))
                      }}
                    >
                      Dismiss all
                    </button>
                  </div>
                )}
              </div>

              {/* Score panel — slides in from right */}
              {showClip && validationMap.has(selected.image_path) && (
                <div style={{
                  width: 290, flexShrink: 0,
                  borderLeft: '1px solid var(--border)',
                  background: 'var(--bg)',
                  overflowY: 'auto',
                  display: 'flex', flexDirection: 'column',
                }}>
                  <ScoreBar
                    result={validationMap.get(selected.image_path)!}
                    threshold={threshold}
                    hoveredBox={hoveredBox}
                    onHoverBox={setHoveredBox}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <LabelEditor
          sample={editing}
          classNames={classNames}
          sessionId={sessionId}
          onClose={() => setEditing(null)}
          onSaved={handleEditorSaved}
        />
      )}
    </>
  )
}

// ── Bounding box quality checks ───────────────────────────────────────────────
type BoxIssueType = 'too_small' | 'too_large' | 'extreme_ratio' | 'edge_clipped'
interface BoxIssue { type: BoxIssueType; label: string; boxIdx: number; className: string }

function checkBoxQuality(ann: { cx: number; cy: number; w: number; h: number; class_name: string }, idx: number): BoxIssue[] {
  const issues: BoxIssue[] = []
  const area = ann.w * ann.h
  const ratio = ann.w > ann.h ? ann.w / ann.h : ann.h / ann.w
  const margin = 0.018
  const isEdge = (ann.cx - ann.w / 2 < margin || ann.cx + ann.w / 2 > 1 - margin ||
                  ann.cy - ann.h / 2 < margin || ann.cy + ann.h / 2 > 1 - margin)

  if (area < 0.004)   issues.push({ type: 'too_small',     label: 'Too small',                     boxIdx: idx, className: ann.class_name })
  if (area > 0.88)    issues.push({ type: 'too_large',     label: 'Too large',                     boxIdx: idx, className: ann.class_name })
  if (ratio > 7)      issues.push({ type: 'extreme_ratio', label: `Ratio ${ratio.toFixed(1)}:1`,   boxIdx: idx, className: ann.class_name })
  if (isEdge && area < 0.70) issues.push({ type: 'edge_clipped', label: 'Edge clipped',           boxIdx: idx, className: ann.class_name })
  return issues
}

function sampleQualityIssues(sample: ImageSample): BoxIssue[] {
  return sample.annotations.flatMap((ann, i) => checkBoxQuality(ann, i))
}

// ── Thumbnail card ────────────────────────────────────────────────────────────
function ImageCard({ sample, validationResult, isSuspicious, onClick }: {
  sample: ImageSample
  validationResult?: ImageValidationResult
  isSuspicious: boolean
  onClick: () => void
}) {
  const qIssues = sampleQualityIssues(sample)
  return (
    <div onClick={onClick} style={{
      border: `1px solid ${isSuspicious ? 'rgba(238,0,0,0.45)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)', overflow: 'hidden', cursor: 'pointer',
      transition: 'border-color 0.15s', position: 'relative',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = isSuspicious ? 'var(--red)' : 'var(--border-hover)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = isSuspicious ? 'rgba(238,0,0,0.45)' : 'var(--border)'}
    >
      {isSuspicious && (
        <div style={{
          position: 'absolute', top: 6, right: 6, zIndex: 10,
          background: 'rgba(200,0,0,0.82)', backdropFilter: 'blur(6px)',
          color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '2px 7px', borderRadius: 8,
        }}>⚠</div>
      )}
      {qIssues.length > 0 && (
        <div style={{
          position: 'absolute', top: 6, left: 6, zIndex: 10,
          background: 'rgba(255,140,0,0.85)', backdropFilter: 'blur(6px)',
          color: '#fff', fontSize: 10, fontWeight: 700,
          padding: '2px 7px', borderRadius: 8,
        }}>⚑ {qIssues.length}</div>
      )}
      <div style={{ background: '#111' }}>
        <AnnotatedImageHud sample={sample} maxHeight="190px" />
      </div>
      <div style={{
        padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6,
        background: isSuspicious ? 'rgba(238,0,0,0.05)' : 'var(--surface)',
      }}>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sample.source_name}
        </span>
        {validationResult && (
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0, color: isSuspicious ? 'var(--red)' : 'var(--text-muted)' }}>
            {Math.round(validationResult.top_confidence * 100)}%
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {sample.annotations.length}b
        </span>
      </div>
    </div>
  )
}

// ── CLIP score panel (fills the right sidebar) ───────────────────────────────
function ScoreBar({ result, threshold, hoveredBox = null, onHoverBox }: {
  result: ImageValidationResult
  threshold: number
  hoveredBox?: number | null
  onHoverBox?: (idx: number | null) => void
}) {
  const boxes = result.box_validations ?? []
  const assignedNames = new Set(boxes.map(bv => bv.class_name))

  // Aggregate "CLIP also sees" — non-assigned classes from avg scores
  const clipOnlyRows = result.scores
    .filter(s => !assignedNames.has(s.class_name) && s.confidence > 0.02)
    .slice(0, 5)

  const SectionHeader = ({ label }: { label: string }) => (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase',
      color: 'var(--text-muted)', padding: '14px 16px 8px',
      borderBottom: '1px solid var(--border)',
    }}>{label}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>

      {/* ── Per-box results ── */}
      <SectionHeader label={`Box scores · ${boxes.length} annotation${boxes.length !== 1 ? 's' : ''}`} />

      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {boxes.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No annotations in this image</span>
        )}

        {boxes.map(bv => {
          const pct      = Math.round(bv.assigned_confidence * 100)
          const isLow    = bv.is_suspicious
          const color    = hudColor(bv.box_index)
          const isHovered = hoveredBox === bv.box_index
          const isDimmed  = hoveredBox !== null && !isHovered

          return (
            <div
              key={bv.box_index}
              onMouseEnter={() => onHoverBox?.(bv.box_index)}
              onMouseLeave={() => onHoverBox?.(null)}
              style={{
                borderRadius: 6,
                border: `1px solid ${isHovered ? color : isLow ? 'rgba(238,0,0,0.3)' : color + '33'}`,
                background: isHovered ? color + '18' : isLow ? 'rgba(238,0,0,0.04)' : color + '08',
                padding: '8px 10px',
                opacity: isDimmed ? 0.35 : 1,
                transition: 'opacity 0.12s ease, border-color 0.12s ease, background 0.12s ease',
                cursor: 'default',
              }}
            >
              {/* Header: badge + class + suspicious marker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                  padding: '2px 6px', borderRadius: 4,
                  background: color + '22', color, border: `1px solid ${color}55`,
                  flexShrink: 0,
                }}>
                  #{bv.box_index}
                </span>
                <span style={{
                  fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 600, flex: 1,
                  color: isLow ? 'var(--red)' : 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {bv.class_name}
                </span>
                {isLow && (
                  <span style={{ fontSize: 10, color: 'var(--red)', flexShrink: 0 }}>⚠</span>
                )}
              </div>

              {/* Confidence bar — assigned class */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, width: `${pct}%`,
                    background: isLow ? 'var(--red)' : color,
                    transition: 'width 0.35s ease',
                  }} />
                </div>
                <span style={{
                  fontSize: 11, fontFamily: 'var(--mono)', width: 36, textAlign: 'right',
                  flexShrink: 0, fontWeight: 600,
                  color: isLow ? 'var(--red)' : 'var(--text-dim)',
                }}>
                  {pct}%
                </span>
              </div>

              {/* CLIP suggestion when suspicious */}
              {isLow && bv.top_class !== bv.class_name && (
                <div style={{
                  marginTop: 6, fontSize: 11, color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ color: 'var(--accent)', fontSize: 10 }}>✦</span>
                  CLIP: <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{bv.top_class}</span>
                  <span style={{ opacity: 0.6 }}>({Math.round(bv.top_confidence * 100)}%)</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── CLIP also sees (aggregate, non-assigned) ── */}
      {clipOnlyRows.length > 0 && (
        <>
          <SectionHeader label="CLIP also sees" />
          <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {clipOnlyRows.map(s => {
              const pct = Math.round(s.confidence * 100)
              return (
                <div key={s.class_name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {s.class_name}
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${pct}%`, background: 'var(--accent)', opacity: 0.6, transition: 'width 0.35s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── IOU helper for overlap suppression ───────────────────────────────────────
function boxIou(
  a: { cx: number; cy: number; w: number; h: number },
  b: { cx: number; cy: number; w: number; h: number },
): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2
  const ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2
  const bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1))
  const inter = ix * iy
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}

// ── Image + SVG HUD ───────────────────────────────────────────────────────────
function AnnotatedImageHud({
  sample,
  maxHeight,
  lightbox = false,
  suggestedBoxes = [],
  detectThreshold = 0,
  dismissedIdxs = new Set(),
  onAccept,
  onDismiss,
  hoveredBox = null,
  onHoverBox,
  boxStyle = 'corners',
}: {
  sample: ImageSample
  maxHeight?: string
  lightbox?: boolean
  suggestedBoxes?: DetectedBox[]
  detectThreshold?: number
  dismissedIdxs?: Set<number>
  onAccept?: (idx: number) => void
  onDismiss?: (idx: number) => void
  hoveredBox?: number | null
  onHoverBox?: (idx: number | null) => void
  boxStyle?: BoxStyle
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const imgUrl = `/filesystem/image?path=${encodeURIComponent(sample.image_path)}`

  const onLoad = () => {
    if (imgRef.current) setDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
  }

  const imgStyle: React.CSSProperties = lightbox
    ? { display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', width: 'auto', height: 'auto', background: '#000' }
    : { display: 'block', width: '100%', maxHeight: maxHeight ?? '200px', background: '#000', objectFit: 'contain' }

  const wrapStyle: React.CSSProperties = lightbox
    ? { position: 'relative', display: 'inline-block' }
    : { position: 'relative', display: 'inline-block', width: '100%' }

  const visible = suggestedBoxes.filter((_, i) => !dismissedIdxs.has(i))

  return (
    <div style={wrapStyle}>
      <img ref={imgRef} src={imgUrl} alt="" onLoad={onLoad} style={imgStyle} />
      {dims.w > 0 && (
        <svg style={{ position: 'absolute', top: 0, left: 0, width: dims.w, height: dims.h, overflow: 'visible', pointerEvents: lightbox ? 'auto' : 'none' }}>
          {/* Existing YOLO annotations */}
          {sample.annotations.map((ann, idx) => (
            <HudBox
              key={`ann-${idx}`} ann={ann} imgW={dims.w} imgH={dims.h} trackId={idx}
              selected={lightbox && hoveredBox === idx}
              dimmed={lightbox && hoveredBox !== null && hoveredBox !== idx}
              onMouseEnter={lightbox ? () => onHoverBox?.(idx) : undefined}
              onMouseLeave={lightbox ? () => onHoverBox?.(null) : undefined}
              boxStyle={boxStyle}
            />
          ))}
          {/* Ghost suggested boxes — skip dismissed, below-threshold, or overlapping existing */}
          {lightbox && suggestedBoxes.map((box, idx) => {
            if (dismissedIdxs.has(idx)) return null
            if (box.confidence < detectThreshold) return null
            if (sample.annotations.some(ann => boxIou(box, ann) > 0.4)) return null
            const x = (box.cx - box.w / 2) * dims.w
            const y = (box.cy - box.h / 2) * dims.h
            const bw = box.w * dims.w
            const bh = box.h * dims.h
            const color = '#f0c040'
            return (
              <g key={`sug-${idx}`}>
                <rect
                  x={x} y={y} width={bw} height={bh}
                  fill="none" stroke={color} strokeWidth={1.5}
                  strokeDasharray="5,3" opacity={0.85}
                />
                {/* Label tag */}
                <rect x={x} y={y - 18} width={Math.min(bw, 140)} height={18} fill={color} opacity={0.9} rx={2} />
                <text x={x + 4} y={y - 5} fontSize={10} fill="#000" fontFamily="monospace" fontWeight="bold">
                  {box.class_name} {Math.round(box.confidence * 100)}%
                </text>
                {/* Action buttons — use foreignObject for HTML buttons */}
                <foreignObject x={x + bw - 46} y={y + 2} width={44} height={20}
                               style={{ pointerEvents: 'all', overflow: 'visible' }}>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <button
                      onClick={() => onAccept?.(idx)}
                      title="Accept"
                      style={{
                        width: 20, height: 20, fontSize: 11, padding: 0, lineHeight: 1,
                        background: 'rgba(80,200,80,0.9)', color: '#000',
                        border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
                      }}
                    >✓</button>
                    <button
                      onClick={() => onDismiss?.(idx)}
                      title="Dismiss"
                      style={{
                        width: 20, height: 20, fontSize: 11, padding: 0, lineHeight: 1,
                        background: 'rgba(200,60,60,0.9)', color: '#fff',
                        border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
                      }}
                    >✕</button>
                  </div>
                </foreignObject>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
