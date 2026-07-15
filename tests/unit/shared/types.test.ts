import { describe, expect, it } from 'vitest'
import type { Brand, LengthValue, ProjectId, Result, ValidationIssue } from '@/shared/types'

describe('詳細設計仕様書 §4 共通型 / Brand', () => {
  it('ブランド型は実行時には素のプリミティブと同一である（コンパイル時のみの区別）', () => {
    const raw = 'project-001'
    const id = raw as ProjectId
    expect(id).toBe(raw)
    expect(typeof id).toBe('string')
  })
})

describe('詳細設計仕様書 §4.1 単位付き数値', () => {
  it('LengthValueは値と単位を組で保持し、単位を伴わない生numberを介さない', () => {
    const length: LengthValue = { value: 1500, unit: 'mm' }
    expect(length.value).toBe(1500)
    expect(length.unit).toBe('mm')
  })
})

describe('詳細設計仕様書 §4.2 結果型 / Result', () => {
  function parsePositive(input: number): Result<number, ValidationIssue> {
    if (input > 0) {
      return { ok: true, value: input }
    }
    return {
      ok: false,
      error: { code: 'NOT_POSITIVE', severity: 'error', message: '正の数である必要があります' },
    }
  }

  it('ok:trueの場合はvalueへ、ok:falseの場合はerrorへ判別共用体として絞り込める', () => {
    const success = parsePositive(10)
    expect(success.ok).toBe(true)
    if (success.ok) {
      expect(success.value).toBe(10)
    }

    const failure = parsePositive(-1)
    expect(failure.ok).toBe(false)
    if (!failure.ok) {
      expect(failure.error.code).toBe('NOT_POSITIVE')
      expect(failure.error.severity).toBe('error')
    }
  })

  it('typeパラメータBrand<T,B>は独立したnominal型を生成する', () => {
    type WidgetId = Brand<string, 'WidgetId'>
    type GadgetId = Brand<string, 'GadgetId'>
    const widgetId = 'w-1' as WidgetId
    const gadgetId: GadgetId = 'g-1' as GadgetId
    // 実行時はどちらも文字列。区別はコンパイル時の型システムのみが担う。
    expect(widgetId).not.toBe(gadgetId)
  })
})
