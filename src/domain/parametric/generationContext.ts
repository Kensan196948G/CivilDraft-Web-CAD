/**
 * パラメトリック図形の生成コンテキスト（詳細設計仕様書 §15）。
 *
 * 仕様書 §15 の `ParametricObjectDefinition.generate(params, context: GenerationContext)`
 * が要求する `GenerationContext` の実体。仕様書本文には型定義が無いため本ファイルで定義する。
 *
 * 設計判断:
 * - 生成される Geometry は GeometryBase により layerId / style を必須とする。ID・タイムスタンプの
 *   副作用は ADR-0013 の GeometryCreationContext（既定 = crypto.randomUUID / Date.now）へ委譲済み
 *   のため、GenerationContext は GeometryCreationContext を継承し、配置先 layerId と既定 style を
 *   加えた「実体化に必要な最小コンテキスト」とする。templateCatalog.instantiateTemplate の
 *   `placement:{layerId,style}` と同じ責務分担（形状=定義側 / 帰属・監査=コンテキスト側）。
 */
import type { GeometryBase, GeometryStyle, LayerId } from '@/shared/types'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'

export interface GenerationContext extends GeometryCreationContext {
  /** 生成図形の配置先レイヤ。 */
  readonly layerId: LayerId
  /** 生成図形へ一律に付与する表示スタイル。 */
  readonly style: GeometryStyle
}

/** 生成図形へ合成する帰属・監査フィールド（type を除く GeometryBase）。 */
export type GeneratedIdentity = Omit<GeometryBase, 'type'>

/**
 * 1 図形分の帰属・監査フィールドを発番する。newId / now は各図形ごとに 1 回ずつ消費する
 * （instantiateTemplate と同じく id は図形単位、createdAt=updatedAt は同一タイムスタンプ）。
 */
export function newIdentity(ctx: GenerationContext): GeneratedIdentity {
  const timestamp = ctx.now()
  return {
    id: ctx.newId(),
    layerId: ctx.layerId,
    style: ctx.style,
    locked: false,
    constructionStepIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
