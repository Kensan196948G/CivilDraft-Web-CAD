/**
 * 電子納品チェック（純粋関数）。
 * フォルダ構成・ファイル命名・形式の検査を行い、エラー/警告/情報を返す。
 * 適合の自動断定はしない（人による最終確認を前提とする）。
 */
import type { ValidationIssue } from '@/shared/types'
import {
  DELIVERY_STANDARD,
  formatRuleFor,
  validateFileName,
  validateFolder,
} from './edeliveryRules'

export interface DeliveryFileEntry {
  readonly folder: string
  readonly fileName: string
  /** 成果物が PDF/A 形式であることが確認できている場合 true（チェック時は利用者の申告）。 */
  readonly pdfA?: boolean
  readonly sizeBytes?: number
}

export interface DeliveryMeta {
  readonly projectName: string
  readonly projectNumber: string
  readonly clientName: string
  readonly workType: string
  readonly orderer: string
  readonly standard: string
}

export interface DeliveryCheckResult {
  readonly issues: readonly ValidationIssue[]
  readonly fileCount: number
  readonly errorCount: number
  readonly warningCount: number
  readonly infoCount: number
  readonly standard: typeof DELIVERY_STANDARD
  /** 人による最終確認が必要（false でも確認は省略できない。true は「確認を促す警告あり」）。 */
  readonly requiresHumanConfirmation: boolean
}

/** 成果物一覧を検査する。 */
export function checkDeliveryFiles(files: readonly DeliveryFileEntry[]): DeliveryCheckResult {
  const issues: ValidationIssue[] = []

  for (const file of files) {
    const folderIssue = validateFolder(file.folder)
    if (folderIssue !== null) issues.push({ ...folderIssue, entityId: file.fileName })

    const nameIssue = validateFileName(file.fileName)
    if (nameIssue !== null) issues.push({ ...nameIssue, entityId: file.fileName })

    const format = formatRuleFor(file.fileName)
    if (format === undefined) {
      issues.push({
        code: 'EDELIVERY_UNKNOWN_FORMAT',
        severity: 'warning',
        entityId: file.fileName,
        message: '形式を判定できません（拡張子を確認してください）',
      })
    } else if (!format.deliveryOk) {
      issues.push({
        code: 'EDELIVERY_FORMAT_NOT_STANDARD',
        severity: 'warning',
        entityId: file.fileName,
        message: `${format.label}: ${format.note}`,
      })
    }

    if (format?.extension === 'pdf' && file.pdfA !== true) {
      issues.push({
        code: 'EDELIVERY_PDFA_NOT_CONFIRMED',
        severity: 'warning',
        entityId: file.fileName,
        message: 'PDF は PDF/A 形式であることを確認してください（長期保存要件）',
      })
    }
  }

  // DRAWINGF に図面ファイル（SXF/DXF）が無い場合は警告（工事完成図の欠落可能性）。
  const drawingFiles = files.filter((file) => file.folder.toUpperCase() === 'DRAWINGF')
  if (drawingFiles.length === 0) {
    issues.push({
      code: 'EDELIVERY_NO_DRAWING_FILES',
      severity: 'warning',
      message: 'DRAWINGF に図面ファイルがありません（工事完成図の格納を確認してください）',
    })
  }

  const severityCount = (severity: ValidationIssue['severity']): number =>
    issues.filter((issue) => issue.severity === severity).length

  return {
    issues,
    fileCount: files.length,
    errorCount: severityCount('error'),
    warningCount: severityCount('warning'),
    infoCount: severityCount('info'),
    standard: DELIVERY_STANDARD,
    // 電子納品は発注者・検査職員による最終確認が必須。自動検査で省略してはならない。
    requiresHumanConfirmation: true,
  }
}

/** 検査結果を CSV（Shift_JIS 前提のテキスト列）へ整形する。 */
export function deliveryCheckToCsv(
  meta: DeliveryMeta,
  files: readonly DeliveryFileEntry[],
  result: DeliveryCheckResult,
): string {
  const rows: string[][] = [
    ['工事名称', meta.projectName],
    ['工事番号', meta.projectNumber],
    ['発注者', meta.orderer],
    ['対象工種', meta.workType],
    ['適用基準', meta.standard],
    ['基準版', result.standard.revision],
    ['出典', result.standard.sourceUrl],
    ['最終確認者', meta.clientName],
    [],
    ['フォルダ', 'ファイル名', '形式', 'サイズ(byte)', '検査結果', '備考'],
  ]
  const fileIssues = new Map<string, readonly ValidationIssue[]>()
  for (const issue of result.issues) {
    const key = issue.entityId ?? ''
    const current = fileIssues.get(key) ?? []
    fileIssues.set(key, [...current, issue])
  }
  for (const file of files) {
    const issues = fileIssues.get(file.fileName) ?? []
    const verdict = issues.some((issue) => issue.severity === 'error')
      ? 'エラー'
      : issues.some((issue) => issue.severity === 'warning')
        ? '警告'
        : '確認済（人による最終確認が必要）'
    rows.push([
      file.folder,
      file.fileName,
      formatRuleFor(file.fileName)?.label ?? '不明',
      String(file.sizeBytes ?? ''),
      verdict,
      issues.map((issue) => issue.message).join('; '),
    ])
  }
  rows.push([], ['総ファイル数', String(files.length)], ['エラー', String(result.errorCount)], ['警告', String(result.warningCount)])
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n')
}

/** 標準フォルダ構成の案内ツリー（管理ファイル案内用）。 */
export function deliveryFolderTree(): string {
  return [
    '（電子成果品ルート）',
    '├─ INDEX_C.XML（工事管理ファイル・DTD は発注者指示に従う）',
    '├─ DRAWINGF.XML（図面管理ファイル）',
    ...DELIVERY_FOLDERS_LINES(),
  ].join('\n')
}

function DELIVERY_FOLDERS_LINES(): string[] {
  const folders: readonly string[] = [
    'DRAWINGF（工事完成図）',
    'MAINT（維持管理データ）',
    'PLAN（施工計画書）',
    'SCHEDULE（工程表）',
    'MEET（打合せ簿）',
    'MATERIAL（材料検査関係）',
    'PROCESS（段階確認・出来形管理）',
    'INSPECT（品質証明・試験）',
    'SALVAGE（完成写真）',
    'OTHRS（その他）',
  ]
  return folders.map((folder, index) => `${index === folders.length - 1 ? '└─' : '├─'} ${folder}`)
}
