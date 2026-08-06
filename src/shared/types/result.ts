/**
 * 詳細設計仕様書 §4.2 結果型
 * 利用者入力・ファイル解析・幾何検査など想定内の失敗はResultで扱う。
 * 予期しない障害のみ例外境界へ送る。
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export interface ValidationIssue {
  readonly code: string
  readonly severity: 'info' | 'warning' | 'error'
  readonly field?: string
  readonly entityId?: string
  readonly message: string
  /** Workers API の構造化エラーコード（例: CD-CONFLICT-001）。UI の分岐に使う。 */
  readonly apiErrorCode?: string
}
