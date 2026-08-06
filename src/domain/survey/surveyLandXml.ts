/**
 * 測点の LandXML 1.2 出力（Issue #44・第二弾）。
 * 土木分野の標準交換形式（LandXML.org Schema 1.2）で測点を Points として出力する。
 * 座標順は LandXML 規約の「northing,easting,elevation」（x=東・y=北を入れ替え）。
 */
import type { SurveyPoint } from '@/shared/types'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function exportSurveyLandXml(
  points: readonly SurveyPoint[],
  options: { readonly name?: string; readonly date?: string } = {},
): string {
  const name = options.name ?? 'CivilDraft Survey Points'
  const date = options.date ?? new Date().toISOString().slice(0, 10)
  const pointElements = points
    .map((point, index) => {
      const elevation = point.elevation === undefined ? '' : `,${point.elevation}`
      const codeAttr = point.code === undefined ? '' : ` code="${escapeXml(point.code)}"`
      return `      <Point name="${escapeXml(point.pointNumber)}"${codeAttr} pntRef="${index + 1}">\n        <P>${point.y},${point.x}${elevation}</P>\n      </Point>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.2" date="${date}">
  <Units>
    <Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/>
  </Units>
  <Survey>
    <SurveyHeader name="${escapeXml(name)}" purpose="as-built"/>
    <Points>
${pointElements}
    </Points>
  </Survey>
</LandXML>
`
}

