/**
 * 測点CSVの取込・出力（詳細設計仕様書 §12.3、FR-SURV-005/008）。
 *
 * 取込の処理順（§12.3 本文。文字コード判定はバイト列段階の責務のため本関数は
 * デコード済み文字列を受け取る）:
 *   CSV解析 → ヘッダー正規化 → 列割当 → 空白・全半角正規化 → 数値変換
 *   → 必須・重複・範囲検査 → プレビュー（rows）→ 確定（points）
 *
 * 失敗の二層構造（詳細設計仕様書 §4.2、既存 coordParser.ts と同方針）:
 *   - 構造的失敗（空入力・必須列の欠落）は Result.error で全体を拒否する。
 *   - 行単位のデータ不良（欠損・非数値・重複・範囲外）は当該行の issues に集約し、
 *     読める行は取り込む（graceful）。エラー行は rows[].rowNumber で提示する
 *     （FR-SURV-008「エラー行を示す」）。
 *
 * CSVインジェクション対策（§24.2）: 先頭が =,+,-,@ 等の値は数式として解釈され得る。
 *   数値列（x/y/標高）の先頭 '-' は正当な負値のため対象外とし、テキスト列
 *   （測点番号・コード・備考）にのみ適用する。取込時は警告として記録し（処理内容の
 *   記録）、出力（exportSurveyCsv）時は先頭にアポストロフィを付与して無害化する。
 */
import type {
  ImportRowResult,
  Result,
  SurveyCsvMapping,
  SurveyPoint,
  SurveyPointId,
  ValidationIssue,
} from '@/shared/types'

/** 取込結果。points は確定した測点、rows は全行のプレビュー、issues は行番号付き集約。 */
export interface SurveyCsvParseResult {
  readonly points: readonly SurveyPoint[]
  readonly rows: readonly ImportRowResult<SurveyPoint>[]
  readonly issues: readonly ValidationIssue[]
}

/** SurveyPointId の発番コンテキスト（ADR-0013 と同様、テストへ決定的IDを注入するため）。 */
export interface SurveyPointIdContext {
  readonly newId: () => SurveyPointId
}

export const defaultSurveyPointIdContext: SurveyPointIdContext = {
  newId: () => crypto.randomUUID() as SurveyPointId,
}

export interface ParseSurveyCsvOptions {
  readonly mapping?: SurveyCsvMapping
  readonly idContext?: SurveyPointIdContext
}

/** 既定の列割当。ヘッダーは正規化（NFKC + トリム + 小文字化）して突合する。 */
export const DEFAULT_SURVEY_CSV_MAPPING: SurveyCsvMapping = {
  pointNumberColumn: 'pointnumber',
  xColumn: 'x',
  yColumn: 'y',
  elevationColumn: 'elevation',
  codeColumn: 'code',
  noteColumn: 'note',
}

/** CSVインジェクションの起点になり得る先頭文字（§24.2）。 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/** 座標値の異常桁を警告する上限（測量単位での絶対値）。 */
const ABNORMAL_MAGNITUDE = 1e9

/**
 * 測点CSV文字列を解析する。mapping 省略時は DEFAULT_SURVEY_CSV_MAPPING を用いる。
 */
export function parseSurveyCsv(
  content: string,
  options: ParseSurveyCsvOptions = {},
): Result<SurveyCsvParseResult, ValidationIssue> {
  const mapping = options.mapping ?? DEFAULT_SURVEY_CSV_MAPPING
  const idContext = options.idContext ?? defaultSurveyPointIdContext

  if (content.trim() === '') {
    return {
      ok: false,
      error: {
        code: 'survey_csv_empty',
        severity: 'error',
        message: 'CSVが空です',
      },
    }
  }

  const table = parseCsvRows(content)
  const headerCells = table[0] ?? []
  const header = headerCells.map(normalizeHeader)

  const columns = resolveColumns(header, mapping)
  if (!columns.ok) {
    return columns
  }
  const cols = columns.value

  const rows: ImportRowResult<SurveyPoint>[] = []
  const points: SurveyPoint[] = []
  const issues: ValidationIssue[] = []
  const seenPointNumbers = new Set<string>()

  for (let i = 1; i < table.length; i++) {
    const rowNumber = i + 1 // ヘッダーを1行目としたファイル行番号
    const cells = table[i] ?? []
    if (isBlankRow(cells)) {
      continue
    }
    const source = buildSource(headerCells, cells)
    const rowIssues: ValidationIssue[] = []

    const point = normalizeRow(cells, cols, rowNumber, seenPointNumbers, idContext, rowIssues)

    rows.push({ rowNumber, source, normalized: point ?? undefined, issues: rowIssues })
    issues.push(...rowIssues)
    if (point) {
      points.push(point)
    }
  }

  return { ok: true, value: { points, rows, issues } }
}

