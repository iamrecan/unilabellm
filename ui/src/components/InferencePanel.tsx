import { useRef, useState } from 'react'
import { inferenceApi, InferenceResult, BatchResult } from '../api/client'
import { HudBox, hudColor } from './HudOverlay'
import { PathInput } from './PathInput'

type Tab = 'single' | 'batch'

export function InferencePanel() {
  const [tab, setTab]             = useState<Tab>('single')
  const [modelPath, setModelPath] = useState('')
  const [imgPath, setImgPath]     = useState('')
  const [imgDir, setImgDir]       = useState('')
  const [conf, setConf]           = useState(25)
  const [iou, setIou]             = useState(45)
  const [maxImgs, setMaxImgs]     = useState(20)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [result, setResult]       = useState<InferenceResult | null>(null)
  const [batch, setBatch]         = useState<BatchResult | null>(null)
  const [selected, setSelected]   = useState<InferenceResult | null>(null)

  const run = async () => {
    if (!modelPath.trim()) { setError('Model path required'); return }
    setLoading(true); setError(null); setResult(null); setBatch(null)
    try {
      if (tab === 'single') {
        if (!imgPath.trim()) { setError('Image path required'); return }
        const r = await inferenceApi.predict(modelPath, imgPath, conf / 100, iou / 100)
        setResult(r)
      } else {
        if (!imgDir.trim()) { setError('Image directory required'); return }
        const r = await inferenceApi.batch(modelPath, imgDir, conf / 100, iou / 100, maxImgs)
        setBatch(r)
        if (r.results.length > 0) setSelected(r.results[0])
      }
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  const display = tab === 'single' ? result : selected

  return (
    <div className="fade-in" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', height: 'calc(100vh - 140px)' }}>

      {/* ── Left: controls ── */}
      <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Test Model</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>
            Run inference with a trained .pt model
          </p>
        </div>

        {/* Model path */}
        <div>
          <label style={labelStyle}>Model (.pt)</label>
          <PathInput
            value={modelPath} onChange={setModelPath}
            placeholder="/path/to/best.pt"
            mode="file" fileExtensions={['.pt', '.onnx', '.engine']}
          />
        </div>

        {/* Conf / IoU */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Conf %</label>
            <input type="number" min={1} max={99} value={conf}
                   onChange={e => setConf(Number(e.target.value))} />
          </div>
          <div>
            <label style={labelStyle}>IoU %</label>
            <input type="number" min={1} max={99} value={iou}
                   onChange={e => setIou(Number(e.target.value))} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['single', 'batch'] as Tab[]).map(t => (
            <button key={t} className={`btn ${tab === t ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setTab(t)}
                    style={{ flex: 1, justifyContent: 'center', fontSize: 12, height: 30 }}>
              {t === 'single' ? 'Single' : 'Batch'}
            </button>
          ))}
        </div>

        {/* Image / dir input */}
        {tab === 'single' ? (
          <div>
            <label style={labelStyle}>Image file</label>
            <PathInput
              value={imgPath} onChange={setImgPath}
              placeholder="/path/to/image.jpg"
              mode="file" fileExtensions={['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff']}
            />
          </div>
        ) : (
          <div>
            <label style={labelStyle}>Image folder</label>
            <PathInput value={imgDir} onChange={setImgDir} placeholder="/path/to/images/" />
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>Max images</label>
              <input type="number" min={1} max={200} value={maxImgs}
                     onChange={e => setMaxImgs(Number(e.target.value))} />
            </div>
          </div>
        )}

        {error && (
          <div style={{
            fontSize: 12, color: 'var(--red)', padding: '8px 10px',
            border: '1px solid rgba(238,0,0,0.25)', borderRadius: 'var(--radius)',
            background: 'var(--red-dim)',
          }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" onClick={run} disabled={loading}
                style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Running…' : '▶ Run Inference'}
        </button>

        {/* Stats */}
        {result && (
          <StatsBox result={result} />
        )}
        {batch && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Batch · {batch.results.length} images · {batch.total_ms}ms
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {batch.results.map((r, i) => (
                <div
                  key={i}
                  onClick={() => setSelected(r)}
                  style={{
                    padding: '8px 12px',
                    borderBottom: i < batch.results.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    background: selected === r ? 'var(--surface2)' : 'transparent',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = selected === r ? 'var(--surface2)' : 'transparent')}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)',
                                 overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                    {r.image_path.split('/').pop()}
                  </span>
                  <span style={{ fontSize: 11, color: r.predictions.length > 0 ? 'var(--green)' : 'var(--text-muted)',
                                 flexShrink: 0, marginLeft: 8 }}>
                    {r.predictions.length} det
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Right: image + HUD ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {display ? (
          <>
            <ImageHud result={display} />
            <PredTable result={display} />
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            color: 'var(--text-muted)', fontSize: 13,
            minHeight: 400,
          }}>
            {loading ? 'Running model…' : 'Select a model and image, then click Run'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Image with HUD predictions ────────────────────────────────────────────────
function ImageHud({ result }: { result: InferenceResult }) {
  const imgUrl = `/filesystem/image?path=${encodeURIComponent(result.image_path)}`
  const imgRef = useRef<HTMLImageElement>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })

  const onLoad = () => {
    if (imgRef.current) setDims({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })
  }

  return (
    <div style={{
      position: 'relative', display: 'inline-block', width: '100%',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden',
      background: '#000',
    }}>
      <img ref={imgRef} src={imgUrl} alt="" onLoad={onLoad}
           style={{ display: 'block', width: '100%', maxHeight: 'calc(100vh - 300px)' }} />
      {dims.w > 0 && (
        <svg style={{
          position: 'absolute', top: 0, left: 0,
          width: dims.w, height: dims.h,
          overflow: 'visible', pointerEvents: 'none',
        }}>
          {result.predictions.map((ann, idx) => (
            <HudBox key={idx} ann={ann} imgW={dims.w} imgH={dims.h} trackId={idx} />
          ))}
        </svg>
      )}
      {/* filename chip */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        fontSize: 10, fontFamily: 'var(--mono)', color: '#ccc',
        background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: 3,
      }}>
        {result.image_path.split('/').pop()}
        {result.inference_ms > 0 && ` · ${result.inference_ms}ms`}
      </div>
    </div>
  )
}

// ── Prediction table ──────────────────────────────────────────────────────────
function PredTable({ result }: { result: InferenceResult }) {
  if (!result.predictions.length) return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
      No detections above threshold
    </div>
  )

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {/* header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px',
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.06em', fontWeight: 500, background: 'var(--surface)',
      }}>
        <span>#</span>
        <span>Class</span>
        <span style={{ textAlign: 'right' }}>Conf</span>
        <span style={{ textAlign: 'right' }}>cx</span>
        <span style={{ textAlign: 'right' }}>cy</span>
        <span style={{ textAlign: 'right' }}>w×h</span>
      </div>
      {result.predictions
        .slice()
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
        .map((p, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px 80px 80px',
            padding: '6px 12px',
            borderBottom: i < result.predictions.length - 1 ? '1px solid var(--border)' : 'none',
            fontSize: 12, alignItems: 'center',
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: 3,
              background: hudColor(p.class_id), flexShrink: 0,
              display: 'inline-block',
            }} />
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)', fontWeight: 500 }}>
              {p.class_name}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--mono)',
                           color: (p.confidence ?? 0) > 0.7 ? 'var(--green)' : 'var(--text-dim)' }}>
              {p.confidence !== undefined ? `${Math.round(p.confidence * 100)}%` : '—'}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-dim)', fontSize: 11 }}>
              {p.cx.toFixed(3)}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-dim)', fontSize: 11 }}>
              {p.cy.toFixed(3)}
            </span>
            <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-dim)', fontSize: 11 }}>
              {p.w.toFixed(2)}×{p.h.toFixed(2)}
            </span>
          </div>
        ))}
    </div>
  )
}

// ── Stats box (single result) ─────────────────────────────────────────────────
function StatsBox({ result }: { result: InferenceResult }) {
  const counts: Record<string, number> = {}
  for (const p of result.predictions) counts[p.class_name] = (counts[p.class_name] ?? 0) + 1

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Result</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>{result.inference_ms}ms</span>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Object.entries(counts).map(([cls, n]) => (
          <div key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: 1,
              background: hudColor(result.model_classes.indexOf(cls)),
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, fontFamily: 'var(--mono)' }}>{cls}</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{n}</span>
          </div>
        ))}
        {result.predictions.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No detections</span>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 500,
  color: 'var(--text-dim)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
