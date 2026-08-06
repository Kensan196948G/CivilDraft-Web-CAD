/**
 * 図面（Geometry群＋レイヤー）を実寸ベクターPDFへ出力する。
 * 継承元: なし（新規実装、Issue #10 / 詳細設計仕様書§24.1 PDF出力。継承元Civil-Drawに前例なし）。
 *
 * DD-TBD-006（PDF生成方式と日本語フォント配布条件）の確定内容:
 * - 生成方式 = pdf-lib 直接描画（ベクター品質維持。ラスタ化しない）。本実装で確定。
 * - 日本語フォント = 注入式DI（options.japaneseFontBytes）で供給する。フォントの同梱・配布条件は
 *   未決のため本実装ではフォントを同梱せず、未注入時は標準フォント＋代替規則で退避する（§24.1）。
 *
 * 設計方針:
 * - 座標は画面のzoom/panを使わず、用紙サイズ・向き・余白・縮尺のみで実寸→用紙へ写像する
 *   （pdfCoordinate.createProjector。§24.1）。
 * - 想定内の失敗（不正な縮尺・余白）は Result の error 側（fatal）で返す。解析継続可能な事象
 *   （フォント代替・未知シンボル等）は success 側の issues[] に集約し、部分的にでもPDFを生成する
 *   （§4.2 Result方針。「予期しない障害のみ例外境界へ送る」）。
 * - 出力日時は引数 ctx（GeometryCreationContext, ADR-0013）の now() から取得する（テスト決定性）。
 * - printable=false のレイヤー、および GeometryStyle.printable=false の図形は出力対象外（§6.3）。
 * - 図面枠・表題欄を構成要素として描画する。表題欄の固定ラベルはASCIIとし、日本語フォント未注入でも
 *   常に判読可能にする（値[プロジェクト名等]は代替規則の対象）。
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { Color, PDFFont, PDFPage } from 'pdf-lib'
import type { PaperOrientation, PaperSize } from '@/domain/canvas/paperSize'
import type { DrawingLayer, Geometry, LayerId, Result, ValidationIssue } from '@/shared/types'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import { createProjector } from './pdfCoordinate'
import { paintGeometry, requiresFontFallback } from './pdfGeometryPainter'
import type { PaintContext } from './pdfGeometryPainter'

/** PDF出力オプション。 */
export interface PdfExportOptions {
  readonly paperSize: PaperSize
  readonly orientation: PaperOrientation
  /** 縮尺分母（例: 100 = 1:100）。用紙上mm = 実寸mm / scale。 */
  readonly scale: number
  /** 用紙端からの余白(mm)。既定10。 */
  readonly marginMm?: number
  readonly titleBlock?: {
    readonly projectName?: string
    readonly drawingNumber?: string
    readonly revision?: string
  }
  /** DD-TBD-006: 日本語フォント注入DI。未指定時は標準フォント＋代替規則。 */
  readonly japaneseFontBytes?: Uint8Array
}

/** 出力成功時の内容。 */
export interface PdfExportSuccess {
  readonly bytes: Uint8Array
  readonly issues: readonly ValidationIssue[]
}

const DEFAULT_MARGIN_MM = 10
/** 表題欄の寸法（pt, 用紙空間）。 */
const TITLE_BLOCK_W_PT = 200
const TITLE_BLOCK_ROW_PT = 14
const TITLE_BLOCK_FONT_PT = 8
const BLACK: Color = rgb(0, 0, 0)
const PLACEHOLDER_COLOR: Color = rgb(0.6, 0.6, 0.6)

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 図面をPDFへ出力する。
 * @param ctx ID発番/タイムスタンプ注入（ADR-0013）。出力日時に ctx.now() を用いる。省略時は既定実装。
 */
