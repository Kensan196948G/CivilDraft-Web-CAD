/**
 * デモ図面コンテンツの SVG プレビュー。
 *
 * CAD エディタを開かずに、案件詳細の図面詳細でサンプル2Dデータを
 * その場で確認するための軽量レンダラ。図形種別の主要なものを
 * 概略表示する（寸法精度は CAD エディタ側が正）。
 */
import type { CSSProperties, ReactElement } from 'react'
import type { Geometry, Point } from '@/shared/types'
import type { DemoDrawingContent } from './demoDrawingContents'

export interface DemoDrawingPreviewProps {
  readonly content: DemoDrawingContent
  readonly height?: number
  /** アクセシブルネーム（role="img" 用）。 */
  readonly ariaLabel?: string
}

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function includePoint(bounds: Bounds | null, point: Point): Bounds {
  if (bounds === null) {
    return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }
}

function geometryBounds(geometry: Geometry): Bounds | null {
  let bounds: Bounds | null = null
  switch (geometry.type) {
    case 'line':
      bounds = includePoint(bounds, geometry.start)
      return includePoint(bounds, geometry.end)
    case 'rectangle':
      bounds = includePoint(bounds, geometry.origin)
      return includePoint(bounds, {
        x: geometry.origin.x + geometry.width,
        y: geometry.origin.y + geometry.height,
      })
    case 'circle':
      bounds = includePoint(bounds, { x: geometry.center.x - geometry.radius, y: geometry.center.y - geometry.radius })
      return includePoint(bounds, { x: geometry.center.x + geometry.radius, y: geometry.center.y + geometry.radius })
    case 'arc':
      bounds = includePoint(bounds, { x: geometry.center.x - geometry.radius, y: geometry.center.y - geometry.radius })
      return includePoint(bounds, { x: geometry.center.x + geometry.radius, y: geometry.center.y + geometry.radius })
    case 'ellipse':
      bounds = includePoint(bounds, { x: geometry.center.x - geometry.radiusX, y: geometry.center.y - geometry.radiusY })
      return includePoint(bounds, { x: geometry.center.x + geometry.radiusX, y: geometry.center.y + geometry.radiusY })
    case 'polyline':
    case 'spline':
      for (const point of geometry.points) bounds = includePoint(bounds, point)
      return bounds
    case 'mline':
      bounds = includePoint(bounds, geometry.start)
      bounds = includePoint(bounds, geometry.end)
      bounds = includePoint(bounds, { x: geometry.start.x + geometry.offset, y: geometry.start.y + geometry.offset })
      return includePoint(bounds, { x: geometry.end.x + geometry.offset, y: geometry.end.y + geometry.offset })
    case 'hatch':
      for (const point of geometry.boundaryPoints) bounds = includePoint(bounds, point)
      return bounds
    case 'text':
      return includePoint(bounds, geometry.anchor)
    case 'dimension':
      bounds = includePoint(bounds, geometry.start)
      return includePoint(bounds, geometry.end)
    case 'leader':
      bounds = includePoint(bounds, geometry.start)
      return includePoint(bounds, geometry.end)
    case 'cloud':
      bounds = includePoint(bounds, { x: geometry.x1, y: geometry.y1 })
      return includePoint(bounds, { x: geometry.x2, y: geometry.y2 })
    case 'symbol':
      return includePoint(bounds, geometry.position)
    case 'parametricObject':
      return bounds
  }
}

function dashFor(lineType: string): string | undefined {
  if (lineType === 'dashed') return '14 10'
  if (lineType === 'dashDot') return '18 8 4 8'
  return undefined
}

