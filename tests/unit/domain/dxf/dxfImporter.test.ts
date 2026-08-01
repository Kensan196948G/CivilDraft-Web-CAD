import { afterEach, describe, expect, it, vi } from 'vitest'
import DxfParser from 'dxf-parser'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { importDxf, type ImportResult } from '@/domain/dxf/dxfImporter'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Result,
  ValidationIssue,
} from '@/shared/types'
import type { DrawingLayer } from '@/shared/types/layer'

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

// ---------------------------------------------------------------------------
// テストヘルパー
// ---------------------------------------------------------------------------

/** 決定的な ID/タイムスタンプを注入するコンテキスト（ADR-0013）。ID は g0,g1,... の連番。 */
function seqCtx(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `g${n++}` as GeometryId,
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

/** ok を前提に value を取り出す（error 側なら失敗させる）。 */
function unwrap(r: Result<ImportResult, ValidationIssue>): ImportResult {
  if (!r.ok) throw new Error(`expected ok result but got error: ${r.error.code}`)
  return r.value
}

function issueCodes(r: ImportResult): string[] {
  return r.issues.map((i) => i.code)
}

/** ENTITIES セクションのみの最小 DXF を組み立てる。 */
function entitiesDxf(body: string): string {
  return `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`
}

/** HEADER($INSUNITS) + ENTITIES の DXF を組み立てる。 */
function dxfWithUnits(insunits: number, body: string): string {
  return (
    `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${insunits}\n0\nENDSEC\n` +
    `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`
  )
}

const LINE_BODY = `0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n100.0\n21\n50.0\n`

function findByType<T extends Geometry['type']>(
  r: ImportResult,
  type: T,
): Extract<Geometry, { type: T }> | undefined {
  return r.geometries.find((g): g is Extract<Geometry, { type: T }> => g.type === type)
}

// ---------------------------------------------------------------------------
// R-002 / R-004: 単位変換回帰テスト（最重要）
// ---------------------------------------------------------------------------
describe('importDxf / 単位変換（$INSUNITS → 内部基準mm、R-002/R-004）', () => {
  it('$INSUNITS=6(Meters) は座標を×1000してmmにする', () => {
    const r = unwrap(importDxf(dxfWithUnits(6, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line).toBeDefined()
    expect(line?.start.x).toBeCloseTo(0)
    expect(line?.start.y).toBeCloseTo(0)
    expect(line?.end.x).toBeCloseTo(100000)
    expect(line?.end.y).toBeCloseTo(50000)
  })

  it('$INSUNITS=4(Millimeters) は等倍', () => {
    const r = unwrap(importDxf(dxfWithUnits(4, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(100)
    expect(line?.end.y).toBeCloseTo(50)
    expect(issueCodes(r)).not.toContain('dxf-unsupported-unit')
  })

  it('$INSUNITS=5(Centimeters) は座標を×10する', () => {
    const r = unwrap(importDxf(dxfWithUnits(5, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(1000)
    expect(line?.end.y).toBeCloseTo(500)
  })

  it('$INSUNITS 欠落時は mm 既定（無変換）で未対応単位issueを出さない', () => {
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(100)
    expect(issueCodes(r)).not.toContain('dxf-unsupported-unit')
  })

  it('$INSUNITS=1(Inches, 未対応) は無変換＋未対応単位issue(warning)', () => {
    const r = unwrap(importDxf(dxfWithUnits(1, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(100) // 無変換(mm扱い)
    const unitIssue = r.issues.find((i) => i.code === 'dxf-unsupported-unit')
    expect(unitIssue).toBeDefined()
    expect(unitIssue?.severity).toBe('warning')
  })

  it('$INSUNITS=0(Unitless) は mm 既定（無変換）で issue を出さない', () => {
    const r = unwrap(importDxf(dxfWithUnits(0, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(100)
    expect(issueCodes(r)).not.toContain('dxf-unsupported-unit')
  })
})

// ---------------------------------------------------------------------------
// エンティティ → Geometry マッピング（実DXF fixture、dxf-parser 経路）
// ---------------------------------------------------------------------------
describe('importDxf / エンティティマッピング', () => {
  it('LINE → LineGeometry', () => {
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line).toBeDefined()
    expect(line?.start).toEqual({ x: 0, y: 0 })
    expect(line?.end).toEqual({ x: 100, y: 50 })
  })

  it('CIRCLE → CircleGeometry', () => {
    const body = `0\nCIRCLE\n8\n0\n10\n25.0\n20\n25.0\n40\n15.0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const circle = findByType(r, 'circle')
    expect(circle?.center).toEqual({ x: 25, y: 25 })
    expect(circle?.radius).toBeCloseTo(15)
  })

  it('ARC → ArcGeometry（dxf-parserのラジアンを度数法へ変換）', () => {
    const body = `0\nARC\n8\n0\n10\n50.0\n20\n50.0\n40\n30.0\n50\n0.0\n51\n90.0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const arc = findByType(r, 'arc')
    expect(arc?.center).toEqual({ x: 50, y: 50 })
    expect(arc?.radius).toBeCloseTo(30)
    expect(arc?.startAngleDeg).toBeCloseTo(0)
    expect(arc?.endAngleDeg).toBeCloseTo(90)
  })

  it('LWPOLYLINE → PolylineGeometry（closedフラグ, Point[]）', () => {
    const body = `0\nLWPOLYLINE\n8\n0\n90\n3\n70\n1\n10\n0\n20\n0\n10\n50\n20\n0\n10\n50\n20\n50\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const poly = findByType(r, 'polyline')
    expect(poly?.points).toHaveLength(3)
    expect(poly?.points[0]).toEqual({ x: 0, y: 0 })
    expect(poly?.closed).toBe(true)
  })

  it('TEXT → TextGeometry（rotationは度数法のまま）', () => {
    const body = `0\nTEXT\n8\n0\n10\n50.0\n20\n100.0\n40\n14.0\n50\n30.0\n1\nHello World\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const text = findByType(r, 'text')
    expect(text?.anchor).toEqual({ x: 50, y: 100 })
    expect(text?.text).toBe('Hello World')
    expect(text?.height).toBeCloseTo(14)
    expect(text?.rotationDeg).toBeCloseTo(30)
    expect(text?.horizontalAlign).toBe('left')
  })

  it('MTEXT → TextGeometry（position を anchor に）', () => {
    const body = `0\nMTEXT\n8\n0\n10\n7.0\n20\n8.0\n40\n12.0\n1\nNote\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const text = findByType(r, 'text')
    expect(text?.anchor).toEqual({ x: 7, y: 8 })
    expect(text?.height).toBeCloseTo(12)
  })

  it('SPLINE(fitPoints) → SplineGeometry（Point[], tension既定）', () => {
    const body =
      `0\nSPLINE\n8\n0\n11\n0\n21\n0\n31\n0\n11\n10\n21\n20\n31\n0\n11\n20\n21\n0\n31\n0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const spline = findByType(r, 'spline')
    expect(spline?.points).toHaveLength(3)
    expect(spline?.points[0]).toEqual({ x: 0, y: 0 })
    expect(spline?.points[1]).toEqual({ x: 10, y: 20 })
    expect(spline?.tension).toBeCloseTo(0.5)
  })

  it('SPLINE(点不足) → 生成せず spline-insufficient issue', () => {
    const body = `0\nSPLINE\n8\n0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    expect(findByType(r, 'spline')).toBeUndefined()
    expect(issueCodes(r)).toContain('dxf-spline-insufficient')
  })

  it('ELLIPSE 全楕円 → EllipseGeometry（radiusX/radiusY/rotationDeg）', () => {
    // center(10,20), major(5,0), ratio 0.5, start 0, end 2π
    const body =
      `0\nELLIPSE\n8\n0\n10\n10\n20\n20\n30\n0\n11\n5\n21\n0\n31\n0\n40\n0.5\n41\n0\n42\n6.283185307179586\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const ellipse = findByType(r, 'ellipse')
    expect(ellipse).toBeDefined()
    expect(ellipse?.center).toEqual({ x: 10, y: 20 })
    expect(ellipse?.radiusX).toBeCloseTo(5)
    expect(ellipse?.radiusY).toBeCloseTo(2.5)
    expect(ellipse?.rotationDeg).toBeCloseTo(0)
  })

  it('ELLIPSE 楕円弧(部分) → 折れ線近似(65点) + info issue', () => {
    // center(0,0), major(10,0), ratio 0.5, start 0, end π
    const body =
      `0\nELLIPSE\n8\n0\n10\n0\n20\n0\n30\n0\n11\n10\n21\n0\n31\n0\n40\n0.5\n41\n0\n42\n3.141592653589793\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    expect(findByType(r, 'ellipse')).toBeUndefined()
    const poly = findByType(r, 'polyline')
    expect(poly?.points).toHaveLength(65)
    expect(poly?.closed).toBe(false)
    expect(poly?.points[0]).toEqual({ x: 10, y: 0 })
    expect(poly?.points[64]?.x).toBeCloseTo(-10)
    expect(poly?.points[64]?.y).toBeCloseTo(0)
    expect(issueCodes(r)).toContain('dxf-ellipse-arc-approximated')
  })

  it('ELLIPSE(center欠落) → 生成せず ellipse-insufficient issue', () => {
    const body = `0\nELLIPSE\n8\n0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    expect(findByType(r, 'ellipse')).toBeUndefined()
    expect(issueCodes(r)).toContain('dxf-ellipse-insufficient')
  })

  it('未対応エンティティ(POINT) → unsupported-entity issue', () => {
    const body = `0\nPOINT\n8\n0\n10\n0\n20\n0\n30\n0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const issue = r.issues.find((i) => i.code === 'dxf-unsupported-entity')
    expect(issue).toBeDefined()
    expect(issue?.field).toBe('POINT')
  })
})

// ---------------------------------------------------------------------------
// HATCH（独自パーサ DXF-002）
// ---------------------------------------------------------------------------
describe('importDxf / HATCH', () => {
  const hatchBody = (pattern: string, angle = 45) =>
    `0\nHATCH\n8\n0\n2\n${pattern}\n70\n0\n71\n0\n91\n1\n92\n1\n93\n4\n` +
    `72\n1\n10\n0.0\n20\n0.0\n11\n100.0\n21\n0.0\n` +
    `72\n1\n10\n100.0\n20\n0.0\n11\n100.0\n21\n100.0\n` +
    `72\n1\n10\n100.0\n20\n100.0\n11\n0.0\n21\n100.0\n` +
    `72\n1\n10\n0.0\n20\n100.0\n11\n0.0\n21\n0.0\n` +
    `75\n1\n76\n1\n52\n${angle}\n41\n2.0\n77\n0\n78\n0\n`

  it('ライン境界の HATCH → HatchGeometry + hatch-imported issue', () => {
    const r = unwrap(importDxf(entitiesDxf(hatchBody('ANSI31', 45)), seqCtx()))
    const hatch = findByType(r, 'hatch')
    expect(hatch?.pattern).toBe('parallel')
    expect(hatch?.angleDeg).toBeCloseTo(45)
    expect(hatch?.boundaryPoints.length).toBeGreaterThanOrEqual(4)
    expect(issueCodes(r)).toContain('dxf-hatch-imported')
  })

  it('DXFパターン名 → 内部HatchPattern マッピング', () => {
    const cases: [string, string][] = [
      ['ANSI31', 'parallel'],
      ['ANSI32', 'cross'],
      ['GRAVEL', 'gravel'],
      ['EARTH', 'earth'],
      ['CONCRETE', 'concrete'],
      ['ROCK', 'rock'],
      ['ASPHALT', 'asphalt'],
      ['WOOD', 'wood'],
      ['STEEL', 'steel'],
      ['WATER', 'water'],
      ['UNKNOWN_XYZ', 'parallel'],
    ]
    for (const [name, expected] of cases) {
      const r = unwrap(importDxf(entitiesDxf(hatchBody(name)), seqCtx()))
      const hatch = findByType(r, 'hatch')
      expect(hatch?.pattern, `pattern for ${name}`).toBe(expected)
    }
  })

  it('境界不足の HATCH は生成しない', () => {
    const body = `0\nHATCH\n8\n0\n2\nANSI31\n91\n0\n52\n0.0\n41\n1.0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    expect(findByType(r, 'hatch')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// レイヤー合成（DrawingLayer）
// ---------------------------------------------------------------------------
describe('importDxf / レイヤー合成（DrawingLayer）', () => {
  const withLayerTable = (layerName: string, aci: number, entityLayer: string) =>
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n` +
    `0\nLAYER\n2\n${layerName}\n70\n0\n62\n${aci}\n0\nENDTAB\n0\nENDSEC\n` +
    `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n${entityLayer}\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n`

  it('LAYERテーブル → DrawingLayer（order/visible/locked/printable/defaultStyle合成）', () => {
    const r = unwrap(importDxf(withLayerTable('WALL', 1, 'WALL'), seqCtx()))
    const layer = r.layers.find((l) => l.name === 'WALL')
    expect(layer).toBeDefined()
    expect(layer?.order).toBe(0)
    expect(layer?.visible).toBe(true)
    expect(layer?.locked).toBe(false)
    expect(layer?.printable).toBe(true)
    // ACI 1 → 赤。defaultStyle は色以外は既定値。
    expect(layer?.defaultStyle.strokeColor).toBe('#ff0000')
    expect(layer?.defaultStyle.lineType).toBe('continuous')
  })

  it('ACI colorIndex → defaultStyle.strokeColor（青=5）', () => {
    const r = unwrap(importDxf(withLayerTable('SKY', 5, 'SKY'), seqCtx()))
    const layer = r.layers.find((l) => l.name === 'SKY')
    expect(layer?.defaultStyle.strokeColor).toBe('#0000ff')
  })

  it('図形styleは所属レイヤーのdefaultStyleを複製する', () => {
    const r = unwrap(importDxf(withLayerTable('WALL', 1, 'WALL'), seqCtx()))
    const line = findByType(r, 'line')
    const layer = r.layers.find((l) => l.name === 'WALL')
    expect(line?.style.strokeColor).toBe('#ff0000')
    expect(line?.layerId).toBe(layer?.id)
  })

  it('未知レイヤー参照の図形は先頭レイヤーへフォールバックする', () => {
    const r = unwrap(importDxf(withLayerTable('WALL', 1, 'NONEXISTENT'), seqCtx()))
    const line = findByType(r, 'line')
    expect(line).toBeDefined()
    expect(line?.layerId).toBe(r.layers[0]?.id)
  })

  it('LAYERテーブルが無い場合は既定レイヤー"0"を1つ生成する', () => {
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY), seqCtx()))
    expect(r.layers).toHaveLength(1)
    expect(r.layers[0]?.name).toBe('0')
  })

  it('LAYER テーブルの linetype(6) と lock フラグ(70 bit4) を反映する（線種往復・#40残）', () => {
    const dxf =
      `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n` +
      `0\nLAYER\n2\nDASH\n6\nDASHED\n70\n4\n62\n3\n` +
      `0\nLAYER\n2\nDOT\n6\nDASHDOT\n70\n0\n62\n5\n` +
      `0\nENDTAB\n0\nENDSEC\n` +
      `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nDASH\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n`
    const r = unwrap(importDxf(dxf, seqCtx()))
    const dash = r.layers.find((l) => l.name === 'DASH')
    const dot = r.layers.find((l) => l.name === 'DOT')
    expect(dash?.defaultStyle.lineType).toBe('dashed')
    expect(dash?.locked).toBe(true)
    expect(dot?.defaultStyle.lineType).toBe('dashDot')
    expect(dot?.locked).toBe(false)
  })

  it('LAYER フラグ(70) の frozen ビットを visible=false へ反映する', () => {
    const dxf =
      `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n` +
      `0\nLAYER\n2\nFROZEN\n70\n1\n62\n7\n` +
      `0\nENDTAB\n0\nENDSEC\n` +
      `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nFROZEN\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n`
    const r = unwrap(importDxf(dxf, seqCtx()))
    const frozen = r.layers.find((l) => l.name === 'FROZEN')
    expect(frozen?.visible).toBe(false)
  })

  it('exportDxf → importDxf の往復で線種（dashed/dashDot）が保持される', () => {
    const dashLayer: DrawingLayer = {
      id: 'ly-dash' as LayerId,
      name: 'DASH',
      order: 0,
      visible: true,
      locked: false,
      printable: true,
      defaultStyle: { ...style, lineType: 'dashed', strokeColor: '#2E9E6B' },
    }
    const dotLayer: DrawingLayer = {
      id: 'ly-dot' as LayerId,
      name: 'DOT',
      order: 1,
      visible: true,
      locked: false,
      printable: true,
      defaultStyle: { ...style, lineType: 'dashDot', strokeColor: '#E08A2B' },
    }
    const geometry: Geometry = {
      ...base,
      id: 'g1' as GeometryId,
      layerId: dashLayer.id,
      type: 'line',
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
    }
    const dxf = exportDxf([geometry], [dashLayer, dotLayer])
    const r = unwrap(importDxf(dxf, seqCtx()))
    expect(r.layers.find((l) => l.name === 'DASH')?.defaultStyle.lineType).toBe('dashed')
    expect(r.layers.find((l) => l.name === 'DOT')?.defaultStyle.lineType).toBe('dashDot')
  })
})

// ---------------------------------------------------------------------------
// Result / 決定性 / XDATA
// ---------------------------------------------------------------------------
describe('importDxf / Result・決定性・XDATA', () => {
  it('空入力は error 側（ok:false, dxf-empty）', () => {
    const r = importDxf('', seqCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('dxf-empty')
  })

  it('空白のみの入力も error 側', () => {
    const r = importDxf('   \n  \t\n', seqCtx())
    expect(r.ok).toBe(false)
  })

  it('決定的ctxで createdAt/updatedAt が固定され id が連番になる', () => {
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.createdAt).toBe('2026-07-15T00:00:00.000Z')
    expect(line?.updatedAt).toBe('2026-07-15T00:00:00.000Z')
    // レイヤー"0"が g0、LINEが g1（生成順）。
    expect(r.layers[0]?.id).toBe('g0')
    expect(line?.id).toBe('g1')
  })

  it('既定コンテキスト省略時も動作する（crypto.randomUUID）', () => {
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY)))
    const line = findByType(r, 'line')
    expect(line?.id).toBeTruthy()
    expect(typeof line?.id).toBe('string')
    expect(defaultCreationContext.newId()).toBeTruthy()
  })

  it('XDATA(1000-1071)は除去され info issue、LINEは取り込まれる', () => {
    const body = `0\nLINE\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n10.0\n1001\nACDB_ROUNDTRIP\n1000\nsome xdata\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    expect(issueCodes(r)).toContain('dxf-xdata-stripped')
    expect(findByType(r, 'line')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// fallback 経路（dxf-parser が null を返すケース、DXF-004）
// ---------------------------------------------------------------------------
describe('importDxf / fallback 経路（DXF-004）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const forceFallback = () => {
    vi.spyOn(DxfParser.prototype, 'parseSync').mockReturnValue(null as never)
  }

  it('LINE を抽出し compat-mode 警告を出す', () => {
    forceFallback()
    const r = unwrap(importDxf(entitiesDxf(LINE_BODY), seqCtx()))
    expect(issueCodes(r)).toContain('dxf-compat-mode')
    expect(issueCodes(r)).toContain('dxf-fallback-extracted')
    const line = findByType(r, 'line')
    expect(line?.start).toEqual({ x: 0, y: 0 })
    expect(line?.end).toEqual({ x: 100, y: 50 })
  })

  it('CIRCLE を抽出する', () => {
    forceFallback()
    const body = `0\nCIRCLE\n8\n0\n10\n50.0\n20\n50.0\n40\n25.0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const circle = findByType(r, 'circle')
    expect(circle?.center).toEqual({ x: 50, y: 50 })
    expect(circle?.radius).toBeCloseTo(25)
  })

  it('ARC の生DXF角度(度数法)は無変換で startAngleDeg/endAngleDeg に入る', () => {
    forceFallback()
    const body = `0\nARC\n8\n0\n10\n50.0\n20\n50.0\n40\n30.0\n50\n0.0\n51\n90.0\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const arc = findByType(r, 'arc')
    expect(arc?.startAngleDeg).toBeCloseTo(0)
    expect(arc?.endAngleDeg).toBeCloseTo(90)
  })

  it('レガシー POLYLINE + VERTEX + SEQEND を統合して取り込む', () => {
    forceFallback()
    const body =
      `0\nPOLYLINE\n8\n0\n70\n1\n0\nVERTEX\n8\n0\n10\n0.0\n20\n0.0\n` +
      `0\nVERTEX\n8\n0\n10\n50.0\n20\n0.0\n0\nVERTEX\n8\n0\n10\n50.0\n20\n50.0\n0\nSEQEND\n`
    const r = unwrap(importDxf(entitiesDxf(body), seqCtx()))
    const poly = findByType(r, 'polyline')
    expect(poly?.points.length).toBeGreaterThanOrEqual(2)
    expect(poly?.closed).toBe(true)
  })

  it('fallback 経路でも $INSUNITS=6 の単位変換が適用される', () => {
    forceFallback()
    const r = unwrap(importDxf(dxfWithUnits(6, LINE_BODY), seqCtx()))
    const line = findByType(r, 'line')
    expect(line?.end.x).toBeCloseTo(100000)
    expect(line?.end.y).toBeCloseTo(50000)
  })

  it('生テキストの LAYER テーブルを抽出する', () => {
    forceFallback()
    const content =
      `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nMyLayer\n62\n7\n0\nENDTAB\n0\nENDSEC\n` +
      `0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nMyLayer\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n`
    const r = unwrap(importDxf(content, seqCtx()))
    expect(r.layers.find((l) => l.name === 'MyLayer')).toBeDefined()
  })
})
