import { describe, expect, it } from 'vitest'
import type { SurveyPointId } from '@/shared/types'
import {
  averageEndAreaVolume,
  computeAverageEndArea,
  computeEarthworkVolume,
  type Section,
  type SectionPoint,
} from '@/domain/sections'

const SP = 'sp-1' as SurveyPointId

function flatSection(
  id: string,
  station: number,
  existingElev: number,
  plannedElev: number,
): Section {
  const ground = (elevation: number): SectionPoint[] => [
    { offset: -10, elevation },
    { offset: 10, elevation },
  ]
  return {
    id,
    surveyPointId: SP,
    station,
    existingGround: ground(existingElev),
    plannedGround: ground(plannedElev),
  }
}

describe('averageEndAreaVolume / 平均断面法の式', () => {
  it('V=(A1+A2)/2×L の固定値（10,20,100 → 1500）', () => {
    expect(averageEndAreaVolume(10, 20, 100)).toBe(1500)
  })

  it('A1=A2 のとき V=A×L（角柱, 50,50,10 → 500）', () => {
    expect(averageEndAreaVolume(50, 50, 10)).toBe(500)
  })
})

describe('computeAverageEndArea / 検証付き算出', () => {
  it('正常系は method/area1/area2/distance/volume を根拠として保持する', () => {
    const result = computeAverageEndArea(10, 20, 100)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      method: 'averageEndArea',
      area1: 10,
      area2: 20,
      distance: 100,
      volume: 1500,
    })
  })

  it('距離 0 は EARTHWORK_INVALID_DISTANCE で拒否', () => {
    const result = computeAverageEndArea(10, 20, 0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EARTHWORK_INVALID_DISTANCE')
  })

  it('負の面積は EARTHWORK_INVALID_AREA で拒否', () => {
    const result = computeAverageEndArea(-1, 20, 100)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('EARTHWORK_INVALID_AREA')
  })
})

describe('computeEarthworkVolume / 2断面間の切盛土量', () => {
  it('切土断面2つから切土土量を平均断面法で算出し、簡易計算の警告を付す', () => {
    // A: 現況5/計画0 → cut=100, B: 現況7/計画0 → cut=140、距離=|20-0|=20
    // 切土 V=(100+140)/2×20=2400、盛土は両断面0 → V=0
    const from = flatSection('A', 0, 5, 0)
    const to = flatSection('B', 20, 7, 0)
    const result = computeEarthworkVolume(from, to)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.distance).toBe(20)
    expect(result.value.cut.volume).toBeCloseTo(2400, 6)
    expect(result.value.fill.volume).toBeCloseTo(0, 6)
    expect(result.value.fromSectionId).toBe('A')
    expect(result.value.toSectionId).toBe('B')
    expect(result.value.warnings.some((w) => w.code === 'EARTHWORK_SIMPLIFIED_METHOD')).toBe(true)
  })

  it('切土断面と盛土断面を別々に集計する', () => {
    // A: 全切土 cut=100/fill=0, B: 全盛土 cut=0/fill=60、距離=10
    // cut V=(100+0)/2×10=500、fill V=(0+60)/2×10=300
    const from = flatSection('A', 0, 5, 0)
    const to = flatSection('B', 10, 0, 3)
    const result = computeEarthworkVolume(from, to)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.cut.volume).toBeCloseTo(500, 6)
    expect(result.value.fill.volume).toBeCloseTo(300, 6)
  })

  it('同一測点（距離0）は未確定として拒否', () => {
    const from = flatSection('A', 5, 5, 0)
    const to = flatSection('B', 5, 7, 0)
    const result = computeEarthworkVolume(from, to)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.some((e) => e.code === 'EARTHWORK_INVALID_DISTANCE')).toBe(true)
  })

  it('一方の断面が面積未確定なら土量も未確定', () => {
    const from = flatSection('A', 0, 5, 0)
    const broken: Section = {
      id: 'B',
      surveyPointId: SP,
      station: 20,
      existingGround: [{ offset: 0, elevation: 0 }],
      plannedGround: [{ offset: 0, elevation: 0 }],
    }
    const result = computeEarthworkVolume(from, broken)
    expect(result.ok).toBe(false)
  })
})
