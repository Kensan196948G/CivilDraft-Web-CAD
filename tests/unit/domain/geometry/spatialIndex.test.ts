import { describe, expect, it } from 'vitest'
import { GeometryIndex } from '@/domain/geometry/spatialIndex'
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

function parametric(gid: string): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'parametricObject',
    definitionId: 'crane-working-sector',
    definitionVersion: 1,
    parameters: {},
    generatedGeometryIds: [],
  }
}

describe('GeometryIndex / 基本操作', () => {
  it('loadで一括登録しsearchで矩形内の図形IDを返す', () => {
    const index = new GeometryIndex()
    index.load([circle('a', 0, 0, 5), circle('b', 100, 100, 5)])
    expect(index.size).toBe(2)
    expect(index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual(['a'])
  })

  it('addで逐次追加できる', () => {
    const index = new GeometryIndex()
    index.add(circle('a', 0, 0, 5))
    expect(index.size).toBe(1)
    expect(index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual(['a'])
  })

  it('同一IDのaddは置き換えになる（重複登録しない）', () => {
    const index = new GeometryIndex()
    index.add(circle('a', 0, 0, 5))
    index.add(circle('a', 100, 100, 5))
    expect(index.size).toBe(1)
    expect(index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([])
    expect(index.search({ minX: 90, minY: 90, maxX: 110, maxY: 110 })).toEqual(['a'])
  })

  it('removeで削除できる（未登録IDはno-op）', () => {
    const index = new GeometryIndex()
    index.add(circle('a', 0, 0, 5))
    index.remove(id('a'))
    expect(index.size).toBe(0)
    expect(() => index.remove(id('missing'))).not.toThrow()
  })

  it('updateで座標変更が検索結果に反映される', () => {
    const index = new GeometryIndex()
    index.load([circle('a', 0, 0, 5)])
    index.update(circle('a', 200, 200, 5))
    expect(index.search({ minX: -10, minY: -10, maxX: 10, maxY: 10 })).toEqual([])
    expect(index.search({ minX: 190, minY: 190, maxX: 210, maxY: 210 })).toEqual(['a'])
  })

  it('clearで全消去される', () => {
    const index = new GeometryIndex()
    index.load([circle('a', 0, 0, 5), circle('b', 100, 100, 5)])
    index.clear()
    expect(index.size).toBe(0)
    expect(index.search({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 })).toEqual([])
  })
})

describe('GeometryIndex / 点検索とtopmost', () => {
  it('pointはtolerance近傍の図形IDを返す', () => {
    const index = new GeometryIndex()
    index.load([circle('a', 0, 0, 5)])
    expect(index.point(8, 0, 5)).toEqual(['a'])
    expect(index.point(20, 0, 5)).toEqual([])
  })

  it('topmostは挿入順序が最後（最前面）のIDを返す', () => {
    const index = new GeometryIndex()
    index.load([circle('back', 0, 0, 5), circle('front', 0, 0, 5)])
    const hits = index.point(0, 0)
    expect(index.topmost(hits)).toBe('front')
  })

  it('updateしても挿入順序（重なり順）は維持される', () => {
    const index = new GeometryIndex()
    index.load([circle('back', 0, 0, 5), circle('front', 0, 0, 5)])
    index.update(circle('back', 1, 1, 5))
    expect(index.topmost([id('back'), id('front')])).toBe('front')
  })

  it('topmostは空配列・未登録IDのみの場合null', () => {
    const index = new GeometryIndex()
    expect(index.topmost([])).toBeNull()
    expect(index.topmost([id('missing')])).toBeNull()
  })
})

describe('GeometryIndex / BBox計算不可の図形', () => {
  it('parametricObjectは索引に登録されない（load/add両経路）', () => {
    const index = new GeometryIndex()
    index.load([parametric('p1'), circle('a', 0, 0, 5)])
    expect(index.size).toBe(1)
    index.add(parametric('p2'))
    expect(index.size).toBe(1)
    expect(index.search({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 })).toEqual(['a'])
  })

  it('updateでBBox計算不可になった図形は索引から外れる', () => {
    const index = new GeometryIndex()
    const poly: Geometry = {
      ...base,
      id: id('a'),
      type: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      closed: false,
    }
    index.load([poly])
    expect(index.size).toBe(1)
    index.update({ ...poly, points: [] })
    expect(index.size).toBe(0)
  })
})
