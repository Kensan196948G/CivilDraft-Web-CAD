import { describe, expect, it } from 'vitest'
import type { ConstructionStepId } from '@/shared/types'
import {
  filterGeometriesByStep,
  isGeometryInStep,
  selectGeometriesForQuantity,
  stepIdOf,
} from '@/domain/construction-steps'

/** 判定に必要な最小構造（constructionStepIds のみ）+ 識別用 name。 */
interface StepGeom {
  readonly name: string
  readonly constructionStepIds: readonly ConstructionStepId[]
}

const EXCAVATION = stepIdOf('excavation')
const STRUCTURE = stepIdOf('structure')
const COMPLETED = stepIdOf('completed')

const common: StepGeom = { name: 'common', constructionStepIds: [] } // 全ステップ共通
const onlyExcavation: StepGeom = { name: 'onlyExcavation', constructionStepIds: [EXCAVATION] }
const multi: StepGeom = { name: 'multi', constructionStepIds: [EXCAVATION, STRUCTURE] }
const onlyCompleted: StepGeom = { name: 'onlyCompleted', constructionStepIds: [COMPLETED] }
const all: readonly StepGeom[] = [common, onlyExcavation, multi, onlyCompleted]

describe('isGeometryInStep / 共通判定サービス', () => {
  it('空配列（全共通）はどのステップでも true', () => {
    expect(isGeometryInStep(common, EXCAVATION)).toBe(true)
    expect(isGeometryInStep(common, COMPLETED)).toBe(true)
  })

  it('割当ありは当該ステップを含むときのみ true', () => {
    expect(isGeometryInStep(onlyExcavation, EXCAVATION)).toBe(true)
    expect(isGeometryInStep(onlyExcavation, STRUCTURE)).toBe(false)
  })
})

describe('filterGeometriesByStep / 表示フィルター', () => {
  it('掘削時: 全共通 + 掘削割当 + 複数跨ぎ（掘削含む）が残る', () => {
    const result = filterGeometriesByStep(all, EXCAVATION).map((g) => g.name)
    expect(result).toEqual(['common', 'onlyExcavation', 'multi'])
  })

  it('構造物施工時: 全共通 + 複数跨ぎ（構造物含む）が残る', () => {
    const result = filterGeometriesByStep(all, STRUCTURE).map((g) => g.name)
    expect(result).toEqual(['common', 'multi'])
  })

  it('完成時: 全共通 + 完成割当が残る', () => {
    const result = filterGeometriesByStep(all, COMPLETED).map((g) => g.name)
    expect(result).toEqual(['common', 'onlyCompleted'])
  })

  it('全表示（null）は全図形をそのまま返す', () => {
    const result = filterGeometriesByStep(all, null)
    expect(result.map((g) => g.name)).toEqual(['common', 'onlyExcavation', 'multi', 'onlyCompleted'])
  })

  it('入力配列は破壊しない（新しい配列を返す）', () => {
    const input = [...all]
    filterGeometriesByStep(input, EXCAVATION)
    expect(input).toHaveLength(4)
  })
})

describe('selectGeometriesForQuantity / 数量選別（§18 判定共用 + §6.3 レイヤー別設定）', () => {
  it('ステップ判定は表示フィルターと同一サービスを用いる（既定は全レイヤー集計）', () => {
    const display = filterGeometriesByStep(all, EXCAVATION).map((g) => g.name)
    const quantity = selectGeometriesForQuantity(all, EXCAVATION).map((g) => g.name)
    expect(quantity).toEqual(display)
  })

  it('§6.3: 非集計レイヤー述語で除外できる（common を集計対象外にする）', () => {
    const isLayerCounted = (g: StepGeom): boolean => g.name !== 'common'
    const result = selectGeometriesForQuantity(all, EXCAVATION, isLayerCounted).map((g) => g.name)
    // 掘削時の表示対象 [common, onlyExcavation, multi] から common を除外。
    expect(result).toEqual(['onlyExcavation', 'multi'])
  })
})
