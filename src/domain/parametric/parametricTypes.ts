/**
 * パラメトリック図形の定義型（詳細設計仕様書 §15）。
 *
 * 仕様書 §15 の ParametricObjectDefinition<TParams> を正本とし、テンプレートカタログ運用に
 * 必要なメタ情報（name / category / description / parameterSchema）を追加する。
 * generate は仕様どおり readonly Geometry[] を返し、検証は validate に分離する
 * （Result で束ねるのはオーケストレーション層 generateParametric の責務。parametricCatalog.ts 参照）。
 */
import type { Geometry, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from './generationContext'

/** テンプレートの分類。templateCatalog.TemplateDef.category と同じ 4 分類。 */
export type ParametricCategory = '仮設' | '土工' | '舗装' | '測量'

/**
 * パラメータの型種別。number/integer/angle はスカラ数値、point は 2 次元座標、
 * pointList は経路（頂点列）、slopeRatio は法勾配文字列（§16.1）を表す。
 */
export type ParameterType =
  | 'number'
  | 'integer'
  | 'angle'
  | 'string'
  | 'point'
  | 'pointList'
  | 'slopeRatio'

/**
 * パラメータスキーマ 1 項目。名称・型・範囲・既定値を宣言的に保持し、
 * validateAgainstSchema がこれを解釈して ValidationIssue を生成する。
 */
export interface ParameterSpec {
  /** パラメータキー（params レコードのキー）。 */
  readonly name: string
  /** 利用者向け日本語ラベル。 */
  readonly label: string
  readonly type: ParameterType
  readonly required: boolean
  /** 既定値。generate 時に未指定パラメータへ適用する。 */
  readonly defaultValue: unknown
  /** 数値の下限（含む）。pointList では最小頂点数として解釈する。 */
  readonly min?: number
  /** 数値の上限（含む）。 */
  readonly max?: number
  /** 数値の下限（含まない）。正数制約（v>0）には exclusiveMin:0 を用いる。 */
  readonly exclusiveMin?: number
  /** 単位表記（mm / 度 など）。表示・注記用。 */
  readonly unit?: string
}

/** パラメータの実行時表現。ParametricGeometry.parameters と同じ形（§15）。 */
export type ParametricParams = Readonly<Record<string, unknown>>

/**
 * 仕様書 §15 の ParametricObjectDefinition。definitionId + version で定義版を保持し
 * （§15.2「定義版を保持し、定義更新で既存図形が無断変更されないようにする」）、
 * validate（パラメータ検証）と generate（図形生成）を分離する。
 */
export interface ParametricObjectDefinition<TParams extends ParametricParams = ParametricParams> {
  readonly definitionId: string
  readonly version: number
  readonly name: string
  readonly category: ParametricCategory
  readonly description: string
  readonly parameterSchema: readonly ParameterSpec[]
  /** パラメータを検証する。問題が無ければ空配列。severity:'error' が 1 件でもあれば生成不可。 */
  validate(params: TParams): readonly ValidationIssue[]
  /** 検証済みパラメータから派生図形を生成する。未指定パラメータには既定値を適用する。 */
  generate(params: TParams, context: GenerationContext): readonly Geometry[]
}
