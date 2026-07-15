/** 詳細設計仕様書 §4 共通型 */
export type Brand<T, B extends string> = T & { readonly __brand: B }

export type ProjectId = Brand<string, 'ProjectId'>
export type DrawingId = Brand<string, 'DrawingId'>
export type RevisionId = Brand<string, 'RevisionId'>
export type GeometryId = Brand<string, 'GeometryId'>
export type LayerId = Brand<string, 'LayerId'>
export type SurveyPointId = Brand<string, 'SurveyPointId'>
export type QuantityItemId = Brand<string, 'QuantityItemId'>
export type ConstructionStepId = Brand<string, 'ConstructionStepId'>

export interface AuditFields {
  readonly createdAt: string
  readonly createdBy?: string
  readonly updatedAt: string
  readonly updatedBy?: string
}
