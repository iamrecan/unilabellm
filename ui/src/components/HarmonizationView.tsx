import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useState, useCallback } from 'react'
import { CanonicalClass, DatasetSource } from '../api/client'
import { AliasChip } from './AliasChip'
import { CanonicalClassCard } from './CanonicalClassCard'
import { DatasetStatsPanel } from './DatasetStats'

interface Props {
  sessionId: string
  sources: DatasetSource[]
  classes: CanonicalClass[]
  onChange: (classes: CanonicalClass[]) => void
  onConfirm: () => void
  confirming: boolean
  readOnly?: boolean
}

export function HarmonizationView({ sessionId, classes, onChange, onConfirm, confirming, readOnly }: Props) {
  const [activeAlias, setActiveAlias] = useState<string | null>(null)
  const [newClassName, setNewClassName] = useState('')
  const [viewTab, setViewTab] = useState<'classes' | 'stats'>('classes')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const confidenceMap: Record<string, number> = {}
  classes.forEach(cc => { cc.aliases.forEach(a => { confidenceMap[a] = cc.confidence }) })

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveAlias((e.active.data.current as any)?.alias ?? null)
  }, [])

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveAlias(null)
    const { active, over } = e
    if (!over || !String(over.id).startsWith('class::')) return
    const { alias, fromClassId } = active.data.current as { alias: string; fromClassId: number | null }
    const toClassId = parseInt(String(over.id).replace('class::', ''), 10)
    if (fromClassId === toClassId) return
    onChange(classes.map(cc => {
      if (cc.id === fromClassId) return { ...cc, aliases: cc.aliases.filter(a => a !== alias) }
      if (cc.id === toClassId)   return cc.aliases.includes(alias) ? cc : { ...cc, aliases: [...cc.aliases, alias] }
      return cc
    }))
  }, [classes, onChange])

  const handleRename      = useCallback((id: number, name: string) => onChange(classes.map(cc => cc.id === id ? { ...cc, name } : cc)), [classes, onChange])
  const handleRemoveAlias = useCallback((id: number, alias: string) => onChange(classes.map(cc => cc.id === id ? { ...cc, aliases: cc.aliases.filter(a => a !== alias) } : cc)), [classes, onChange])
  const handleRemoveClass = useCallback((id: number) => onChange(classes.filter(cc => cc.id !== id)), [classes, onChange])

  const handleAddClass = () => {
    const name = newClassName.trim()
    if (!name) return
    const nextId = Math.max(...classes.map(c => c.id), -1) + 1
    onChange([...classes, { id: nextId, name, aliases: [], source_map: {}, confidence: 1 }])
    setNewClassName('')
  }

  const emptyClasses = classes.filter(cc => cc.aliases.length === 0)

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Canonical Classes</h2>
            <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Drag aliases between classes · Double-click a name to rename
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Tab switcher */}
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['classes', 'stats'] as const).map((tab, i, arr) => (
                <button key={tab} onClick={() => setViewTab(tab)} style={{
                  padding: '0 14px', fontSize: 12, height: 30, borderRadius: 0,
                  background: viewTab === tab ? 'var(--surface2)' : 'transparent',
                  color: viewTab === tab ? 'var(--text)' : 'var(--text-dim)',
                  borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  {tab === 'classes' ? 'Classes' : '◫ Stats'}
                </button>
              ))}
            </div>
            {/* Confirm button — only in Classes tab */}
            {!readOnly && viewTab === 'classes' && (
              <button
                className="btn btn-primary"
                onClick={onConfirm}
                disabled={confirming || classes.length === 0}
              >
                {confirming ? 'Saving…' : 'Confirm & Save'}
              </button>
            )}
          </div>
        </div>

        {viewTab === 'stats' ? (
          <DatasetStatsPanel sessionId={sessionId} classNames={classes.map(c => c.name)} />
        ) : (
          <>
            {/* Warning for empty classes */}
            {!readOnly && emptyClasses.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 12, padding: '8px 12px', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 'var(--radius)', background: 'var(--yellow-dim)' }}>
                {emptyClasses.length} class{emptyClasses.length > 1 ? 'es have' : ' has'} no aliases:{' '}
                {emptyClasses.map(c => c.name).join(', ')}
              </div>
            )}

            {/* Class cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {classes.map(cc => (
                <CanonicalClassCard
                  key={cc.id}
                  cc={cc}
                  onRename={handleRename}
                  onRemoveAlias={handleRemoveAlias}
                  onRemoveClass={handleRemoveClass}
                  confidenceMap={confidenceMap}
                  readOnly={readOnly}
                />
              ))}
            </div>

            {/* Add class */}
            {!readOnly && (
              <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <input
                  placeholder="New class name…"
                  value={newClassName}
                  onChange={e => setNewClassName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddClass()}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-ghost" onClick={handleAddClass} style={{ flexShrink: 0 }}>
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <DragOverlay>
        {activeAlias && <AliasChip alias={activeAlias} fromClassId={null} />}
      </DragOverlay>
    </DndContext>
  )
}
