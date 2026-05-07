import { useState } from 'react'
import { sessionsApi } from '../api/client'
import { PathInput } from './PathInput'

interface Props {
  onCreated: (sessionId: string) => void
}

export function NewSessionForm({ onCreated }: Props) {
  const [paths, setPaths]   = useState<string[]>(['', ''])
  const [domain, setDomain] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const updatePath = (i: number, v: string) => { const n = [...paths]; n[i] = v; setPaths(n) }
  const removePath = (i: number) => setPaths(paths.filter((_, j) => j !== i))

  const handleCreate = async () => {
    const validPaths = paths.filter(p => p.trim())
    if (validPaths.length < 2) { setError('At least 2 dataset paths are required'); return }
    setLoading(true); setError(null)
    try {
      const s = await sessionsApi.create({ source_paths: validPaths, domain_hint: domain.trim() || undefined })
      onCreated(s.id)
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="fade-in" style={{ maxWidth: 560 }}>
      <h1 style={{ marginBottom: 6 }}>New Session</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 32 }}>
        Select at least 2 YOLO or COCO dataset folders.
      </p>

      {/* Dataset paths */}
      <label style={labelStyle}>Dataset Folders</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {paths.map((p, i) => (
          <PathInput
            key={i}
            value={p}
            onChange={v => updatePath(i, v)}
            placeholder={`Dataset ${i + 1}…`}
            onRemove={paths.length > 2 ? () => removePath(i) : undefined}
          />
        ))}
      </div>
      <button className="btn btn-ghost" style={{ fontSize: 12, height: 28, marginBottom: 28 }} onClick={() => setPaths([...paths, ''])}>
        + Add dataset
      </button>

      {/* Domain hint */}
      <label style={labelStyle}>
        Domain hint <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span>
      </label>
      <input
        value={domain}
        placeholder="e.g. military vehicles, traffic, medical…"
        onChange={e => setDomain(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleCreate()}
        style={{ marginBottom: 24 }}
      />

      {error && (
        <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 16, padding: '10px 12px', border: '1px solid rgba(238,0,0,0.25)', borderRadius: 'var(--radius)', background: 'var(--red-dim)' }}>
          {error}
        </div>
      )}

      <button className="btn btn-primary" onClick={handleCreate} disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
        {loading ? 'Analyzing…' : 'Create Session'}
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-dim)',
  marginBottom: 8,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
