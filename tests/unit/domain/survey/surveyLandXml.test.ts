import { describe, expect, it } from 'vitest'
import { exportSurveyLandXml } from '@/domain/survey/surveyLandXml'
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

describe('exportSurveyLandXml（Issue #44・第二弾）', () => {
  it('LandXML 1.2 のヘッダーと Units を含む', () => {
    const xml = exportSurveyLandXml([point('T-1')], { date: '2026-08-06' })
    expect(xml).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2"')
    expect(xml).toContain('version="1.2"')
    expect(xml).toContain('linearUnit="meter"')
    expect(xml).toContain('date="2026-08-06"')
  })

  it('測点は northing,easting[,elevation] の順で出力される（x=東→easting、y=北→northing）', () => {
    const xml = exportSurveyLandXml(
      [point('T-1', { elevation: 12.5, code: 'BM' })],
      { date: '2026-08-06' },
    )
    expect(xml).toContain('<Point name="T-1" code="BM" pntRef="1">')
    expect(xml).toContain('<P>200,100,12.5</P>')
  })

  it('標高なしの測点は2次元座標で出力される', () => {
    const xml = exportSurveyLandXml([point('T-2')], { date: '2026-08-06' })
    expect(xml).toContain('<P>200,100</P>')
  })

  it('XML特殊文字はエスケープされる', () => {
    const xml = exportSurveyLandXml([point('A&B<"x"')], { date: '2026-08-06' })
    expect(xml).toContain('name="A&amp;B&lt;&quot;x&quot;"')
  })
})
