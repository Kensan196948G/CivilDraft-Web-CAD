/**
 * exportPdf 統合テスト。
 * - 全13種の図形が例外なく描画され %PDF- バイト列が生成される
 * - フォント代替（非ASCII＋フォント未注入）／フォント埋込失敗の退避
 * - printable=false（レイヤー/スタイル）の除外
 * - 表題欄（値の代替判定）／出力日時 ctx.now() 注入の決定性
 * - Result の error 側（不正縮尺・余白）
 */
import { describe, expect, it, vi } from 'vitest'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import type { PdfExportOptions } from '@/domain/pdf/pdfExporter'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  ArcGeometry,
  CircleGeometry,
  DimensionGeometry,
  DrawingLayer,
  EllipseGeometry,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  HatchGeometry,
  LayerId,
  LeaderGeometry,
  LineGeometry,
  ParametricGeometry,
  PolylineGeometry,
  RectangleGeometry,
  Result,
  SplineGeometry,
  SymbolGeometry,
  TextGeometry,
  ValidationIssue,
} from '@/shared/types'

// ── ヘルパー ─────────────────────────────────────
const gid = (s: string): GeometryId => s as unknown as GeometryId
const lid = (s: string): LayerId => s as unknown as LayerId

function style(over: Partial<GeometryStyle> = {}): GeometryStyle {
  return {
    strokeColor: '#000000',
    strokeWidth: 1,
    lineType: 'continuous',
    opacity: 1,
    printable: true,
    ...over,
  }
}

