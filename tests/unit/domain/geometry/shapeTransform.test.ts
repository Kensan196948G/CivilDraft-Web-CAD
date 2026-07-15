import { describe, expect, it } from 'vitest'
import { computeCentroid, transformShape } from '@/domain/geometry/shapeTransform'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'

// selection.test.ts のヘルパーパターン（style / base / id）を踏襲する。
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

function line(gid: string, start: Point, end: Point): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end }
}

function rectangle(gid: string, origin: Point, width: number, height: number, rotationDeg = 0): Geometry {
  return { ...base, id: id(gid), type: 'rectangle', origin, width, height, rotationDeg }
}

function circle(gid: string, center: Point, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center, radius }
}

function arc(gid: string, center: Point, radius: number, startAngleDeg: number, endAngleDeg: number): Geometry {
  return { ...base, id: id(gid), type: 'arc', center, radius, startAngleDeg, endAngleDeg }
}

function ellipse(gid: string, center: Point, radiusX: number, radiusY: number, rotationDeg = 0): Geometry {
  return { ...base, id: id(gid), type: 'ellipse', center, radiusX, radiusY, rotationDeg }
}

function polyline(gid: string, points: Point[], closed = false): Geometry {
  return { ...base, id: id(gid), type: 'polyline', points, closed }
}

function text(gid: string, anchor: Point, rotationDeg: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'text',
    anchor,
    text: 'A',
    height: 10,
    rotationDeg,
    horizontalAlign: 'left',
  }
}

function symbol(gid: string, position: Point, rotationDeg: number): Geometry {
  return { ...base, id: id(gid), type: 'symbol', symbolId: 'sym-1', position, rotationDeg, scale: 1 }
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

describe('computeCentroid', () => {
  it('単一図形は代表点AABBの中心を返す', () => {
    expect(computeCentroid([line('a', { x: 0, y: 0 }, { x: 10, y: 20 })])).toEqual({ cx: 5, cy: 10 })
  })

  it('代表点が無い（空配列）場合は原点を返す', () => {
    expect(computeCentroid([])).toEqual({ cx: 0, cy: 0 })
  })

  it('parametricObjectのみの場合も原点を返す（代表点を持たない）', () => {
    expect(computeCentroid([parametric('p1')])).toEqual({ cx: 0, cy: 0 })
  })

  it('複数図形の代表点をまとめてAABB中心を求める', () => {
    const shapes = [line('a', { x: 0, y: 0 }, { x: 10, y: 0 }), circle('b', { x: 20, y: 20 }, 5)]
    // 代表点: line{0,0}{10,0} + circle 4象限点{15,20}{25,20}{20,15}{20,25}
    // AABB: x[0,25] y[0,25] → center (12.5, 12.5)
    expect(computeCentroid(shapes)).toEqual({ cx: 12.5, cy: 12.5 })
  })
})

describe('transformShape', () => {
  it('rotateCW: line を原点回りに視覚CW回転する（(dx,dy)→(-dy,dx)）', () => {
    const result = transformShape(line('a', { x: 10, y: 0 }, { x: 0, y: 10 }), 0, 0, 'rotateCW')
    expect(result).toEqual(line('a', { x: 0, y: 10 }, { x: -10, y: 0 }))
  })

  it('mirrorH: X方向のみ反転（Y据え置き）し、id・createdAtを維持する', () => {
    const result = transformShape(line('a', { x: 10, y: 5 }, { x: 20, y: -5 }), 0, 0, 'mirrorH')
    expect(result).toEqual(line('a', { x: -10, y: 5 }, { x: -20, y: -5 }))
    expect(result?.id).toBe('a')
    expect(result?.createdAt).toBe('2026-07-15T00:00:00.000Z')
  })

  it('rotateCW: rectangle は幅高さを入れ替え rotationDeg に+90する', () => {
    const result = transformShape(rectangle('r', { x: 0, y: 0 }, 10, 20, 0), 0, 0, 'rotateCW')
    // 中心(5,10)→CW→(-10,5)、幅20 高さ10、origin=(-20,0)、rotation 90
    expect(result).toEqual(rectangle('r', { x: -20, y: 0 }, 20, 10, 90))
  })

  it('rotateCW: arc は中心を回し、角度(度数法)へ直接+90する', () => {
    const result = transformShape(arc('c', { x: 0, y: 0 }, 5, 0, 90), 10, 10, 'rotateCW')
    expect(result).toEqual(arc('c', { x: 20, y: 0 }, 5, 90, 180))
  })

  it('rotateCCW: ellipse は半長軸・半短軸を入れ替え rotationDeg に-90する', () => {
    const result = transformShape(ellipse('e', { x: 0, y: 0 }, 4, 2, 10), 0, 0, 'rotateCCW')
    expect(result).toEqual(ellipse('e', { x: 0, y: 0 }, 2, 4, -80))
  })

  it('mirrorV: text は基準点をY反転し rotationDeg を 180-angle にする', () => {
    const result = transformShape(text('t', { x: 5, y: 5 }, 30), 0, 0, 'mirrorV')
    expect(result).toEqual(text('t', { x: 5, y: -5 }, 150))
  })

  it('rotateCW: polyline の全点を変換する', () => {
    const result = transformShape(
      polyline('p', [{ x: 1, y: 0 }, { x: 0, y: 1 }]),
      0,
      0,
      'rotateCW',
    )
    expect(result).toEqual(polyline('p', [{ x: 0, y: 1 }, { x: -1, y: 0 }]))
  })

  it('rotateCCW: symbol は位置と rotationDeg を変換する', () => {
    const result = transformShape(symbol('s', { x: 0, y: 10 }, 45), 0, 0, 'rotateCCW')
    // applyPoint(0,10,0,0,CCW): dx0 dy10 → {0+10, 0-0}={10,0}
    expect(result).toEqual(symbol('s', { x: 10, y: 0 }, -45))
  })

  it('parametricObject は変換対象外として null を返す', () => {
    expect(transformShape(parametric('p1'), 0, 0, 'rotateCW')).toBeNull()
  })
})
