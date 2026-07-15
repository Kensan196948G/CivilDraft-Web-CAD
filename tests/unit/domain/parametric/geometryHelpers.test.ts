import { describe, expect, it } from 'vitest'
import {
  offsetPath,
  pathLength,
  pointOnCircle,
  sampleAlongPath,
} from '@/domain/parametric/geometryHelpers'

describe('pointOnCircle', () => {
  it('0度は中心の右方向、90度は下方向（Y下向き）', () => {
    const right = pointOnCircle({ x: 0, y: 0 }, 100, 0)
    expect(right.x).toBeCloseTo(100)
    expect(right.y).toBeCloseTo(0)
    const down = pointOnCircle({ x: 0, y: 0 }, 100, 90)
    expect(down.x).toBeCloseTo(0)
    expect(down.y).toBeCloseTo(100)
  })
})

describe('pathLength / sampleAlongPath', () => {
  it('直線経路の総延長を返す', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 3000, y: 4000 }])).toBeCloseTo(5000)
  })

  it('spacing 刻みでサンプリングし終点を必ず含める', () => {
    const samples = sampleAlongPath([{ x: 0, y: 0 }, { x: 10000, y: 0 }], 2000)
    expect(samples).toHaveLength(6)
    expect(samples[0]?.point).toEqual({ x: 0, y: 0 })
    expect(samples[5]?.point).toEqual({ x: 10000, y: 0 })
    expect(samples[0]?.angleDeg).toBeCloseTo(0)
  })

  it('割り切れない場合も終点を追加する', () => {
    const samples = sampleAlongPath([{ x: 0, y: 0 }, { x: 5000, y: 0 }], 2000)
    // d=0,2000,4000 + 終点5000 = 4 サンプル
    expect(samples).toHaveLength(4)
    expect(samples[3]?.point).toEqual({ x: 5000, y: 0 })
  })

  it('spacing<=0 や頂点不足は空配列', () => {
    expect(sampleAlongPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toEqual([])
    expect(sampleAlongPath([{ x: 0, y: 0 }], 100)).toEqual([])
  })
})

describe('offsetPath', () => {
  it('水平経路を左手法線方向へ平行移動する', () => {
    const left = offsetPath([{ x: 0, y: 0 }, { x: 12000, y: 0 }], 2000)
    expect(left).toEqual([
      { x: 0, y: 2000 },
      { x: 12000, y: 2000 },
    ])
    const right = offsetPath([{ x: 0, y: 0 }, { x: 12000, y: 0 }], -2000)
    expect(right).toEqual([
      { x: 0, y: -2000 },
      { x: 12000, y: -2000 },
    ])
  })
})
