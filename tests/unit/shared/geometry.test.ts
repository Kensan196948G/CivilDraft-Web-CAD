import { describe, expect, it } from 'vitest'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
} from '@/shared/types'

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

/**
 * 詳細設計仕様書 §6「各図形固有型は判別プロパティtypeを必須とし、
 * switchの網羅性検査を利用する」の実証。ケース漏れがあるとnever型への
 * 代入でコンパイルエラーになる。
 */
function describeGeometry(g: Geometry): string {
  switch (g.type) {
    case 'line':
      return `line:${g.start.x},${g.start.y}-${g.end.x},${g.end.y}`
    case 'circle':
      return `circle:r=${g.radius}`
    case 'polyline':
      return `polyline:n=${g.points.length},closed=${g.closed}`
    case 'text':
      return `text:${g.text}`
    case 'arc':
      return `arc:${g.startAngleDeg}-${g.endAngleDeg}`
    case 'rectangle':
      return `rectangle:${g.width}x${g.height}`
    case 'ellipse':
      return `ellipse:${g.radiusX}x${g.radiusY}`
    case 'dimension':
      return `dimension:${g.orientation}`
    case 'leader':
      return `leader:${g.text}`
    case 'hatch':
      return `hatch:${g.pattern}`
    case 'symbol':
      return `symbol:${g.symbolId}`
    case 'spline':
      return `spline:n=${g.points.length},tension=${g.tension}`
    case 'parametricObject':
      return `parametricObject:${g.definitionId}`
    default: {
      const exhaustive: never = g
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

describe('詳細設計仕様書 §6 Geometry判別共用体', () => {
  it('line/circle/polyline/textの既存4型を判別できる', () => {
    const line: Geometry = { ...base, id: id('g1'), type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    const circle: Geometry = { ...base, id: id('g2'), type: 'circle', center: { x: 0, y: 0 }, radius: 5 }
    const polyline: Geometry = {
      ...base,
      id: id('g3'),
      type: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      closed: false,
    }
    const text: Geometry = {
      ...base,
      id: id('g4'),
      type: 'text',
      anchor: { x: 0, y: 0 },
      text: '注記',
      height: 3,
      rotationDeg: 0,
      horizontalAlign: 'left',
    }

    expect(describeGeometry(line)).toBe('line:0,0-10,0')
    expect(describeGeometry(circle)).toBe('circle:r=5')
    expect(describeGeometry(polyline)).toBe('polyline:n=2,closed=false')
    expect(describeGeometry(text)).toBe('text:注記')
  })

  it('Issue #20で新規定義したarc/rectangle/ellipse/dimension/leader/hatch/symbol/splineを判別できる', () => {
    const arc: Geometry = {
      ...base,
      id: id('g5'),
      type: 'arc',
      center: { x: 0, y: 0 },
      radius: 5,
      startAngleDeg: 0,
      endAngleDeg: 90,
    }
    const rectangle: Geometry = {
      ...base,
      id: id('g6'),
      type: 'rectangle',
      origin: { x: 0, y: 0 },
      width: 10,
      height: 20,
      rotationDeg: 0,
    }
    const ellipse: Geometry = {
      ...base,
      id: id('g7'),
      type: 'ellipse',
      center: { x: 0, y: 0 },
      radiusX: 10,
      radiusY: 5,
      rotationDeg: 0,
    }
    const dimension: Geometry = {
      ...base,
      id: id('g8'),
      type: 'dimension',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      orientation: 'horizontal',
      offset: 10,
      textHeight: 3,
      arrowSize: 2,
    }
    const leader: Geometry = {
      ...base,
      id: id('g9'),
      type: 'leader',
      start: { x: 0, y: 0 },
      end: { x: 20, y: -20 },
      text: '既存埋設管',
      textHeight: 3,
    }
    const hatch: Geometry = {
      ...base,
      id: id('g10'),
      type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      pattern: 'concrete',
      angleDeg: 45,
      spacing: 2,
    }
    const symbol: Geometry = {
      ...base,
      id: id('g11'),
      type: 'symbol',
      symbolId: 'manhole',
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      scale: 1,
    }
    const spline: Geometry = {
      ...base,
      id: id('g12'),
      type: 'spline',
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }],
      tension: 0.5,
    }

    expect(describeGeometry(arc)).toBe('arc:0-90')
    expect(describeGeometry(rectangle)).toBe('rectangle:10x20')
    expect(describeGeometry(ellipse)).toBe('ellipse:10x5')
    expect(describeGeometry(dimension)).toBe('dimension:horizontal')
    expect(describeGeometry(leader)).toBe('leader:既存埋設管')
    expect(describeGeometry(hatch)).toBe('hatch:concrete')
    expect(describeGeometry(symbol)).toBe('symbol:manhole')
    expect(describeGeometry(spline)).toBe('spline:n=3,tension=0.5')
  })

  it('§15パラメトリック図形は生成図形IDへの参照を保持する（座標を直接持たない）', () => {
    const parametric: Geometry = {
      ...base,
      id: id('g13'),
      type: 'parametricObject',
      definitionId: 'heavy-machine-radius',
      definitionVersion: 1,
      parameters: { center: { x: 0, y: 0 }, radius: 5000, machineName: 'BH-30' },
      generatedGeometryIds: [id('g14'), id('g15')],
    }

    expect(describeGeometry(parametric)).toBe('parametricObject:heavy-machine-radius')
    expect(parametric.generatedGeometryIds).toHaveLength(2)
  })
})
