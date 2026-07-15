import { describe, expect, it } from 'vitest'
import { CoordinateTransformer } from '@/domain/canvas/coordinateTransformer'

describe('CoordinateTransformer / 変換経路（仕様書§9.2）', () => {
  it('zoom=1, pan=0 では screen と domain が一致する（恒等）', () => {
    const t = new CoordinateTransformer({ zoom: 1, panX: 0, panY: 0 })
    expect(t.screenToDomain({ x: 100, y: 50 })).toEqual({ x: 100, y: 50 })
    expect(t.domainToScreen({ x: 100, y: 50 })).toEqual({ x: 100, y: 50 })
  })

  it('domain = (screen - pan) / zoom の規約（viewportCulling/rulerUtilsと同一）', () => {
    const t = new CoordinateTransformer({ zoom: 2, panX: 100, panY: 60 })
    expect(t.screenToDomain({ x: 300, y: 260 })).toEqual({ x: 100, y: 100 })
    expect(t.domainToScreen({ x: 100, y: 100 })).toEqual({ x: 300, y: 260 })
  })

  it('screenToDomain と domainToScreen は互いに逆変換', () => {
    const t = new CoordinateTransformer({ zoom: 0.5, panX: -33, panY: 17 })
    const p = { x: 123.45, y: -678.9 }
    const roundTrip = t.domainToScreen(t.screenToDomain(p))
    expect(roundTrip.x).toBeCloseTo(p.x, 10)
    expect(roundTrip.y).toBeCloseTo(p.y, 10)
  })

  it('長さ変換はpanの影響を受けない', () => {
    const t = new CoordinateTransformer({ zoom: 4, panX: 999, panY: -999 })
    expect(t.screenLengthToDomain(8)).toBe(2)
    expect(t.domainLengthToScreen(2)).toBe(8)
  })

  it('ヒットテスト許容ピクセルのドメイン換算（§9.3）: ズームインほど許容mmが小さくなる', () => {
    const zoomedIn = new CoordinateTransformer({ zoom: 10, panX: 0, panY: 0 })
    const zoomedOut = new CoordinateTransformer({ zoom: 0.1, panX: 0, panY: 0 })
    expect(zoomedIn.screenLengthToDomain(5)).toBeCloseTo(0.5)
    expect(zoomedOut.screenLengthToDomain(5)).toBeCloseTo(50)
  })

  it('Phase 1 の drawing transform は恒等（canvas=domain）', () => {
    const t = new CoordinateTransformer({ zoom: 3, panX: 10, panY: 20 })
    expect(t.canvasToDomain({ x: 7, y: 8 })).toEqual({ x: 7, y: 8 })
    expect(t.domainToCanvas({ x: 7, y: 8 })).toEqual({ x: 7, y: 8 })
  })

  it('zoom が 0以下・非有限のときは構築時に例外（プログラミングエラーの早期検出）', () => {
    expect(() => new CoordinateTransformer({ zoom: 0, panX: 0, panY: 0 })).toThrow()
    expect(() => new CoordinateTransformer({ zoom: -1, panX: 0, panY: 0 })).toThrow()
    expect(() => new CoordinateTransformer({ zoom: Number.NaN, panX: 0, panY: 0 })).toThrow()
    expect(() => new CoordinateTransformer({ zoom: Number.POSITIVE_INFINITY, panX: 0, panY: 0 })).toThrow()
  })
})
