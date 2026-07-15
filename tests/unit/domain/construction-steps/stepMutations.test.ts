import { describe, expect, it } from 'vitest'
import type { ConstructionStepId } from '@/shared/types'
import {
  DEFAULT_CONSTRUCTION_STEPS,
  planStepDeletion,
  reorderSteps,
  stepIdOf,
} from '@/domain/construction-steps'

interface StepGeom {
  readonly name: string
  readonly constructionStepIds: readonly ConstructionStepId[]
}

const BEFORE = stepIdOf('before')
const EXCAVATION = stepIdOf('excavation')
const STRUCTURE = stepIdOf('structure')

describe('reorderSteps / 順序変更（ID不変・orderのみ更新, §18）', () => {
  it('新しい並びに応じて order を 0..n へ振り直し、ID は変えない', () => {
    const ids = DEFAULT_CONSTRUCTION_STEPS.map((s) => s.id)
    const reversed = [...ids].reverse()
    const result = reorderSteps(DEFAULT_CONSTRUCTION_STEPS, reversed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((s) => s.id)).toEqual(reversed)
    expect(result.value.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5])
    // completed が先頭（order=0）へ来ても id は completed のまま。
    expect(result.value[0]!.code).toBe('completed')
    expect(result.value[0]!.order).toBe(0)
  })

  it('数不一致は CONSTRUCTION_STEP_REORDER_COUNT_MISMATCH', () => {
    const result = reorderSteps(DEFAULT_CONSTRUCTION_STEPS, [BEFORE])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONSTRUCTION_STEP_REORDER_COUNT_MISMATCH')
  })

  it('未知 ID を含む順序は CONSTRUCTION_STEP_REORDER_UNKNOWN_ID', () => {
    const ids = DEFAULT_CONSTRUCTION_STEPS.map((s) => s.id)
    const swapped = [...ids.slice(1), 'ghost' as ConstructionStepId]
    const result = reorderSteps(DEFAULT_CONSTRUCTION_STEPS, swapped)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONSTRUCTION_STEP_REORDER_UNKNOWN_ID')
  })
})

describe('planStepDeletion / 削除計画（関連図形数・移行先必須, §18）', () => {
  const geometries: StepGeom[] = [
    { name: 'g-excavation', constructionStepIds: [EXCAVATION] },
    { name: 'g-multi', constructionStepIds: [EXCAVATION, STRUCTURE] },
    { name: 'g-common', constructionStepIds: [] },
    { name: 'g-structure', constructionStepIds: [STRUCTURE] },
  ]

  it('関連図形数を数え、削除対象を移行先へ張り替える', () => {
    const result = planStepDeletion(
      DEFAULT_CONSTRUCTION_STEPS,
      EXCAVATION,
      STRUCTURE,
      geometries,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // excavation を参照するのは g-excavation, g-multi の 2 図形。
    expect(result.value.affectedGeometryCount).toBe(2)
    // 削除後は 5 ステップ、excavation は含まれない。
    expect(result.value.nextSteps).toHaveLength(5)
    expect(result.value.nextSteps.some((s) => s.id === EXCAVATION)).toBe(false)
    expect(result.value.nextSteps.map((s) => s.order)).toEqual([0, 1, 2, 3, 4])

    const byName = new Map(result.value.remappedGeometries.map((g) => [g.name, g]))
    // 単独参照 → 移行先 structure に置換。
    expect(byName.get('g-excavation')!.constructionStepIds).toEqual([STRUCTURE])
    // 複数参照 → excavation を structure へ置換し重複を除去（structure 単一に）。
    expect(byName.get('g-multi')!.constructionStepIds).toEqual([STRUCTURE])
    // 全共通（空配列）は影響を受けない。
    expect(byName.get('g-common')!.constructionStepIds).toEqual([])
  })

  it('移行先未指定に相当する自己指定は SELF_MIGRATION で拒否', () => {
    const result = planStepDeletion(DEFAULT_CONSTRUCTION_STEPS, EXCAVATION, EXCAVATION, geometries)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONSTRUCTION_STEP_DELETE_SELF_MIGRATION')
  })

  it('存在しない移行先は UNKNOWN_TARGET で拒否', () => {
    const result = planStepDeletion(
      DEFAULT_CONSTRUCTION_STEPS,
      EXCAVATION,
      'ghost' as ConstructionStepId,
      geometries,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONSTRUCTION_STEP_DELETE_UNKNOWN_TARGET')
  })

  it('存在しない削除対象は DELETE_UNKNOWN で拒否', () => {
    const result = planStepDeletion(
      DEFAULT_CONSTRUCTION_STEPS,
      'ghost' as ConstructionStepId,
      STRUCTURE,
      geometries,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONSTRUCTION_STEP_DELETE_UNKNOWN')
  })
})
