import { useDraggable } from '@dnd-kit/core'

interface Props {
  alias: string
  fromClassId: number | null  // null = unassigned pool
  confidence?: number
  onRemove?: () => void
  disabled?: boolean
}

export function AliasChip({ alias, fromClassId, confidence = 1, onRemove, disabled }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alias::${fromClassId ?? 'pool'}::${alias}`,
    data: { alias, fromClassId },
    disabled,
  })

  const isLowConf = confidence < 0.7
  const chipClass = [
    'chip',
    isLowConf ? 'chip-low-confidence' : 'chip-default',
    isDragging ? 'chip-dragging' : '',
  ].join(' ')

  return (
    <span
      ref={setNodeRef}
      className={chipClass}
      title={isLowConf ? `Low confidence (${(confidence * 100).toFixed(0)}%)` : alias}
      {...listeners}
      {...attributes}
    >
      {isLowConf && <span style={{ fontSize: 11 }}>⚠</span>}
      {alias}
      {onRemove && !disabled && (
        <button
          className="chip-remove"
          onClick={e => { e.stopPropagation(); onRemove() }}
          title="Remove alias"
        >
          ×
        </button>
      )}
    </span>
  )
}
