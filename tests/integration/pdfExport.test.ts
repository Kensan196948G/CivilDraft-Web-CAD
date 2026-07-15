/**
 * PDF出力経路の結合テスト（store × テンプレート × DXF入出力 × exportPdf を実物結合）。
 *
 * 狙い: 単体テスト（tests/unit/domain/pdf/）が exportPdf を直接叩くのに対し、本テストは
 * 実際のUIと同じ「EditorStore に図形を積む → store.getState() を exportPdf へ渡す」経路を
 * モックなしで通し、モジュール境界の契約ズレを突く。とくに次を検証する:
 *   1. テンプレート実体化 → store 配置 → exportPdf で %PDF- が生成され、日本語テキスト由来の
 *      PDF_FONT_FALLBACK（フォント未注入時の代替規則, §24.1）が issues に現れる
 *   2. printable=false レイヤー上の図形が出力から除外される（§6.3）
 *   3. DXF取込（importDxf）した図面をそのまま exportPdf できる（DXF→store→PDF の直列経路）
 *   4. 決定的 ctx（固定 now()）注入で出力が再現可能（同一入力2回で bytes 完全一致）。
 *      加えて now() が異なると bytes が変わることを確認し、出力日時が実際に埋め込まれる証跡とする
 *
 * 除外の観測手法（単体テスト踏襲）: 日本語テキスト図形が描画されると必ず PDF_FONT_FALLBACK が
 * その entityId 付きで issues に積まれる（フォント未注入時）。この issue の有無を「描画された/
 * 除外された」の観測プロキシに用いる（PDFバイト列からのテキスト抽出は行わない）。
 */
import { describe, expect, it } from 'vitest'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import { getTemplateById, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { importDxf } from '@/domain/dxf/dxfImporter'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import type { PdfExportOptions } from '@/domain/pdf/pdfExporter'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  CircleGeometry,
  DrawingLayer,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  LineGeometry,
  Result,
  TextGeometry,
  ValidationIssue,
} from '@/shared/types'

// --- 共通フィクスチャ -------------------------------------------------------

/** 連番ID・固定タイムスタンプの GeometryCreationContext（出力再現性のため）。 */
function deterministicCtx(prefix: string, nowIso = '2026-07-15T00:00:00.000Z'): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `${prefix}-${n++}` as GeometryId,
    now: () => nowIso,
  }
}