export async function exportPdf(
  geometries: readonly Geometry[],
  layers: readonly DrawingLayer[],
  options: PdfExportOptions,
  ctx: GeometryCreationContext = defaultCreationContext,
): Promise<Result<PdfExportSuccess, ValidationIssue>> {
  // 1. 想定内の致命エラー（縮尺・余白）は error 側で返す。
  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    return {
      ok: false,
      error: {
        code: 'PDF_INVALID_SCALE',
        severity: 'error',
        field: 'scale',
        message: `縮尺分母は正の有限数である必要があります: ${String(options.scale)}`,
      },
    }
  }
  const marginMm = options.marginMm ?? DEFAULT_MARGIN_MM
  if (!Number.isFinite(marginMm) || marginMm < 0) {
    return {
      ok: false,
      error: {
        code: 'PDF_INVALID_MARGIN',
        severity: 'error',
        field: 'marginMm',
        message: `余白は0以上の有限数である必要があります: ${String(marginMm)}`,
      },
    }
  }

  const projector = createProjector(options.paperSize, options.orientation, options.scale, marginMm)
  const drawableW = projector.paper.widthPt - projector.marginPt * 2
  const drawableH = projector.paper.heightPt - projector.marginPt * 2
  if (drawableW <= 0 || drawableH <= 0) {
    return {
      ok: false,
      error: {
        code: 'PDF_MARGIN_TOO_LARGE',
        severity: 'error',
        field: 'marginMm',
        message: `余白が用紙サイズに対して大きすぎ、描画領域が確保できません（margin=${marginMm}mm）`,
      },
    }
  }

  const issues: ValidationIssue[] = []

  // 2. ドキュメント生成とフォント準備。
  // pdf-lib は create() 既定で現在時刻の CreationDate/ModDate を埋め込むため、
  // 同一入力＋同一 ctx でも秒を跨ぐと bytes が変わり得る。updateMetadata:false で
  // 無効化し、出力日時は ctx.now() 由来で明示設定する（ADR-0013 の決定性契約・CI flaky 対策）。
  const doc = await PDFDocument.create({ updateMetadata: false })
  doc.registerFontkit(fontkit)
  const outputDate = new Date(ctx.now())
  doc.setProducer('CivilDraft Web CAD')
  doc.setCreator('CivilDraft Web CAD')
  doc.setCreationDate(outputDate)
  doc.setModificationDate(outputDate)

  let font: PDFFont
  let hasInjectedFont = false
  if (options.japaneseFontBytes !== undefined) {
    try {
      font = await doc.embedFont(options.japaneseFontBytes, { subset: true })
      hasInjectedFont = true
    } catch (e) {
      // フォント埋め込み失敗は致命ではない。標準フォントへ退避して継続する。
      issues.push({
        code: 'PDF_FONT_EMBED_FAILED',
        severity: 'warning',
        field: 'japaneseFontBytes',
        message: `注入フォントの埋め込みに失敗したため標準フォントで代替します: ${errMessage(e)}`,
      })
      font = await doc.embedFont(StandardFonts.Helvetica)
    }
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica)
  }

  // 3. ページ生成（用紙pt寸法）。
  const page = doc.addPage([projector.paper.widthPt, projector.paper.heightPt])

  // 4. 図面枠（余白の内側の外周線）。
  page.drawRectangle({
    x: projector.marginPt,
    y: projector.marginPt,
    width: drawableW,
    height: drawableH,
    borderColor: BLACK,
    borderWidth: 1,
  })

  // 5. 図形描画（printable除外 → レイヤーorder昇順で安定ソート）。
  const layerById = new Map<LayerId, DrawingLayer>(layers.map((l) => [l.id, l]))
  const printable = geometries.filter((g) => {
    if (g.style.printable === false) return false
    const layer = layerById.get(g.layerId)
    if (layer !== undefined && layer.printable === false) return false
    return true
  })
  const orderOf = (g: Geometry): number => layerById.get(g.layerId)?.order ?? Number.POSITIVE_INFINITY
  const ordered = [...printable].sort((a, b) => orderOf(a) - orderOf(b))

  const paintCtx: PaintContext = { page, projector, font, hasInjectedFont, issues }
  for (const g of ordered) {
    paintGeometry(paintCtx, g)
  }

  // 6. 表題欄（右下）。出力日時は ctx.now()。
  drawTitleBlock(page, projector.paper.widthPt, projector.marginPt, options, ctx, {
    font,
    hasInjectedFont,
    issues,
  })

  // 7. 保存。予期しない生成失敗のみ error 側で返す。
  try {
    const bytes = await doc.save()
    return { ok: true, value: { bytes, issues } }
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'PDF_GENERATE_FAILED',
        severity: 'error',
        message: `PDF生成に失敗しました: ${errMessage(e)}`,
      },
    }
  }
}