function renderShape(geometry: Geometry, displayWidth: number): ReactElement | null {
  const stroke = geometry.style.strokeColor
  const strokeWidth = Math.max(displayWidth / 700, 1)
  const dash = dashFor(geometry.style.lineType)
  const common = { stroke, strokeWidth, fill: 'none', strokeDasharray: dash } as const
  switch (geometry.type) {
    case 'line':
      return <line x1={geometry.start.x} y1={geometry.start.y} x2={geometry.end.x} y2={geometry.end.y} {...common} />
    case 'rectangle':
      return <rect x={geometry.origin.x} y={geometry.origin.y} width={geometry.width} height={geometry.height} {...common} fill={geometry.style.fillColor ?? 'none'} />
    case 'circle':
      return <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} {...common} fill={geometry.style.fillColor ?? 'none'} />
    case 'arc':
      return <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} {...common} />
    case 'ellipse':
      return <ellipse cx={geometry.center.x} cy={geometry.center.y} rx={geometry.radiusX} ry={geometry.radiusY} {...common} fill={geometry.style.fillColor ?? 'none'} />
    case 'polyline':
    case 'spline':
      return <polyline points={geometry.points.map((p) => `${p.x},${p.y}`).join(' ')} {...common} />
    case 'mline': {
      const dx = geometry.end.x - geometry.start.x
      const dy = geometry.end.y - geometry.start.y
      const length = Math.hypot(dx, dy) || 1
      const px = (-dy / length) * geometry.offset
      const py = (dx / length) * geometry.offset
      return (
        <>
          <line x1={geometry.start.x + px} y1={geometry.start.y + py} x2={geometry.end.x + px} y2={geometry.end.y + py} {...common} />
          <line x1={geometry.start.x - px} y1={geometry.start.y - py} x2={geometry.end.x - px} y2={geometry.end.y - py} {...common} />
        </>
      )
    }
    case 'hatch':
      return <polygon points={geometry.boundaryPoints.map((p) => `${p.x},${p.y}`).join(' ')} stroke={stroke} strokeWidth={strokeWidth} fill={stroke} fillOpacity={0.08} />
    case 'text': {
      const fontSize = displayWidth / 42
      return <text x={geometry.anchor.x} y={geometry.anchor.y} fontSize={fontSize} fill={stroke} style={{ fontFamily: "'IBM Plex Sans JP', sans-serif" }}>{geometry.text}</text>
    }
    case 'dimension': {
      const dx = geometry.end.x - geometry.start.x
      const dy = geometry.end.y - geometry.start.y
      const distanceM = (Math.hypot(dx, dy) / 1000).toFixed(1)
      const midX = (geometry.start.x + geometry.end.x) / 2
      const midY = (geometry.start.y + geometry.end.y) / 2 + geometry.offset
      return (
        <>
          <line x1={geometry.start.x} y1={geometry.start.y} x2={geometry.end.x} y2={geometry.end.y} {...common} />
          <text x={midX} y={midY} fontSize={displayWidth / 50} fill={stroke}>{distanceM}m</text>
        </>
      )
    }
    case 'leader':
      return (
        <>
          <line x1={geometry.start.x} y1={geometry.start.y} x2={geometry.end.x} y2={geometry.end.y} {...common} />
          <text x={geometry.end.x} y={geometry.end.y} fontSize={displayWidth / 50} fill={stroke}>{geometry.text}</text>
        </>
      )
    case 'cloud':
      return <rect x={geometry.x1} y={geometry.y1} width={geometry.x2 - geometry.x1} height={geometry.y2 - geometry.y1} {...common} strokeDasharray="10 8" />
    case 'symbol':
      return <circle cx={geometry.position.x} cy={geometry.position.y} r={displayWidth / 90} fill={stroke} stroke="none" />
    case 'parametricObject':
      return null
  }
}

export function DemoDrawingPreview({
  content,
  height = 260,
  ariaLabel,
}: DemoDrawingPreviewProps) {
  let bounds: Bounds | null = null
  for (const geometry of content.geometries) {
    const next = geometryBounds(geometry)
    if (next === null) continue
    bounds =
      bounds === null
        ? next
        : {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
          }
  }
  if (bounds === null) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
        図形データがありません（CAD編集で新規作図できます）
      </div>
    )
  }
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 0.04
  const viewX = bounds.minX - pad
  const viewY = bounds.minY - pad
  const viewWidth = bounds.maxX - bounds.minX + pad * 2
  const viewHeight = bounds.maxY - bounds.minY + pad * 2
  const style: CSSProperties = { width: '100%', height, display: 'block', background: '#FAFBFC' }
  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? 'サンプル2Dデータのプレビュー'}
      viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
    >
      {content.geometries.map((geometry) => (
        <g key={geometry.id}>{renderShape(geometry, Math.max(viewWidth, viewHeight))}</g>
      ))}
    </svg>
  )
}
