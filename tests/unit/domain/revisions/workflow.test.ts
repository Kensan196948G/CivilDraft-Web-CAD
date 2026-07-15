import { describe, expect, it } from 'vitest'
import {
  applyRevisionAction,
  availableActions,
  transition,
} from '@/domain/revisions/workflow'
import type { TransitionContext } from '@/domain/revisions/workflow'
import type { RevisionStatus, WorkflowActor } from '@/domain/revisions'

// roles.ts の RolePermissions（{ canView, canEdit, canApprove }）は WorkflowActor へ
// 構造的に代入可能。ここでは各システムロール相当の能力を再現する。
const viewer: WorkflowActor = { canEdit: false, canApprove: false }
const engineer: WorkflowActor = { canEdit: true, canApprove: false }
const supervisor: WorkflowActor = { canEdit: true, canApprove: true }

/** 各遷移で前提条件を満たす最小コンテキスト。 */
const okContext: TransitionContext = {
  mandatoryChecksPassed: true,
  hasStaleQuantities: false,
  returnReason: '寸法未確定のため',
  comment: '断面が仕様と不一致',
  reviewResultRecorded: true,
  checksumMatches: true,
  currentRevisionNumber: '1',
  newRevisionNumber: '2',
  obsoleteReason: '上位計画の変更により廃止',
}

describe('transition — §19.1 状態遷移表の全遷移（許可）', () => {
  const cases: ReadonlyArray<[RevisionStatus, Parameters<typeof transition>[1], WorkflowActor, RevisionStatus]> = [
    ['draft', 'submitReview', engineer, 'inReview'],
    ['returned', 'resumeEditing', engineer, 'draft'],
    ['inReview', 'return', supervisor, 'returned'],
    ['inReview', 'completeReview', supervisor, 'pendingApproval'],
    ['pendingApproval', 'return', supervisor, 'returned'],
    ['pendingApproval', 'approve', supervisor, 'approved'],
    ['approved', 'createRevision', engineer, 'draft'],
    ['approved', 'obsolete', supervisor, 'obsolete'],
  ]

  it.each(cases)('%s --%s--> %s（能力を満たす実行者）', (from, action, actor, to) => {
    const result = transition(from, action, actor, okContext)
    expect(result).toEqual({ ok: true, value: to })
  })
})

describe('transition — 不許可の遷移（許可されない操作）', () => {
  it('draft で approve はできない（表に無い遷移）', () => {
    const result = transition('draft', 'approve', supervisor, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_TRANSITION_NOT_ALLOWED')
  })

  it('approved で submitReview はできない', () => {
    const result = transition('approved', 'submitReview', engineer, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_TRANSITION_NOT_ALLOWED')
  })

  it('obsolete は終端で、いかなる操作も遷移しない', () => {
    expect(transition('obsolete', 'createRevision', engineer, okContext).ok).toBe(false)
  })
})

describe('transition — ロール別権限（§19.1 実行可能ロール）', () => {
  it('viewer は作成者操作（submitReview）を実行できない', () => {
    const result = transition('draft', 'submitReview', viewer, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ROLE_NOT_PERMITTED')
  })

  it('viewer は照査（inReview→return）を実行できない', () => {
    const result = transition('inReview', 'return', viewer, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ROLE_NOT_PERMITTED')
  })

  it('engineer（canApprove なし）は照査完了（completeReview）を実行できない', () => {
    const result = transition('inReview', 'completeReview', engineer, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ROLE_NOT_PERMITTED')
  })

  it('engineer は承認（approve）を実行できない', () => {
    const result = transition('pendingApproval', 'approve', engineer, okContext)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ROLE_NOT_PERMITTED')
  })
})

describe('transition — §19.1 前提条件', () => {
  it('submitReview は必須検査未合格だと失敗する', () => {
    const result = transition('draft', 'submitReview', engineer, { mandatoryChecksPassed: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_MANDATORY_CHECK_FAILED')
  })

  it('submitReview は stale 数量が残っていると失敗する', () => {
    const result = transition('draft', 'submitReview', engineer, {
      mandatoryChecksPassed: true,
      hasStaleQuantities: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_STALE_QUANTITIES')
  })

  it('return はコメント無しだと失敗する（コメント必須）', () => {
    const result = transition('inReview', 'return', supervisor, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_COMMENT_REQUIRED')
  })

  it('approve は checksum 不一致だと失敗する', () => {
    const result = transition('pendingApproval', 'approve', supervisor, { checksumMatches: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_CHECKSUM_MISMATCH')
  })

  it('completeReview は照査結果未記録だと失敗する', () => {
    const result = transition('inReview', 'completeReview', supervisor, { reviewResultRecorded: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_REVIEW_RESULT_REQUIRED')
  })

  it('createRevision は新改訂番号が単調増加でないと失敗する', () => {
    const result = transition('approved', 'createRevision', engineer, {
      currentRevisionNumber: '2',
      newRevisionNumber: '2',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_NUMBER_NOT_INCREASING')
  })

  it('obsolete は理由無しだと失敗する', () => {
    const result = transition('approved', 'obsolete', supervisor, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_OBSOLETE_REASON_REQUIRED')
  })
})

describe('availableActions', () => {
  it('inReview からは return / completeReview の 2 操作が可能', () => {
    expect(availableActions('inReview').slice().sort()).toEqual(['completeReview', 'return'])
  })

  it('obsolete からは操作なし', () => {
    expect(availableActions('obsolete')).toEqual([])
  })
})

describe('applyRevisionAction — 遷移と履歴の同時生成（§19.2）', () => {
  it('承認成功時に次状態と承認者履歴を返す', () => {
    const result = applyRevisionAction({
      current: 'pendingApproval',
      action: 'approve',
      actor: supervisor,
      actorId: 'user-approver',
      timestamp: '2026-07-15T10:00:00.000Z',
      context: { checksumMatches: true },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        nextStatus: 'approved',
        history: {
          action: 'approve',
          fromStatus: 'pendingApproval',
          toStatus: 'approved',
          actorId: 'user-approver',
          actorRole: 'approver',
          comment: undefined,
          timestamp: '2026-07-15T10:00:00.000Z',
        },
      },
    })
  })

  it('差戻し時はコメントが履歴に記録され、照査者ロールになる', () => {
    const result = applyRevisionAction({
      current: 'inReview',
      action: 'return',
      actor: supervisor,
      actorId: 'user-reviewer',
      timestamp: '2026-07-15T11:00:00.000Z',
      context: { comment: '寸法線が不足' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.history.actorRole).toBe('reviewer')
      expect(result.value.history.comment).toBe('寸法線が不足')
    }
  })

  it('actorId 未指定は失敗する', () => {
    const result = applyRevisionAction({
      current: 'pendingApproval',
      action: 'approve',
      actor: supervisor,
      actorId: '   ',
      timestamp: '2026-07-15T10:00:00.000Z',
      context: { checksumMatches: true },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ACTOR_REQUIRED')
  })

  it('遷移が不許可なら履歴を生成せず error を返す', () => {
    const result = applyRevisionAction({
      current: 'pendingApproval',
      action: 'approve',
      actor: engineer,
      actorId: 'user-engineer',
      timestamp: '2026-07-15T10:00:00.000Z',
      context: { checksumMatches: true },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('REVISION_ROLE_NOT_PERMITTED')
  })
})
