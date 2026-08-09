/**
 * Excel（.xlsx）出力（数量・図面リスト・サマリー）。
 *
 * - exceljs で 3 シート（数量明細 / 図面リスト / サマリー）を生成する。
 * - セル先頭の = + - @ 等による数式インジェクションを無害化する
 *   （先頭にアポストロフィを前置。CSV 版 quantityCsv と同じ方針）。
 * - ブラウザ・Node 双方で動作する（バイト列を返す）。
 */
import ExcelJS from 'exceljs'

export interface QuantityExcelRow {
  readonly workType?: string
  readonly specification?: string
  readonly methodLabel: string
  readonly unit: string
  readonly roundedValue: number
  readonly status: string
}

export interface DrawingExcelRow {
  readonly drawingNumber: string
  readonly name: string
  readonly revisionNumber: string
  readonly status: string
}

export interface ExcelWorkbookMeta {
  readonly projectName?: string
  readonly drawingNumber?: string
  readonly revisionNumber?: string
  readonly generatedAt: string
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE7EAF0' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true }

/** 数式インジェクション対策: 危険な先頭文字を持つセル値を無害化する。 */
export function sanitizeExcelCell(value: string): string {
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`
  }
  return value
}

function setHeaderRow(worksheet: ExcelJS.Worksheet, headers: readonly string[]): void {
  worksheet.columns = headers.map((header) => ({
    header,
    width: Math.max(14, Math.min(36, header.length * 2 + 6)),
  }))
  const headerRow = worksheet.getRow(1)
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function addSanitizedRow(
  worksheet: ExcelJS.Worksheet,
  values: readonly (string | number)[],
): void {
  const row = worksheet.addRow(values.map((value) => (typeof value === 'string' ? sanitizeExcelCell(value) : value)))
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle' }
  })
}

/**
 * 数量・図面リスト・サマリーを含む Excel ワークブックを生成する。
 * @returns .xlsx のバイト列（Uint8Array）
 */
export async function createCivilDraftWorkbook(
  quantities: readonly QuantityExcelRow[],
  drawings: readonly DrawingExcelRow[],
  meta: ExcelWorkbookMeta,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()

  const quantitySheet = workbook.addWorksheet('数量明細')
  setHeaderRow(quantitySheet, ['工種', '規格', '算出区分', '数量', '単位', '状態'])
  for (const item of quantities) {
    addSanitizedRow(quantitySheet, [
      item.workType ?? '',
      item.specification ?? '',
      item.methodLabel,
      item.roundedValue,
      item.unit,
      item.status,
    ])
  }

  const drawingSheet = workbook.addWorksheet('図面リスト')
  setHeaderRow(drawingSheet, ['図面番号', '図面名', '改訂', '状態'])
  for (const item of drawings) {
    addSanitizedRow(drawingSheet, [
      item.drawingNumber,
      item.name,
      item.revisionNumber,
      item.status,
    ])
  }

  const summarySheet = workbook.addWorksheet('サマリー')
  setHeaderRow(summarySheet, ['項目', '値'])
  const summaryRows: readonly (readonly (string | number)[])[] = [
    ['案件名', meta.projectName ?? ''],
    ['図面番号', meta.drawingNumber ?? ''],
    ['改訂', meta.revisionNumber ?? ''],
    ['数量明細行数', quantities.length],
    ['図面リスト行数', drawings.length],
    ['生成日時', meta.generatedAt],
  ]
  for (const row of summaryRows) {
    addSanitizedRow(summarySheet, row)
  }
  summarySheet.getColumn(2).width = 42

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
