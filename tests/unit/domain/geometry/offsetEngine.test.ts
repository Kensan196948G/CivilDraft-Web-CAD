import { describe, expect, it } from 'vitest'
import { canOffset, offsetShape } from '@/domain/geometry/offsetEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
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

const NOW = '2026-07-15T12:00:00.000Z'

function id(v: string): GeometryId {
  return v as GeometryId
}

function seqCtx(): GeometryCreationContext {
  let n = 0
  return { newId: () => `gen-${++n}` as GeometryId, now: () => NOW }
}

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: id(gid), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

function circle(gid: string, cx: number, cy: number, radius: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius }
}

function arc(gid: string, cx: number, cy: number, radius: number): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'arc',
    center: { x: cx, y: cy },
    radius,
    startAngleDeg: 0,
    endAngleDeg: 90,
  }
}

function rect(gid: string, x: number, y: number, width: number, height: number): Geometry {
  return { ...base, id: id(gid), type: 'rectangle', origin: { x, y }, width, height, rotationDeg: 0 }
}

function text(gid: string): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'text',
    anchor: { x: 0, y: 0 },
    text: 'A',
    height: 10,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

function polyline(gid: string): Geometry {
  return { ...base, id: id(gid), type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }
}

function ellipse(gid: string): Geometry {
  return { ...base, id: id(gid), type: 'ellipse', center: { x: 0, y: 0 }, radiusX: 20, radiusY: 10, rotationDeg: 0 }
}

describe('offsetShape', () => {
  it('線分を左向き法線方向へ平行移動する（新IDとタイムスタンプを発番）', () => {
    const result = offsetShape(line('l', 0, 0, 100, 0), 10, seqCtx())
    expect(result).toEqual({
      ...base,
      id: id('gen-1'),
      type: 'line',
      start: { x: 0, y: 10 },
      end: { x: 100, y: 10 },
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('円は半径を距離分だけ増やす', () => {
    const result = offsetShape(circle('c', 0, 0, 50), 10, seqCtx())
    expect(result).toEqual({
      ...base,
      id: id('gen-1'),
      type: 'circle',
      center: { x: 0, y: 0 },
      radius: 60,
      createdAt: NOW,
      updatedAt: NOW,
    })
  })

  it('弧は半径のみ増減し中心・角度は維持する', () => {
    const result = offsetShape(arc('a', 0, 0, 50), 10, seqCtx())
    expect(result).toMatchObject({ type: 'arc', radius: 60, startAngleDeg: 0, endAngleDeg: 90 })
  })

  it('矩形は各辺を距離分だけ外側へ拡げる', () => {
    const result = offsetShape(rect('r', 10, 10, 100, 50), 5, seqCtx())
    expect(result).toMatchObject({
      type: 'rectangle',
      origin: { x: 5, y: 5 },
      width: 110,
      height: 60,
    })
  })

  it('負のオフセットで円の半径が0以下になるとnull', () => {
    expect(offsetShape(circle('c', 0, 0, 5), -5, seqCtx())).toBeNull()
    expect(offsetShape(circle('c', 0, 0, 5), -10, seqCtx())).toBeNull()
  })

  it('矩形の幅が0以下になるとnull', () => {
    expect(offsetShape(rect('r', 0, 0, 10, 50), -5, seqCtx())).toBeNull()
  })

  it('長さ0の線分（退化）はnull', () => {
    expect(offsetShape(line('l', 5, 5, 5, 5), 10, seqCtx())).toBeNull()
  })

  it('対象外図形種（text/polyline/ellipse）はnull', () => {
    expect(offsetShape(text('t'), 10, seqCtx())).toBeNull()
    expect(offsetShape(polyline('p'), 10, seqCtx())).toBeNull()
    expect(offsetShape(ellipse('e'), 10, seqCtx())).toBeNull()
  })
})

describe('canOffset', () => {
  it('line/circle/arc/rectangleはtrue', () => {
    expect(canOffset(line('l', 0, 0, 1, 1))).toBe(true)
    expect(canOffset(circle('c', 0, 0, 1))).toBe(true)
    expect(canOffset(arc('a', 0, 0, 1))).toBe(true)
    expect(canOffset(rect('r', 0, 0, 1, 1))).toBe(true)
  })

  it('その他の図形種はfalse', () => {
    expect(canOffset(text('t'))).toBe(false)
    expect(canOffset(polyline('p'))).toBe(false)
    expect(canOffset(ellipse('e'))).toBe(false)
  })
})
