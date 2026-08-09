import { describe, expect, it } from 'vitest'
import { measureArea, measureDistance } from '@/domain/geometry/measure'
import type { Point } from '@/shared/types'

const p = (x: number, y: number): Point => ({ x, y })

describe('measure / 測距・面積', () => {
  it('measureDistance: 2点間の距離・XY成分・方位角（Y下方向を正）', () => {
    const result = measureDistance([p(0, 0), p(30, 40)])
    expect(result).not.toBeNull()
    expect(result?.distanceMm).toBeCloseTo(50)
    expect(result?.dxMm).toBeCloseTo(30)
    expect(result?.dyMm).toBeCloseTo(40)
    // 真下（Y正）は時計回り 90°
    expect(measureDistance([p(0, 0), p(0, 10)])?.angleDeg).toBeCloseTo(90)
    // 右方向は 0°
    expect(measureDistance([p(0, 0), p(10, 0)])?.angleDeg).toBeCloseTo(0)
    expect(measureDistance([p(0, 0)])).toBeNull()
  })

  it('measureArea: 3点以上で面積・周長、閉指定で面積を返す', () => {
    const square = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)]
    const closed = measureArea(square, true)
    expect(closed?.areaMm2).toBeCloseTo(10000)
    expect(closed?.perimeterMm).toBeCloseTo(400)
    expect(closed?.vertexCount).toBe(4)
    const open = measureArea(square, false)
    expect(open?.areaMm2).toBe(0)
    expect(open?.perimeterMm).toBeCloseTo(400)
  })

  it('measureArea: 2点以下は null（退化）', () => {
    expect(measureArea([p(0, 0), p(1, 1)], true)).toBeNull()
    expect(measureArea([p(0, 0)], true)).toBeNull()
  })
})
