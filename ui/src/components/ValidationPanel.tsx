import { useCallback, useEffect, useRef, useState } from 'react'
import { ImageValidationResult, ValidationStatus, validationApi } from '../api/client'

interface Props {
  sessionId: string
  onResultsReady: (results: ImageValidationResult[], threshold: number) => void
}

export function ValidationPanel({ sessionId, onResultsReady }: Props) {
  const [open, setOpen]           = useState(false)
  const [threshold, setThreshold] = useState(0.25)
  const [maxImages, setMaxImages] = useState(100)
  const [status, setStatus]       = useState<ValidationStatus | null>(null)
  const [running, setRunning]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── stop polling on unmount ──────────────────────────────────────────────
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // ── start validation run ─────────────────────────────────────────────────
  const handleStart = async () => {
    setRunning(true)
    setError(null)
    setStatus(null)
    try {
      await validationApi.start(sessionId, threshold, maxImages)
      // poll every 1.5s
      pollRef.current = setInterval(async () => {
        try {
          const s = await validationApi.status(sessionId)
          setStatus(s)
          if (s.status === 'done') {
            stopPolling()
            setRunning(false)
            onResultsReady(s.results, threshold)
          } else if (s.status === 'failed') {
            stopPolling()
            setRunning(false)
            setError(s.error || 'Validation failed')
          }
        } catch { /* will retry */ }
      }, 1500)
    } catch (e: any) {
      setRunning(false)
      setError(e.response?.data?.detail ?? e.message)
    }
  }

  // ── re-apply threshold filter on existing results ────────────────────────
  const handleThresholdChange = useCallback((val: number) => {
    setThreshold(val)
    if (status?.status === 'done' && status.results.length > 0) {
      // refilter client-side — no need to re-run
      onResultsReady(status.results, val)
    }
  }, [status, onResultsReady])

  const progress = status?.total ? Math.round((status.done / status.total) * 100) : 0

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'none', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          CLIP Validation
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status?.status === 'done' && (
            <span style={{
              fontSize: 11, padding: '2px 7px', borderRadius: 10,
              background: status.suspicious_count > 0 ? 'rgba(238,0,0,0.12)' : 'rgba(0,200,100,0.12)',
              color: status.suspicious_count > 0 ? 'var(--red)' : 'var(--green)',
              border: `1px solid ${status.suspicious_count > 0 ? 'rgba(238,0,0,0.3)' : 'rgba(0,200,100,0.3)'}`,
              fontWeight: 600,
            }}>
              {status.suspicious_count} suspicious
            </span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}>{open ? '−' : '+'}</span>
        </span>
      </button>

      {/* ── Body ── */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Threshold slider */}
          <div style={{ paddingTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Suspicion threshold</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                {threshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range" min={0.10} max={0.50} step={0.01}
              value={threshold}
              onChange={e => handleThresholdChange(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>0.10 lenient</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>0.50 strict</span>
            </div>
          </div>

          {/* Max images */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Max images / source</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{maxImages}</span>
            </div>
            <input
              type="range" min={20} max={500} step={10}
              value={maxImages}
              onChange={e => setMaxImages(parseInt(e.target.value))}
              disabled={running}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Run button */}
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={running}
            style={{ justifyContent: 'center', fontSize: 13 }}
          >
            {running ? '⏳ Scoring…' : '▶ Run Validation'}
          </button>

          {/* Progress bar */}
          {running && (
            <div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--surface2)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--accent)',
                  width: `${progress}%`,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
                {status?.phase || 'Loading CLIP model…'} {status?.total ? `(${status.done}/${status.total})` : ''}
              </div>
            </div>
          )}

          {/* Results summary */}
          {status?.status === 'done' && (
            <div style={{
              padding: '10px 12px', borderRadius: 'var(--radius)',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)' }}>Total scored</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{status.total_images}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text-dim)' }}>Suspicious</span>
                <span style={{ fontFamily: 'var(--mono)', color: status.suspicious_count > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {status.suspicious_count} ({(status.suspicious_ratio * 100).toFixed(1)}%)
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Threshold used: {status.threshold.toFixed(2)} · Drag slider to refilter
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 12, color: 'var(--red)', padding: '8px 10px',
              border: '1px solid rgba(238,0,0,0.2)', borderRadius: 'var(--radius)',
              background: 'var(--red-dim)',
            }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
