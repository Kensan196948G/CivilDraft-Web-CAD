/**
 * 電子納品ルール定義（一次情報ベース）。
 *
 * 出典:
 * - 国土交通省「工事完成図書の電子納品等要領（令和5年3月版）」
 *   https://www.mlit.go.jp/tec/content/001396114.pdf
 * - 国土交通省「電子納品等運用ガイドライン【土木工事編】（令和5年3月版）」
 *   http://cals-ed.go.jp/mg/wp-content/uploads/guide_c11.pdf
 *
 * 本モジュールは「チェック支援」であり、電子納品の適合を自動断定しない。
 * 最終確認は必ず人間（検査職員・発注者）が行う。
 */
import type { ValidationIssue } from '@/shared/types'

/** 適用基準の版管理。改定時はここを更新し、出典・版を成果物に記録する。 */
export const DELIVERY_STANDARD = {
  name: '工事完成図書の電子納品等要領（令和5年3月版）＋電子納品等運用ガイドライン【土木工事編】（令和5年3月版）',
  sourceUrl:
    'https://www.mlit.go.jp/tec/content/001396114.pdf / http://cals-ed.go.jp/mg/wp-content/uploads/guide_c11.pdf',
  revision: 'R5.3',
  publisher: '国土交通省',
} as const

/** 電子成果品ルート直下に置く標準フォルダ（土木工事編）。 */
export const DELIVERY_FOLDERS = [
  'DRAWINGF', // 工事完成図（SXF(P21)・図面管理ファイル）
  'MAINT', // 維持管理データ
  'PLAN', // 施工計画書
  'SCHEDULE', // 工程表
  'MEET', // 打合せ簿
  'MATERIAL', // 材料検査関係
  'PROCESS', // 段階確認・出来形管理
  'INSPECT', // 品質証明・試験
  'SALVAGE', // 完成写真
  'OTHRS', // その他
] as const

export type DeliveryFolder = (typeof DELIVERY_FOLDERS)[number]

/** ルート直下に置く管理ファイル（例）。実装は XML 生成ではなく項目一覧 CSV を提供する。 */
export const DELIVERY_MANAGEMENT_FILES = ['INDEX_C.XML', 'DRAWINGF.XML'] as const

/**
 * ファイル名の禁則文字（要領 8章「使用文字」に基づく実用的な検査セット）。
 * 機種依存文字（丸囲み数字・ローマ数字・㈱・№・㎥ 等）・外字・制御文字・
 * ファイルシステム予約文字は使用不可。
 */
export const FORBIDDEN_FILE_NAME_CHARS =
  '\\/:*?"<>|\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u0009\u000A\u000B\u000C\u000D\u000E\u000F\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F\u007F' +
  '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ㈱№㎥㎡㍍㌢㌔㌘㌢ｶﾞﾊﾟ' +
  '，．・：；？！'

export const HALF_WIDTH_ALNUM = /^[A-Za-z0-9._-]+$/

/** ファイル名の最大長（全角2文字換算の簡易規則で 80 バイト相当を目安に 40 文字まで）。 */
export const MAX_FILE_NAME_LENGTH = 80

/** 形式ごとの取扱い。isError=false の形式は警告（要領上は発注者協議が必要）。 */
export interface FormatRule {
  readonly extension: string
  readonly label: string
  readonly kind: 'cad' | 'document' | 'data' | 'image'
  readonly deliveryOk: boolean
  readonly note: string
}

export const FORMAT_RULES: readonly FormatRule[] = [
  {
    extension: 'sxf',
    label: 'SXF(P21)',
    kind: 'cad',
    deliveryOk: true,
    note: 'CAD図面の標準交換形式（CAD製図基準）。P21 版を推奨。',
  },
  {
    extension: 'p21',
    label: 'SXF(P21)',
    kind: 'cad',
    deliveryOk: true,
    note: 'SXF P21 ファイル。',
  },
  {
    extension: 'pdf',
    label: 'PDF',
    kind: 'document',
    deliveryOk: true,
    note: '書類は PDF/A 形式を推奨（長期保存）。本システムは PDF/A 変換自体は未実装（課題）。',
  },
  {
    extension: 'dxf',
    label: 'DXF',
    kind: 'cad',
    deliveryOk: false,
    note: 'DXF は要領の標準形式ではない。SXF(P21) への変換または発注者協議が必要。',
  },
  {
    extension: 'csv',
    label: 'CSV',
    kind: 'data',
    deliveryOk: true,
    note: '数量・測量等のデータ交換用。文字コード（UTF-8/Shift_JIS）は発注者仕様に従う。',
  },
  {
    extension: 'xml',
    label: 'XML',
    kind: 'data',
    deliveryOk: true,
    note: '管理ファイル（INDEX_C.XML 等）は指定 DTD に従う。',
  },
  {
    extension: 'jpg',
    label: 'JPEG',
    kind: 'image',
    deliveryOk: true,
    note: '完成写真等。解像度・圧縮率は要領に従う。',
  },
  {
    extension: 'png',
    label: 'PNG',
    kind: 'image',
    deliveryOk: true,
    note: '図面画像等。',
  },
]

export function formatRuleFor(fileName: string): FormatRule | undefined {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = fileName.slice(dot + 1).toLowerCase()
  return FORMAT_RULES.find((rule) => rule.extension === ext)
}

/** ファイル名の文字検査。問題なければ null。 */
export function validateFileName(fileName: string): ValidationIssue | null {
  if (fileName.trim() === '') {
    return { code: 'EDELIVERY_EMPTY_NAME', severity: 'error', message: 'ファイル名が空です' }
  }
  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return {
      code: 'EDELIVERY_NAME_TOO_LONG',
      severity: 'error',
      message: `ファイル名が長すぎます（最大 ${MAX_FILE_NAME_LENGTH} 文字）`,
    }
  }
  for (const char of FORBIDDEN_FILE_NAME_CHARS) {
    if (fileName.includes(char)) {
      return {
        code: 'EDELIVERY_FORBIDDEN_CHAR',
        severity: 'error',
        message: `ファイル名に禁則文字「${char}」が含まれています`,
      }
    }
  }
  if (!HALF_WIDTH_ALNUM.test(fileName)) {
    return {
      code: 'EDELIVERY_NON_ASCII_NAME',
      severity: 'error',
      message: 'ファイル名は半角英数字・._- のみ使用してください（全角・記号は禁則）',
    }
  }
  return null
}

/** フォルダ名の検査。許容フォルダか判定し、問題ならエラーを返す。 */
export function validateFolder(folder: string): ValidationIssue | null {
  const upper = folder.toUpperCase()
  if ((DELIVERY_FOLDERS as readonly string[]).includes(upper)) return null
  return {
    code: 'EDELIVERY_UNKNOWN_FOLDER',
    severity: 'error',
    message: `不明なフォルダ「${folder}」。標準フォルダ: ${DELIVERY_FOLDERS.join(' / ')}`,
  }
}
