import { describe, expect, it } from 'vitest'
import {
  centerlineLength,
  generateOffsetStations,
  generateStations,
  offsetStation,
  type CenterlineStation,
} from '@/domain/survey/centerline'
import type { LengthValue, Point } from '@/shared/types'

const PITCH_20M: LengthValue = { value: 20, unit: 'm' }

function okStations(points: readonly Point[], pitch: LengthValue): readonly CenterlineStation[] {
  const result = generateStations(points, pitch)
  if (!result.ok) throw new Error(`期待した成功が失敗した: ${result.error.message}`)
  return result.value
}

describe('centerlineLength / 総延長', () => {
  it('折れ線の各セグメント長を合算する', () => {
    // (0,0)→(30000,0)→(30000,40000): 30000 + 40000 = 70000mm
    expect(centerlineLength([{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 40000 }])).toBeCloseTo(70000, 6)
  })

  it('連続重複点は無視する', () => {
    expect(centerlineLength([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }])).toBeCloseTo(100, 6)
  })
})

describe('generateStations / 測点ピッチ配置（§12.4）', () => {
  it('直線100mを20mピッチで配置し、起点・ピッチ・終点を生成する', () => {
    const stations = okStations([{ x: 0, y: 0 }, { x: 100000, y: 0 }], PITCH_20M)
    expect(stations.map((s) => s.station)).toEqual([0, 20000, 40000, 60000, 80000, 100000])
    expect(stations.map((s) => s.label)).toEqual(['No.0', 'No.1', 'No.2', 'No.3', 'No.4', 'No.5'])
    expect(stations[0]?.kind).toBe('start')
    expect(stations[5]?.kind).toBe('end')
    // 位置はX軸上に等間隔
    expect(stations[2]?.position).toEqual({ x: 40000, y: 0 })
  })

  it('中間頂点を重複なく測点化する（曲線境界に相当）', () => {
    // (0,0)→(30000,0)→(30000,40000): 総延長70m、頂点は30m地点
    const stations = okStations([{ x: 0, y: 0 }, { x: 30000, y: 0 }, { x: 30000, y: 40000 }], PITCH_20M)
    const vertex = stations.find((s) => s.station === 30000)
    expect(vertex?.kind).toBe('vertex')
    expect(vertex?.position).toEqual({ x: 30000, y: 0 })
    // station は昇順・重複なし
    const sorted = [...stations].map((s) => s.station).sort((a, b) => a - b)
    expect(stations.map((s) => s.station)).toEqual(sorted)
    expect(new Set(stations.map((s) => s.station)).size).toBe(stations.length)
  })

  it('端数のある測点は No.n+plus 表記になる', () => {
    // 25m: No.0, No.1(20m), 終点25m → No.1+5.00
    const stations = okStations([{ x: 0, y: 0 }, { x: 25000, y: 0 }], PITCH_20M)
    expect(stations.map((s) => s.label)).toEqual(['No.0', 'No.1', 'No.1+5.00'])
  })

  it('頂点がピッチと一致する場合は vertex 優先で1つに統合する', () => {
    // 頂点が20m地点（ピッチと一致）: (0,0)→(20000,0)→(20000,10000)
    const stations = okStations([{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 10000 }], PITCH_20M)
    const at20 = stations.filter((s) => s.station === 20000)
    expect(at20).toHaveLength(1)
    expect(at20[0]?.kind).toBe('vertex')
  })

  it('2点未満は拒否する', () => {
    const result = generateStations([{ x: 0, y: 0 }], PITCH_20M)
    expect(result.ok).toBe(false)
  })

  it('ピッチが0以下だと拒否する', () => {
    const result = generateStations([{ x: 0, y: 0 }, { x: 100, y: 0 }], { value: 0, unit: 'm' })
    expect(result.ok).toBe(false)
  })
})

describe('offsetStation / 左右オフセット（進行方向基準・内部Y下向き）', () => {
  it('東進する測点の左は北(−Y)、右は南(+Y)へ振れる', () => {
    const station: CenterlineStation = {
      station: 0,
      position: { x: 1000, y: 500 },
      tangent: { x: 1, y: 0 },
      label: 'No.0',
      kind: 'start',
    }
    const offset = offsetStation(station, { value: 5, unit: 'm' }) // 5m=5000mm
    expect(offset.left).toEqual({ x: 1000, y: -4500 }) // 500 - 5000
    expect(offset.right).toEqual({ x: 1000, y: 5500 }) // 500 + 5000
    expect(offset.center).toEqual({ x: 1000, y: 500 })
  })

  it('北進(内部−Y方向)する測点の左は西(−X)へ振れる', () => {
    const station: CenterlineStation = {
      station: 0,
      position: { x: 0, y: 0 },
      tangent: { x: 0, y: -1 }, // 内部Y下向きなので進行方向−Y=画面上向き=北
      label: 'No.0',
      kind: 'start',
    }
    const offset = offsetStation(station, { value: 3, unit: 'm' }) // 3000mm
    // leftNormal=(ty,−tx)=(-1,0), rightNormal=(−ty,tx)=(1,0)
    expect(offset.left).toEqual({ x: -3000, y: 0 })
    expect(offset.right).toEqual({ x: 3000, y: 0 })
  })

  it('測点列全体の左右オフセット点を生成する', () => {
    const stations = okStations([{ x: 0, y: 0 }, { x: 100000, y: 0 }], PITCH_20M)
    const offsets = generateOffsetStations(stations, { value: 5, unit: 'm' })
    expect(offsets).toHaveLength(stations.length)
    // 直線なので全測点で右=+Y方向5000mm
    for (const o of offsets) {
      expect(o.right.y - o.center.y).toBeCloseTo(5000, 6)
      expect(o.left.y - o.center.y).toBeCloseTo(-5000, 6)
    }
  })
})
