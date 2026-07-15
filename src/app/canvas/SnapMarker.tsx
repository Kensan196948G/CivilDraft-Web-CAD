/**
 * スナップマーカー描画。現在のスナップ種別に応じた記号（矩形・三角・×・◎・直角記号など）を
 * Konva図形で重ねて表示する。
 * 継承元: Civil-Draw src/canvas/SnapMarker.tsx（継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: src/app/canvas（プレゼンテーション層。react-konva使用）。
 *
 * 継承元との差分:
 * - SnapResult型の import を移植済み @/domain/geometry/snapEngine へ変更。
 * - props を readonly 化。COLOR テーブルを Record<Exclude<SnapType,'none'>, string> で型安全化
 *   （全スナップ種別の配色定義漏れをコンパイル時に検出）。
 * - zoom は継承元同様 props 受け（CanvasArea が EditorStore の zoom を渡す）。
 * - 各スナップ種別の形状定義・寸法係数は as_is で保全。
 */
import { Circle, Line, Rect } from 'react-konva'
import type { SnapResult, SnapType } from '@/domain/geometry/snapEngine'

interface SnapMarkerProps {
  readonly snap: SnapResult | null
  readonly zoom: number
}

const COLOR: Record<Exclude<SnapType, 'none'>, string> = {
  grid: '#60a5fa',
  endpoint: '#fbbf24',
  midpoint: '#34d399',
  center: '#a78bfa',
  perpendicular: '#f59e0b',
  tangent: '#22d3ee',
  nearest: '#86efac',
  intersection: '#f472b6',
}

export function SnapMarker({ snap, zoom }: SnapMarkerProps) {
  if (!snap || snap.type === 'none') return null

  const { x, y } = snap.point
  const size = 10 / zoom
  const color = COLOR[snap.type] ?? '#ffffff'
  const strokeWidth = 1.5 / zoom

  if (snap.type === 'endpoint' || snap.type === 'grid') {
    return (
      <Rect
        x={x - size / 2}
        y={y - size / 2}
        width={size}
        height={size}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="transparent"
        listening={false}
      />
    )
  }

  if (snap.type === 'midpoint') {
    return (
      <Line
        points={[x, y - size / 1.3, x - size / 1.3, y + size / 2, x + size / 1.3, y + size / 2]}
        closed
        stroke={color}
        strokeWidth={strokeWidth}
        fill="transparent"
        listening={false}
      />
    )
  }

  if (snap.type === 'intersection') {
    return (
      <>
        <Line
          points={[x - size / 2, y - size / 2, x + size / 2, y + size / 2]}
          stroke={color}
          strokeWidth={strokeWidth}
          listening={false}
        />
        <Line
          points={[x - size / 2, y + size / 2, x + size / 2, y - size / 2]}
          stroke={color}
          strokeWidth={strokeWidth}
          listening={false}
        />
        <Circle
          x={x}
          y={y}
          radius={size / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={false}
        />
      </>
    )
  }

  if (snap.type === 'center') {
    return (
      <>
        <Circle
          x={x}
          y={y}
          radius={size / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={false}
        />
        <Circle
          x={x}
          y={y}
          radius={size / 5}
          stroke={color}
          strokeWidth={strokeWidth}
          fill={color}
          listening={false}
        />
      </>
    )
  }

  // 直角記号: ┐ 形（縦アーム＋横アーム）＋足元のドット
  if (snap.type === 'perpendicular') {
    const arm = size * 0.48
    return (
      <>
        <Line
          points={[x - arm, y, x + arm, y]}
          stroke={color}
          strokeWidth={strokeWidth}
          listening={false}
        />
        <Line
          points={[x - arm, y, x - arm, y - size]}
          stroke={color}
          strokeWidth={strokeWidth}
          listening={false}
        />
        <Circle
          x={x}
          y={y}
          radius={size / 6}
          stroke={color}
          strokeWidth={strokeWidth}
          fill={color}
          listening={false}
        />
      </>
    )
  }

  // nearest: 砂時計/X形（図形上の最近接点）
  if (snap.type === 'nearest') {
    return (
      <Line
        points={[
          x - size / 2,
          y - size / 2,
          x + size / 2,
          y + size / 2,
          x,
          y,
          x - size / 2,
          y + size / 2,
          x + size / 2,
          y - size / 2,
        ]}
        stroke={color}
        strokeWidth={strokeWidth}
        listening={false}
      />
    )
  }

  // tangent: 小円＋水平の突起（○─）
  if (snap.type === 'tangent') {
    return (
      <>
        <Circle
          x={x}
          y={y}
          radius={size / 2.5}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          listening={false}
        />
        <Line
          points={[x + size / 2.5, y, x + size * 0.85, y]}
          stroke={color}
          strokeWidth={strokeWidth}
          listening={false}
        />
      </>
    )
  }

  return null
}
