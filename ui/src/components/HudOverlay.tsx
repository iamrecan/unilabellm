import { AnnotationBox } from '../api/client'

// Military-style neon palette
export const HUD_PALETTE = [
  '#00e676', '#40c4ff', '#ff6d00', '#ea80fc',
  '#ffd740', '#69f0ae', '#ff4081', '#80d8ff',
  '#b2ff59', '#ffd180', '#ff9e80', '#b388ff',
]
export const hudColor = (classId: number) => HUD_PALETTE[classId % HUD_PALETTE.length]

interface HudBoxProps {
  ann: AnnotationBox
  imgW: number
  imgH: number
  trackId: number
  selected?: boolean
  dimmed?: boolean
  interactive?: boolean
  onClick?: (e: React.MouseEvent) => void
}

export function HudBox({ ann, imgW, imgH, trackId, selected, dimmed, interactive, onClick }: HudBoxProps) {
  const color = hudColor(ann.class_id)
  const bx = (ann.cx - ann.w / 2) * imgW
  const by = (ann.cy - ann.h / 2) * imgH
  const bw = ann.w * imgW
  const bh = ann.h * imgH
  const cx = bx + bw / 2
  const cy = by + bh / 2
  const cs = Math.max(5, Math.min(bw, bh) * 0.18)
  const sw = selected ? 2.5 : 1.5

  const labelName = (ann.class_name ?? `class_${ann.class_id}`).toUpperCase()
  const confStr   = ann.confidence !== undefined ? ` ${Math.round(ann.confidence * 100)}%` : ''
  const idStr     = ann.confidence !== undefined
    ? `CONF:${Math.round(ann.confidence * 100)}%`
    : `ID:${String(trackId).padStart(3, '0')}`
  const charW = 6
  const lw = Math.max(labelName.length, idStr.length) * charW + 10
  const lh = 28

  // Place label right of box; fall back to left if it overflows
  const fitsRight = bx + bw + 5 + lw < imgW + 24
  const labelX = fitsRight ? bx + bw + 5 : bx - lw - 5
  const labelY = Math.max(0, Math.min(imgH - lh, by - 2))
  const connX  = fitsRight ? bx + bw : bx
  const connX2 = fitsRight ? labelX  : labelX + lw

  return (
    <g
      onClick={onClick}
      style={{
        cursor: interactive ? 'pointer' : 'default',
        opacity: dimmed ? 0.28 : 1,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    >
      {/* Selection tint */}
      {selected && (
        <rect x={bx} y={by} width={bw} height={bh} fill={`${color}20`} />
      )}

      {/* ── Corner brackets ── */}
      <path d={`M ${bx+cs},${by} H ${bx} V ${by+cs}`}           stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
      <path d={`M ${bx+bw-cs},${by} H ${bx+bw} V ${by+cs}`}     stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
      <path d={`M ${bx},${by+bh-cs} V ${by+bh} H ${bx+cs}`}     stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
      <path d={`M ${bx+bw},${by+bh-cs} V ${by+bh} H ${bx+bw-cs}`} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />

      {/* ── Center crosshair ── */}
      <circle cx={cx} cy={cy} r={5}   stroke={color} strokeWidth={0.9} fill="none" opacity={0.8} />
      <line x1={cx-10} y1={cy} x2={cx+10} y2={cy} stroke={color} strokeWidth={0.9} opacity={0.8} />
      <line x1={cx} y1={cy-10} x2={cx} y2={cy+10} stroke={color} strokeWidth={0.9} opacity={0.8} />

      {/* ── Connector dashes ── */}
      <line x1={connX} y1={by} x2={connX2} y2={labelY}
            stroke={color} strokeWidth={0.7} opacity={0.45} strokeDasharray="4 3" />

      {/* ── Label box ── */}
      <rect x={labelX} y={labelY} width={lw} height={lh}
            fill="rgba(0,0,0,0.88)" stroke={color} strokeWidth={0.8} rx={1} />
      <text x={labelX+4} y={labelY+10}
            fill={color} fontSize={8} fontFamily="'Courier New',Consolas,monospace" fontWeight="bold" letterSpacing={0.4}>
        {idStr}
      </text>
      <text x={labelX+4} y={labelY+22}
            fill={color} fontSize={9} fontFamily="'Courier New',Consolas,monospace" letterSpacing={0.3}>
        {labelName}
      </text>
    </g>
  )
}
