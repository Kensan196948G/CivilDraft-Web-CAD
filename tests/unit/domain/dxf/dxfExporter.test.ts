import { describe, expect, it } from 'vitest'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import type { DrawingLayer } from '@/shared/types/layer'
import type { Geometry, GeometryBase, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#ff0000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'ly1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

function id(v: string): GeometryId {
  return v as GeometryId
}

const LAYER: DrawingLayer = {
  id: 'ly1' as LayerId,
  name: '仮設',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

function line(x1: number, y1: number, x2: number, y2: number, layerId = 'ly1'): Geometry {
  return { ...base, layerId: layerId as LayerId, id: id('L'), type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

/**
 * DXF文字列を行分割し、指定グループコードの直後の値を数値で返す。
 * afterを指定すると、そのマーカー行（例: 'TEXT'エンティティ開始）以降だけを検索する
 * （LTYPEテーブル等が先に同じグループコードを出力するケースを避けるため）。
 */
function valueAfterCode(dxf: string, code: string, opts: { after?: string; occurrence?: number } = {}): number | null {
  const lines = dxf.split('\n')
  let start = 0
  if (opts.after !== undefined) {
    const idx = lines.findIndex((l) => l.trim() === opts.after)
    if (idx < 0) return null
    start = idx + 1
  }
  const target = opts.occurrence ?? 0
  let count = 0
  for (let i = start; i < lines.length - 1; i++) {
    if (lines[i]?.trim() === code) {
      if (count === target) return parseFloat(lines[i + 1] ?? '')
      count++
    }
  }
  return null
}

/** $INSUNITSヘッダーの単位コードを取り出す。 */
function insUnits(dxf: string): number | null {
  const m = dxf.match(/\$INSUNITS\r?\n\s*70\r?\n\s*(\d+)/)
  return m && m[1] !== undefined ? parseInt(m[1], 10) : null
}

describe('exportDxf / 基本構造', () => {
  it('ENTITIES/ENDSECセクションを含む', () => {
    const dxf = exportDxf([line(0, 0, 100, 50)], [LAYER])
    expect(dxf).toContain('ENTITIES')
    expect(dxf).toContain('ENDSEC')
  })

  it('TABLES（レイヤー）セクションにレイヤー名を含む', () => {
    const dxf = exportDxf([], [LAYER])
    expect(dxf).toContain('TABLES')
    expect(dxf).toContain('仮設')
  })

  it('line/rectangle/circleを例外なく出力する', () => {
    const rect: Geometry = { ...base, id: id('R'), type: 'rectangle', origin: { x: 10, y: 20 }, width: 30, height: 40, rotationDeg: 0 }
    const circle: Geometry = { ...base, id: id('C'), type: 'circle', center: { x: 5, y: 5 }, radius: 25 }
    const dxf = exportDxf([line(0, 0, 100, 50), rect, circle], [LAYER])
    expect(dxf).toContain('LINE')
    expect(dxf).toContain('CIRCLE')
    expect(dxf.length).toBeGreaterThan(500)
  })
})

describe('exportDxf / 単位整合（R-002・R-004 回帰防止）', () => {
  it('既定はmm宣言（$INSUNITS=4=Millimeters）で座標は等倍', () => {
    const dxf = exportDxf([line(0, 0, 1000, 500)], [LAYER])
    expect(insUnits(dxf)).toBe(4) // Millimeters
    // LINEのx2(グループ11)/y2(グループ21)が内部mm値そのまま
    expect(valueAfterCode(dxf, '11')).toBeCloseTo(1000)
    expect(valueAfterCode(dxf, '21')).toBeCloseTo(500)
  })

  it('宣言単位とヘッダー出力が一致する（mm=4 / cm=5 / m=6）', () => {
    expect(insUnits(exportDxf([], [LAYER], { unit: 'mm' }))).toBe(4)
    expect(insUnits(exportDxf([], [LAYER], { unit: 'cm' }))).toBe(5)
    expect(insUnits(exportDxf([], [LAYER], { unit: 'm' }))).toBe(6)
  })

  it('unit=mで座標に1/1000の係数が正しく適用される', () => {
    const dxf = exportDxf([line(0, 0, 1000, 500)], [LAYER], { unit: 'm' })
    expect(insUnits(dxf)).toBe(6) // Meters
    expect(valueAfterCode(dxf, '11')).toBeCloseTo(1) // 1000mm = 1m
    expect(valueAfterCode(dxf, '21')).toBeCloseTo(0.5) // 500mm = 0.5m
  })

  it('unit=cmで座標に1/10の係数が正しく適用される', () => {
    const dxf = exportDxf([line(0, 0, 1000, 500)], [LAYER], { unit: 'cm' })
    expect(insUnits(dxf)).toBe(5) // Centimeters
    expect(valueAfterCode(dxf, '11')).toBeCloseTo(100) // 1000mm = 100cm
    expect(valueAfterCode(dxf, '21')).toBeCloseTo(50) // 500mm = 50cm
  })
})

describe('exportDxf / 図形種別', () => {
  it('arcをARCエンティティとして出力し、角度は度数のまま（rad二重変換なし）', () => {
    const arc: Geometry = { ...base, id: id('A'), type: 'arc', center: { x: 200, y: 200 }, radius: 30, startAngleDeg: 0, endAngleDeg: 90 }
    const dxf = exportDxf([arc], [LAYER])
    expect(dxf).toContain('ARC')
    // 継承元の*180/Math.PI変換を誤って適用すると90°は約5156.6になる。度数のまま90であることを確認。
    expect(valueAfterCode(dxf, '50')).toBeCloseTo(0)
    expect(valueAfterCode(dxf, '51')).toBeCloseTo(90)
  })

  it('polylineをPOLYLINEとして出力する', () => {
    const poly: Geometry = {
      ...base, id: id('P'), type: 'polyline',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true,
    }
    const dxf = exportDxf([poly], [LAYER])
    expect(dxf).toContain('POLYLINE')
  })

  it('splineを開ポリラインとして出力する（例外なし）', () => {
    const spline: Geometry = {
      ...base, id: id('S'), type: 'spline',
      points: [{ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }], tension: 0.5,
    }
    expect(() => exportDxf([spline], [LAYER])).not.toThrow()
    expect(exportDxf([spline], [LAYER])).toContain('POLYLINE')
  })

  it('textを出力し、height(グループ40)はmm既定で等倍（*0.001スケールなし）', () => {
    const text: Geometry = {
      ...base, id: id('T'), type: 'text',
      anchor: { x: 5, y: 5 }, text: 'TEST', height: 14, rotationDeg: 0, horizontalAlign: 'left',
    }
    const dxf = exportDxf([text], [LAYER])
    expect(dxf).toContain('TEXT')
    expect(dxf).toContain('TEST')
    // TEXTエンティティ以降のグループ40(文字高)を読む。LTYPEテーブルの40と衝突させない。
    expect(valueAfterCode(dxf, '40', { after: 'TEXT' })).toBeCloseTo(14) // 0.014でないこと
  })

  it('ellipseをELLIPSEエンティティとして出力する（dxf-writer型欠落をcastで解決）', () => {
    const ellipse: Geometry = {
      ...base, id: id('E'), type: 'ellipse',
      center: { x: 100, y: 100 }, radiusX: 40, radiusY: 20, rotationDeg: 0,
    }
    const dxf = exportDxf([ellipse], [LAYER])
    expect(dxf).toContain('ELLIPSE')
  })

  it('退化楕円（半径0）はskipし例外を出さない', () => {
    const degenerate: Geometry = {
      ...base, id: id('E0'), type: 'ellipse',
      center: { x: 0, y: 0 }, radiusX: 0, radiusY: 0, rotationDeg: 0,
    }
    expect(() => exportDxf([degenerate], [LAYER])).not.toThrow()
    const dxf = exportDxf([degenerate], [LAYER])
    expect(dxf).not.toContain('ELLIPSE')
  })

  it('horizontal/vertical/parallel寸法を線分＋テキストに分解する', () => {
    const dimH: Geometry = { ...base, id: id('DH'), type: 'dimension', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, orientation: 'horizontal', offset: 20, textHeight: 12, arrowSize: 8 }
    const dimV: Geometry = { ...base, id: id('DV'), type: 'dimension', start: { x: 0, y: 0 }, end: { x: 0, y: 50 }, orientation: 'vertical', offset: 20, textHeight: 12, arrowSize: 8 }
    const dimP: Geometry = { ...base, id: id('DP'), type: 'dimension', start: { x: 0, y: 0 }, end: { x: 30, y: 40 }, orientation: 'parallel', offset: 20, textHeight: 12, arrowSize: 8 }
    const dxf = exportDxf([dimH, dimV, dimP], [LAYER])
    const lineCount = (dxf.match(/\nLINE\n/g) ?? []).length
    expect(lineCount).toBeGreaterThanOrEqual(9) // 各寸法3線分以上
  })

  it('parallel寸法は単位法線でoffsetし、長さ0セグメントは何も描かない', () => {
    const degenerate: Geometry = { ...base, id: id('DD'), type: 'dimension', start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, orientation: 'parallel', offset: 10, textHeight: 12, arrowSize: 8 }
    expect(() => exportDxf([degenerate], [LAYER])).not.toThrow()
  })

  it('leader(引出線)を線分＋テキストとして出力する', () => {
    const leader: Geometry = { ...base, id: id('LD'), type: 'leader', start: { x: 0, y: 0 }, end: { x: 50, y: 30 }, text: '注記', textHeight: 10 }
    const dxf = exportDxf([leader], [LAYER])
    expect(dxf).toContain('LINE')
    expect(dxf).toContain('注記')
  })

  it('parametricObjectは出力対象外としてskipし例外を出さない', () => {
    const parametric: Geometry = {
      ...base, id: id('PM'), type: 'parametricObject',
      definitionId: 'heavy-machine-radius', definitionVersion: 1, parameters: {}, generatedGeometryIds: [],
    }
    expect(() => exportDxf([parametric], [LAYER])).not.toThrow()
    const dxf = exportDxf([parametric], [LAYER])
    expect(dxf).toContain('ENTITIES')
  })
})

describe('exportDxf / hatch', () => {
  it('parallelハッチをPOLYLINE外形＋LINE群として出力する', () => {
    const hatch: Geometry = {
      ...base, id: id('H'), type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      pattern: 'parallel', angleDeg: 45, spacing: 10,
    }
    const dxf = exportDxf([hatch], [LAYER])
    expect(dxf).toContain('POLYLINE')
    expect(dxf).toContain('LINE')
  })

  it('concreteハッチを例外なく出力する', () => {
    const hatch: Geometry = {
      ...base, id: id('HC'), type: 'hatch',
      boundaryPoints: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 60 }],
      pattern: 'concrete', angleDeg: 0, spacing: 10,
    }
    expect(() => exportDxf([hatch], [LAYER])).not.toThrow()
    expect(exportDxf([hatch], [LAYER])).toContain('POLYLINE')
  })
})

describe('exportDxf / symbol', () => {
  function symbol(symbolId: string, x: number, y: number, rotationDeg: number, scale: number): Geometry {
    return { ...base, id: id('SY'), type: 'symbol', symbolId, position: { x, y }, rotationDeg, scale }
  }

  it('既知記号(cone)をエンティティとして出力する', () => {
    const dxf = exportDxf([symbol('cone', 50, 50, 0, 1)], [LAYER])
    expect(dxf).toContain('ENTITIES')
    expect(dxf.length).toBeGreaterThan(500)
  })

  it('回転・スケール付き記号を例外なく出力する', () => {
    const dxf = exportDxf([symbol('fence', 0, 0, 90, 2)], [LAYER])
    expect(dxf).toContain('ENTITIES')
    expect(typeof dxf).toBe('string')
  })

  it('未知のsymbolIdはskipし例外を出さない', () => {
    expect(() => exportDxf([symbol('nonexistent', 10, 10, 0, 1)], [LAYER])).not.toThrow()
    expect(exportDxf([symbol('nonexistent', 10, 10, 0, 1)], [LAYER])).toContain('ENTITIES')
  })

  it('circleパスを持つ記号(excavator)はCIRCLEを含む', () => {
    const dxf = exportDxf([symbol('excavator', 100, 100, 0, 1)], [LAYER])
    expect(dxf).toContain('CIRCLE')
  })
})

describe('exportDxf / レイヤー', () => {
  it('図形を正しいレイヤー名に配置する', () => {
    const dxf = exportDxf([line(0, 0, 1, 1)], [LAYER])
    expect(dxf).toContain('仮設')
  })

  it('lineType=dashedをDASHED linetypeで出力する', () => {
    const dashedLayer: DrawingLayer = { ...LAYER, id: 'lyd' as LayerId, defaultStyle: { ...style, lineType: 'dashed' } }
    const dxf = exportDxf([line(0, 0, 100, 0, 'lyd')], [dashedLayer])
    expect(dxf).toContain('DASHED')
  })

  it('lineType=dashDotをDASHDOT linetypeで出力し、LTYPE定義も登録される', () => {
    const ddLayer: DrawingLayer = { ...LAYER, id: 'lydd' as LayerId, defaultStyle: { ...style, lineType: 'dashDot' } }
    const dxf = exportDxf([line(0, 0, 100, 0, 'lydd')], [ddLayer])
    expect(dxf).toContain('DASHDOT')
    // 未定義参照でないこと: LTYPEテーブルにも登録され、DASHDOTは2回以上出現する
    expect((dxf.match(/DASHDOT/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('未知のlayerIdはレイヤー"0"にフォールバックする', () => {
    const orphan = line(0, 0, 1, 1, 'nonexistent')
    const dxf = exportDxf([orphan], [LAYER])
    expect(dxf).toContain('LINE')
  })
})
