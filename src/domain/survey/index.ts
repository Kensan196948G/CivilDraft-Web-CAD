/**
 * 土木座標・測量ドメイン（詳細設計仕様書 §12）の公開API。
 * 座標設定の検証、距離・方位角からの点算出と座標変換、測点CSV入出力、
 * 中心線・測点・左右オフセット生成をまとめて再輸出する。
 */
export {
  defaultCoordinateSystemSettings,
  validateCoordinateSystemSettings,
} from './coordinateSystem'

export {
  pointFromBearingDistance,
  bearingDistanceBetween,
  createCoordinateTransformer,
  type CoordinateTransformer,
} from './bearingDistance'

export {
  DEFAULT_SURVEY_CSV_MAPPING,
  defaultSurveyPointIdContext,
  parseSurveyCsv,
  exportSurveyCsv,
  type SurveyCsvParseResult,
  type SurveyPointIdContext,
  type ParseSurveyCsvOptions,
} from './surveyCsv'

export {
  centerlineLength,
  generateStations,
  offsetStation,
  generateOffsetStations,
  type StationKind,
  type CenterlineStation,
  type OffsetStation,
  type GenerateStationsOptions,
} from './centerline'
