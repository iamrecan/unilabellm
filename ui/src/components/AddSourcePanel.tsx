import { useState } from 'react'
import { sessionsApi, HarmonizationSession } from '../api/client'
import { PathInput } from './PathInput'

interface Props {
  sessionId: string
  onAdded: (session: HarmonizationSession) => void
}

export function AddSourcePanel({ sessionId, onAdded }: Props) {
  const [open, setOpen]       = useState(false)
  const [paths, setPaths]     = useState<string[]>([''])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const updatePath = (i: number, v: string) => { const n = [...paths]; n[i] = v; setPaths(n) }
  const removePath = (i: number) => setPaths(paths.filter((_, j) => j !== i))

  const handleAdd = async () => {
    const valid = paths.filter(p => p.trim())
    if (!valid.length) return
    setLoading(true)
    setError(null)
    try {
      const updated = await sessionsApi.addSource(sessionId, valid)
      onAdded(updated)
      setOpen(false)
      setPaths([''])
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = () => { setOpen(false); setPaths(['']); setError(null) }

  if (!open) return (
    <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen(true)}
        style={{ width: '100%', justifyContent: 'center', fontSize: 12, height: 28 }}
      >
        + Add dataset
      </button>
    </div>
  )

  return (
    <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
        Add Datasets
      </div>

      {paths.map((p, i) => (
        <PathInput
          key={i}
          value={p}
          onChange={v => updatePath(i, v)}
          placeholder={`Dataset ${i + 1}…`}
          onRemove={paths.length > 1 ? () => removePath(i) : undefined}
        />
      ))}

      <button
        className="btn btn-ghost"
        onClick={() => setPaths([...paths, ''])}
        style={{ fontSize: 12, height: 26, alignSelf: 'flex-start' }}
      >
        + Add another
      </button>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--red)', padding: '6px 8px', border: '1px solid rgba(238,0,0,0.2)', borderRadius: 'var(--radius)', background: 'var(--red-dim)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={loading || !paths.some(p => p.trim())}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {loading ? 'Analyzing…' : 'Add & Re-analyze'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleCancel}
          disabled={loading}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
