import { describe, expect, it } from 'vitest'
import type { ConstructionStepId } from '@/shared/types'
import {
  DEFAULT_CONSTRUCTION_STEPS,
  STANDARD_STEP_CODES,
  getStandardSteps,
  getStepById,
  stepIdOf,
} from '@/domain/construction-steps'

describe('DEFAULT_CONSTRUCTION_STEPS / 既定6ステップカタログ', () => {
  it('6 ステップを標準値の順序で持つ（施工前→完成時）', () => {
    expect(DEFAULT_CONSTRUCTION_STEPS).toHaveLength(6)
    expect(DEFAULT_CONSTRUCTION_STEPS.map((s) => s.code)).toEqual([
      'before',
      'excavation',
      'temporaryWorks',
      'structure',
      'backfill',
      'completed',
    ])
  })

  it('各ステップは code=id、order=0..5、standard=true、日本語名を持つ', () => {
    expect(DEFAULT_CONSTRUCTION_STEPS.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5])
    expect(DEFAULT_CONSTRUCTION_STEPS.every((s) => s.standard)).toBe(true)
    expect(DEFAULT_CONSTRUCTION_STEPS.every((s) => (s.id as string) === s.code)).toBe(true)
    expect(DEFAULT_CONSTRUCTION_STEPS.map((s) => s.name)).toEqual([
      '施工前',
      '掘削時',
      '仮設設置時',
      '構造物施工時',
      '埋戻し時',
      '完成時',
    ])
  })

  it('STANDARD_STEP_CODES と一致する', () => {
    expect(DEFAULT_CONSTRUCTION_STEPS.map((s) => s.code)).toEqual([...STANDARD_STEP_CODES])
  })
})

describe('getStepById / getStandardSteps', () => {
  it('ID で既定ステップを検索できる', () => {
    const step = getStepById(DEFAULT_CONSTRUCTION_STEPS, stepIdOf('structure'))
    expect(step?.name).toBe('構造物施工時')
  })

  it('未知 ID は undefined を返す', () => {
    expect(getStepById(DEFAULT_CONSTRUCTION_STEPS, 'unknown' as ConstructionStepId)).toBeUndefined()
  })

  it('標準ステップのみを order 昇順で返す（カスタム混在時に標準だけ抽出）', () => {
    const withCustom = [
      ...DEFAULT_CONSTRUCTION_STEPS,
      { id: stepIdOf('custom'), code: 'custom', name: 'カスタム', order: 6, standard: false },
    ]
    const standards = getStandardSteps(withCustom)
    expect(standards).toHaveLength(6)
    expect(standards.every((s) => s.standard)).toBe(true)
  })
})
