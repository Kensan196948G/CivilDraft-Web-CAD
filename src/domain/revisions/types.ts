/**
 * 詳細設計仕様書 §19 改訂・ワークフローの共通型。
 *
 * workflow.ts（状態遷移）と invariants.ts（不変条件）が双方から参照するため、
 * 循環 import を避ける目的で型のみをここに集約する。
 *
 * ロール設計に関する重要な判断（依存注入）:
 * - domain 層は eslint（詳細設計仕様書 §2.1 / eslint.config.js）により infrastructure への
 *   import を型 import も含めて全面禁止されている。よって
 *   `src/infrastructure/auth/roles.ts` の `CivilDraftRole` を直接 import できない。
 * - 代替として、遷移に必要な「能力」だけを表す WorkflowActor を domain 内に定義し、
 *   actor を引数で受け取る依存注入設計とする（違反回避）。
 * - infrastructure の `RolePermissions`（{ canView, canEdit, canApprove }）は WorkflowActor へ
 *   構造的に代入可能なので、呼び出し側（application 層）は roles.ts の
 *   `permissionsFor(role)` の戻り値をそのまま渡せる。これにより §roles 実装との整合を保つ。
 */
import type { AuditFields, DrawingId, RevisionId } from '@/shared/types'

/**
 * 詳細設計仕様書 §19 の RevisionStatus をそのまま踏襲する。
 * 状態名・順序とも仕様どおり（draft → inReview → pendingApproval → approved、
 * 差戻しは returned、廃止は obsolete）。
 */
export type RevisionStatus =
  | 'draft'
  | 'inReview'
  | 'returned'
  | 'pendingApproval'
  | 'approved'
  | 'obsolete'

/**
 * 詳細設計仕様書 §19.1 状態遷移表の「操作」列に対応するアクション。
 * inReview→returned と pendingApproval→returned はどちらも `return` だが、
 * 実行可能ロール（照査者 / 承認者）は現在状態から決定する。
 */
export type RevisionAction =
  | 'submitReview'
  | 'resumeEditing'
  | 'return'
  | 'completeReview'
  | 'approve'
  | 'createRevision'
  | 'obsolete'

/**
 * 詳細設計仕様書 §19.1「実行可能ロール」列に対応するワークフロー上の役割。
 * システムロール（engineer/supervisor/viewer）とは別概念で、承認フロー内での立場を表す。
 * - author（作成者）: 図面を編集し照査へ提出する。能力 canEdit が必要。
 * - reviewer（照査者）: 照査し差戻し/照査完了を行う。能力 canApprove が必要。
 * - approver（承認者）: 承認/差戻しを行う。能力 canApprove が必要。
 * - admin（管理権限）: 承認済み版の廃止を行う。能力 canApprove が必要。
 *
 * 照査・承認・廃止をいずれも canApprove に対応させるのは roles.ts が canEdit/canApprove の
 * 2 能力しか区別しないためで、仕様の「照査・承認できるロール」を §roles 実装へ写像した結果。
 * 作成・照査・承認の兼務制限（§19.2）は本 domain ではなく案件ポリシー側で検査する。
 */
export type WorkflowRole = 'author' | 'reviewer' | 'approver' | 'admin'

/**
 * 遷移の実行者が持つ能力。roles.ts の RolePermissions を構造的部分集合として受け取るための型。
 * domain は infrastructure を import しないため、CivilDraftRole ではなく能力で受け取る。
 */
export interface WorkflowActor {
  readonly canEdit: boolean
  readonly canApprove: boolean
}

/**
 * 詳細設計仕様書 §19 DrawingRevision。仕様の定義をそのまま型として表す。
 * status/revisionNumber/contentChecksum は不変条件（invariants.ts）の検査対象。
 */
export interface DrawingRevision extends AuditFields {
  readonly id: RevisionId
  readonly drawingId: DrawingId
  readonly revisionNumber: string
  readonly status: RevisionStatus
  readonly changeSummary: string
  readonly basedOnRevisionId?: RevisionId
  readonly contentVersion: number
  readonly contentChecksum: string
}

/**
 * 詳細設計仕様書 §19.2「ワークフロー操作と監査ログは同一トランザクションで記録する」を
 * 満たすための履歴エントリ。作成者/照査者/承認者（actorId + actorRole）・コメント・日時を記録する。
 */
export interface RevisionHistoryEntry {
  readonly action: RevisionAction
  readonly fromStatus: RevisionStatus
  readonly toStatus: RevisionStatus
  /** 操作者の識別子（作成者/照査者/承認者の実体）。 */
  readonly actorId: string
  /** 操作者のワークフロー上の役割。 */
  readonly actorRole: WorkflowRole
  /** 差戻し理由・照査/承認コメント・廃止理由など、操作に付随する注記。 */
  readonly comment?: string
  /** 操作日時（ISO 8601 文字列）。 */
  readonly timestamp: string
}
