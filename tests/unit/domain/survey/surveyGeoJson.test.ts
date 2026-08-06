import { describe, expect, it } from 'vitest'
import { exportSurveyGeoJson } from '@/domain/survey/surveyGeoJson'
import type { SurveyPoint, SurveyPointId } from '@/shared/types'

function point(id: string, overrides: Partial<SurveyPoint> = {}): SurveyPoint {
  return {
    id: id as SurveyPointId,
    pointNumber: id,
    x: 100,
    y: 200,
    ...overrides,
  }
}

describe('exportSurveyGeoJson（Issue #44）', () => {
  it('FeatureCollection を出力し、座標は [x, y] の平面座標', () => {
    const text = exportSurveyGeoJson([point('T-1')], { indent: 0 })
    const parsed = JSON.parse(text) as {
      type: string
      features: { type: string; geometry: { type: string; coordinates: number[] }; properties: { pointNumber: string } }[]
    }
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(1)
    expect(parsed.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [100, 200] })
    expect(parsed.features[0]?.properties.pointNumber).toBe('T-1')
  })

  it('標高がある場合は3次元座標になり、code/note は properties に含まれる', () => {
    const text = exportSurveyGeoJson(
      [point('T-2', { elevation: 12.5, code: 'BM', note: '基準点' })],
      { indent: 0 },
    )
    const parsed = JSON.parse(text) as {
      features: { geometry: { coordinates: number[] }; properties: Record<string, string | number> }[]
    }
    expect(parsed.features[0]?.geometry.coordinates).toEqual([100, 200, 12.5])
    expect(parsed.features[0]?.properties.code).toBe('BM')
    expect(parsed.features[0]?.properties.note).toBe('基準点')
  })

  it('空配列でも有効な FeatureCollection を返す', () => {
    const parsed = JSON.parse(exportSurveyGeoJson([], { indent: 0 })) as { features: unknown[] }
    expect(parsed.features).toEqual([])
  })
})
