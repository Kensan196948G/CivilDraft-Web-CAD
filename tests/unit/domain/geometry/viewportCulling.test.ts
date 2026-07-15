import { describe, expect, it } from 'vitest'
import { GeometryIndex } from '@/domain/geometry/spatialIndex'
import { getVisibleIds, isInViewport, shouldCull, type Viewport } from '@/domain/geometry/viewportCulling'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

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

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius: r }
}

/** zoom=1, pan=0: world座標がそのまま画面座標になる素朴なビューポート。 */
const vp: Viewport = { zoom: 1, panX: 0, panY: 0, width: 800, height: 600 }

describe('isInViewport', () => {
  it('ビューポート内の図形はtrue', () => {
    expect(isInViewport(circle('a', 400, 300, 10), vp)).toBe(true)
  })

  it('ビューポートから十分離れた図形はfalse', () => {
    expect(isInViewport(circle('a', 2000, 2000, 10), vp)).toBe(false)
  })

  it('画面外でもpadding既定値50以内ならtrue（パン中のちらつき防止マージン）', () => {
    expect(isInViewport(circle('a', 840, 300, 10), vp)).toBe(true)
    expect(isInViewport(circle('a', 861, 300, 10), vp)).toBe(false)
  })

  it('zoom/panを反映したworld座標で判定する', () => {
    const zoomed: Viewport = { zoom: 2, panX: -800, panY: -600, width: 800, height: 600 }
    // 可視world範囲はx:[400,800], y:[300,600]（padding除く）
    expect(isInViewport(circle('a', 600, 450, 10), zoomed)).toBe(true)
    expect(isInViewport(circle('a', 100, 100, 10), zoomed)).toBe(false)
  })

  it('BBox計算不可の図形（parametricObject）はfalse', () => {
    const parametric: Geometry = {
      ...base,
      id: id('p1'),
      type: 'parametricObject',
      definitionId: 'heavy-machine-radius',
      definitionVersion: 1,
      parameters: {},
      generatedGeometryIds: [],
    }
    expect(isInViewport(parametric, vp)).toBe(false)
  })
})

describe('getVisibleIds', () => {
  it('索引からビューポート内の図形IDのみ返す', () => {
    const index = new GeometryIndex()
    index.load([circle('visible', 400, 300, 10), circle('offscreen', 5000, 5000, 10)])
    const ids = getVisibleIds(index, vp)
    expect(ids.has(id('visible'))).toBe(true)
    expect(ids.has(id('offscreen'))).toBe(false)
  })

  it('isInViewportと同じ可視範囲判定になる（両経路の整合性）', () => {
    const boundary = circle('b', 840, 300, 10) // padding込みで可視
    const outside = circle('o', 861, 300, 10) // padding込みでも不可視
    const index = new GeometryIndex()
    index.load([boundary, outside])
    const ids = getVisibleIds(index, vp)
    expect(ids.has(id('b'))).toBe(isInViewport(boundary, vp))
    expect(ids.has(id('o'))).toBe(isInViewport(outside, vp))
  })
})

describe('shouldCull', () => {
  it('しきい値（既定500）以上でtrue', () => {
    expect(shouldCull(499)).toBe(false)
    expect(shouldCull(500)).toBe(true)
  })

  it('しきい値を指定できる', () => {
    expect(shouldCull(100, 100)).toBe(true)
    expect(shouldCull(99, 100)).toBe(false)
  })
})
