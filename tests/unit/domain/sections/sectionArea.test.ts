import { describe, expect, it } from 'vitest'
import type { SurveyPointId } from '@/shared/types'
import {
  applyComputedAreas,
  computeSectionAreas,
  type Section,
  type SectionPoint,
} from '@/domain/sections'

const SP = 'sp-1' as SurveyPointId

function section(
  existingGround: readonly SectionPoint[],
  plannedGround: readonly SectionPoint[],
  overrides: Partial<Section> = {},
): Section {
  return {
    id: 'sec-1',
    surveyPointId: SP,
    station: 0,
    existingGround,
    plannedGround,
    ...overrides,
  }
}

describe('computeSectionAreas / 切盛判定・面積', () => {
  it('現況が計画より一様に高い断面は全切土（cutArea=100・fillArea=0）', () => {
    // 現況 y=5 / 計画 y=0、offset 幅 20 → 差 5 × 20 = 100
    const result = computeSectionAreas(
      section(
        [
          { offset: -10, elevation: 5 },
          { offset: 10, elevation: 5 },
        ],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cutArea).toBeCloseTo(100, 9)
    expect(result.value.fillArea).toBeCloseTo(0, 9)
  })

  it('計画が現況より一様に高い断面は全盛土（fillArea=60・cutArea=0）', () => {
    // 現況 y=0 / 計画 y=3、offset 幅 20 → 3 × 20 = 60
    const result = computeSectionAreas(
      section(
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
        [
          { offset: -10, elevation: 3 },
          { offset: 10, elevation: 3 },
        ],
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.fillArea).toBeCloseTo(60, 9)
    expect(result.value.cutArea).toBeCloseTo(0, 9)
  })

  it('交点を挿入し切土・盛土を分類する（V字計画線: cut=10・fill=10）', () => {
    // 現況 y=0 平坦 / 計画 V字 (-10,2)-(0,-2)-(10,2)。交点 -5, 5 を挿入し左右対称に分割。
    const result = computeSectionAreas(
      section(
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
        [
          { offset: -10, elevation: 2 },
          { offset: 0, elevation: -2 },
          { offset: 10, elevation: 2 },
        ],
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cutArea).toBeCloseTo(10, 9)
    expect(result.value.fillArea).toBeCloseTo(10, 9)
    // cut / fill 各 2 区間（交点で分割）→ 計 4 領域。
    expect(result.value.regions).toHaveLength(4)
    expect(result.value.regions.filter((r) => r.kind === 'cut')).toHaveLength(2)
    expect(result.value.regions.filter((r) => r.kind === 'fill')).toHaveLength(2)
  })

  it('共通定義域のみで面積を算出し、非共通部分には info 警告を出す', () => {
    // 現況 offset[-20,20] / 計画 offset[-10,10] → 共通域[-10,10]、差 4 × 20 = 80 切土
    const result = computeSectionAreas(
      section(
        [
          { offset: -20, elevation: 4 },
          { offset: 20, elevation: 4 },
        ],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.domain).toEqual({ from: -10, to: 10 })
    expect(result.value.cutArea).toBeCloseTo(80, 9)
    expect(result.value.warnings.some((w) => w.code === 'SECTION_DOMAIN_TRIMMED')).toBe(true)
  })
})

describe('computeSectionAreas / 面積未確定（§16.2）', () => {
  it('線分不足（点1つ）は SECTION_PROFILE_TOO_FEW_POINTS で未確定', () => {
    const result = computeSectionAreas(
      section(
        [{ offset: 0, elevation: 0 }],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((e) => e.code === 'SECTION_PROFILE_TOO_FEW_POINTS')).toBe(true)
  })

  it('同一 offset 重複は SECTION_PROFILE_DUPLICATE_OFFSET で未確定', () => {
    const result = computeSectionAreas(
      section(
        [
          { offset: 0, elevation: 0 },
          { offset: 0, elevation: 5 },
        ],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((e) => e.code === 'SECTION_PROFILE_DUPLICATE_OFFSET')).toBe(true)
  })

  it('offset 逆行（自己交差）は SECTION_PROFILE_SELF_INTERSECTION で未確定', () => {
    const result = computeSectionAreas(
      section(
        [
          { offset: 10, elevation: 0 },
          { offset: -10, elevation: 0 },
        ],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((e) => e.code === 'SECTION_PROFILE_SELF_INTERSECTION')).toBe(true)
  })

  it('定義域が重複しない断面は SECTION_NO_OVERLAP で未確定', () => {
    const result = computeSectionAreas(
      section(
        [
          { offset: -20, elevation: 0 },
          { offset: -11, elevation: 0 },
        ],
        [
          { offset: 10, elevation: 0 },
          { offset: 20, elevation: 0 },
        ],
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((e) => e.code === 'SECTION_NO_OVERLAP')).toBe(true)
  })
})

describe('applyComputedAreas', () => {
  it('算出成功時は cutArea/fillArea を反映する', () => {
    const s = applyComputedAreas(
      section(
        [
          { offset: -10, elevation: 5 },
          { offset: 10, elevation: 5 },
        ],
        [
          { offset: -10, elevation: 0 },
          { offset: 10, elevation: 0 },
        ],
      ),
    )
    expect(s.cutArea).toBeCloseTo(100, 9)
    expect(s.fillArea).toBeCloseTo(0, 9)
  })

  it('未確定時は cutArea/fillArea を undefined にする', () => {
    const s = applyComputedAreas(
      section([{ offset: 0, elevation: 0 }], [{ offset: 0, elevation: 0 }], {
        cutArea: 999,
        fillArea: 999,
      }),
    )
    expect(s.cutArea).toBeUndefined()
    expect(s.fillArea).toBeUndefined()
  })
})
