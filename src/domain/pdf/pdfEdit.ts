/**
 * PDF 編集（結合・分割・回転・透かし・墨消し）。
 *
 * pdf-lib を利用した純粋関数群。期待される失敗（不正 PDF・範囲外ページ等）は
 * Result<Uint8Array, ValidationIssue> で返す（ADR-0003）。
 *
 * 制約（正直な実装境界）:
 * - 墨消し（redact）は「描画レイヤーでの塗りつぶし」であり、PDF コンテンツストリームから
 *   テキストを物理削除するものではない。真正な墨消しが必要な場合は専用ツール/ライブラリ
 *   （PAdES 対応等）での後処理を要する（根拠付き課題として記録済み）。
 * - 結合・分割はページ単位で行う（ブックマーク・注釈の再構築は対象外）。
 */
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { Result, ValidationIssue } from '@/shared/types'

function fail(code: string, message: string): ValidationIssue {
  return { code, severity: 'error', message }
}

export interface PdfRect {
  readonly pageIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly color?: string
}

export interface PdfWatermarkOptions {
  readonly text: string
  readonly fontSize?: number
  readonly color?: string
  readonly opacity?: number
  readonly x?: number
  readonly y?: number
  readonly rotateDeg?: number
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes)
}

/** PDF のページ数を取得する。 */
export async function getPdfPageCount(bytes: Uint8Array): Promise<Result<number, ValidationIssue>> {
  try {
    const doc = await loadPdf(bytes)
    return { ok: true, value: doc.getPageCount() }
  } catch {
    return { ok: false, error: fail('PDF_LOAD_FAILED', 'PDF を読み込めません（破損または非PDFファイル）') }
  }
}

/** 複数 PDF をページ順に結合する。空配列はエラー。 */
export async function mergePdfBytes(
  files: readonly Uint8Array[],
): Promise<Result<Uint8Array, ValidationIssue>> {
  if (files.length === 0) {
    return { ok: false, error: fail('PDF_MERGE_EMPTY', '結合する PDF がありません') }
  }
  try {
    const merged = await PDFDocument.create()
    for (let i = 0; i < files.length; i++) {
      const source = await loadPdf(files[i] ?? new Uint8Array())
      const pages = await merged.copyPages(source, source.getPageIndices())
      for (const page of pages) merged.addPage(page)
    }
    return { ok: true, value: await merged.save() }
  } catch {
    return { ok: false, error: fail('PDF_MERGE_FAILED', 'PDF の結合に失敗しました') }
  }
}

/**
 * ページ範囲指定で PDF を分割する。
 * ranges は 1 始まりの閉区間 {start, end}（例: {start:1, end:3} は 1〜3 ページ目）。
 */
export async function splitPdfBytes(
  bytes: Uint8Array,
  ranges: readonly { readonly start: number; readonly end: number }[],
): Promise<Result<readonly Uint8Array[], ValidationIssue>> {
  try {
    const source = await loadPdf(bytes)
    const count = source.getPageCount()
    for (const range of ranges) {
      if (range.start < 1 || range.end > count || range.start > range.end) {
        return {
          ok: false,
          error: fail(
            'PDF_SPLIT_RANGE_INVALID',
            `分割範囲が不正です（1〜${count} ページ目・start<=end で指定）: ${range.start}-${range.end}`,
          ),
        }
      }
    }
    const outputs: Uint8Array[] = []
    for (const range of ranges) {
      const part = await PDFDocument.create()
      const indices = Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start - 1 + i)
      const pages = await part.copyPages(source, indices)
      for (const page of pages) part.addPage(page)
      outputs.push(await part.save())
    }
    return { ok: true, value: outputs }
  } catch {
    return { ok: false, error: fail('PDF_SPLIT_FAILED', 'PDF の分割に失敗しました') }
  }
}

/** 全ページ（または指定ページ）を回転する。degrees は 0/90/180/270 の倍数に正規化。 */
export async function rotatePdfPages(
  bytes: Uint8Array,
  degreesValue: number,
  pageIndexes?: readonly number[],
): Promise<Result<Uint8Array, ValidationIssue>> {
  try {
    const doc = await loadPdf(bytes)
    const normalized = ((Math.round(degreesValue) % 360) + 360) % 360
    const targets =
      pageIndexes !== undefined
        ? pageIndexes.filter((index) => index >= 0 && index < doc.getPageCount())
        : doc.getPageIndices()
    for (const index of targets) {
      const page = doc.getPage(index)
      const current = page.getRotation().angle
      page.setRotation(degrees((current + normalized) % 360))
    }
    return { ok: true, value: await doc.save() }
  } catch {
    return { ok: false, error: fail('PDF_ROTATE_FAILED', 'PDF の回転に失敗しました') }
  }
}

/** 全ページにテキスト透かしを重ねる。 */
export async function addPdfWatermark(
  bytes: Uint8Array,
  options: PdfWatermarkOptions,
): Promise<Result<Uint8Array, ValidationIssue>> {
  if (options.text.trim() === '') {
    return { ok: false, error: fail('PDF_WATERMARK_EMPTY', '透かしテキストを入力してください') }
  }
  // 標準 Helvetica は Latin-1 のみ対応。日本語等は「?」へ置換して描画する
  // （日本語フォント注入は pdfExporter の仕組みと別系統。透かしの多言語対応は課題）。
  const sanitized = options.text
    .split('')
    .map((char) => (char.charCodeAt(0) <= 0xff ? char : '?'))
    .join('')
  try {
    const doc = await loadPdf(bytes)
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const fontSize = options.fontSize ?? 24
    const color = rgb(0.5, 0.5, 0.5)
    for (const index of doc.getPageIndices()) {
      const page = doc.getPage(index)
      const width = page.getWidth()
      const height = page.getHeight()
      page.drawText(sanitized, {
        x: options.x ?? width / 2 - (sanitized.length * fontSize) / 4,
        y: options.y ?? height / 2,
        size: fontSize,
        font,
        color,
        opacity: options.opacity ?? 0.2,
        rotate: degrees(options.rotateDeg ?? 30),
      })
    }
    return { ok: true, value: await doc.save() }
  } catch {
    return { ok: false, error: fail('PDF_WATERMARK_FAILED', '透かしの追加に失敗しました') }
  }
}

/**
 * 指定領域を塗りつぶす（墨消し）。
 * 注意: これは視覚的な塗りつぶしであり、コンテンツの物理削除ではない。
 */
export async function redactPdfPages(
  bytes: Uint8Array,
  rects: readonly PdfRect[],
): Promise<Result<Uint8Array, ValidationIssue>> {
  if (rects.length === 0) {
    return { ok: false, error: fail('PDF_REDACT_EMPTY', '墨消し領域が指定されていません') }
  }
  try {
    const doc = await loadPdf(bytes)
    for (const rect of rects) {
      if (rect.pageIndex < 0 || rect.pageIndex >= doc.getPageCount()) {
        return {
          ok: false,
          error: fail('PDF_REDACT_PAGE_INVALID', `墨消しページ番号が不正です: ${rect.pageIndex + 1}`),
        }
      }
      const page = doc.getPage(rect.pageIndex)
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        color: rgb(0, 0, 0),
        opacity: 1,
      })
    }
    return { ok: true, value: await doc.save() }
  } catch {
    return { ok: false, error: fail('PDF_REDACT_FAILED', '墨消しの適用に失敗しました') }
  }
}
