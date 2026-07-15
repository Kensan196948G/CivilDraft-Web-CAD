import { describe, expect, it } from 'vitest'
import {
  clipSegmentToPolygon,
  generateHatchLines,
  pointInPolygon,
  type HatchLine,
} from '@/domain/geometry/hatchGenerator'
import type {
  GeometryBase,
  GeometryId,
  GeometryStyle,
  HatchGeometry,
  HatchPattern,
  LayerId,
  Point,
} from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'layer-1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

function id(v: string): GeometryId {
  return v as GeometryId
}

function hatch(
  boundaryPoints: readonly Point[],
  pattern: HatchPattern,
  angleDeg: number,
  spacing: number,
): HatchGeometry {
  return { ...base, id: id('h1'), type: 'hatch', boundaryPoints, pattern, angleDeg, spacing }
}

/** 10x10 軸平行正方形 (0,0)-(10,10)。 */
const square: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

/**
 * 上辺中央に切り欠きを持つ凹ポリゴン（左右2本の柱）。
 * x∈[0,4]の左柱・x∈[6,10]の右柱が高さ10、中央x∈[4,6]は高さ4までで凹んでいる。
 */
const concave: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 6, y: 10 },
  { x: 6, y: 4 },
  { x: 4, y: 4 },
  { x: 4, y: 10 },
  { x: 0, y: 10 },
]

function midpoint(l: HatchLine): Point {
  return { x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 }
}

describe('pointInPolygon', () => {
  it('正方形の内側の点はtrue', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  it('正方形の外側の点はfalse', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false)
  })

  it('辺上の点はray-castingの向きに依存する（左辺included・右辺excluded）', () => {
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 10, y: 5 }, square)).toBe(false)
  })

  it('凹ポリゴンの切り欠き部（凹部）の点はfalse', () => {
    // (5,8) は上辺中央の切り欠き内（y=4より上、x∈[4,6]）で外側
    expect(pointInPolygon({ x: 5, y: 8 }, concave)).toBe(false)
  })

  it('凹ポリゴンの実体部（左柱・右柱・下部）の点はtrue', () => {
    expect(pointInPolygon({ x: 2, y: 8 }, concave)).toBe(true) // 左柱
    expect(pointInPolygon({ x: 8, y: 8 }, concave)).toBe(true) // 右柱
    expect(pointInPolygon({ x: 5, y: 2 }, concave)).toBe(true) // 下部（切り欠きより下）
  })
})

describe('clipSegmentToPolygon', () => {
  it('完全に内側の線分は1区間として返る', () => {
    const out = clipSegmentToPolygon({ x: 2, y: 5 }, { x: 8, y: 5 }, square)
    expect(out).toHaveLength(1)
    const mid = midpoint(out[0]!)
    expect(pointInPolygon(mid, square)).toBe(true)
  })

  it('ポリゴンを跨ぐ線分は内側部分のみclipされる', () => {
    const out = clipSegmentToPolygon({ x: -5, y: 5 }, { x: 15, y: 5 }, square)
    expect(out).toHaveLength(1)
    // clip後の区間は概ね [0,10] 内に収まる
    expect(out[0]!.start.x).toBeGreaterThanOrEqual(-0.5)
    expect(out[0]!.end.x).toBeLessThanOrEqual(10.5)
  })

  it('完全に外側の線分は空を返す', () => {
    expect(clipSegmentToPolygon({ x: -20, y: 5 }, { x: -10, y: 5 }, square)).toEqual([])
  })

  it('凹ポリゴンを横切る線分は複数区間に分割される', () => {
    // y=8 の水平線は左柱(x∈[0,4])と右柱(x∈[6,10])を通り、切り欠き(x∈[4,6])で途切れる
    const out = clipSegmentToPolygon({ x: -2, y: 8 }, { x: 12, y: 8 }, concave)
    expect(out).toHaveLength(2)
    for (const seg of out) {
      expect(pointInPolygon(midpoint(seg), concave)).toBe(true)
    }
  })
})

describe('generateHatchLines', () => {
  it('parallel/0°/spacing=2/10x10正方形で内部を通る5本の水平線', () => {
    const lines = generateHatchLines(hatch(square, 'parallel', 0, 2))
    expect(lines).toHaveLength(5)
    for (const l of lines) {
      expect(pointInPolygon(midpoint(l), square)).toBe(true)
    }
  })

  it('crossはparallelの2方向で本数が倍になる', () => {
    const lines = generateHatchLines(hatch(square, 'cross', 0, 2))
    expect(lines).toHaveLength(10)
  })

  it('空のboundaryPointsは[]を返す（shapeBBox=null）', () => {
    expect(generateHatchLines(hatch([], 'parallel', 0, 2))).toEqual([])
  })

  it('spacing<=0は[]を返す（無限ループ防御）', () => {
    expect(generateHatchLines(hatch(square, 'parallel', 0, 0))).toEqual([])
    expect(generateHatchLines(hatch(square, 'parallel', 0, -1))).toEqual([])
  })

  it('固定角パターン（concrete/rock/asphalt/wood/steel/water/earth/gravel）は非空を返す', () => {
    const patterns: HatchPattern[] = [
      'concrete',
      'rock',
      'asphalt',
      'wood',
      'steel',
      'water',
      'earth',
      'gravel',
    ]
    for (const p of patterns) {
      const lines = generateHatchLines(hatch(square, p, 30, 2))
      expect(lines.length).toBeGreaterThan(0)
    }
  })

  it('凹ポリゴンでも生成線分の中点は全てポリゴン内', () => {
    const lines = generateHatchLines(hatch(concave, 'parallel', 0, 2))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) {
      expect(pointInPolygon(midpoint(l), concave)).toBe(true)
    }
  })
})
