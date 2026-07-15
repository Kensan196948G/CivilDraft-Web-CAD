/**
 * 線形・単曲線ドメインの公開API。詳細設計仕様書 §12.4・§13。
 * 座標は内部mm、角度は内部rad（ADR-0012）。公開関数の角度入力は AngleValue（度数法可）。
 *
 * 簡易クロソイド（§13.2）は仕様正本により Phase 5 以降・別ADR確定事項であり、本モジュールには含めない。
 */
export type {
  CurveDirection,
  SingleCurveInput,
  SingleCurve,
  CurveExpansionOptions,
} from './singleCurve'
export {
  computeSingleCurve,
  expandCurve,
  DEFAULT_CHORD_TOLERANCE_MM,
  MAX_EXPANSION_SEGMENTS,
} from './singleCurve'

export type {
  LineAlignmentSegment,
  ArcAlignmentSegment,
  AlignmentSegment,
  Alignment,
  AlignmentElement,
  AlignmentBuildInput,
  AlignmentBuildOptions,
  AlignmentPoint,
} from './alignment'
export { buildAlignment, stationToPoint, generateStations } from './alignment'
