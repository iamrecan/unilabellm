import { useEffect, useRef, useState } from 'react'
import { sessionsApi, ImageSample } from '../api/client'
import { HudBox, hudColor } from './HudOverlay'
import { LabelEditor } from './LabelEditor'

interface Props {
  sessionId: string
  classNames: string[]
}

export function SampleViewer({ sessionId, classNames }: Props) {
  const [open, setOpen]         = useState(false)
  const [samples, setSamples]   = useState<ImageSample[]>([])
  const [loading, setLoading]   = useState(false)
  const [selected, setSelected] = useState<ImageSample | null>(null)
  const [editing, setEditing]   = useState<ImageSample | null>(null)

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

  return (
    <>
      <button className="btn btn-ghost" onClick={handleOpen}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
        Preview Labels
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
          <div style={{
            height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg)', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Label Preview</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
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
            {!loading && samples.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', paddingTop: 60 }}>No images found.</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {samples.map((s, i) => (
                <ImageCard key={i} sample={s} onClick={() => setSelected(s)} />
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
function ImageCard({ sample, onClick }: { sample: ImageSample; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ background: '#111' }}>
        <AnnotatedImageHud sample={sample} maxHeight="200px" />
      </div>
      <div style={{
        padding: '8px 10px', background: 'var(--surface)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sample.source_name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>
          {sample.annotations.length} box{sample.annotations.length !== 1 ? 'es' : ''}
        </span>
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
