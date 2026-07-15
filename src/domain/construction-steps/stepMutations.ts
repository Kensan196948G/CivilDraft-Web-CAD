/**
 * 施工ステップの編集操作（順序変更・削除計画, 詳細設計仕様書 §18）。
 *
 * - 順序変更（reorderSteps）: ID は変えず order だけを変更する（§18）。
 * - 削除計画（planStepDeletion）: 関連図形数を提示し、移行先指定を必須とする（§18）。
 *   純関数として「削除後のステップ一覧」「関連図形数」「移行先へ張り替えた図形」を返し、
 *   実際の反映（ストア更新・履歴登録）は呼び出し側に委ねる。
 */
import type { ConstructionStepId, GeometryBase, Result, ValidationIssue } from '@/shared/types'
import type { ConstructionStep } from './constructionStep'

/** 施工ステップ紐付けを持つ最小構造。 */
type StepBearing = Pick<GeometryBase, 'constructionStepIds'>

/**
 * ステップ順序を orderedIds の並びで振り直す。ID は不変で order のみ更新する（§18）。
 * orderedIds は既存ステップ ID の順列である必要がある（過不足・重複・未知 ID は error）。
 */
export function reorderSteps(
  steps: readonly ConstructionStep[],
  orderedIds: readonly ConstructionStepId[],
): Result<ConstructionStep[], ValidationIssue> {
  if (orderedIds.length !== steps.length) {
    return {
      ok: false,
      error: {
        code: 'CONSTRUCTION_STEP_REORDER_COUNT_MISMATCH',
        severity: 'error',
        message: `順序指定はステップ数と一致する必要があります（指定 ${orderedIds.length} / ステップ ${steps.length}）`,
      },
    }
  }
  const byId = new Map(steps.map((s) => [s.id, s]))
  const seen = new Set<ConstructionStepId>()
  const result: ConstructionStep[] = []
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i]!
    const step = byId.get(id)
    if (step === undefined) {
      return {
        ok: false,
        error: {
          code: 'CONSTRUCTION_STEP_REORDER_UNKNOWN_ID',
          severity: 'error',
          entityId: id,
          message: `未知のステップ ID が順序指定に含まれます: ${id}`,
        },
      }
    }
    if (seen.has(id)) {
      return {
        ok: false,
        error: {
          code: 'CONSTRUCTION_STEP_REORDER_DUPLICATE_ID',
          severity: 'error',
          entityId: id,
          message: `順序指定にステップ ID が重複しています: ${id}`,
        },
      }
    }
    seen.add(id)
    // ID は変えず order だけを新しい並びのインデックスへ更新する。
    result.push({ ...step, order: i })
  }
  return { ok: true, value: result }
}

/** ステップ削除計画（純関数の結果。反映は呼び出し側）。 */
export interface StepDeletionPlan<T extends StepBearing> {
  readonly deletedStepId: ConstructionStepId
  readonly migrationTargetId: ConstructionStepId
  /** 削除対象ステップに紐付く図形数（UI 提示用, §18）。 */
  readonly affectedGeometryCount: number
  /** 削除後のステップ一覧（order を 0..n へ再採番）。 */
  readonly nextSteps: readonly ConstructionStep[]
  /** 削除対象を移行先へ張り替えた図形（対象外の図形は同一参照のまま）。 */
  readonly remappedGeometries: readonly T[]
}

/**
 * ステップ削除の計画を作る（§18）。
 * 移行先の指定を必須とし、削除対象・移行先の存在と相違を検証する。
 * 削除対象ステップを参照する図形の constructionStepIds は移行先へ張り替える
 * （移行先が既に含まれる場合は重複を除去）。空配列（全共通）の図形は影響を受けない。
 */
export function planStepDeletion<T extends StepBearing>(
  steps: readonly ConstructionStep[],
  deletedStepId: ConstructionStepId,
  migrationTargetId: ConstructionStepId,
  geometries: readonly T[],
): Result<StepDeletionPlan<T>, ValidationIssue> {
  const deleted = steps.find((s) => s.id === deletedStepId)
  if (deleted === undefined) {
    return {
      ok: false,
      error: {
        code: 'CONSTRUCTION_STEP_DELETE_UNKNOWN',
        severity: 'error',
        entityId: deletedStepId,
        message: `削除対象のステップが存在しません: ${deletedStepId}`,
      },
    }
  }
  if (migrationTargetId === deletedStepId) {
    return {
      ok: false,
      error: {
        code: 'CONSTRUCTION_STEP_DELETE_SELF_MIGRATION',
        severity: 'error',
        entityId: migrationTargetId,
        message: '移行先に削除対象と同じステップは指定できません',
      },
    }
  }
  if (steps.find((s) => s.id === migrationTargetId) === undefined) {
    return {
      ok: false,
      error: {
        code: 'CONSTRUCTION_STEP_DELETE_UNKNOWN_TARGET',
        severity: 'error',
        entityId: migrationTargetId,
        message: `移行先のステップが存在しません: ${migrationTargetId}（移行先指定は必須）`,
      },
    }
  }

  let affectedGeometryCount = 0
  const remappedGeometries = geometries.map((g) => {
    if (!g.constructionStepIds.includes(deletedStepId)) return g
    affectedGeometryCount += 1
    const replaced = g.constructionStepIds.map((id) =>
      id === deletedStepId ? migrationTargetId : id,
    )
    return { ...g, constructionStepIds: [...new Set(replaced)] }
  })

  const nextSteps = steps
    .filter((s) => s.id !== deletedStepId)
    .sort((a, b) => a.order - b.order)
    .map((s, index) => ({ ...s, order: index }))

  return {
    ok: true,
    value: {
      deletedStepId,
      migrationTargetId,
      affectedGeometryCount,
      nextSteps,
      remappedGeometries,
    },
  }
}