interface ResolvedColumns {
  readonly pointNumber: number
  readonly x: number
  readonly y: number
  readonly elevation: number | null
  readonly code: number | null
  readonly note: number | null
}

function resolveColumns(
  header: readonly string[],
  mapping: SurveyCsvMapping,
): Result<ResolvedColumns, ValidationIssue> {
  const find = (name: string): number => header.indexOf(normalizeHeader(name))

  const pointNumber = find(mapping.pointNumberColumn)
  const x = find(mapping.xColumn)
  const y = find(mapping.yColumn)

  const missing: string[] = []
  if (pointNumber < 0) missing.push(mapping.pointNumberColumn)
  if (x < 0) missing.push(mapping.xColumn)
  if (y < 0) missing.push(mapping.yColumn)
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'survey_csv_missing_column',
        severity: 'error',
        message: `必須列が見つかりません: ${missing.join(', ')}`,
      },
    }
  }

  const optional = (name: string | undefined): number | null => {
    if (name === undefined) return null
    const idx = find(name)
    return idx < 0 ? null : idx
  }

  return {
    ok: true,
    value: {
      pointNumber,
      x,
      y,
      elevation: optional(mapping.elevationColumn),
      code: optional(mapping.codeColumn),
      note: optional(mapping.noteColumn),
    },
  }
}

function normalizeRow(
  cells: readonly string[],
  cols: ResolvedColumns,
  rowNumber: number,
  seenPointNumbers: Set<string>,
  idContext: SurveyPointIdContext,
  issues: ValidationIssue[],
): SurveyPoint | null {
  const cell = (index: number): string => normalizeCell(cells[index] ?? '')

  const pointNumber = cell(cols.pointNumber)
  if (pointNumber === '') {
    issues.push(rowIssue(rowNumber, 'error', 'pointNumber', '測点番号が欠損しています'))
    return null
  }
  checkInjection(pointNumber, rowNumber, 'pointNumber', issues)

  const x = parseNumericCell(cell(cols.x), rowNumber, 'x', issues, true)
  const y = parseNumericCell(cell(cols.y), rowNumber, 'y', issues, true)
  if (x === null || y === null) {
    return null
  }
  checkMagnitude(x, rowNumber, 'x', issues)
  checkMagnitude(y, rowNumber, 'y', issues)

  if (seenPointNumbers.has(pointNumber)) {
    issues.push(rowIssue(rowNumber, 'warning', 'pointNumber', `測点番号が重複しています: "${pointNumber}"`))
  } else {
    seenPointNumbers.add(pointNumber)
  }

  let elevation: number | undefined
  if (cols.elevation !== null) {
    const rawElevation = cell(cols.elevation)
    if (rawElevation !== '') {
      const parsed = parseNumericCell(rawElevation, rowNumber, 'elevation', issues, false)
      if (parsed !== null) {
        elevation = parsed
      }
    }
  }

  const code = cols.code !== null ? optionalText(cell(cols.code), rowNumber, 'code', issues) : undefined
  const note = cols.note !== null ? optionalText(cell(cols.note), rowNumber, 'note', issues) : undefined

  return {
    id: idContext.newId(),
    pointNumber,
    x,
    y,
    ...(elevation !== undefined ? { elevation } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(note !== undefined ? { note } : {}),
  }
}

function optionalText(
  value: string,
  rowNumber: number,
  field: string,
  issues: ValidationIssue[],
): string | undefined {
  if (value === '') return undefined
  checkInjection(value, rowNumber, field, issues)
  return value
}

/**
 * NFKC 正規化（全角英数記号→半角、全角空白→半角）とトリムでセルを整える。
 * §12.3「空白・全半角正規化」に対応する。値は大文字小文字を保持する。
 */
function normalizeCell(raw: string): string {
  return raw.normalize('NFKC').trim()
}

/** ヘッダー照合用の正規化。値と異なり列名は大文字小文字を無視して突合する。 */
function normalizeHeader(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase()
}

/** 数値セルを解析する。required=true で空・非数値を error、false で warning とする。 */
function parseNumericCell(
  value: string,
  rowNumber: number,
  field: string,
  issues: ValidationIssue[],
  required: boolean,
): number | null {
  const severity = required ? 'error' : 'warning'
  if (value === '') {
    if (required) {
      issues.push(rowIssue(rowNumber, severity, field, `${field}が欠損しています`))
    }
    return null
  }
  // U+2212（MINUS SIGN）を ASCII ハイフンへ、桁区切りカンマを除去してから解析する。
  const cleaned = value.replace(/−/g, '-').replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(cleaned)) {
    issues.push(rowIssue(rowNumber, severity, field, `${field}が数値ではありません: "${value}"`))
    return null
  }
  return Number(cleaned)
}

