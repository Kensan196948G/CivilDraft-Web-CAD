import { describe, expect, it } from 'vitest'
import { computePolygonMetrics } from '@/domain/geometry/areaCalculator'
import type { Point } from '@/shared/types'

describe('computePolygonMetrics / 頂点3未満', () => {
  it('2頂点は面積・周長ともにゼロを返す', () => {
    expect(computePolygonMetrics([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual({
      area: 0,
      perimeter: 0,
      vertexCount: 2,
    })
  })

  it('空配列は面積・周長ともにゼロを返す', () => {
    expect(computePolygonMetrics([])).toEqual({ area: 0, perimeter: 0, vertexCount: 0 })
  })
})

describe('computePolygonMetrics / 靴紐公式', () => {
  it('単位正方形（反時計回り）の面積・周長を計算する', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const r = computePolygonMetrics(pts)
    expect(r.area).toBeCloseTo(1, 9)
    expect(r.perimeter).toBeCloseTo(4, 9)
    expect(r.vertexCount).toBe(4)
  })

  it('単位正方形（時計回り）でも面積は同じ正の値になる（符号は絶対値化）', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
    ]
    const r = computePolygonMetrics(pts)
    expect(r.area).toBeCloseTo(1, 9)
  })

  it('直角三角形（3-4-5）の面積・周長を計算する', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
    ]
    const r = computePolygonMetrics(pts)
    expect(r.area).toBeCloseTo(6, 9)
    expect(r.vertexCount).toBe(3)
    expect(r.perimeter).toBeCloseTo(12, 9)
  })

  it('10×10の矩形（面積100・周長40）を計算する', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    const r = computePolygonMetrics(pts)
    expect(r.area).toBeCloseTo(100, 6)
    expect(r.perimeter).toBeCloseTo(40, 6)
  })
})

describe('computePolygonMetrics / 縮退エッジ', () => {
  it('末尾の頂点が重複していても面積計算は破綻しない（ダブルクリック入力相当）', () => {
    // 縮退エッジ（同一点への辺）は靴紐公式の交差項がゼロになるため、
    // vertexCountには反映されるが面積の正当性は損なわれない。
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 1 },
    ]
    const r = computePolygonMetrics(pts)
    expect(r.vertexCount).toBe(5)

    const sliced = computePolygonMetrics(pts.slice(0, -1))
    expect(sliced.area).toBeCloseTo(1, 9)
    expect(sliced.vertexCount).toBe(4)
  })
})
