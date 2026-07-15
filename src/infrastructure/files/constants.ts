/**
 * CivilDraft 独自ファイル形式の定数（詳細設計仕様書 §22）。
 *
 * §22.1 論理形式（JSONベース）の識別子・スキーマ版、§22.3 制限値を集約する。
 * 制限値は「性能・安全試験後に値を確定する」暫定値であり、入力値だけで巨大配列を
 * 事前確保しないための上限として parse/serialize 双方で検査に用いる（§22.3）。
 */

/** ファイル種別識別子。§22.1 `format` フィールドの固定値。 */
export const CIVIL_FILE_FORMAT = 'CivilDraft' as const

/**
 * 現行スキーマ版（§22.1 `schemaVersion`）。IndexedDB とは別系統で、
 * ファイル入出力の互換判定にのみ用いる。破壊的変更時にインクリメントする。
 */
export const CURRENT_SCHEMA_VERSION = 1

/**
 * 読込互換の下限版。これ未満は移行関数（§22.2 手順4）で現行版へ引き上げる。
 * 初期は現行版のみのため下限＝現行だが、将来の移行実装の拡張点として明示する。
 */
export const MIN_SUPPORTED_SCHEMA_VERSION = 1

/** Checksum アルゴリズム（§22.1 `checksums.algorithm`）。 */
export const CHECKSUM_ALGORITHM = 'SHA-256' as const

/**
 * §22.3 制限値（暫定）。性能・安全試験後に確定する。
 * - maxFileBytes: シリアライズ結果の総バイト数上限（DoS・メモリ保護）
 * - maxGeometryCount / maxLayerCount: 図形・レイヤー件数上限
 * - maxVerticesPerGeometry: 1図形あたりの頂点数上限（polyline/spline 等）
 * - maxStringLength: 文字列フィールド長上限（text 本文・名称等）
 * - maxRecoveryCandidates: 復旧候補数上限（IndexedDB 復旧スナップショット側の値。
 *   ファイル形式では直接使わないが §22.3 の定数化対象として集約する）
 */
export const CIVIL_FILE_LIMITS = {
  maxFileBytes: 64 * 1024 * 1024,
  maxGeometryCount: 100_000,
  maxLayerCount: 1_000,
  maxVerticesPerGeometry: 100_000,
  maxStringLength: 100_000,
  maxRecoveryCandidates: 50,
} as const

/**
 * ファイル入出力に関わるエラーコード（詳細設計仕様書 §28）。
 * コードは区分、message は具体診断を担う（§28 末尾: 利用者向けと開発者向けを分離）。
 */
export const FILE_ERROR_CODES = {
  /** §28 CD-FILE-001: 未対応スキーマ。format 不一致・未対応版・解析不能な内容を含む。 */
  unsupportedSchema: 'CD-FILE-001',
  /** §28 CD-FILE-002: Checksum 不一致。 */
  checksumMismatch: 'CD-FILE-002',
  /** §28 CD-VAL-001: 必須項目不足。 */
  missingField: 'CD-VAL-001',
  /** §28 CD-VAL-002: 数値・範囲不正。制限値超過もここに含める。 */
  rangeInvalid: 'CD-VAL-002',
} as const