interface TitleTextEnv {
  readonly font: PDFFont
  readonly hasInjectedFont: boolean
  readonly issues: ValidationIssue[]
}

/**
 * 表題欄を右下に描画する。固定ラベルはASCII（フォント非依存で常に判読可能）、
 * 値（プロジェクト名等）はフォント代替規則の対象とする。縮尺は「1:scale」、出力日時は ctx.now()。
 */
function drawTitleBlock(
  page: PDFPage,
  paperWpt: number,
  marginPt: number,
  options: PdfExportOptions,
  ctx: GeometryCreationContext,
  env: TitleTextEnv,
): void {
  const rows: readonly (readonly [string, string])[] = [
    ['Project', options.titleBlock?.projectName ?? ''],
    ['Drawing No', options.titleBlock?.drawingNumber ?? ''],
    ['Rev', options.titleBlock?.revision ?? ''],
    ['Scale', `1:${options.scale}`],
    ['Date', ctx.now()],
  ]
  const blockH = TITLE_BLOCK_ROW_PT * rows.length
  const right = paperWpt - marginPt
  const left = right - TITLE_BLOCK_W_PT
  const bottom = marginPt

  page.drawRectangle({
    x: left,
    y: bottom,
    width: TITLE_BLOCK_W_PT,
    height: blockH,
    borderColor: BLACK,
    borderWidth: 1,
  })

  const labelX = left + 4
  const valueX = left + 64
  rows.forEach(([label, value], i) => {
    // 最下行(i=0)から上へ積む。行ベースラインは行下端から2pt上。
    const rowBottom = bottom + TITLE_BLOCK_ROW_PT * (rows.length - 1 - i)
    const baseline = rowBottom + 3
    if (i > 0) {
      // 行区切り線（最上段以外の上端）。
      page.drawLine({
        start: { x: left, y: rowBottom + TITLE_BLOCK_ROW_PT },
        end: { x: right, y: rowBottom + TITLE_BLOCK_ROW_PT },
        thickness: 0.5,
        color: BLACK,
      })
    }
    drawTitleText(page, env, labelX, baseline, `${label}:`)
    if (value !== '') drawTitleText(page, env, valueX, baseline, value)
  })
}

/** 表題欄の1テキスト。標準フォントで描けない文字はプレースホルダ矩形＋warning。 */
function drawTitleText(
  page: PDFPage,
  env: TitleTextEnv,
  x: number,
  y: number,
  text: string,
): void {
  const size = TITLE_BLOCK_FONT_PT
  if (requiresFontFallback(text, env.hasInjectedFont)) {
    page.drawRectangle({
      x,
      y,
      width: Math.max(text.length * size * 0.6, size),
      height: size,
      borderColor: PLACEHOLDER_COLOR,
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    })
    env.issues.push({
      code: 'PDF_FONT_FALLBACK',
      severity: 'warning',
      field: 'titleBlock',
      message: `表題欄テキストを標準フォントで描画できずプレースホルダに置換しました（日本語フォント未注入）: "${text}"`,
    })
    return
  }
  try {
    page.drawText(text, { x, y, size, font: env.font, color: BLACK, rotate: degrees(0) })
  } catch {
    page.drawRectangle({
      x,
      y,
      width: Math.max(text.length * size * 0.6, size),
      height: size,
      borderColor: PLACEHOLDER_COLOR,
      borderWidth: 0.5,
      borderDashArray: [2, 2],
    })
    env.issues.push({
      code: 'PDF_FONT_FALLBACK',
      severity: 'warning',
      field: 'titleBlock',
      message: `表題欄テキストをエンコードできずプレースホルダに置換しました: "${text}"`,
    })
  }
}