const STYLE: GeometryStyle = {
  strokeColor: '#1f2937',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

/** store 既定レイヤーのID（createDefaultLayer と一致させ、printable フィルタがレイヤーを解決できるようにする）。 */
const DEFAULT_LAYER_ID = createDefaultLayer().id

const OPTS: PdfExportOptions = { paperSize: 'A3', orientation: 'landscape', scale: 100 }

function base(id: string, layerId: LayerId = DEFAULT_LAYER_ID): Omit<GeometryBase, 'type'> {
  return {
    id: id as GeometryId,
    layerId,
    style: STYLE,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

/** 日本語テキスト図形（フォント未注入時に必ず PDF_FONT_FALLBACK を誘発する観測プローブ）。 */
function jpText(id: string, text: string, layerId: LayerId = DEFAULT_LAYER_ID): TextGeometry {
  return {
    ...base(id, layerId),
    type: 'text',
    anchor: { x: 0, y: 0 },
    text,
    height: 100,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

function pdfMagic(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes.subarray(0, 5))
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function unwrap<T>(r: Result<T, ValidationIssue>): T {
  if (!r.ok) throw new Error(`expected ok Result, got error: ${r.error.code}`)
  return r.value
}

// ---------------------------------------------------------------------------
// シナリオ1: テンプレート配置 → store → exportPdf（%PDF-・日本語代替の内訳）
// ---------------------------------------------------------------------------
describe('結合: テンプレート配置→store→exportPdf', () => {
  it('テンプレート実体化を store に積み、日本語テキストを加えて出力すると %PDF- とフォント代替 issue が得られる', async () => {
    const ctx = deterministicCtx('s1')
    const store = createEditorStore(ctx)

    // 測量基準点マーカー（円・十字2本・ASCIIラベル "CP"）を実体化して store へ。
    const template = getTemplateById('survey-control-point')
    expect(template).toBeDefined()
    const placed = instantiateTemplate(template!, { layerId: DEFAULT_LAYER_ID, style: STYLE }, ctx)
    store.getState().addGeometries(placed)

    // 日本語テキスト（フォント未注入 → 代替規則が働く）を store の実状態へ追加する。
    const jp = jpText('s1-jp', '基準点表示')
    store.getState().addGeometries([jp])

    const s = store.getState()
    expect(s.geometries).toHaveLength(placed.length + 1)

    const v = unwrap(await exportPdf(s.geometries, s.layers, OPTS, ctx))
    expect(pdfMagic(v.bytes)).toBe('%PDF-')

    // 日本語テキスト由来の PDF_FONT_FALLBACK が entityId 付きで存在し、対象文字列を message に含む。
    const jpFallback = v.issues.filter((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === jp.id)
    expect(jpFallback.length).toBeGreaterThanOrEqual(1)
    expect(jpFallback[0]?.severity).toBe('warning')
    expect(jpFallback.some((i) => i.message.includes('基準点表示'))).toBe(true)

    // テンプレートの ASCII ラベル "CP" は代替不要 → その entityId のフォント代替は出ない。
    const cp = placed.find((g): g is TextGeometry => g.type === 'text')
    expect(cp).toBeDefined()
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === cp!.id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// シナリオ2: printable=false レイヤーの除外（store 実状態からの出力, §6.3）
// ---------------------------------------------------------------------------
describe('結合: printable=false レイヤーの除外', () => {
  it('非印刷レイヤー上の図形は出力から除外され、印刷レイヤー上の図形のみ描画される', async () => {
    const ctx = deterministicCtx('s2')
    const store = createEditorStore(ctx)

    const printableLayer = createDefaultLayer() // id=DEFAULT_LAYER_ID, printable:true, order 0
    const hiddenLayer: DrawingLayer = {
      ...createDefaultLayer(),
      id: 'layer-hidden' as LayerId,
      name: '非印刷レイヤー',
      order: 1,
      printable: false,
    }
    const shown = jpText('s2-shown', '印刷対象', DEFAULT_LAYER_ID)
    const hidden = jpText('s2-hidden', '非印刷対象', hiddenLayer.id)

    // DXF読込と同じ replaceDocument 経路でレイヤー集合ごと差し替える。
    store.getState().replaceDocument([shown, hidden], [printableLayer, hiddenLayer])

    const s = store.getState()
    const v = unwrap(await exportPdf(s.geometries, s.layers, OPTS, ctx))
    expect(pdfMagic(v.bytes)).toBe('%PDF-')

    // 印刷レイヤー上の図形は描画される（entityId 付き fallback あり）。
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === 's2-shown')).toBe(true)
    // 非印刷レイヤー上の図形は除外される（fallback なし＝描画されていない）。
    expect(v.issues.some((i) => i.code === 'PDF_FONT_FALLBACK' && i.entityId === 's2-hidden')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// シナリオ3: DXF取込 → store → exportPdf（DXF→store→PDF の直列経路）
// ---------------------------------------------------------------------------
describe('結合: DXF取込→store→exportPdf の直列経路', () => {
  it('importDxf した図面を replaceDocument で store へ載せ、そのまま exportPdf できる', async () => {
    const ctx = deterministicCtx('s3')
    const layers: readonly DrawingLayer[] = [createDefaultLayer()]

    // DXF往復に耐える基本図形（line/circle/polyline/text）で出力元図面を作る。
    const source: readonly Geometry[] = [
      { ...base('s3-line'), type: 'line', start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } },
      { ...base('s3-circle'), type: 'circle', center: { x: 500, y: 500 }, radius: 200 },
      {
        ...base('s3-poly'),
        type: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 200 },
          { x: 600, y: 0 },
        ],
        closed: false,
      },
      {
        ...base('s3-text'),
        type: 'text',
        anchor: { x: 0, y: 900 },
        text: 'ROUNDTRIP',
        height: 50,
        rotationDeg: 0,
        horizontalAlign: 'left',
      },
    ]

    // DXF文字列 → importDxf → store.replaceDocument → exportPdf。
    const dxf = exportDxf(source, layers, { unit: 'mm' })
    const imported = importDxf(dxf, ctx)
    expect(imported.ok).toBe(true)
    if (!imported.ok) return

    const store = createEditorStore(ctx)
    store.getState().replaceDocument(imported.value.geometries, imported.value.layers)

    const s = store.getState()
    expect(s.geometries.length).toBeGreaterThan(0)

    const v = unwrap(await exportPdf(s.geometries, s.layers, OPTS, ctx))
    expect(pdfMagic(v.bytes)).toBe('%PDF-')
    expect(v.bytes.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// シナリオ4: 決定的 ctx による出力再現性（bytes 完全一致 / now() が bytes に効く）
// ---------------------------------------------------------------------------
describe('結合: 決定的 ctx による出力の再現性', () => {
  /** 固定入力＋固定 now() の store から exportPdf し bytes を得る（毎回同一の論理入力を構築）。 */
  async function buildBytes(nowIso: string): Promise<Uint8Array> {
    const ctx = deterministicCtx('s4', nowIso)
    const store = createEditorStore(ctx)
    // ctx非依存の固定図形（id・座標を固定）にして、差異要因を ctx.now() のみへ限定する。
    const line: LineGeometry = { ...base('s4-line'), type: 'line', start: { x: 0, y: 0 }, end: { x: 800, y: 400 } }
    const circle: CircleGeometry = { ...base('s4-circle'), type: 'circle', center: { x: 400, y: 200 }, radius: 150 }
    store.getState().addGeometries([line, circle])
    const s = store.getState()
    const opts: PdfExportOptions = { ...OPTS, titleBlock: { projectName: 'Determinism', drawingNumber: 'D-001' } }
    return unwrap(await exportPdf(s.geometries, s.layers, opts, ctx)).bytes
  }

  it('同一入力＋同一 now() で2回出力すると bytes が完全一致する', async () => {
    const a = await buildBytes('2026-07-15T00:00:00.000Z')
    const b = await buildBytes('2026-07-15T00:00:00.000Z')
    expect(a.length).toBe(b.length)
    expect(bytesEqual(a, b)).toBe(true)
  })

  it('now() が異なると bytes が変わる（表題欄の出力日時が実際に埋め込まれている証跡）', async () => {
    const a = await buildBytes('2026-07-15T00:00:00.000Z')
    const b = await buildBytes('2026-07-16T09:30:00.000Z')
    expect(bytesEqual(a, b)).toBe(false)
  })
})
