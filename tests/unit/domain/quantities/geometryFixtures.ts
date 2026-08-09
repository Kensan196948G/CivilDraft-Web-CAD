/**
 * 数量算出テスト用の図形フィクスチャ生成ヘルパー（.test. を含まないため vitest の対象外）。
 * GeometryBase の共通フィールドを埋め、型固有フィールドだけを引数で受け取る。
 */
import type {
  ArcGeometry,
  CircleGeometry,
  CloudGeometry,
  EllipseGeometry,
  GeometryId,
  HatchGeometry,
  LayerId,
  LineGeometry,
  MLineGeometry,
  Point,
  PolylineGeometry,
  RectangleGeometry,
  SymbolGeometry,
} from '@/shared/types'

const STYLE = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
} as const

function base(id: string) {
  return {
    id: id as GeometryId,
    layerId: 'layer-1' as LayerId,
    style: STYLE,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as const
}

export function makeLine(id: string, start: Point, end: Point): LineGeometry {
  return { ...base(id), type: 'line', start, end }
}

export function makePolyline(id: string, points: readonly Point[], closed = false): PolylineGeometry {
  return { ...base(id), type: 'polyline', points, closed }
}

export function makeCircle(id: string, center: Point, radius: number): CircleGeometry {
  return { ...base(id), type: 'circle', center, radius }
}

export function makeRectangle(id: string, origin: Point, width: number, height: number): RectangleGeometry {
  return { ...base(id), type: 'rectangle', origin, width, height, rotationDeg: 0 }
}

export function makeArc(id: string, center: Point, radius: number, startAngleDeg: number, endAngleDeg: number): ArcGeometry {
  return { ...base(id), type: 'arc', center, radius, startAngleDeg, endAngleDeg }
}

export function makeEllipse(id: string, center: Point, radiusX: number, radiusY: number): EllipseGeometry {
  return { ...base(id), type: 'ellipse', center, radiusX, radiusY, rotationDeg: 0 }
}

export function makeHatch(id: string, boundaryPoints: readonly Point[]): HatchGeometry {
  return { ...base(id), type: 'hatch', boundaryPoints, pattern: 'parallel', angleDeg: 0, spacing: 10 }
}

export function makeSymbol(id: string, position: Point): SymbolGeometry {
  return { ...base(id), type: 'symbol', symbolId: 'sym-1', position, rotationDeg: 0, scale: 1 }
}

export function makeMline(id: string, start: Point, end: Point): MLineGeometry {
  return { ...base(id), type: 'mline', start, end, offset: 10 }
}

export function makeCloud(id: string, x1: number, y1: number, x2: number, y2: number): CloudGeometry {
  return { ...base(id), type: 'cloud', x1, y1, x2, y2, arcSize: 15 }
}
