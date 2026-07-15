import { describe, expect, it } from 'vitest'
import { shapeBBox, unionBBox } from '@/domain/geometry/shapeBBox'
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

describe('shapeBBox / 座標を直接持つ図形', () => {
  it('lineは始点・終点のAABBを返す', () => {
    const line: Geometry = { ...base, id: id('g1'), type: 'line', start: { x: 10, y: 0 }, end: { x: 0, y: 10 } }
    expect(shapeBBox(line)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
  })

  it('rectangleはrotationDegを無視しorigin基準のAABBを返す', () => {
    const rect: Geometry = {
      ...base,
      id: id('g2'),
      type: 'rectangle',
      origin: { x: 5, y: 5 },
      width: 10,
      height: 20,
      rotationDeg: 45,
    }
    expect(shapeBBox(rect)).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 25 })
  })

  it('circleは中心±半径のAABBを返す', () => {
    const circle: Geometry = { ...base, id: id('g3'), type: 'circle', center: { x: 0, y: 0 }, radius: 5 }
    expect(shapeBBox(circle)).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 })
  })

  it('arcは開始角・終了角を無視し全円のAABBで近似する', () => {
    const arc: Geometry = {
      ...base,
      id: id('g4'),
      type: 'arc',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngleDeg: 0,
      endAngleDeg: 10,
    }
    expect(shapeBBox(arc)).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 })
  })

  it('polylineは全頂点のAABBを返す', () => {
    const polyline: Geometry = {
      ...base,
      id: id('g5'),
      type: 'polyline',
      points: [{ x: 0, y: 5 }, { x: 10, y: -5 }, { x: 3, y: 8 }],
      closed: false,
    }
    expect(shapeBBox(polyline)).toEqual({ minX: 0, minY: -5, maxX: 10, maxY: 8 })
  })

  it('polyline/splineは空点配列でnullを返す', () => {
    const polyline: Geometry = { ...base, id: id('g6'), type: 'polyline', points: [], closed: false }
    expect(shapeBBox(polyline)).toBeNull()
  })

  it('hatchは境界点のAABBを返す', () => {
    const hatch: Geometry = {
      ...base,
      id: id('g7'),
      type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      pattern: 'concrete',
      angleDeg: 45,
      spacing: 2,
    }
    expect(shapeBBox(hatch)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
  })

  it('symbolはscaleに比例した固定半径50*scaleのAABBを返す', () => {
    const symbol: Geometry = {
      ...base,
      id: id('g8'),
      type: 'symbol',
      symbolId: 'manhole',
      position: { x: 100, y: 100 },
      rotationDeg: 0,
      scale: 2,
    }
    expect(shapeBBox(symbol)).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 })
  })
})

describe('shapeBBox / 座標を直接持たない図形', () => {
  it('parametricObjectはnullを返す（生成図形IDへの間接参照のみのため）', () => {
    const parametric: Geometry = {
      ...base,
      id: id('g9'),
      type: 'parametricObject',
      definitionId: 'heavy-machine-radius',
      definitionVersion: 1,
      parameters: {},
      generatedGeometryIds: [],
    }
    expect(shapeBBox(parametric)).toBeNull()
  })
})

describe('unionBBox', () => {
  it('複数図形のAABBを統合する', () => {
    const line: Geometry = { ...base, id: id('g10'), type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    const circle: Geometry = { ...base, id: id('g11'), type: 'circle', center: { x: 20, y: 20 }, radius: 5 }
    expect(unionBBox([line, circle])).toEqual({ minX: 0, minY: 0, maxX: 25, maxY: 25 })
  })

  it('空配列はnullを返す', () => {
    expect(unionBBox([])).toBeNull()
  })

  it('全図形がnullを返す場合（parametricObjectのみ）はnullを返す', () => {
    const parametric: Geometry = {
      ...base,
      id: id('g12'),
      type: 'parametricObject',
      definitionId: 'crane-working-sector',
      definitionVersion: 1,
      parameters: {},
      generatedGeometryIds: [],
    }
    expect(unionBBox([parametric])).toBeNull()
  })
})

// QAカバレッジ補強: 既存テスト未到達の図形種別（ellipse/text/dimension/leader）のAABBを検証する。
// text/leader は文字幅メトリクスを持たない簡易近似（height/textHeight の10倍）の契約を固定する。
describe('shapeBBox / 追加カバレッジ（ellipse・text・dimension・leader）', () => {
  it('ellipse は rotationDeg を無視し中心±radiusX/radiusY のAABBを返す', () => {
    const e: Geometry = {
      ...base, id: id('g20'), type: 'ellipse',
      center: { x: 0, y: 0 }, radiusX: 40, radiusY: 20, rotationDeg: 30,
    }
    expect(shapeBBox(e)).toEqual({ minX: -40, minY: -20, maxX: 40, maxY: 20 })
  })

  it('text は anchor 基準の簡易近似AABB（幅=height*10・上方=height）を返す', () => {
    const t: Geometry = {
      ...base, id: id('g21'), type: 'text',
      anchor: { x: 10, y: 10 }, text: 'ABC', height: 5, rotationDeg: 0, horizontalAlign: 'left',
    }
    expect(shapeBBox(t)).toEqual({ minX: 10, minY: 5, maxX: 60, maxY: 10 })
  })

  it('dimension は始点・終点のAABBを返す', () => {
    const d: Geometry = {
      ...base, id: id('g22'), type: 'dimension',
      start: { x: 0, y: 0 }, end: { x: 100, y: 30 },
      orientation: 'horizontal', offset: 10, textHeight: 3, arrowSize: 2,
    }
    expect(shapeBBox(d)).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 30 })
  })

  it('leader は始点・終点のAABBに注記テキスト分（textHeight×10 / textHeight）を加える', () => {
    const l: Geometry = {
      ...base, id: id('g23'), type: 'leader',
      start: { x: 0, y: 0 }, end: { x: 50, y: 20 }, text: 'note', textHeight: 10,
    }
    expect(shapeBBox(l)).toEqual({ minX: 0, minY: 0, maxX: 150, maxY: 30 })
  })
})