let seq = 0
function base(over: Partial<Omit<GeometryBase, 'type'>> = {}): Omit<GeometryBase, 'type'> {
  return {
    id: gid(`g${seq++}`),
    layerId: lid('layer-1'),
    style: style(),
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function layer(over: Partial<DrawingLayer> = {}): DrawingLayer {
  return {
    id: lid('layer-1'),
    name: 'L1',
    order: 0,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: style(),
    ...over,
  }
}

function seqCtx(): GeometryCreationContext {
  let i = 0
  return {
    newId: () => gid(`ctx-${i++}`),
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

const OPTS: PdfExportOptions = { paperSize: 'A3', orientation: 'landscape', scale: 100 }

function pdfMagic(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

function unwrap<T>(r: Result<T, ValidationIssue>): T {
  if (!r.ok) throw new Error(`expected ok Result, got error: ${r.error.code}`)
  return r.value
}

// ── 全13種の図形ビルダー ─────────────────────────
const line: LineGeometry = { ...base(), type: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 800 } }
const rectangle: RectangleGeometry = {
  ...base(),
  type: 'rectangle',
  origin: { x: 0, y: 0 },
  width: 1000,
  height: 500,
  rotationDeg: 15,
}
const circle: CircleGeometry = { ...base(), type: 'circle', center: { x: 500, y: 500 }, radius: 300 }
const arc: ArcGeometry = {
  ...base(),
  type: 'arc',
  center: { x: 0, y: 0 },
  radius: 400,
  startAngleDeg: 0,
  endAngleDeg: 90,
}
const ellipse: EllipseGeometry = {
  ...base(),
  type: 'ellipse',
  center: { x: 0, y: 0 },
  radiusX: 300,
  radiusY: 150,
  rotationDeg: 30,
}
const polyline: PolylineGeometry = {
  ...base(),
  type: 'polyline',
  points: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
  ],
  closed: true,
}
const spline: SplineGeometry = {
  ...base(),
  type: 'spline',
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 100 },
    { x: 100, y: 0 },
  ],
  tension: 0.5,
}
const text: TextGeometry = {
  ...base(),
  type: 'text',
  anchor: { x: 0, y: 0 },
  text: 'HELLO',
  height: 100,
  rotationDeg: 0,
  horizontalAlign: 'left',
}
const dimension: DimensionGeometry = {
  ...base(),
  type: 'dimension',
  start: { x: 0, y: 0 },
  end: { x: 1000, y: 0 },
  orientation: 'horizontal',
  offset: 50,
  textHeight: 80,
  arrowSize: 40,
}
const leader: LeaderGeometry = {
  ...base(),
  type: 'leader',
  start: { x: 0, y: 0 },
  end: { x: 200, y: 200 },
  text: 'NOTE',
  textHeight: 80,
}
const hatch: HatchGeometry = {
  ...base(),
  type: 'hatch',
  boundaryPoints: [
    { x: 0, y: 0 },
    { x: 500, y: 0 },
    { x: 500, y: 500 },
    { x: 0, y: 500 },
  ],
  pattern: 'parallel',
  angleDeg: 45,
  spacing: 50,
}
const symbol: SymbolGeometry = {
  ...base(),
  type: 'symbol',
  symbolId: 'cone',
  position: { x: 0, y: 0 },
  rotationDeg: 0,
  scale: 2,
}
const parametric: ParametricGeometry = {
  ...base(),
  type: 'parametricObject',
  definitionId: 'd1',
  definitionVersion: 1,
  parameters: {},
  generatedGeometryIds: [],
}

const ALL: readonly Geometry[] = [
  line,
  rectangle,
  circle,
  arc,
  ellipse,
  polyline,
  spline,
  text,
  dimension,
  leader,
  hatch,
  symbol,
  parametric,
]

// ── テスト ───────────────────────────────────────
describe('exportPdf: 全13種の描画', () => {
  it.each(ALL.map((g) => [g.type, g] as const))(
    '%s を単体で描画しても例外なく %%PDF- を生成する',
    async (_type, geometry) => {
      const r = await exportPdf([geometry], [layer()], OPTS, seqCtx())
      const v = unwrap(r)
      expect(pdfMagic(v.bytes)).toBe('%PDF-')
      expect(v.bytes.length).toBeGreaterThan(0)
    },
  )

  it('13種を一括描画しても成功する', async () => {
    const r = await exportPdf(ALL, [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    expect(pdfMagic(v.bytes)).toBe('%PDF-')
  })

  it('図形が空でも枠＋表題欄のみのPDFを生成する', async () => {
    const r = await exportPdf([], [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    expect(pdfMagic(v.bytes)).toBe('%PDF-')
  })
})

describe('exportPdf: フォント代替規則（§24.1）', () => {
  it('日本語テキスト＋フォント未注入 → PDF_FONT_FALLBACK warning、bytesは生成', async () => {
    const jp: TextGeometry = { ...base(), type: 'text', anchor: { x: 0, y: 0 }, text: '基準点', height: 100, rotationDeg: 0, horizontalAlign: 'left' }
    const r = await exportPdf([jp], [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    const fb = v.issues.filter((i) => i.code === 'PDF_FONT_FALLBACK')
    expect(fb.length).toBeGreaterThanOrEqual(1)
    expect(fb[0]?.severity).toBe('warning')
    expect(fb.some((i) => i.message.includes('基準点'))).toBe(true)
    expect(pdfMagic(v.bytes)).toBe('%PDF-')
  })

  it('ASCIIテキスト → 図形起因のPDF_FONT_FALLBACKは出ない', async () => {
    const r = await exportPdf([text], [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    const fromEntity = v.issues.filter((i) => i.code === 'PDF_FONT_FALLBACK' && i.field !== 'titleBlock')
    expect(fromEntity).toHaveLength(0)
  })

  it('不正なフォントバイト → PDF_FONT_EMBED_FAILED warning、標準フォントへ退避して生成', async () => {
    const optsBadFont: PdfExportOptions = { ...OPTS, japaneseFontBytes: new Uint8Array([1, 2, 3, 4, 5]) }
    const r = await exportPdf([text], [layer()], optsBadFont, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_EMBED_FAILED')).toBe(true)
    expect(pdfMagic(v.bytes)).toBe('%PDF-')
  })
})

describe('exportPdf: printable除外（§6.3）', () => {
  // 除外の観測はフォント代替issueの有無で間接検証する（日本語テキストが描画されれば必ずfallback issue）。
  const jpText: TextGeometry = { ...base(), type: 'text', anchor: { x: 0, y: 0 }, text: '除外対象', height: 100, rotationDeg: 0, horizontalAlign: 'left' }

  it('style.printable=false の図形は描画されない（fallback issueなし）', async () => {
    const g: TextGeometry = { ...jpText, id: gid('gp1'), style: style({ printable: false }) }
    const r = await exportPdf([g], [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === 'gp1')).toBe(false)
  })

  it('printable=true なら描画される（entityId付きfallback issueあり）', async () => {
    const g: TextGeometry = { ...jpText, id: gid('gp2'), style: style({ printable: true }) }
    const r = await exportPdf([g], [layer()], OPTS, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === 'gp2')).toBe(true)
  })

  it('printable=false のレイヤー上の図形は描画されない', async () => {
    const g: TextGeometry = { ...jpText, id: gid('gp3'), layerId: lid('hidden') }
    const nonPrintLayer = layer({ id: lid('hidden'), printable: false })
    const r = await exportPdf([g], [nonPrintLayer], OPTS, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === 'gp3')).toBe(false)
  })
})

describe('exportPdf: 表題欄と出力日時', () => {
  it('日本語のprojectName＋フォント未注入 → titleBlock由来のPDF_FONT_FALLBACK', async () => {
    const opts: PdfExportOptions = { ...OPTS, titleBlock: { projectName: '橋梁詳細図', drawingNumber: 'A-001', revision: 'B' } }
    const r = await exportPdf([], [layer()], opts, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.field === 'titleBlock')).toBe(true)
  })

  it('ASCIIのtitleBlock → titleBlock由来のfallbackなし', async () => {
    const opts: PdfExportOptions = { ...OPTS, titleBlock: { projectName: 'Bridge', drawingNumber: 'A-001', revision: 'B' } }
    const r = await exportPdf([], [layer()], opts, seqCtx())
    const v = unwrap(r)
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.field === 'titleBlock')).toBe(false)
  })

  it('出力日時は ctx.now() から取得する（決定的ctx注入）', async () => {
    const now = vi.fn(() => '2026-07-15T00:00:00.000Z')
    const ctx: GeometryCreationContext = { newId: () => gid('x'), now }
    const r = await exportPdf([], [layer()], OPTS, ctx)
    unwrap(r)
    expect(now).toHaveBeenCalled()
  })

  it('デフォルトctx（省略）でも生成できる', async () => {
    const r = await exportPdf([line], [layer()], OPTS)
    expect(pdfMagic(unwrap(r).bytes)).toBe('%PDF-')
  })
})

describe('exportPdf: Result error 側（想定内の致命エラー）', () => {
  it('scale<=0 → PDF_INVALID_SCALE', async () => {
    const r = await exportPdf([line], [layer()], { ...OPTS, scale: 0 }, seqCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('PDF_INVALID_SCALE')
      expect(r.error.severity).toBe('error')
    }
  })

  it('scaleが非有限 → PDF_INVALID_SCALE', async () => {
    const r = await exportPdf([line], [layer()], { ...OPTS, scale: Number.NaN }, seqCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('PDF_INVALID_SCALE')
  })

  it('marginMm<0 → PDF_INVALID_MARGIN', async () => {
    const r = await exportPdf([line], [layer()], { ...OPTS, marginMm: -5 }, seqCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('PDF_INVALID_MARGIN')
  })

  it('余白が用紙より大きい → PDF_MARGIN_TOO_LARGE', async () => {
    // A3 短辺297mm。margin 200mm だと描画領域が負になる。
    const r = await exportPdf([line], [layer()], { paperSize: 'A3', orientation: 'landscape', scale: 100, marginMm: 200 }, seqCtx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('PDF_MARGIN_TOO_LARGE')
  })
})

describe('exportPdf: レイヤーorderで安定ソートしても成功する', () => {
  it('複数レイヤー・order逆順でも例外なく描画', async () => {
    const l0 = layer({ id: lid('a'), order: 5 })
    const l1 = layer({ id: lid('b'), order: 1 })
    const g0: LineGeometry = { ...line, id: gid('la'), layerId: lid('a') }
    const g1: CircleGeometry = { ...circle, id: gid('lb'), layerId: lid('b') }
    const r = await exportPdf([g0, g1], [l0, l1], OPTS, seqCtx())
    expect(pdfMagic(unwrap(r).bytes)).toBe('%PDF-')
  })
})
