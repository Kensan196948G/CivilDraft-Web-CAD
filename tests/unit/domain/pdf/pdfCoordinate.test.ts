/**
 * pdfCoordinate（内部mm→PDF pt写像）の数値回帰テスト。
 * mm→pt換算・Y反転・縮尺・余白・向きを固定値で検証する（§24.1）。
 */
import { describe, expect, it } from 'vitest'
import { PT_PER_MM, createProjector } from '@/domain/pdf/pdfCoordinate'

describe('PT_PER_MM', () => {
  it('1mm=72/25.4pt の組版定数である', () => {
    expect(PT_PER_MM).toBeCloseTo(2.834645669, 6)
  })
})

describe('createProjector: 用紙寸法', () => {
  it('A4 portrait は 595.28 x 841.89 pt', () => {
    const proj = createProjector('A4', 'portrait', 100, 10)
    expect(proj.paper.widthPt).toBeCloseTo(210 * PT_PER_MM, 3)
    expect(proj.paper.heightPt).toBeCloseTo(297 * PT_PER_MM, 3)
    expect(proj.paper.widthPt).toBeCloseTo(595.276, 2)
    expect(proj.paper.heightPt).toBeCloseTo(841.89, 2)
  })

  it('landscape は幅高を入れ替える', () => {
    const proj = createProjector('A4', 'landscape', 100, 10)
    expect(proj.paper.widthPt).toBeCloseTo(297 * PT_PER_MM, 3)
    expect(proj.paper.heightPt).toBeCloseTo(210 * PT_PER_MM, 3)
  })
})

describe('createProjector: 座標写像（A4 portrait / 1:100 / margin 10mm）', () => {
  const proj = createProjector('A4', 'portrait', 100, 10)

  it('内部原点(0,0)は描画領域左上（余白の内側）へ写る', () => {
    const p = proj.point({ x: 0, y: 0 })
    expect(p.x).toBeCloseTo(10 * PT_PER_MM, 4) // 28.3465
    expect(p.y).toBeCloseTo((297 - 10) * PT_PER_MM, 4) // 813.44
  })

  it('縮尺適用: 実寸1000mm は用紙上10mm=28.35pt ぶん右へ', () => {
    const origin = proj.point({ x: 0, y: 0 })
    const p = proj.point({ x: 1000, y: 0 })
    expect(p.x - origin.x).toBeCloseTo(28.3465, 3)
    // 用紙上mm換算 = 1000/100 = 10mm
    expect((p.x - origin.x) / PT_PER_MM).toBeCloseTo(10, 4)
  })

  it('Y反転: 内部+Y（下方向）は用紙上でyが小さくなる（下へ）', () => {
    const origin = proj.point({ x: 0, y: 0 })
    const p = proj.point({ x: 0, y: 1000 })
    expect(p.y).toBeLessThan(origin.y)
    expect(origin.y - p.y).toBeCloseTo(28.3465, 3)
  })

  it('length(): 図面空間の長さは縮尺で縮む（1000mm@1:100 → 28.35pt）', () => {
    expect(proj.length(1000)).toBeCloseTo(28.3465, 3)
    expect(proj.length(0)).toBe(0)
  })

  it('marginPt は marginMm*PT_PER_MM', () => {
    expect(proj.marginPt).toBeCloseTo(10 * PT_PER_MM, 4)
  })
})

describe('createProjector: 縮尺の違い', () => {
  it('1:1 では実寸mmがそのまま用紙mm（=pt換算のみ）', () => {
    const proj = createProjector('A0', 'portrait', 1, 0)
    // margin0, 1:1 → 内部(100,0) は用紙上100mm
    const origin = proj.point({ x: 0, y: 0 })
    const p = proj.point({ x: 100, y: 0 })
    expect(p.x - origin.x).toBeCloseTo(100 * PT_PER_MM, 3)
  })

  it('1:50 は 1:100 の2倍のスケール', () => {
    const p50 = createProjector('A3', 'portrait', 50, 10)
    const p100 = createProjector('A3', 'portrait', 100, 10)
    expect(p50.length(1000)).toBeCloseTo(p100.length(1000) * 2, 4)
  })
})