function checkMagnitude(value: number, rowNumber: number, field: string, issues: ValidationIssue[]): void {
  if (Math.abs(value) > ABNORMAL_MAGNITUDE) {
    issues.push(rowIssue(rowNumber, 'warning', field, `${field}の桁数が異常に大きい可能性があります: ${value}`))
  }
}

function checkInjection(value: string, rowNumber: number, field: string, issues: ValidationIssue[]): void {
  if (startsWithFormulaTrigger(value)) {
    issues.push(
      rowIssue(rowNumber, 'warning', field, `CSVインジェクションの恐れがある値です（出力時にエスケープします）: "${value}"`),
    )
  }
}

function startsWithFormulaTrigger(value: string): boolean {
  return value.length > 0 && FORMULA_TRIGGERS.has(value[0]!)
}

function rowIssue(
  rowNumber: number,
  severity: ValidationIssue['severity'],
  field: string,
  message: string,
): ValidationIssue {
  return { code: 'survey_csv_row', severity, field, message: `${rowNumber}行目: ${message}` }
}

function buildSource(header: readonly string[], cells: readonly string[]): Record<string, string> {
  const source: Record<string, string> = {}
  for (let i = 0; i < header.length; i++) {
    source[header[i]!] = cells[i] ?? ''
  }
  return source
}

function isBlankRow(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '')
}

/**
 * 測点をCSV文字列へ出力する（FR-SURV-005）。列は mapping に従い、テキスト列の
 * CSVインジェクション（§24.2）を無害化する。行区切りは CRLF（Excel 互換）。
 */
export function exportSurveyCsv(
  points: readonly SurveyPoint[],
  mapping: SurveyCsvMapping = DEFAULT_SURVEY_CSV_MAPPING,
): string {
  const columns: Array<{ header: string; value: (p: SurveyPoint) => string; text: boolean }> = [
    { header: mapping.pointNumberColumn, value: (p) => p.pointNumber, text: true },
    { header: mapping.xColumn, value: (p) => String(p.x), text: false },
    { header: mapping.yColumn, value: (p) => String(p.y), text: false },
  ]
  if (mapping.elevationColumn !== undefined) {
    columns.push({ header: mapping.elevationColumn, value: (p) => (p.elevation === undefined ? '' : String(p.elevation)), text: false })
  }
  if (mapping.codeColumn !== undefined) {
    columns.push({ header: mapping.codeColumn, value: (p) => p.code ?? '', text: true })
  }
  if (mapping.noteColumn !== undefined) {
    columns.push({ header: mapping.noteColumn, value: (p) => p.note ?? '', text: true })
  }

  const lines: string[] = []
  lines.push(columns.map((c) => encodeCsvField(c.header, false)).join(','))
  for (const point of points) {
    lines.push(columns.map((c) => encodeCsvField(c.value(point), c.text)).join(','))
  }
  return lines.join('\r\n')
}

/**
 * CSVフィールドを符号化する。text=true かつ先頭が数式トリガーならアポストロフィを
 * 付与して無害化し（§24.2）、カンマ・引用符・改行・前後空白を含む場合は二重引用符で囲う。
 */
function encodeCsvField(value: string, text: boolean): string {
  const guarded = text && startsWithFormulaTrigger(value) ? `'${value}` : value
  const needsQuote = /[",\r\n]/.test(guarded) || guarded !== guarded.trim()
  if (!needsQuote) {
    return guarded
  }
  return `"${guarded.replace(/"/g, '""')}"`
}

/**
 * CSV文字列をセルの二次元配列へ解析する（RFC 4180 準拠の最小実装）。
 * 二重引用符で囲まれたフィールド内のカンマ・改行・""（エスケープ引用符）を扱う。
 * 改行は LF / CRLF / CR を許容する。
 */
function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    rows.push(row)
    row = []
  }

  while (i < content.length) {
    const ch = content[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      if (content[i + 1] === '\n') {
        i++
      }
      pushRow()
      i++
      continue
    }
    if (ch === '\n') {
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }
  // 末尾フィールド/行（最終行に改行が無い場合）を確定する。
  if (field !== '' || row.length > 0) {
    pushRow()
  }
  return rows
}
