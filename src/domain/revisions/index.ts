/**
 * 詳細設計仕様書 §19 改訂・承認ワークフロー domain の公開窓口。
 */
export type {
  RevisionStatus,
  RevisionAction,
  WorkflowRole,
  WorkflowActor,
  DrawingRevision,
  RevisionHistoryEntry,
} from './types'

export {
  transition,
  availableActions,
  revisionTransitionTarget,
  applyRevisionAction,
} from './workflow'
export type {
  TransitionContext,
  RevisionActionInput,
  RevisionActionResult,
} from './workflow'

export {
  canModifyRevisionContent,
  assertContentMutable,
  compareRevisionNumber,
  assertRevisionNumberIncreases,
  validateHistoryEntry,
} from './invariants'
