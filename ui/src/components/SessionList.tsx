import { HarmonizationSession } from '../api/client'

interface Props {
  sessions: HarmonizationSession[]
  onSelect: (id: string) => void
  onNew: () => void
}

const STATUS: Record<string, { dot: string; label: string }> = {
  pending:   { dot: '#f5a623', label: 'Pending' },
  reviewing: { dot: '#0070f3', label: 'Reviewing' },
  confirmed: { dot: '#50e3c2', label: 'Confirmed' },
  exported:  { dot: '#444',    label: 'Exported' },
}

export function SessionList({ sessions, onSelect, onNew }: Props) {
  return (
    <div className="fade-in">
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>Sessions</h1>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            Harmonize multiple YOLO / COCO datasets into a single unified export.
          </p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>New Session</button>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

        {/* Header row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr 120px 100px 100px',
          padding: '0 16px',
          height: 36,
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}>
          {['Session', 'Sources', 'Images', 'Classes', 'Status'].map(col => (
            <span key={col} style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {col}
            </span>
          ))}
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
            No sessions yet —{' '}
            <button onClick={onNew} style={{ background: 'none', color: 'var(--accent)', fontSize: 13, padding: 0, height: 'auto', textDecoration: 'underline' }}>
              create one
            </button>
          </div>
        ) : (
          sessions.map((s, i) => {
            const st = STATUS[s.status] ?? STATUS.pending
            const totalImages = s.sources.reduce((n, src) => n + src.image_count, 0)
            return (
              <div
                key={s.id}
                onClick={() => onSelect(s.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr 120px 100px 100px',
                  padding: '0 16px',
                  height: 52,
                  alignItems: 'center',
                  borderBottom: i < sessions.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Session ID */}
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                  {s.id.slice(0, 8)}
                  <span style={{ color: 'var(--text-muted)' }}>…</span>
                </span>

                {/* Sources */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflow: 'hidden' }}>
                  {s.sources.map(src => (
                    <span key={src.name} style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      color: 'var(--text-dim)',
                      background: 'var(--surface2)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 160,
                    }}>
                      {src.name}
                    </span>
                  ))}
                </div>

                {/* Images */}
                <span style={{ fontSize: 13, color: 'var(--text)' }}>
                  {totalImages.toLocaleString()}
                </span>

                {/* Classes */}
                <span style={{ fontSize: 13, color: 'var(--text)' }}>
                  {s.canonical_classes.length}
                </span>

                {/* Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className="status-dot" style={{ background: st.dot }} />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{st.label}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
