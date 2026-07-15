import { describe, expect, it } from 'vitest'
import {
  bboxContainsPoint,
  bboxIntersects,
  findShapeAtPoint,
  findShapesInRect,
  rectFromPoints,
} from '@/domain/geometry/selection'
import type { BBox } from '@/domain/geometry/shapeBBox'
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

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: id(gid), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function parametric(gid: string): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'parametricObject',
    definitionId: 'heavy-machine-radius',
    definitionVersion: 1,
    parameters: {},
    generatedGeometryIds: [],
  }
}

describe('bboxContainsPoint', () => {
  const bbox: BBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

  it('内側の点はtrue、境界上の点もtrue', () => {
    expect(bboxContainsPoint(bbox, { x: 5, y: 5 })).toBe(true)
    expect(bboxContainsPoint(bbox, { x: 0, y: 0 })).toBe(true)
    expect(bboxContainsPoint(bbox, { x: 10, y: 10 })).toBe(true)
  })

  it('外側の点はfalse', () => {
    expect(bboxContainsPoint(bbox, { x: 11, y: 5 })).toBe(false)
    expect(bboxContainsPoint(bbox, { x: 5, y: -1 })).toBe(false)
  })

  it('toleranceの分だけ外側拡張して判定する', () => {
    expect(bboxContainsPoint(bbox, { x: 12, y: 5 }, 2)).toBe(true)
    expect(bboxContainsPoint(bbox, { x: 12.1, y: 5 }, 2)).toBe(false)
  })
})

describe('bboxIntersects', () => {
  it('重なる2つのBBoxはtrue', () => {
    const a: BBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const b: BBox = { minX: 5, minY: 5, maxX: 15, maxY: 15 }
    expect(bboxIntersects(a, b)).toBe(true)
  })

  it('辺で接する2つのBBoxはtrue（境界接触は交差扱い）', () => {
    const a: BBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const b: BBox = { minX: 10, minY: 0, maxX: 20, maxY: 10 }
    expect(bboxIntersects(a, b)).toBe(true)
  })

  it('離れた2つのBBoxはfalse', () => {
    const a: BBox = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    const b: BBox = { minX: 11, minY: 11, maxX: 20, maxY: 20 }
    expect(bboxIntersects(a, b)).toBe(false)
  })
})

describe('rectFromPoints', () => {
  it('どの対角方向のドラッグでもmin<=maxに正規化する', () => {
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 0, y: 0 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    })
    expect(rectFromPoints({ x: 0, y: 10 }, { x: 10, y: 0 })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
    })
  })
})

describe('findShapesInRect', () => {
  it('矩形と重なる図形のIDのみ返す', () => {
    const shapes = [line('a', 0, 0, 5, 5), line('b', 100, 100, 110, 110)]
    expect(findShapesInRect(shapes, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toEqual(['a'])
  })

  it('BBox計算不可の図形（parametricObject）は対象外', () => {
    const shapes = [parametric('p1'), line('a', 0, 0, 5, 5)]
    expect(findShapesInRect(shapes, { minX: -100, minY: -100, maxX: 100, maxY: 100 })).toEqual(['a'])
  })
})

describe('findShapeAtPoint', () => {
  it('重なる図形は配列末尾側（最前面）を優先する', () => {
    const shapes = [line('back', 0, 0, 10, 10), line('front', 0, 0, 10, 10)]
    expect(findShapeAtPoint(shapes, { x: 5, y: 5 })).toBe('front')
  })

  it('デフォルトtolerance=5の範囲でヒットする', () => {
    const shapes = [line('a', 0, 0, 10, 0)]
    expect(findShapeAtPoint(shapes, { x: 5, y: 4 })).toBe('a')
    expect(findShapeAtPoint(shapes, { x: 5, y: 6 })).toBeNull()
  })

  it('どの図形にもヒットしない場合はnull', () => {
    const shapes = [line('a', 0, 0, 10, 10)]
    expect(findShapeAtPoint(shapes, { x: 100, y: 100 })).toBeNull()
  })

  it('BBox計算不可の図形（parametricObject）はヒットしない', () => {
    expect(findShapeAtPoint([parametric('p1')], { x: 0, y: 0 })).toBeNull()
  })
})
