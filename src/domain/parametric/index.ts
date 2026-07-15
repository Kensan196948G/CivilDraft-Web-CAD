/**
 * パラメトリック図形ドメインの公開 API（詳細設計仕様書 §15・§16.1）。
 * 定義カタログ・生成/再生成・法勾配・生成コンテキスト・型を集約して再エクスポートする。
 */
export type { GenerationContext, GeneratedIdentity } from './generationContext'
export { newIdentity } from './generationContext'

export type {
  ParametricCategory,
  ParameterType,
  ParameterSpec,
  ParametricParams,
  ParametricObjectDefinition,
} from './parametricTypes'

export {
  asNumber,
  asInteger,
  asString,
  asPoint,
  asPointList,
  validateAgainstSchema,
} from './parameterValidation'

export type { SlopeRatio } from './slopeRatio'
export {
  parseSlopeRatio,
  formatSlopeRatio,
  slopeHorizontalRun,
  slopeHatchBoundary,
} from './slopeRatio'

export type { PathSample, TextOptions } from './geometryHelpers'
export {
  ANNOTATION_TEXT_HEIGHT,
  makeLine,
  makePolyline,
  makeCircle,
  makeArc,
  makeRectangle,
  makeHatch,
  makeSymbol,
  makeText,
  pointOnCircle,
  circlePolygon,
  pathLength,
  sampleAlongPath,
  offsetPath,
} from './geometryHelpers'

export type { RegenerateResult } from './parametricCatalog'
export {
  PARAMETRIC_CATALOG,
  getDefinitionById,
  generateParametric,
  regenerate,
} from './parametricCatalog'

export { heavyMachineRadiusDefinition, CAPABILITY_DISCLAIMER } from './definitions/heavyMachineRadius'
export { craneWorkingSectorDefinition } from './definitions/craneWorkingSector'
export { steelPlateArrayDefinition } from './definitions/steelPlateArray'
export { temporaryFenceDefinition, FENCE_POST_SYMBOL_ID } from './definitions/temporaryFence'
export { barricadeLineDefinition, BARRICADE_SYMBOL_ID } from './definitions/barricadeLine'
export { slopePatternDefinition } from './definitions/slopePattern'
export { trafficRouteDefinition, ARROW_SYMBOL_ID } from './definitions/trafficRoute'
