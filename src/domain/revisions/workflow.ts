/**
 * 詳細設計仕様書 §19.1 状態遷移表を忠実に実装するワークフロー状態機械。
 *
 * transition(current, action, actor, ctx) は許可された遷移か・実行者に能力があるか・
 * 前提条件を満たすかを検査し、次状態またはエラー（ValidationIssue）を Result で返す。
 * 許可されない遷移・能力不足・前提未達はすべて想定内の失敗として error にする。
 *
 * applyRevisionAction は遷移と同時に履歴エントリを生成する。§19.2「ワークフロー操作と
 * 監査ログは同一トランザクションで記録する」を満たすため、呼び出し側が next 状態と
 * 履歴を 1 回の永続化で書けるよう両方を返す（永続化そのものは infrastructure 層の責務）。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import { assertRevisionNumberIncreases } from './invariants'
import type {
  RevisionAction,
  RevisionHistoryEntry,
  RevisionStatus,
  WorkflowActor,
  WorkflowRole,
} from './types'

/** transition の前提条件（§19.1「前提」列）を渡すためのコンテキスト。 */
export interface TransitionContext {
  /** submitReview: 必須検査が合格しているか。 */
  readonly mandatoryChecksPassed?: boolean
  /** submitReview: 古い（stale）数量が残っているか。true なら提出不可。 */
  readonly hasStaleQuantities?: boolean
  /** resumeEditing: 差戻し理由。 */
  readonly returnReason?: string
  /** return: 差戻しコメント（必須）。 */
  readonly comment?: string
  /** completeReview: 照査結果が記録済みか。 */
  readonly reviewResultRecorded?: boolean
  /** approve: クライアント表示 checksum とサーバー値が一致したか。 */
  readonly checksumMatches?: boolean
  /** createRevision: 直前（承認済み）の改訂番号。単調増加検査に用いる。 */
  readonly currentRevisionNumber?: string
  /** createRevision: 新しい改訂番号（必須・単調増加）。 */
  readonly newRevisionNumber?: string
  /** obsolete: 廃止理由（必須）。 */
  readonly obsoleteReason?: string
}

interface TransitionRule {
  readonly from: RevisionStatus
  readonly action: RevisionAction
  readonly to: RevisionStatus
  readonly role: WorkflowRole
  /** 実行に必要な能力（roles.ts の canEdit/canApprove に対応）。 */
  readonly capability: 'canEdit' | 'canApprove'
  /** §19.1「前提」列の検査。問題なければ null。 */
  readonly precondition: (ctx: TransitionContext) => ValidationIssue | null
}

function issue(code: string, message: string, field?: string): ValidationIssue {
  return field === undefined
    ? { code, severity: 'error', message }
    : { code, severity: 'error', field, message }
}

function requireText(value: string | undefined, code: string, message: string): ValidationIssue | null {
  return value !== undefined && value.trim() !== '' ? null : issue(code, message)
}

/**
 * §19.1 状態遷移表そのものをデータとして表現する（単一の真実）。
 * transition / applyRevisionAction / 到達可能アクション列挙はすべてこの表から導出する。
 */
const TRANSITIONS: readonly TransitionRule[] = [
  {
    from: 'draft',
    action: 'submitReview',
    to: 'inReview',
    role: 'author',
    capability: 'canEdit',
    precondition: (ctx) => {
      if (ctx.mandatoryChecksPassed !== true) {
        return issue('REVISION_MANDATORY_CHECK_FAILED', '必須検査に合格していません')
      }
      if (ctx.hasStaleQuantities === true) {
        return issue('REVISION_STALE_QUANTITIES', '古い数量が残っているため照査へ提出できません')
      }
      return null
    },
  },
  {
    from: 'returned',
    action: 'resumeEditing',
    to: 'draft',
    role: 'author',
    capability: 'canEdit',
    precondition: (ctx) =>
      requireText(ctx.returnReason, 'REVISION_RETURN_REASON_REQUIRED', '差戻し理由が必要です'),
  },
  {
    from: 'inReview',
    action: 'return',
    to: 'returned',
    role: 'reviewer',
    capability: 'canApprove',
    precondition: (ctx) =>
      requireText(ctx.comment, 'REVISION_COMMENT_REQUIRED', '差戻しにはコメントが必要です'),
  },
  {
    from: 'inReview',
    action: 'completeReview',
    to: 'pendingApproval',
    role: 'reviewer',
    capability: 'canApprove',
    precondition: (ctx) => {
      if (ctx.reviewResultRecorded !== true) {
        return issue('REVISION_REVIEW_RESULT_REQUIRED', '照査結果が記録されていません')
      }
      return null
    },
  },
  {
    from: 'pendingApproval',
    action: 'return',
    to: 'returned',
    role: 'approver',
    capability: 'canApprove',
    precondition: (ctx) =>
      requireText(ctx.comment, 'REVISION_COMMENT_REQUIRED', '差戻しにはコメントが必要です'),
  },
  {
    from: 'pendingApproval',
    action: 'approve',
    to: 'approved',
    role: 'approver',
    capability: 'canApprove',
    precondition: (ctx) => {
      if (ctx.checksumMatches !== true) {
        return issue('REVISION_CHECKSUM_MISMATCH', '内容 Checksum が一致しません（表示内容が変更された可能性）')
      }
      return null
    },
  },
  {
    from: 'approved',
    action: 'createRevision',
    to: 'draft',
    role: 'author',
    capability: 'canEdit',
    precondition: (ctx) => {
      // 新 ID の付与は呼び出し側（新エンティティ生成）の責務。ここでは新改訂番号の
      // 提示と単調増加（§19.2）を検査する。currentRevisionNumber 未指定時は増加検査を省く。
      const missing = requireText(
        ctx.newRevisionNumber,
        'REVISION_NEW_NUMBER_REQUIRED',
        '新しい改訂番号が必要です',
      )
      if (missing !== null) return missing
      if (ctx.currentRevisionNumber !== undefined) {
        return assertRevisionNumberIncreases(ctx.currentRevisionNumber, ctx.newRevisionNumber as string)
      }
      return null
    },
  },
  {
    from: 'approved',
    action: 'obsolete',
    to: 'obsolete',
    role: 'admin',
    capability: 'canApprove',
    precondition: (ctx) =>
      requireText(ctx.obsoleteReason, 'REVISION_OBSOLETE_REASON_REQUIRED', '廃止理由が必要です'),
  },
]

