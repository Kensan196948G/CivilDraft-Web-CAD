/**
 * 図面のチェックイン/アウト（排他編集の所有権モデル）。
 *
 * 設計位置づけ:
 * - 共有版（Workers API）は既に楽観ロック（expectedVersion + 409 CD-CONFLICT-001）を
 *   持つため、本モジュールは「誰がどの改訂を編集対象として保有しているか」を明示する
 *   オーナーシップ層として機能する。
 * - 現行実装は端末ローカル（IndexedDB と別の localStorage 相当）の状態で動作し、
 *   サーバー横断のロック強制はスキーマ拡張（migration 0006 相当）を要する。
 *   サーバー永続化は統合報告書の残課題として記録する。
 * - 承認後改変防止は revisions/workflow.ts の approved 状態と contentChecksum 照合で担保され、
 *   チェックアウトは draft 状態の改訂に対してのみ許可する。
 */
import type { Result, ValidationIssue } from '@/shared/types'

export type CheckoutStatus = 'checkedOut' | 'checkedIn'

export interface DrawingCheckout {
  readonly drawingId: string
  readonly revisionId: string
  readonly checkedOutBy: string
  readonly checkedOutAt: string
  readonly status: CheckoutStatus
  readonly checkedInAt?: string
}

function fail(code: string, message: string): ValidationIssue {
  return { code, severity: 'error', message }
}

export interface AcquireCheckoutInput {
  readonly drawingId: string
  readonly revisionId: string
  readonly actorId: string
  readonly revisionStatus: 'draft' | 'inReview' | 'returned' | 'pendingApproval' | 'approved' | 'obsolete'
  readonly now: string
}

/** チェックアウトを取得する。他ユーザーが保有中・承認済み改訂は取得不可。 */
export function acquireCheckout(
  current: DrawingCheckout | null,
  input: AcquireCheckoutInput,
): Result<DrawingCheckout, ValidationIssue> {
  if (input.actorId.trim() === '') {
    return { ok: false, error: fail('CD_CHECKOUT_ACTOR_REQUIRED', '操作者を特定できません') }
  }
  if (input.revisionStatus !== 'draft' && input.revisionStatus !== 'returned') {
    return {
      ok: false,
      error: fail('CD_CHECKOUT_NOT_EDITABLE', 'draft / returned 状態の改訂のみチェックアウトできます（承認後改変防止）'),
    }
  }
  if (current?.status === 'checkedOut') {
    if (current.checkedOutBy !== input.actorId) {
      return {
        ok: false,
        error: fail(
          'CD_CHECKOUT_ALREADY_HELD',
          `別の利用者（${current.checkedOutBy}）がチェックアウト中のため編集できません`,
        ),
      }
    }
    // 同一利用者による再取得は日時更新で許容する。
    return {
      ok: true,
      value: {
        ...current,
        revisionId: input.revisionId,
        checkedOutAt: input.now,
        status: 'checkedOut',
        checkedInAt: undefined,
      },
    }
  }
  return {
    ok: true,
    value: {
      drawingId: input.drawingId,
      revisionId: input.revisionId,
      checkedOutBy: input.actorId,
      checkedOutAt: input.now,
      status: 'checkedOut',
    },
  }
}

/** チェックインする。保有者本人のみ、未保有時はエラー。 */
export function releaseCheckout(
  current: DrawingCheckout | null,
  input: { readonly actorId: string; readonly now: string; readonly note?: string },
): Result<DrawingCheckout, ValidationIssue> {
  if (current === null || current.status !== 'checkedOut') {
    return { ok: false, error: fail('CD_CHECKOUT_NOT_HELD', 'チェックアウトされていません') }
  }
  if (current.checkedOutBy !== input.actorId) {
    return {
      ok: false,
      error: fail('CD_CHECKOUT_NOT_OWNER', `チェックアウト保有者（${current.checkedOutBy}）のみチェックインできます`),
    }
  }
  return {
    ok: true,
    value: {
      ...current,
      status: 'checkedIn',
      checkedInAt: input.now,
    },
  }
}
