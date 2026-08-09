import { describe, expect, it } from 'vitest'
import { exportSxfP21 } from '@/domain/edelivery/sxfP21'
import type { Geometry, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base = {
  layerId: 'layer-1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
}

const id = (v: string): GeometryId => v as GeometryId

describe('sxfP21 / 試作エクスポータ', () => {
  it('ISO-10303-21 ヘッダと SXF スキーマを出力する', () => {
    const result = exportSxfP21([], { fileName: 'test.P21', drawingName: '施工図' })
    expect(result.text).toContain('ISO-10303-21;')
    expect(result.text).toContain("FILE_SCHEMA(('SXF'));")
    expect(result.text).toContain('ENDSEC;')
    expect(result.text).toContain('END-ISO-10303-21;')
  })

  it('線分・ポリライン・円を AP202 エンティティとして出力する', () => {
    const geometries: Geometry[] = [
      {
        ...base,
        id: id('l1'),
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 1000, y: 0 },
      },
      {
        ...base,
        id: id('p1'),
        type: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        closed: false,
      },
      {
        ...base,
        id: id('c1'),
        type: 'circle',
        center: { x: 50, y: 50 },
        radius: 25,
      },
    ]
    const result = exportSxfP21(geometries, { fileName: 'test.P21', drawingName: '施工図' })
    expect(result.exportedCount).toBe(3)
    expect(result.text).toContain('LINE(')
    expect(result.text).toContain('POLYLINE(')
    expect(result.text).toContain('CIRCLE(')
    expect(result.text).toContain('SHAPE_REPRESENTATION')
    expect(result.issues).toHaveLength(0)
  })

  it('円弧は TRIMMED_CURVE として出力し、未対応図形（楕円）は警告を積む', () => {
    const geometries: Geometry[] = [
      {
        ...base,
        id: id('a1'),
        type: 'arc',
        center: { x: 0, y: 0 },
        radius: 100,
        startAngleDeg: 0,
        endAngleDeg: 180,
      },
      {
        ...base,
        id: id('e1'),
        type: 'ellipse',
        center: { x: 0, y: 0 },
        radiusX: 10,
        radiusY: 20,
        rotationDeg: 0,
      },
    ]
    const result = exportSxfP21(geometries, { fileName: 'test.P21', drawingName: '施工図' })
    expect(result.exportedCount).toBe(1)
    expect(result.text).toContain('TRIMMED_CURVE(')
    expect(result.text).toContain('PARAMETER_VALUE(')
    expect(result.issues.some((issue) => issue.includes('楕円'))).toBe(true)
  })
})
