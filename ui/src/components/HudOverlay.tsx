import { AnnotationBox } from '../api/client'

// Military-style neon palette
export const HUD_PALETTE = [
  '#00e676', '#40c4ff', '#ff6d00', '#ea80fc',
  '#ffd740', '#69f0ae', '#ff4081', '#80d8ff',
  '#b2ff59', '#ffd180', '#ff9e80', '#b388ff',
]
export const hudColor = (classId: number) => HUD_PALETTE[classId % HUD_PALETTE.length]

export type BoxStyle = 'corners' | 'box' | 'minimal' | 'filled'

interface HudBoxProps {
  ann: AnnotationBox
  imgW: number
  imgH: number
  trackId: number
  selected?: boolean
  dimmed?: boolean
  interactive?: boolean
  boxStyle?: BoxStyle
  onClick?: (e: React.MouseEvent) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export function HudBox({ ann, imgW, imgH, trackId, selected, dimmed, interactive, boxStyle = 'corners', onClick, onMouseEnter, onMouseLeave }: HudBoxProps) {
  const color = hudColor(ann.class_id)
  const bx = (ann.cx - ann.w / 2) * imgW
  const by = (ann.cy - ann.h / 2) * imgH
  const bw = ann.w * imgW
  const bh = ann.h * imgH
  const cx = bx + bw / 2
  const cy = by + bh / 2
  const sw = selected ? 2.5 : 1.5

  const labelName = (ann.class_name ?? `class_${ann.class_id}`).toUpperCase()
  const confStr   = ann.confidence !== undefined ? ` ${Math.round(ann.confidence * 100)}%` : ''

  const groupStyle: React.CSSProperties = {
    cursor: interactive ? 'pointer' : 'default',
    opacity: dimmed ? 0.2 : 1,
    transition: 'opacity 0.12s ease',
    pointerEvents: (interactive || onMouseEnter) ? 'auto' : 'none',
  }

  // ── corners ────────────────────────────────────────────────────────────────
  if (boxStyle === 'corners') {
    const cs = Math.max(5, Math.min(bw, bh) * 0.18)
    const idStr = ann.confidence !== undefined
      ? `CONF:${Math.round(ann.confidence * 100)}%`
      : `ID:${String(trackId).padStart(3, '0')}`
    const charW = 6
    const lw = Math.max(labelName.length, idStr.length) * charW + 10
    const lh = 28
    const fitsRight = bx + bw + 5 + lw < imgW + 24
    const labelX = fitsRight ? bx + bw + 5 : bx - lw - 5
    const labelY = Math.max(0, Math.min(imgH - lh, by - 2))
    const connX  = fitsRight ? bx + bw : bx
    const connX2 = fitsRight ? labelX  : labelX + lw

    return (
      <g onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={groupStyle}>
        {selected && <rect x={bx} y={by} width={bw} height={bh} fill={`${color}20`} />}
        {/* Corner brackets */}
        <path d={`M ${bx+cs},${by} H ${bx} V ${by+cs}`}           stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
        <path d={`M ${bx+bw-cs},${by} H ${bx+bw} V ${by+cs}`}     stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
        <path d={`M ${bx},${by+bh-cs} V ${by+bh} H ${bx+cs}`}     stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
        <path d={`M ${bx+bw},${by+bh-cs} V ${by+bh} H ${bx+bw-cs}`} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="square" />
        {/* Center crosshair */}
        <circle cx={cx} cy={cy} r={5}   stroke={color} strokeWidth={0.9} fill="none" opacity={0.8} />
        <line x1={cx-10} y1={cy} x2={cx+10} y2={cy} stroke={color} strokeWidth={0.9} opacity={0.8} />
        <line x1={cx} y1={cy-10} x2={cx} y2={cy+10} stroke={color} strokeWidth={0.9} opacity={0.8} />
        {/* Connector */}
        <line x1={connX} y1={by} x2={connX2} y2={labelY}
              stroke={color} strokeWidth={0.7} opacity={0.45} strokeDasharray="4 3" />
        {/* Label box */}
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

  // ── box ────────────────────────────────────────────────────────────────────
  // Classic full-rect stroke with a label badge above the top-left corner
  if (boxStyle === 'box') {
    const charW = 7
    const badgeW = (labelName.length + confStr.length) * charW + 10
    const badgeH = 18
    // If box is near top of image, put badge below instead of above
    const badgeAbove = by >= badgeH + 2
    const badgeY = badgeAbove ? by - badgeH : by + bh + 1

    return (
      <g onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={groupStyle}>
        {selected && <rect x={bx} y={by} width={bw} height={bh} fill={`${color}18`} />}
        {/* Full rect */}
        <rect x={bx} y={by} width={bw} height={bh}
              fill="none" stroke={color} strokeWidth={sw} />
        {/* Notch on top-left corner connecting to badge */}
        <line x1={bx} y1={by} x2={bx + Math.min(badgeW, bw)} y2={by}
              stroke={color} strokeWidth={sw + 0.5} />
        {/* Label badge */}
        <rect x={bx} y={badgeY} width={badgeW} height={badgeH}
              fill="rgba(0,0,0,0.88)" stroke={color} strokeWidth={0.8} rx={1} />
        <text x={bx + 5} y={badgeY + 13}
              fill={color} fontSize={10} fontFamily="'Courier New',Consolas,monospace" fontWeight="bold">
          {labelName}{confStr}
        </text>
      </g>
    )
  }

  // ── minimal ────────────────────────────────────────────────────────────────
  // Thin outline + small colored pill in top-left, label only (no IDs or monospace)
  if (boxStyle === 'minimal') {
    const pillPad = 6
    const charW   = 6.5
    const pillW   = labelName.length * charW + pillPad * 2
    const pillH   = 15
    const pillAbove = by >= pillH + 2
    const pillY   = pillAbove ? by - pillH : by

    return (
      <g onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={groupStyle}>
        {/* Thin outline */}
        <rect x={bx} y={by} width={bw} height={bh}
              fill={selected ? `${color}10` : 'none'}
              stroke={color} strokeWidth={selected ? 1.8 : 1}
              opacity={0.75} />
        {/* Pill badge */}
        <rect x={bx} y={pillY} width={pillW} height={pillH}
              fill={color} rx={pillH / 2} />
        <text x={bx + pillPad} y={pillY + pillH - 4}
              fill="#000" fontSize={9} fontFamily="system-ui,sans-serif" fontWeight="700">
          {labelName}
        </text>
      </g>
    )
  }

  // ── filled ────────────────────────────────────────────────────────────────
  // Semi-transparent fill, solid border, rounded corners, inline label at top-left
  if (boxStyle === 'filled') {
    const tagPad  = 5
    const charW   = 6.5
    const tagW    = (labelName.length + confStr.length) * charW + tagPad * 2
    const tagH    = 17
    const tagFits = bh > tagH + 6   // enough room to put tag inside
    const tagY    = tagFits ? by + 3 : by - tagH - 1

    return (
      <g onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={groupStyle}>
        {/* Filled background */}
        <rect x={bx} y={by} width={bw} height={bh}
              fill={`${color}22`}
              stroke={color} strokeWidth={selected ? 2 : 1.5}
              rx={3} />
        {/* Inline color tag */}
        <rect x={bx + 3} y={tagY} width={Math.min(tagW, bw - 6)} height={tagH}
              fill={color} rx={2} />
        <text x={bx + 3 + tagPad} y={tagY + tagH - 4}
              fill="#000" fontSize={9} fontFamily="system-ui,sans-serif" fontWeight="700"
              style={{ letterSpacing: 0.3 }}>
          {labelName}{confStr}
        </text>
      </g>
    )
  }

  return null
}
