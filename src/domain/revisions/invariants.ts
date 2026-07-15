/**
 * 詳細設計仕様書 §19.2 不変条件の検査関数群。
 *
 * 表現する不変条件:
 * - `approved`（および終端の `obsolete`）の内容・数量・属性を更新しない。
 * - 改訂番号は単調増加する（新改訂は直前より必ず大きい）。
 * - ワークフロー操作は履歴（作成者/照査者/承認者・コメント・日時）を記録する。
 *
 * 検査は想定内の失敗として ValidationIssue を返す（例外は投げない。§4.2 結果型方針）。
 * 問題なしは null を返す（既存 validateScaleConfig 等の踏襲）。
 */
import type { ValidationIssue } from '@/shared/types'
import type { RevisionHistoryEntry, RevisionStatus } from './types'

/**
 * 図面内容（座標・数量・属性）を変更してよい状態か。
 * 仕様は `approved` の更新禁止を明記する。`obsolete` は承認済みからの終端で同じく凍結されるため、
 * ここでは両状態を「内容変更不可」とみなす（obsolete への追記的更新も禁止）。
 */
export function canModifyRevisionContent(status: RevisionStatus): boolean {
  return status !== 'approved' && status !== 'obsolete'
}

/**
 * 内容変更の可否を検査する。変更不可状態なら error を返す。
 * approved 版の直接上書き防止（§19.2）の入口となる。
 */
export function assertContentMutable(status: RevisionStatus): ValidationIssue | null {
  if (canModifyRevisionContent(status)) return null
  return {
    code: 'REVISION_CONTENT_IMMUTABLE',
    severity: 'error',
    message:
      status === 'approved'
        ? '承認済みの改訂は内容・数量・属性を変更できません（新規改訂を作成してください）'
        : '廃止済みの改訂は内容・数量・属性を変更できません',
  }
}

const NUMERIC_RE = /^\d+$/
const ALPHA_RE = /^[A-Za-z]+$/

/**
 * 改訂番号を比較する。負=a<b、0=同値、正=a>b。
 *
 * 対応する採番方式（土木製図で一般的なもの）と判断:
 * - 数値式（"0","1",...,"10"）: 整数として比較（"10" > "9"）。
 * - 英字式（"A","B",...,"Z","AA"）: 桁数優先、次に大文字ロケール非依存の辞書順（"AA" > "Z"）。
 * - 方式が混在・不明な場合: 文字列の辞書順にフォールバックする（採番方式の混在は運用外とみなす）。
 */
export function compareRevisionNumber(a: string, b: string): number {
  if (NUMERIC_RE.test(a) && NUMERIC_RE.test(b)) {
    const na = Number(a)
    const nb = Number(b)
    return na === nb ? 0 : na < nb ? -1 : 1
  }
  if (ALPHA_RE.test(a) && ALPHA_RE.test(b)) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1
    const ua = a.toUpperCase()
    const ub = b.toUpperCase()
    return ua === ub ? 0 : ua < ub ? -1 : 1
  }
  return a === b ? 0 : a < b ? -1 : 1
}

/**
 * 新改訂番号が直前より単調増加しているか検査する（§19.2 改訂番号の単調増加）。
 * next <= prev なら error を返す。
 */
export function assertRevisionNumberIncreases(
  prev: string,
  next: string,
): ValidationIssue | null {
  if (compareRevisionNumber(next, prev) > 0) return null
  return {
    code: 'REVISION_NUMBER_NOT_INCREASING',
    severity: 'error',
    field: 'revisionNumber',
    message: `改訂番号は単調増加が必要です（直前=${prev}, 新規=${next}）`,
  }
}

/**
 * 履歴エントリの必須項目を検査する（§19.2 履歴記録）。
 * 作成者（actorId）・日時（timestamp）は必須。差戻し（return）・廃止（obsolete）・
 * 編集再開（resumeEditing）はコメント/理由を必須とする（§19.1 前提列）。
 */
export function validateHistoryEntry(entry: RevisionHistoryEntry): ValidationIssue | null {
  if (entry.actorId.trim() === '') {
    return {
      code: 'REVISION_HISTORY_ACTOR_REQUIRED',
      severity: 'error',
      field: 'actorId',
      message: '履歴には操作者（作成者/照査者/承認者）が必要です',
    }
  }
  if (entry.timestamp.trim() === '') {
    return {
      code: 'REVISION_HISTORY_TIMESTAMP_REQUIRED',
      severity: 'error',
      field: 'timestamp',
      message: '履歴には操作日時が必要です',
    }
  }
  const commentRequired =
    entry.action === 'return' ||
    entry.action === 'obsolete' ||
    entry.action === 'resumeEditing'
  if (commentRequired && (entry.comment === undefined || entry.comment.trim() === '')) {
    return {
      code: 'REVISION_HISTORY_COMMENT_REQUIRED',
      severity: 'error',
      field: 'comment',
      message: '差戻し・廃止・編集再開の履歴には理由/コメントが必要です',
    }
  }
  return null
}
