import { useEffect, useState } from 'react'
import { sessionsApi, DatasetStats, SourceStat } from '../api/client'
import { hudColor } from './HudOverlay'

interface Props {
  sessionId: string
  classNames: string[]
}

export function DatasetStatsPanel({ sessionId, classNames }: Props) {
  const [stats, setStats] = useState<DatasetStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    sessionsApi.stats(sessionId)
      .then(setStats)
      .catch(e => setError(e.response?.data?.detail ?? e.message))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading stats…
    </div>
  )

  if (error) return (
    <div style={{ padding: 16, color: 'var(--red)', fontSize: 13,
                  background: 'rgba(238,0,0,0.06)', borderRadius: 8,
                  border: '1px solid rgba(238,0,0,0.2)' }}>
      ✗ {error}
    </div>
  )

  if (!stats) return null

  const sortedClasses = Object.entries(stats.class_counts).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(1, ...sortedClasses.map(([, c]) => c))
  const avgPerImage = stats.total_images > 0
    ? (stats.total_labels / stats.total_images).toFixed(1) : '0'

  const SectionTitle = ({ label }: { label: string }) => (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text-muted)', marginBottom: 12, paddingBottom: 6,
      borderBottom: '1px solid var(--border)',
    }}>{label}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Summary cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { label: 'Total images',      value: stats.total_images.toLocaleString() },
          { label: 'Total annotations', value: stats.total_labels.toLocaleString() },
          { label: 'Avg / image',       value: avgPerImage },
          { label: 'Classes',           value: classNames.length },
          { label: 'Sources',           value: stats.source_stats.length },
        ].map(({ label, value }) => (
          <div key={label} style={{
            flex: '1 1 110px', padding: '12px 16px', borderRadius: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* ── Class distribution ── */}
      <div>
        <SectionTitle label="Class distribution" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {sortedClasses.map(([name, count]) => {
            const colorIdx = classNames.indexOf(name)
            const color = hudColor(colorIdx >= 0 ? colorIdx : 0)
            const pct = count / maxCount * 100
            return (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span title={name} style={{
                  width: 140, fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {name}
                </span>
                <div style={{
                  flex: 1, height: 20, background: 'var(--surface2)',
                  borderRadius: 4, overflow: 'hidden', position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute', inset: 0, width: `${pct}%`,
                    background: color + 'bb', borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }} />
                  <span style={{
                    position: 'absolute', left: 8, top: 0, bottom: 0,
                    display: 'flex', alignItems: 'center',
                    fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 600,
                    color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)', zIndex: 1,
                  }}>
                    {count.toLocaleString()}
                  </span>
                </div>
                <span style={{
                  fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)',
                  width: 40, textAlign: 'right', flexShrink: 0,
                }}>
                  {maxCount > 0 ? Math.round(count / maxCount * 100) : 0}%
                </span>
              </div>
            )
          })}
          {sortedClasses.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No labels found. Make sure LLM analysis is done.
            </span>
          )}
        </div>
      </div>

      {/* ── Source breakdown ── */}
      <div>
        <SectionTitle label="Source breakdown" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)',
            padding: '7px 14px', background: 'var(--surface2)',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            <span>Source</span>
            <span style={{ textAlign: 'right' }}>Images</span>
            <span style={{ textAlign: 'right' }}>Labels</span>
            <span style={{ textAlign: 'right' }}>Avg</span>
          </div>
          {stats.source_stats.map((src: SourceStat, i: number) => (
            <div key={src.name} style={{
              display: 'grid', gridTemplateColumns: '1fr repeat(3, 80px)',
              padding: '9px 14px', fontSize: 12,
              background: i % 2 === 0 ? 'var(--surface)' : 'transparent',
              borderTop: '1px solid var(--border)',
            }}>
              <span style={{
                fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{src.name}</span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                {src.image_count.toLocaleString()}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                {src.label_count.toLocaleString()}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--accent)' }}>
                {src.image_count > 0 ? (src.label_count / src.image_count).toFixed(1) : '0'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Per-source class breakdown (only if >1 source) ── */}
      {stats.source_stats.length > 1 && (
        <div>
          <SectionTitle label="Per-source class counts" />
          <div style={{
            overflowX: 'auto',
            border: '1px solid var(--border)', borderRadius: 8,
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ textAlign: 'left', padding: '7px 12px', fontWeight: 600, fontSize: 10,
                               letterSpacing: '0.06em', textTransform: 'uppercase',
                               color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    Class
                  </th>
                  {stats.source_stats.map(src => (
                    <th key={src.name} style={{
                      textAlign: 'right', padding: '7px 12px', fontWeight: 600, fontSize: 10,
                      letterSpacing: '0.06em', textTransform: 'uppercase',
                      color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
                      maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {src.name}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', padding: '7px 12px', fontWeight: 700, fontSize: 10,
                               letterSpacing: '0.06em', textTransform: 'uppercase',
                               color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedClasses.map(([name, total], rowIdx) => {
                  const colorIdx = classNames.indexOf(name)
                  const color = hudColor(colorIdx >= 0 ? colorIdx : 0)
                  return (
                    <tr key={name} style={{ background: rowIdx % 2 === 0 ? 'var(--surface)' : 'transparent' }}>
                      <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                                         overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                         maxWidth: 180 }}>
                            {name}
                          </span>
                        </span>
                      </td>
                      {stats.source_stats.map(src => (
                        <td key={src.name} style={{
                          textAlign: 'right', padding: '7px 12px',
                          fontFamily: 'var(--mono)', color: 'var(--text-dim)',
                          borderTop: '1px solid var(--border)',
                        }}>
                          {(src.class_counts[name] ?? 0).toLocaleString()}
                        </td>
                      ))}
                      <td style={{
                        textAlign: 'right', padding: '7px 12px',
                        fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)',
                        borderTop: '1px solid var(--border)',
                      }}>
                        {total.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
