/**
 * 監査ログ hash chain（ADR-0009 / Issue #61）。
 *
 * 各監査レコードの `entry_hash = SHA-256(previous_hash | canonical payload)` とし、
 * レコードを時系列に連結することで改ざんを検知できるようにする。
 * previous_hash が無い先頭レコード（または過去のレガシーレコード）からは
 * 空文字を起点にチェーンを再開する。
 *
 * 注意: canonical 化は jsonb のキー順正規化（ソート）に影響されないよう、
 * 再帰的にキーをソートした stable JSON 文字列を使用する。
 */

/** hash chain の対象となる監査レコード（persistAuditLog 前後で使用）。 */
export interface AuditChainRecord {
  readonly id: string
  readonly occurredAt: string
  readonly eventName: string
  readonly actorId: string
  readonly projectId?: string
  readonly entityType?: string
  readonly entityId?: string
  readonly result: 'success' | 'failure'
  readonly correlationId: string
  readonly detail?: unknown
  readonly previousHash?: string
  readonly entryHash?: string
}

/** キーをソートした安定 JSON 文字列化（jsonb 正規化と無関係に決定論的）。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** ハッシュ対象の canonical ペイロード（固定フィールド順・欠損は null で正規化）。 */
export function canonicalAuditPayload(record: AuditChainRecord): string {
  return stableStringify({
    id: record.id,
    occurredAt: record.occurredAt,
    eventName: record.eventName,
    actorId: record.actorId,
    projectId: record.projectId ?? null,
    entityType: record.entityType ?? null,
    entityId: record.entityId ?? null,
    result: record.result,
    correlationId: record.correlationId,
    detail: record.detail ?? null,
  })
}

/** SHA-256 16進文字列。 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * previous_hash と canonical ペイロードから entry_hash を計算する。
 * previous_hash 未指定（チェーン先頭）は空文字起点。
 */
export async function computeEntryHash(
  previousHash: string | undefined,
  record: AuditChainRecord,
): Promise<string> {
  return sha256Hex(`${previousHash ?? ''}|${canonicalAuditPayload(record)}`)
}

export interface AuditChainVerification {
  readonly valid: boolean
  /** 検証対象レコード総数 */
  readonly checkedCount: number
  /** entry_hash を持つレコード数 */
  readonly hashedCount: number
  /** レガシー（hash 無し）レコード数 */
  readonly legacyCount: number
  /** 最初に不整合を検出したレコード位置（0始まり）。valid の場合は undefined */
  readonly brokenAt?: number
  /** 末尾レコードの entry_hash（チェーンが 1 件以上ある場合） */
  readonly tailHash?: string
}

/**
 * 時系列順の監査レコード列に対してチェーンの完全性を検証する。
 * - hash 無しレコードのみの場合は legacy として valid=true（検証対象外）
 * - hash 有りレコードは previous_hash の一致と entry_hash の再計算一致の両方を確認
 * - 途中に hash 無しレコードがある場合、後続の hash 有りレコードは
 *   直前の hash 有りレコードを起点に再計算する（persistAuditLog と同じ規則）
 */
export async function verifyAuditChain(
  records: readonly AuditChainRecord[],
): Promise<AuditChainVerification> {
  let previousHashedEntryHash: string | undefined
  let hashedCount = 0
  let legacyCount = 0
  let tailHash: string | undefined

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record || record.entryHash === undefined) {
      legacyCount += 1
      continue
    }
    // 直前レコードが hash 有りの場合はその entry_hash が previous_hash のはず。
    // 直前が hash 無し（または先頭）の場合は空起点で再開する。
    const expectedPreviousHash = previousHashedEntryHash ?? ''
    const storedPreviousHash = record.previousHash ?? ''
    if (storedPreviousHash !== expectedPreviousHash) {
      return {
        valid: false,
        checkedCount: records.length,
        hashedCount,
        legacyCount,
        brokenAt: i,
      }
    }
    const expectedHash = await computeEntryHash(storedPreviousHash, record)
    if (expectedHash !== record.entryHash) {
      return {
        valid: false,
        checkedCount: records.length,
        hashedCount,
        legacyCount,
        brokenAt: i,
      }
    }
    hashedCount += 1
    previousHashedEntryHash = record.entryHash
    tailHash = record.entryHash
  }

  return {
    valid: true,
    checkedCount: records.length,
    hashedCount,
    legacyCount,
    tailHash,
  }
}
