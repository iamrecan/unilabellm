import { useEffect, useRef, useState } from 'react'
import { sessionsApi, ImageSample, ImageValidationResult } from '../api/client'
import { HudBox, hudColor } from './HudOverlay'
import { LabelEditor } from './LabelEditor'

interface Props {
  sessionId: string
  classNames: string[]
  /** Pass validation results to highlight suspicious images */
  validationResults?: ImageValidationResult[]
  /** Current CLIP threshold — used to recompute suspicious set on slider change */
  validationThreshold?: number
}

type FilterMode = 'all' | 'suspicious'

export function SampleViewer({ sessionId, classNames, validationResults, validationThreshold = 0.25 }: Props) {
  const [open, setOpen]         = useState(false)
  const [samples, setSamples]   = useState<ImageSample[]>([])
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<ImageSample | null>(null)
  const [editing, setEditing]   = useState<ImageSample | null>(null)
  const [filter, setFilter]     = useState<FilterMode>('all')

  // Build a lookup: image_path → validation result (recomputed on threshold change)
  const validationMap = new Map<string, ImageValidationResult>(
    (validationResults ?? []).map(r => [r.image_path, r])
  )
  const suspiciousSet = new Set<string>(
    (validationResults ?? [])
      .filter(r => r.scores.some(s => s.class_name === r.assigned_labels[0] && s.confidence < validationThreshold)
        || r.is_suspicious)
      .map(r => r.image_path)
  )

  const load = async () => {
    setLoading(true)
    try { setSamples(await sessionsApi.samples(sessionId, 8)) }
    finally { setLoading(false) }
  }

  const handleOpen = () => { setOpen(true); if (!samples.length) load() }
  const handleEditorSaved = () => { setEditing(null); load() }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelected(null); setOpen(false) }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // Filtered samples for display
  const displayedSamples = filter === 'suspicious'
    ? samples.filter(s => suspiciousSet.has(s.image_path))
    : samples

  const suspiciousInSamples = samples.filter(s => suspiciousSet.has(s.image_path)).length
  const hasValidation = validationResults && validationResults.length > 0

  return (
    <>
      <button className="btn btn-ghost" onClick={handleOpen}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
        Preview Labels
        {hasValidation && suspiciousInSamples > 0 && (
          <span style={{
            marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 10,
            background: 'rgba(238,0,0,0.15)', color: 'var(--red)',
            border: '1px solid rgba(238,0,0,0.3)', fontWeight: 600,
          }}>
            {suspiciousInSamples} ⚠
          </span>
        )}
      </button>

      {/* ── Grid modal ── */}
      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg)', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Label Preview</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>

              {/* Filter toggle — only show when we have validation results */}
              {hasValidation && (
                <div style={{ display: 'flex', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                  {(['all', 'suspicious'] as FilterMode[]).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setFilter(mode)}
                      style={{
                        padding: '4px 12px', fontSize: 12, height: 30, borderRadius: 0,
                        background: filter === mode ? 'var(--accent)' : 'transparent',
                        color: filter === mode ? '#fff' : 'var(--text-dim)',
                        borderRight: mode === 'all' ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      {mode === 'all' ? 'All' : `Suspicious (${suspiciousSet.size})`}
                    </button>
                  ))}
                </div>
              )}

              <button className="btn btn-ghost" onClick={load} disabled={loading}
                      style={{ fontSize: 12, height: 30 }}>
                {loading ? 'Loading…' : 'Resample'}
              </button>
              <button onClick={() => setOpen(false)}
                      style={{ background: 'none', color: 'var(--text-dim)', fontSize: 20, padding: 0, height: 'auto', lineHeight: 1 }}>
                ×
              </button>
            </div>
          </div>

          {/* Legend */}
          <div style={{
            display: 'flex', gap: 12, padding: '10px 24px',
            borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
            background: 'var(--surface)', flexShrink: 0,
          }}>
            {classNames.map((name, id) => (
              <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: hudColor(id), flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{name}</span>
              </span>
            ))}
          </div>

          {/* Image grid */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {loading && !samples.length && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', paddingTop: 60 }}>Loading samples…</div>
            )}
            {!loading && displayedSamples.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', paddingTop: 60 }}>
                {filter === 'suspicious' ? 'No suspicious images in current sample. Try Resample.' : 'No images found.'}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {displayedSamples.map((s, i) => (
                <ImageCard
                  key={i}
                  sample={s}
                  validationResult={validationMap.get(s.image_path)}
                  isSuspicious={suspiciousSet.has(s.image_path)}
                  onClick={() => setSelected(s)}
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
          style={{
            position: 'fixed', inset: 0, zIndex: 300,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div onClick={e => e.stopPropagation()}
               style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>

            {/* Suspicious reason banner */}
            {suspiciousSet.has(selected.image_path) && (
              <div style={{
                position: 'absolute', top: -60, left: 0, right: 0,
                background: 'rgba(238,0,0,0.15)', border: '1px solid rgba(238,0,0,0.3)',
                borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12, color: 'var(--red)',
                maxWidth: '90vw',
              }}>
                ⚠ {validationMap.get(selected.image_path)?.suspicion_reason}
              </div>
            )}

            <AnnotatedImageHud sample={selected} maxHeight="78vh" />

            <button onClick={() => setSelected(null)} style={{
              position: 'absolute', top: -36, right: 0,
              background: 'none', color: 'var(--text-dim)', fontSize: 22, padding: 0, height: 'auto', lineHeight: 1,
            }}>×</button>

            <button
              className="btn btn-ghost"
              onClick={() => { setEditing(selected); setSelected(null) }}
              style={{ position: 'absolute', top: -36, right: 28, fontSize: 12, height: 26, padding: '0 10px' }}
            >
              ✎ Edit Labels
            </button>

            {/* CLIP score breakdown */}
            {validationMap.has(selected.image_path) && (
              <ScoreBar result={validationMap.get(selected.image_path)!} threshold={validationThreshold} />
            )}

            <div style={{ position: 'absolute', bottom: -26, left: 0, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
              {selected.source_name} · {selected.annotations.length} annotations
            </div>
          </div>
        </div>
      )}

      {/* ── Label editor ── */}
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

// ── Thumbnail card ────────────────────────────────────────────────────────────
function ImageCard({
  sample, validationResult, isSuspicious, onClick,
}: {
  sample: ImageSample
  validationResult?: ImageValidationResult
  isSuspicious: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${isSuspicious ? 'rgba(238,0,0,0.5)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s',
        position: 'relative',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = isSuspicious ? 'rgba(238,0,0,0.8)' : 'var(--border-hover)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = isSuspicious ? 'rgba(238,0,0,0.5)' : 'var(--border)')}
    >
      {/* Suspicious badge */}
      {isSuspicious && (
        <div style={{
          position: 'absolute', top: 6, right: 6, zIndex: 10,
          background: 'rgba(238,0,0,0.85)', color: '#fff',
          fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 8,
          backdropFilter: 'blur(4px)',
        }}>
          ⚠ SUSPICIOUS
        </div>
      )}

      <div style={{ background: '#111' }}>
        <AnnotatedImageHud sample={sample} maxHeight="200px" />
      </div>

      <div style={{
        padding: '8px 10px',
        background: isSuspicious ? 'rgba(238,0,0,0.06)' : 'var(--surface)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {sample.source_name}
        </span>
        {validationResult && (
          <span style={{
            fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0,
            color: isSuspicious ? 'var(--red)' : 'var(--text-muted)',
          }}>
            {(validationResult.top_confidence * 100).toFixed(0)}%
          </span>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          {sample.annotations.length} box{sample.annotations.length !== 1 ? 'es' : ''}
        </span>
      </div>
    </div>
  )
}

// ── CLIP score breakdown bar (shown in lightbox) ──────────────────────────────
function ScoreBar({ result, threshold }: { result: ImageValidationResult; threshold: number }) {
  const sorted = [...result.scores].sort((a, b) => b.confidence - a.confidence).slice(0, 5)
  return (
    <div style={{
      position: 'absolute', bottom: -110, left: 0, right: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '8px 12px', fontSize: 11,
    }}>
      <div style={{ color: 'var(--text-dim)', marginBottom: 6, fontWeight: 500 }}>CLIP confidence</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sorted.map(s => {
          const pct = Math.round(s.confidence * 100)
          const isBelowThreshold = result.assigned_labels.includes(s.class_name) && s.confidence < threshold
          return (
            <div key={s.class_name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontFamily: 'var(--mono)', width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                color: result.assigned_labels.includes(s.class_name) ? 'var(--text)' : 'var(--text-muted)',
              }}>{s.class_name}</span>
              <div style={{ flex: 1, height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3,
                  width: `${pct}%`,
                  background: isBelowThreshold ? 'var(--red)' : s.class_name === result.top_class ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'width 0.3s',
                }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', width: 32, textAlign: 'right', color: isBelowThreshold ? 'var(--red)' : 'var(--text-dim)' }}>
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Image + HUD SVG overlay ───────────────────────────────────────────────────
function AnnotatedImageHud({ sample, maxHeight }: { sample: ImageSample; maxHeight: string }) {
  const imgUrl = `/filesystem/image?path=${encodeURIComponent(sample.image_path)}`
  const imgRef = useRef<HTMLImageElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const onLoad = () => {
    if (imgRef.current) setDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <img
        ref={imgRef}
        src={imgUrl}
        alt=""
        onLoad={onLoad}
        style={{ display: 'block', width: '100%', maxHeight, background: '#000' }}
      />
      {dims.w > 0 && (
        <svg style={{
          position: 'absolute', top: 0, left: 0,
          width: dims.w, height: dims.h,
          overflow: 'visible', pointerEvents: 'none',
        }}>
          {sample.annotations.map((ann, idx) => (
            <HudBox key={idx} ann={ann} imgW={dims.w} imgH={dims.h} trackId={idx} />
          ))}
        </svg>
      )}
    </div>
  )
}
