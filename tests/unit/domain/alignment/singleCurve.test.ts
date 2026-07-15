import { describe, expect, it } from 'vitest'
import {
  computeSingleCurve,
  expandCurve,
  type SingleCurve,
  type SingleCurveInput,
} from '@/domain/alignment'
import type { AngleValue, Point } from '@/shared/types'

/** mm・rad の数値近接判定（大きなmm値でも安定するよう絶対差で比較）。 */
function expectClose(actual: number, expected: number, eps = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThan(eps)
}

const deg = (value: number): AngleValue => ({ value, unit: 'deg' })
const R100M = 100_000 // 100m を mm 表現（ADR-0012 内部基準）

/** back tangent +X・IP原点・R=100m の基本ケース入力を生成する。 */
function baseInput(overrides: Partial<SingleCurveInput> = {}): SingleCurveInput {
  return {
    ip: { x: 0, y: 0 },
    backTangentDirection: deg(0),
    radius: R100M,
    deflectionAngle: deg(90),
    direction: 'right',
    ...overrides,
  }
}

function unwrap(input: SingleCurveInput): SingleCurve {
  const result = computeSingleCurve(input)
  if (!result.ok) throw new Error(`unexpected error: ${result.error.code}`)
  return result.value
}

describe('computeSingleCurve 諸元計算（詳細設計仕様書§13.1）', () => {
  it('R=100m・Δ=90° の曲線諸元を仕様式どおり計算する', () => {
    const curve = unwrap(baseInput())
    // T = R·tan(Δ/2) = R·tan45 = R
    expectClose(curve.tangentLength, R100M)
    // L = R·Δ = R·(π/2)
    expectClose(curve.curveLength, R100M * (Math.PI / 2), 1e-3)
    // E = R·(sec(Δ/2)−1) = R·(√2−1)
    expectClose(curve.externalLength, R100M * (Math.SQRT2 - 1), 1e-3)
    // M = R·(1−cos(Δ/2)) = R·(1−√2/2)
    expectClose(curve.middleOrdinate, R100M * (1 - Math.SQRT1_2), 1e-3)
    // C = 2R·sin(Δ/2) = 2R·(√2/2) = R√2
    expectClose(curve.longChord, R100M * Math.SQRT2, 1e-3)
    expectClose(curve.deflectionAngleRad, Math.PI / 2)
  })

  it('R=100m・Δ=60° の接線長・曲線長を仕様式どおり計算する', () => {
    const curve = unwrap(baseInput({ deflectionAngle: deg(60) }))
    expectClose(curve.tangentLength, R100M * Math.tan(Math.PI / 6), 1e-3)
    expectClose(curve.curveLength, R100M * (Math.PI / 3), 1e-3)
  })

  it('右折の BC/EC/中心/始終角を計算する', () => {
    const curve = unwrap(baseInput({ direction: 'right' }))
    expectClose(curve.bc.x, -R100M)
    expectClose(curve.bc.y, 0)
    expectClose(curve.ec.x, 0)
    expectClose(curve.ec.y, R100M)
    expectClose(curve.center.x, -R100M)
    expectClose(curve.center.y, R100M)
    expectClose(curve.startAngleRad, -Math.PI / 2)
    expectClose(curve.endAngleRad, 0)
    expectClose(curve.sweepAngleRad, Math.PI / 2)
  })

  it('左折は右折と反対側に中心・ECを持つ（掃引角は負）', () => {
    const curve = unwrap(baseInput({ direction: 'left' }))
    expectClose(curve.bc.x, -R100M)
    expectClose(curve.bc.y, 0)
    expectClose(curve.ec.x, 0)
    expectClose(curve.ec.y, -R100M)
    expectClose(curve.center.x, -R100M)
    expectClose(curve.center.y, -R100M)
    expectClose(curve.startAngleRad, Math.PI / 2)
    expectClose(curve.sweepAngleRad, -Math.PI / 2)
  })

  it('BC/EC は中心から半径Rの円上にある', () => {
    const curve = unwrap(baseInput())
    const dBc = Math.hypot(curve.bc.x - curve.center.x, curve.bc.y - curve.center.y)
    const dEc = Math.hypot(curve.ec.x - curve.center.x, curve.ec.y - curve.center.y)
    expectClose(dBc, R100M, 1e-3)
    expectClose(dEc, R100M, 1e-3)
  })

  it('角度単位（rad/gon）を指定しても度数法と同一結果になる', () => {
    const byDeg = unwrap(baseInput({ deflectionAngle: deg(90) }))
    const byRad = unwrap(baseInput({ deflectionAngle: { value: Math.PI / 2, unit: 'rad' } }))
    const byGon = unwrap(baseInput({ deflectionAngle: { value: 100, unit: 'gon' } }))
    expectClose(byRad.tangentLength, byDeg.tangentLength, 1e-6)
    expectClose(byGon.tangentLength, byDeg.tangentLength, 1e-6)
  })
})

describe('computeSingleCurve 不正入力（Result エラー）', () => {
  it('半径が0以下ならエラーを返す', () => {
    const result = computeSingleCurve(baseInput({ radius: 0 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_curve_radius_non_positive')
  })

  it('交角が0度近傍ならエラーを返す', () => {
    const result = computeSingleCurve(baseInput({ deflectionAngle: deg(0) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_curve_deflection_too_small')
  })

  it('交角が180度近傍ならエラーを返す', () => {
    const result = computeSingleCurve(baseInput({ deflectionAngle: deg(180) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('alignment_curve_deflection_too_large')
  })
})

describe('expandCurve 折れ線展開（詳細設計仕様書§13）', () => {
  it('展開点列の始点はBC・終点はECに一致する', () => {
    const curve = unwrap(baseInput())
    const points = expandCurve(curve, { segments: 16 })
    const first = points[0] as Point
    const last = points[points.length - 1] as Point
    expectClose(first.x, curve.bc.x, 1e-6)
    expectClose(first.y, curve.bc.y, 1e-6)
    expectClose(last.x, curve.ec.x, 1e-6)
    expectClose(last.y, curve.ec.y, 1e-6)
  })

  it('segments 指定で 分割数+1 の点を返し、全点が円上にある', () => {
    const curve = unwrap(baseInput())
    const points = expandCurve(curve, { segments: 8 })
    expect(points.length).toBe(9)
    for (const p of points) {
      const d = Math.hypot(p.x - curve.center.x, p.y - curve.center.y)
      expectClose(d, R100M, 1e-3)
    }
  })

  it('chordToleranceMm を小さくすると分割数が増える', () => {
    const curve = unwrap(baseInput())
    const coarse = expandCurve(curve, { chordToleranceMm: 100 })
    const fine = expandCurve(curve, { chordToleranceMm: 1 })
    expect(fine.length).toBeGreaterThan(coarse.length)
  })

  it('展開点の弦逸脱が許容差以内に収まる', () => {
    const curve = unwrap(baseInput())
    const tol = 5
    const points = expandCurve(curve, { chordToleranceMm: tol })
    // 各弦の中点と円弧の距離差（サジタ）が許容差以内であることを確認する。
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as Point
      const b = points[i] as Point
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const distMid = Math.hypot(mid.x - curve.center.x, mid.y - curve.center.y)
      expect(curve.radius - distMid).toBeLessThanOrEqual(tol + 1e-6)
    }
  })
})
