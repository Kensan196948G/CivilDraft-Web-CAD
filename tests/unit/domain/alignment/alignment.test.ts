import { describe, expect, it } from 'vitest'
import {
  buildAlignment,
  computeSingleCurve,
  generateStations,
  stationToPoint,
  type Alignment,
  type AlignmentElement,
  type SingleCurve,
} from '@/domain/alignment'
import type { AngleValue, Point } from '@/shared/types'

function expectClose(actual: number, expected: number, eps = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

const deg = (value: number): AngleValue => ({ value, unit: 'deg' })
const R100M = 100_000

/** テスト用の右折単曲線（BC=(-100000,0)・EC=(0,100000)）。 */
function rightCurve(): SingleCurve {
  const result = computeSingleCurve({
    ip: { x: 0, y: 0 },
    backTangentDirection: deg(0),
    radius: R100M,
    deflectionAngle: deg(90),
    direction: 'right',
  })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function buildOrThrow(elements: readonly AlignmentElement[], startStation = 0): Alignment {
  const result = buildAlignment({ id: 'a1', name: 'テスト線形', startStation, elements })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

function mapOrThrow(alignment: Alignment, station: number): Point {
  const result = stationToPoint(alignment, station)
  if (!result.ok) throw new Error(result.error.code)
  return result.value.point
}

describe('buildAlignment 構築（詳細設計仕様書§12.4・§13）', () => {
  it('直線1本の線形の長さと累加距離を割り付ける', () => {
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: R100M, y: 0 } },
    ])
    expect(alignment.segments.length).toBe(1)
    expectClose(alignment.startStation, 0)
    expectClose(alignment.endStation, R100M)
  })

  it('直線+単曲線を接続し、累加距離が各要素長の合計になる', () => {
    const curve = rightCurve()
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: -2 * R100M, y: 0 }, end: { x: -R100M, y: 0 } },
      { kind: 'arc', curve },
    ])
    expect(alignment.segments.length).toBe(2)
    expectClose(alignment.endStation, R100M + curve.curveLength, 1e-3)
    const arcSeg = alignment.segments[1]
    expect(arcSeg?.kind).toBe('arc')
    expectClose(arcSeg?.startStation ?? -1, R100M, 1e-6)
  })

  it('接続不連続（前要素終点と次要素始点のずれ）を検出する', () => {
    const curve = rightCurve()
    const result = buildAlignment({
      id: 'a1',
      name: 'x',
      elements: [
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: R100M, y: 0 } }, // 終点(100000,0)
        { kind: 'arc', curve }, // BC=(-100000,0) → 不連続
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_discontinuous')
  })

  it('長さ0の直線要素を拒否する', () => {
    const result = buildAlignment({
      id: 'a1',
      name: 'x',
      elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_line_zero_length')
  })

  it('要素0件を拒否する', () => {
    const result = buildAlignment({ id: 'a1', name: 'x', elements: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_empty')
  })
})

describe('stationToPoint 測点距離→座標（詳細設計仕様書§12.4）', () => {
  it('直線上で 測点→座標→往復 が一致する（始点・中点・終点）', () => {
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: R100M, y: 0 } },
    ])
    const start = mapOrThrow(alignment, 0)
    const mid = mapOrThrow(alignment, R100M / 2)
    const end = mapOrThrow(alignment, R100M)
    expectClose(start.x, 0)
    expectClose(mid.x, R100M / 2)
    expectClose(end.x, R100M)
    expectClose(start.y, 0)
    expectClose(mid.y, 0)
    expectClose(end.y, 0)
  })

  it('直線上の進行方向（接線）が要素方向と一致する', () => {
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: R100M } },
    ])
    const result = stationToPoint(alignment, R100M / 2)
    expect(result.ok).toBe(true)
    if (result.ok) expectClose(result.value.tangentDirectionRad, Math.PI / 2)
  })

  it('曲線境界（BC）でも直線終点と同一点になり進行方向が連続する', () => {
    const curve = rightCurve()
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: -2 * R100M, y: 0 }, end: { x: -R100M, y: 0 } },
      { kind: 'arc', curve },
    ])
    // BC の測点 = 直線長
    const atBc = mapOrThrow(alignment, R100M)
    expectClose(atBc.x, curve.bc.x, 1e-3)
    expectClose(atBc.y, curve.bc.y, 1e-3)
    // 終端 = EC
    const atEc = mapOrThrow(alignment, alignment.endStation)
    expectClose(atEc.x, curve.ec.x, 1e-3)
    expectClose(atEc.y, curve.ec.y, 1e-3)
  })

  it('円弧上の点が中心から半径R上にあり、接線方向が正しい', () => {
    const curve = rightCurve()
    const alignment = buildOrThrow([{ kind: 'arc', curve }])
    // 曲線中央
    const result = stationToPoint(alignment, curve.curveLength / 2)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const d = Math.hypot(
        result.value.point.x - curve.center.x,
        result.value.point.y - curve.center.y,
      )
      expectClose(d, R100M, 1e-3)
      // 右折・+X始まりの曲線中央の接線方向は +π/4。
      expectClose(result.value.tangentDirectionRad, Math.PI / 4, 1e-6)
    }
  })

  it('範囲外の測点はエラーを返す', () => {
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: R100M, y: 0 } },
    ])
    const under = stationToPoint(alignment, -1)
    const over = stationToPoint(alignment, R100M * 2)
    expect(under.ok).toBe(false)
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.error.code).toBe('alignment_station_out_of_range')
  })
})

describe('generateStations 測点列生成（詳細設計仕様書§12.4）', () => {
  it('開始・終了・曲線境界を含み、ピッチ倍数を重複なく昇順で返す', () => {
    const curve = rightCurve()
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: -2 * R100M, y: 0 }, end: { x: -R100M, y: 0 } },
      { kind: 'arc', curve },
    ])
    const stations = generateStations(alignment, 50_000)

    // 昇順かつ重複なし
    for (let i = 1; i < stations.length; i++) {
      expect((stations[i] as number) - (stations[i - 1] as number)).toBeGreaterThan(1e-6)
    }
    // 開始・曲線境界（=直線長 100000）・終了を含む
    expect(stations[0]).toBe(0)
    expect(stations.some((s) => Math.abs(s - R100M) < 1e-6)).toBe(true)
    expect(stations.some((s) => Math.abs(s - alignment.endStation) < 1e-6)).toBe(true)
    // ピッチ倍数 50000/150000/200000 を含む
    expect(stations.some((s) => Math.abs(s - 50_000) < 1e-6)).toBe(true)
    expect(stations.some((s) => Math.abs(s - 150_000) < 1e-6)).toBe(true)
  })

  it('ピッチが非正なら境界（開始・終了・セグメント境界）のみを返す', () => {
    const curve = rightCurve()
    const alignment = buildOrThrow([
      { kind: 'line', start: { x: -2 * R100M, y: 0 }, end: { x: -R100M, y: 0 } },
      { kind: 'arc', curve },
    ])
    const stations = generateStations(alignment, 0)
    expect(stations).toEqual([0, R100M, alignment.endStation])
  })
})
