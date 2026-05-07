import { useEffect, useRef, useState } from 'react'
import { ExportStatus, ExportSummary, sessionsApi } from '../api/client'
import { PathInput } from './PathInput'

interface Props {
  sessionId: string
  onExported: () => void
}

const PHASE_LABELS: Record<string, string> = {
  starting:       'Starting…',
  collecting:     'Collecting images…',
  dedup:          'Removing duplicates…',
  splitting:      'Splitting dataset…',
  'writing train':'Writing train split…',
  'writing val':  'Writing val split…',
  'writing test': 'Writing test split…',
}

function phaseLabel(phase?: string) {
  if (!phase) return 'Working…'
  return PHASE_LABELS[phase] ?? phase
}

export function ExportPanel({ sessionId, onExported }: Props) {
  const [outputPath, setOutputPath] = useState('./workspace/exports/unified')
  const [trainRatio, setTrainRatio] = useState(70)
  const [valRatio,   setValRatio]   = useState(20)

  const [exporting, setExporting]   = useState(false)
  const [progress,  setProgress]    = useState<ExportStatus | null>(null)
  const [error,     setError]       = useState<string | null>(null)
  const [summary,   setSummary]     = useState<ExportSummary | null>(null)
  const [zipping,   setZipping]     = useState(false)
  const [zipResult, setZipResult]   = useState<{ zip_path: string; size_mb: number } | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  const startPolling = () => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const s = await sessionsApi.exportStatus(sessionId)
        setProgress(s)
        if (s.status === 'done') {
          stopPolling()
          setExporting(false)
          if (s.summary) {
            setSummary(s.summary as ExportSummary)
            onExported()
          }
        } else if (s.status === 'failed') {
          stopPolling()
          setExporting(false)
          setError(s.error ?? 'Export failed')
        }
      } catch { /* ignore transient errors */ }
    }, 500)
  }

  const testRatio = 100 - trainRatio - valRatio

  const handleExport = async () => {
    if (testRatio < 0) { setError('Ratios exceed 100%'); return }
    setExporting(true)
    setError(null)
    setProgress({ status: 'running', phase: 'starting', done: 0, total: 0 })
    try {
      await sessionsApi.export(sessionId, outputPath, [trainRatio / 100, valRatio / 100, testRatio / 100])
      startPolling()
    } catch (e: any) {
      setExporting(false)
      setProgress(null)
      setError(e.response?.data?.detail ?? e.message)
    }
  }

  const handleZip = async () => {
    if (!summary) return
    setZipping(true)
    try {
      const r = await sessionsApi.packageZip(sessionId, summary.output_path)
      setZipResult(r)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally {
      setZipping(false)
    }
  }

  // ── Progress view ──────────────────────────────────────────────────────────
  if (exporting && progress) {
    const pct = (progress.total && progress.total > 0)
      ? Math.min(100, Math.round((progress.done ?? 0) / progress.total * 100))
      : null

    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="status-dot" style={{ background: 'var(--blue)', animation: 'pulse 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Exporting…
          </span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {phaseLabel(progress.phase)}
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface)', overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{
              height: '100%',
              borderRadius: 3,
              background: 'var(--blue)',
              transition: 'width 0.3s ease',
              width: pct !== null ? `${pct}%` : '0%',
            }} />
          </div>

          {pct !== null ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>{progress.done ?? 0} / {progress.total} images</span>
              <span>{pct}%</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Please wait…</div>
          )}
        </div>
      </div>
    )
  }

  // ── Summary view ───────────────────────────────────────────────────────────
  if (summary) return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="status-dot" style={{ background: 'var(--green)' }} />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Export Complete
        </span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
          {summary.output_path}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {Object.entries(summary.split_counts).map(([split, count]) => (
            <div key={split} style={{ textAlign: 'center', padding: '8px 4px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)' }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{count}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>{split}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {summary.total_images.toLocaleString()} total images
          {summary.duplicate_count > 0 && (
            <span style={{ color: 'var(--yellow)', marginLeft: 8 }}>· {summary.duplicate_count} duplicates removed</span>
          )}
        </div>
        {/* Kaggle zip */}
        {!zipResult ? (
          <button
            className="btn btn-ghost"
            onClick={handleZip}
            disabled={zipping}
            style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
          >
            {zipping ? 'Creating ZIP…' : 'Package for Kaggle (.zip)'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="status-dot" style={{ background: 'var(--green)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>ZIP ready · {zipResult.size_mb} MB</span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {zipResult.zip_path}
            </div>
          </div>
        )}

        <button
          className="btn btn-ghost"
          onClick={() => { setSummary(null); setZipResult(null); setProgress(null) }}
          style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
        >
          Export again
        </button>
      </div>
    </div>
  )

  // ── Form view ──────────────────────────────────────────────────────────────
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Export Dataset
        </span>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Output folder</label>
          <PathInput value={outputPath} onChange={setOutputPath} placeholder="Select export folder…" />
        </div>

        <div>
          <label style={labelStyle}>Split ratio</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {([['Train', trainRatio, setTrainRatio], ['Val', valRatio, setValRatio]] as const).map(([lbl, val, set]) => (
              <div key={String(lbl)}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textAlign: 'center' }}>{lbl} %</div>
                <input
                  type="number" min={0} max={100}
                  value={val as number}
                  onChange={e => (set as any)(Number(e.target.value))}
                  style={{ textAlign: 'center' }}
                />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textAlign: 'center' }}>Test %</div>
              <div style={{
                height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${testRatio < 0 ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                fontSize: 14,
                color: testRatio < 0 ? 'var(--red)' : 'var(--text-dim)',
                fontWeight: 600,
              }}>
                {testRatio}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: 'var(--red)', padding: '8px 10px', border: '1px solid rgba(238,0,0,0.25)', borderRadius: 'var(--radius)', background: 'var(--red-dim)' }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" onClick={handleExport} disabled={exporting} style={{ width: '100%', justifyContent: 'center' }}>
          Export YOLO Dataset
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 500,
  color: 'var(--text-dim)', marginBottom: 6,
  textTransform: 'uppercase', letterSpacing: '0.05em',
}