function findRule(current: RevisionStatus, action: RevisionAction): TransitionRule | undefined {
  return TRANSITIONS.find((rule) => rule.from === current && rule.action === action)
}

/**
 * 状態遷移を試みる。順に「遷移可否 → 実行者の能力 → 前提条件」を検査し、
 * すべて満たせば次状態を、いずれか満たさなければ ValidationIssue を返す。
 */
export function transition(
  current: RevisionStatus,
  action: RevisionAction,
  actor: WorkflowActor,
  ctx: TransitionContext = {},
): Result<RevisionStatus, ValidationIssue> {
  const rule = findRule(current, action)
  if (rule === undefined) {
    return {
      ok: false,
      error: issue(
        'REVISION_TRANSITION_NOT_ALLOWED',
        `状態 ${current} では操作 ${action} を実行できません`,
      ),
    }
  }
  if (!actor[rule.capability]) {
    return {
      ok: false,
      error: issue(
        'REVISION_ROLE_NOT_PERMITTED',
        `この操作（${action}）を実行する権限（${rule.role}）がありません`,
      ),
    }
  }
  const preconditionIssue = rule.precondition(ctx)
  if (preconditionIssue !== null) {
    return { ok: false, error: preconditionIssue }
  }
  return { ok: true, value: rule.to }
}

/** 現在状態から実行可能なアクション一覧を返す（UI のボタン活性判定などに使う）。 */
export function availableActions(current: RevisionStatus): readonly RevisionAction[] {
  return TRANSITIONS.filter((rule) => rule.from === current).map((rule) => rule.action)
}

/** applyRevisionAction の入力。遷移条件に加え、履歴記録に必要な操作者と日時を含む。 */
export interface RevisionActionInput {
  readonly current: RevisionStatus
  readonly action: RevisionAction
  readonly actor: WorkflowActor
  /** 操作者の識別子（履歴の作成者/照査者/承認者）。 */
  readonly actorId: string
  /** 操作日時（ISO 8601）。 */
  readonly timestamp: string
  readonly context?: TransitionContext
}

/** applyRevisionAction の成功結果。次状態と、同一トランザクションで記録すべき履歴を返す。 */
export interface RevisionActionResult {
  readonly nextStatus: RevisionStatus
  readonly history: RevisionHistoryEntry
}

/** 操作に付随するコメント/理由を履歴用に 1 つへ正規化する。 */
function historyComment(action: RevisionAction, ctx: TransitionContext): string | undefined {
  if (action === 'resumeEditing') return ctx.returnReason
  if (action === 'obsolete') return ctx.obsoleteReason
  return ctx.comment
}

/**
 * 遷移を実行し、成功時は次状態と履歴エントリを生成して返す（§19.2 監査ログの同時記録）。
 * 遷移不可・能力不足・前提未達は transition と同じ ValidationIssue を返す。
 */
export function applyRevisionAction(
  input: RevisionActionInput,
): Result<RevisionActionResult, ValidationIssue> {
  const { current, action, actor, actorId, timestamp, context = {} } = input
  if (actorId.trim() === '') {
    return { ok: false, error: issue('REVISION_ACTOR_REQUIRED', '操作者が指定されていません', 'actorId') }
  }
  if (timestamp.trim() === '') {
    return { ok: false, error: issue('REVISION_TIMESTAMP_REQUIRED', '操作日時が指定されていません', 'timestamp') }
  }
  const result = transition(current, action, actor, context)
  if (!result.ok) return result

  const rule = findRule(current, action) as TransitionRule
  const history: RevisionHistoryEntry = {
    action,
    fromStatus: current,
    toStatus: result.value,
    actorId,
    actorRole: rule.role,
    comment: historyComment(action, context),
    timestamp,
  }
  return { ok: true, value: { nextStatus: result.value, history } }
}
