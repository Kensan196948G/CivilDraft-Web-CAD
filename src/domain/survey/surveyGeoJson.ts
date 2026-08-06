/**
 * 測点の GeoJSON 出力（Issue #44）。
 * RFC 7946 準拠の FeatureCollection を生成する。座標は [x(東), y(北)] の平面座標とし、
 * 標高がある場合は [x, y, elevation] の3次元座標で表現する。
 */
import type { SurveyPoint } from '@/shared/types'

export interface SurveyGeoJsonOptions {
  readonly name?: string
  readonly indent?: number
}

export function exportSurveyGeoJson(
  points: readonly SurveyPoint[],
  options: SurveyGeoJsonOptions = {},
): string {
  const features = points.map((point) => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates:
        point.elevation === undefined
          ? [point.x, point.y]
          : [point.x, point.y, point.elevation],
    },
    properties: {
      pointNumber: point.pointNumber,
      ...(point.code === undefined ? {} : { code: point.code }),
      ...(point.note === undefined ? {} : { note: point.note }),
    },
  }))
  const collection = {
    type: 'FeatureCollection' as const,
    name: options.name ?? 'CivilDraft Survey Points',
    features,
  }
  return JSON.stringify(collection, null, options.indent ?? 2)
}

