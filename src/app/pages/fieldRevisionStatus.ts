/**
 * 現場説明モードの改訂承認状態を API から取得する（Issue #178）。
 *
 * 実 revisionId を持つ実案件でのみ GET /api/v1/revisions/:id を呼び、
 * 改訂 status を FieldRevisionStatus へ写像する。
 * 取得失敗・未知値は unknown とし、実在しない状態を捏造しない。
 */
import { createCivilDraftApiClient } from '@/infrastructure/cloud/civilDraftApiClient'
import type { CloudRevision } from '@/infrastructure/cloud/civilDraftApiClient'
import type { Result, ValidationIssue } from '@/shared/types'
import type { FieldRevisionStatus } from './FieldExplanationPage'

export type { FieldRevisionStatus } from './FieldExplanationPage'

/** FieldExplanationPage が表示可能な改訂 status（API 契約と一致）。 */
const KNOWN_REVISION_STATUSES: readonly FieldRevisionStatus[] = [
  'draft',
  'inReview',
  'pendingApproval',
  'approved',
  'returned',
  'obsolete',
]

const KNOWN_REVISION_STATUS_SET: ReadonlySet<string> = new Set(KNOWN_REVISION_STATUSES)

/** API の改訂 status（文字列）を FieldRevisionStatus へ写像する。未知値は unknown。 */
export function mapRevisionStatusToField(status: string): FieldRevisionStatus {
  return KNOWN_REVISION_STATUS_SET.has(status) ? (status as FieldRevisionStatus) : 'unknown'
}

/**
 * 改訂承認状態を取得する。
 * 取得失敗・例外・未知 status はいずれも unknown を返す（捏造しない）。
 */
export async function fetchFieldRevisionStatus(
  revisionId: string,
  getRevision: (id: string) => Promise<Result<CloudRevision, ValidationIssue>> = (id) =>
    createCivilDraftApiClient().getRevision(id),
): Promise<FieldRevisionStatus> {
  try {
    const result = await getRevision(revisionId)
    if (!result.ok) return 'unknown'
    return mapRevisionStatusToField(result.value.status)
  } catch {
    return 'unknown'
  }
}
