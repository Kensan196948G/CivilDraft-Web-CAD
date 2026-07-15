/**
 * ルーラー（定規）UI。水平・垂直の目盛りをSVGで描画し、左上にコーナー矩形を置く。
 * 継承元: Civil-Draw src/canvas/Ruler.tsx（継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: src/app/canvas（プレゼンテーション層）。目盛り値の算出は移植済み
 * domain/canvas/rulerUtils.ts へ委譲する（§9.2: 描画側で独自変換式を書かない）。
 *
 * 継承元との差分:
 * - rulerUtils の import パスを @/domain/canvas/rulerUtils へ変更。
 * - props / rulerStyle を readonly / CSSProperties 明示 import（verbatimModuleSyntax対応）に。
 * - 継承元は store 非依存の props 駆動。zoom/pan/width/height は CanvasArea（Issue #6）が
 *   EditorStore を購読して渡す設計を踏襲する（本コンポーネントは store を直接参照しない）。
 * - SVG目盛り・ラベル・垂直ラベルの回転描画は as_is で保全。
 */
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { calcHorizontalTicks, calcVerticalTicks, formatTickValue } from '@/domain/canvas/rulerUtils'

export const RULER_SIZE = 24

interface RulerProps {
  readonly zoom: number
  readonly panX: number
  readonly panY: number
  readonly width: number
  readonly height: number
}

export function Ruler({ zoom, panX, panY, width, height }: RulerProps) {
  const hTicks = useMemo(() => calcHorizontalTicks(panX, zoom, width), [panX, zoom, width])
  const vTicks = useMemo(() => calcVerticalTicks(panY, zoom, height), [panY, zoom, height])

  const rulerStyle: CSSProperties = {
    background: 'var(--bg-toolbar)',
    position: 'absolute',
    zIndex: 10,
    pointerEvents: 'none',
    overflow: 'hidden',
  }

  return (
    <>
      {/* 水平ルーラー */}
      <div
        data-testid="ruler-horizontal"
        style={{
          ...rulerStyle,
          top: 0,
          left: RULER_SIZE,
          right: 0,
          height: RULER_SIZE,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <svg width="100%" height={RULER_SIZE} overflow="hidden">
          {hTicks.map((t) => {
            const x = t.pos - RULER_SIZE
            return (
              <g key={t.pos}>
                <line
                  x1={x}
                  y1={RULER_SIZE - 5}
                  x2={x}
                  y2={RULER_SIZE}
                  stroke="var(--text-muted)"
                  strokeWidth={0.5}
                />
                <text
                  x={x + 2}
                  y={RULER_SIZE - 7}
                  fill="var(--text-muted)"
                  fontSize={8}
                  fontFamily="var(--font-mono, monospace)"
                >
                  {formatTickValue(t.value)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* 垂直ルーラー */}
      <div
        data-testid="ruler-vertical"
        style={{
          ...rulerStyle,
          top: RULER_SIZE,
          left: 0,
          bottom: 0,
          width: RULER_SIZE,
          borderLeft: '1px solid var(--border)',
          borderRight: '1px solid var(--border)',
        }}
      >
        <svg width={RULER_SIZE} height="100%" overflow="hidden">
          {vTicks.map((t) => {
            const y = t.pos - RULER_SIZE
            const cx = RULER_SIZE / 2
            return (
              <g key={t.pos}>
                <line
                  x1={RULER_SIZE - 5}
                  y1={y}
                  x2={RULER_SIZE}
                  y2={y}
                  stroke="var(--text-muted)"
                  strokeWidth={0.5}
                />
                <text
                  x={cx}
                  y={y - 2}
                  fill="var(--text-muted)"
                  fontSize={8}
                  fontFamily="var(--font-mono, monospace)"
                  textAnchor="middle"
                  transform={`rotate(-90 ${cx} ${y - 2})`}
                >
                  {formatTickValue(t.value)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* コーナー矩形 */}
      <div
        style={{
          ...rulerStyle,
          top: 0,
          left: 0,
          width: RULER_SIZE,
          height: RULER_SIZE,
          borderLeft: '1px solid var(--border)',
          borderRight: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          zIndex: 11,
        }}
      />
    </>
  )
}
