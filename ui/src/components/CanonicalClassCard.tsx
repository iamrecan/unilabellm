import { useDroppable } from '@dnd-kit/core'
import { useState } from 'react'
import { CanonicalClass } from '../api/client'
import { AliasChip } from './AliasChip'

interface Props {
  cc: CanonicalClass
  onRename: (id: number, name: string) => void
  onRemoveAlias: (classId: number, alias: string) => void
  onRemoveClass: (id: number) => void
  confidenceMap: Record<string, number>
  readOnly?: boolean
}

function confColor(v: number) {
  if (v < 0.5) return 'var(--red)'
  if (v < 0.7) return 'var(--yellow)'
  return 'var(--green)'
}

export function CanonicalClassCard({ cc, onRename, onRemoveAlias, onRemoveClass, confidenceMap, readOnly }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `class::${cc.id}` })
  const [editing, setEditing]   = useState(false)
  const [nameInput, setNameInput] = useState(cc.name)

  const submit = () => {
    const t = nameInput.trim()
    if (t && t !== cc.name) onRename(cc.id, t)
    setEditing(false)
  }

  const borderColor = isOver ? 'var(--text)' : cc.confidence < 0.5 ? 'rgba(238,0,0,0.4)' : cc.confidence < 0.7 ? 'rgba(245,166,35,0.35)' : 'var(--border)'

  return (
    <div
      ref={setNodeRef}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 'var(--radius)',
        padding: '12px 14px',
        background: isOver ? 'var(--surface)' : 'transparent',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Row 1: id · name · confidence · count · remove */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 24 }}>
          {cc.id}
        </span>

        {editing && !readOnly ? (
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={submit}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setEditing(false) }}
            autoFocus
            style={{ flex: 1, fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 13, height: 28 }}
          />
        ) : (
          <span
            onDoubleClick={() => !readOnly && setEditing(true)}
            title={readOnly ? '' : 'Double-click to rename'}
            style={{ flex: 1, fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 13, cursor: readOnly ? 'default' : 'text', color: 'var(--text)' }}
          >
            {cc.name}
          </span>
        )}

        {/* Confidence */}
        <span style={{ fontSize: 11, color: confColor(cc.confidence), fontFamily: 'var(--mono)' }}>
          {Math.round(cc.confidence * 100)}%
        </span>

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {cc.aliases.length} aliases
        </span>

        {!readOnly && (
          <button
            onClick={() => onRemoveClass(cc.id)}
            style={{ background: 'none', color: 'var(--text-muted)', fontSize: 16, padding: '0 2px', height: 'auto', lineHeight: 1 }}
            title="Remove class"
          >
            ×
          </button>
        )}
      </div>

      {/* Row 2: alias chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minHeight: 26 }}>
        {cc.aliases.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Drop aliases here…</span>
        )}
        {cc.aliases.map(alias => (
          <AliasChip
            key={alias}
            alias={alias}
            fromClassId={cc.id}
            confidence={confidenceMap[alias] ?? 1}
            onRemove={readOnly ? undefined : () => onRemoveAlias(cc.id, alias)}
            disabled={readOnly}
          />
        ))}
      </div>
    </div>
  )
}
