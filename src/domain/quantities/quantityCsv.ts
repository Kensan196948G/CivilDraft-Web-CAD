/**
 * 数量CSV出力（詳細設計仕様書 §24.2 数量CSV列）。
 *
 * 列順・必須列は §24.2 の表に忠実（QUANTITY_CSV_COLUMNS が正本）。
 * CSVインジェクション対策として、ユーザー入力由来のテキスト列で先頭が `=` `+` `-` `@`
 * タブ・CR の値をアポストロフィでエスケープし、処理内容を sanitizations に記録する（§24.2）。
 * rawValue / roundedValue はシステム生成の数値列のため、負数を壊さないようエスケープ対象外とする
 * （§24.2「対象列の性質に応じて」）。
 */
import type { CivilAttribute, QuantityItem } from '@/shared/types'

/** §24.2 数量CSV列（この順序・名称が出力ヘッダの正本）。 */
export const QUANTITY_CSV_COLUMNS = [
  'projectNumber',
  'drawingNumber',
  'revisionNumber',
  'workSection',
  'station',
  'workType',
  'category',
  'subcategory',
  'specification',
  'method',
  'rawValue',
  'roundedValue',
  'unit',
  'sourceGeometryIds',
  'adjustmentReason',
] as const

export type QuantityCsvColumn = (typeof QUANTITY_CSV_COLUMNS)[number]

/** 明細に紐づかない図面レベルの列（案件番号・図面番号・改訂番号）。 */
export interface QuantityCsvContext {
  readonly projectNumber: string
  readonly drawingNumber: string
  readonly revisionNumber: string
}

/** CSV 1 行の入力。attribute は工区・種別等の列を供給する（欠落可）。 */
export interface QuantityCsvRow {
  readonly item: QuantityItem
  readonly attribute?: CivilAttribute
}

export interface QuantityCsvInput {
  readonly rows: readonly QuantityCsvRow[]
  readonly context: QuantityCsvContext
  /** 既定 true。ヘッダ行を先頭に出力する。 */
  readonly includeHeader?: boolean
  /** rawValue/roundedValue の整形。既定は String（十進表記）。 */
  readonly numberFormatter?: (value: number) => string
  /** sourceGeometryIds の連結区切り。既定は ';'（列内カンマ回避のため）。 */
  readonly geometryIdSeparator?: string
}

/** CSVインジェクション対策で無害化したセルの記録（§24.2 処理内容の記録）。 */
export interface CsvSanitizationRecord {
  readonly rowIndex: number
  readonly column: QuantityCsvColumn
  readonly original: string
  readonly action: 'escaped'
}

export interface QuantityCsvResult {
  readonly csv: string
  readonly sanitizations: readonly CsvSanitizationRecord[]
}

/** 数式起点とみなす先頭文字（OWASP CSV Injection 準拠 + §24.2 の =,+,-,@）。 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r'])

/** 数値列（システム生成のためインジェクション・エスケープ対象外）。 */
const NUMERIC_COLUMNS = new Set<QuantityCsvColumn>(['rawValue', 'roundedValue'])

/** テキストセルを無害化する。数式起点ならアポストロフィを前置してエスケープする。 */
function sanitizeText(raw: string): { value: string; escaped: boolean } {
  const first = raw.charAt(0)
  if (raw.length > 0 && FORMULA_PREFIXES.has(first)) {
    return { value: `'${raw}`, escaped: true }
  }
  return { value: raw, escaped: false }
}

/** RFC 4180 のフィールドクオート。カンマ・二重引用符・改行を含む場合に囲む。 */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rawCellValue(
  column: QuantityCsvColumn,
  row: QuantityCsvRow,
  input: QuantityCsvInput,
): string {
  const { item, attribute } = row
  const formatNumber = input.numberFormatter ?? String
  const separator = input.geometryIdSeparator ?? ';'
  switch (column) {
    case 'projectNumber':
      return input.context.projectNumber
    case 'drawingNumber':
      return input.context.drawingNumber
    case 'revisionNumber':
      return input.context.revisionNumber
    case 'workSection':
      return attribute?.workSectionId ?? ''
    case 'station':
      return attribute?.station ?? ''
    case 'workType':
      return item.workType ?? attribute?.workType ?? ''
    case 'category':
      return attribute?.category ?? ''
    case 'subcategory':
      return attribute?.subcategory ?? ''
    case 'specification':
      return item.specification ?? attribute?.specification ?? ''
    case 'method':
      return item.method
    case 'rawValue':
      return formatNumber(item.rawValue)
    case 'roundedValue':
      return formatNumber(item.roundedValue)
    case 'unit':
      return item.unit
    case 'sourceGeometryIds':
      return item.sources.map((source) => source.geometryId).join(separator)
    case 'adjustmentReason':
      return item.manualAdjustment?.reason ?? ''
    default: {
      const exhaustive: never = column
      throw new Error(`未知のCSV列: ${String(exhaustive)}`)
    }
  }
}

/**
 * 数量明細を §24.2 の列順で CSV 文字列へ整形する。
 * 無害化したセルは sanitizations に記録して返す（rowIndex は 0 始まりのデータ行番号）。
 */
export function exportQuantityCsv(input: QuantityCsvInput): QuantityCsvResult {
  const includeHeader = input.includeHeader ?? true
  const sanitizations: CsvSanitizationRecord[] = []
  const lines: string[] = []

  if (includeHeader) {
    lines.push(QUANTITY_CSV_COLUMNS.map(quoteField).join(','))
  }

  input.rows.forEach((row, rowIndex) => {
    const cells = QUANTITY_CSV_COLUMNS.map((column) => {
      const raw = rawCellValue(column, row, input)
      if (NUMERIC_COLUMNS.has(column)) {
        return quoteField(raw)
      }
      const sanitized = sanitizeText(raw)
      if (sanitized.escaped) {
        sanitizations.push({ rowIndex, column, original: raw, action: 'escaped' })
      }
      return quoteField(sanitized.value)
    })
    lines.push(cells.join(','))
  })

  return { csv: lines.join('\r\n'), sanitizations }
}
