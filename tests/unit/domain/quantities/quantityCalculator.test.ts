import { describe, expect, it } from 'vitest'
import {
  computeContribution,
  geometryAreaMm2,
  geometryLengthMm,
  geometryPerimeterMm,
} from '@/domain/quantities/quantityCalculator'
import {
  makeArc,
  makeCircle,
  makeCloud,
  makeHatch,
  makeLine,
  makeMline,
  makePolyline,
  makeRectangle,
  makeSymbol,
} from './geometryFixtures'

describe('geometryLengthMm / 延長（内部基準mm）', () => {
  it('線分は2点間距離（3-4-5 → 5000mm）', () => {
    expect(geometryLengthMm(makeLine('l1', { x: 0, y: 0 }, { x: 3000, y: 4000 }))).toBeCloseTo(5000, 6)
  })

  it('開いたポリラインは各辺長の合計（閉辺は加えない）', () => {
    const pl = makePolyline('p1', [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], true)
    expect(geometryLengthMm(pl)).toBeCloseTo(2000, 6)
  })

  it('円弧は半径×掃引角（半径1000・90度 → 1000×π/2）', () => {
    const arc = makeArc('a1', { x: 0, y: 0 }, 1000, 0, 90)
    expect(geometryLengthMm(arc)).toBeCloseTo((1000 * Math.PI) / 2, 6)
  })

  it('始終角が一致する円弧は全円周長として扱う', () => {
    const arc = makeArc('a2', { x: 0, y: 0 }, 1000, 45, 45)
    expect(geometryLengthMm(arc)).toBeCloseTo(2 * Math.PI * 1000, 6)
  })

  it('円は延長算出できず null', () => {
    expect(geometryLengthMm(makeCircle('c1', { x: 0, y: 0 }, 1000))).toBeNull()
  })

  it('mline は中心線の延長として算出する（3-4-5 → 5000mm）', () => {
    const mline = makeMline('m1', { x: 0, y: 0 }, { x: 3000, y: 4000 })
    expect(geometryLengthMm(mline)).toBeCloseTo(5000, 6)
  })

  it('cloud は注記図形として延長算出 null', () => {
    const cloud = makeCloud('cl1', 0, 0, 100, 50)
    expect(geometryLengthMm(cloud)).toBeNull()
  })
})

describe('geometryPerimeterMm / 外周（内部基準mm）', () => {
  it('矩形は 2(w+h)', () => {
    expect(geometryPerimeterMm(makeRectangle('r1', { x: 0, y: 0 }, 2000, 3000))).toBeCloseTo(10000, 6)
  })

  it('円は 2πr', () => {
    expect(geometryPerimeterMm(makeCircle('c1', { x: 0, y: 0 }, 1000))).toBeCloseTo(2 * Math.PI * 1000, 6)
  })
})

describe('geometryAreaMm2 / 面積（内部基準mm²）', () => {
  it('円は πr²', () => {
    expect(geometryAreaMm2(makeCircle('c1', { x: 0, y: 0 }, 1000))).toBeCloseTo(Math.PI * 1_000_000, 3)
  })

  it('閉ポリゴン（1000×1000正方形）は靴紐公式で 1,000,000mm²', () => {
    const sq = makePolyline('p1', [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ], true)
    expect(geometryAreaMm2(sq)).toBeCloseTo(1_000_000, 3)
  })

  it('ハッチ境界も面積算出できる', () => {
    const hatch = makeHatch('h1', [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 1000 },
      { x: 0, y: 1000 },
    ])
    expect(geometryAreaMm2(hatch)).toBeCloseTo(2_000_000, 3)
  })
})

describe('computeContribution / 単位換算と整合検査（§17.2）', () => {
  it('length + m: 5000mm → 5.0 m', () => {
    const r = computeContribution(makeLine('l1', { x: 0, y: 0 }, { x: 3000, y: 4000 }), 'length', 'm')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(5, 9)
  })

  it('perimeter + m: 矩形 10000mm → 10.0 m', () => {
    const r = computeContribution(makeRectangle('r1', { x: 0, y: 0 }, 2000, 3000), 'perimeter', 'm')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(10, 9)
  })

  it('area + m2: 円 → π m²', () => {
    const r = computeContribution(makeCircle('c1', { x: 0, y: 0 }, 1000), 'area', 'm2')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(Math.PI, 6)
  })

  it('count: 記号は 1', () => {
    const r = computeContribution(makeSymbol('s1', { x: 0, y: 0 }), 'count', 'count')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(1)
  })

  it('volume + m3: 面積6m²×厚さ0.5m → 3.0 m³', () => {
    const rect = makeRectangle('r1', { x: 0, y: 0 }, 2000, 3000) // 6,000,000 mm²
    const r = computeContribution(rect, 'volume', 'm3', { volume: { thicknessMm: 500 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(3, 9)
  })

  it('volume で厚さ未指定はエラー', () => {
    const rect = makeRectangle('r1', { x: 0, y: 0 }, 2000, 3000)
    const r = computeContribution(rect, 'volume', 'm3')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('QTY_VOLUME_THICKNESS_REQUIRED')
  })

  it('算出区分と単位の次元不整合（length + m2）はエラー', () => {
    const r = computeContribution(makeLine('l1', { x: 0, y: 0 }, { x: 1000, y: 0 }), 'length', 'm2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('QTY_UNIT_METHOD_MISMATCH')
  })

  it('算出対象外の図形（円の length）はエラー', () => {
    const r = computeContribution(makeCircle('c1', { x: 0, y: 0 }, 1000), 'length', 'm')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('QTY_LENGTH_UNSUPPORTED')
  })

  it('manual は自動算出できずエラー', () => {
    const r = computeContribution(makeLine('l1', { x: 0, y: 0 }, { x: 1000, y: 0 }), 'manual', 'm')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('QTY_MANUAL_NOT_COMPUTABLE')
  })
})
