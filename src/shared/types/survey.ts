/**
 * 詳細設計仕様書 §12 土木座標・測量処理のデータモデル。
 * ADR-0012 の帰結（内部座標系＝X右・Y下・反時計回り正・mm と、測量座標系＝
 * 北基準・時計回り方位角・実寸は異なる）を受け、測量座標はここで内部座標と
 * 分離した「測量固有の値」として保持する。内部座標への写像は
 * domain/survey/bearingDistance.ts の CoordinateTransformer に集約する。
 */
import type { Point } from './geometry'
import type { SurveyPointId } from './brand'
import type { ValidationIssue } from './result'

/**
 * 詳細設計仕様書 §12.1 座標設定。
 * origin は測量原点(0,0)が内部座標（ADR-0012: mm・X右・Y下）上のどこに載るかを表す
 * 基準点。rotationDeg は測量軸から図面（内部）軸への回転量。
 * 初期版の jgd-attribute は planeRectangularZone / verticalDatum を属性として
 * 保持するだけとし、複雑な測地変換は行わない（§12.1 本文）。
 */
export interface CoordinateSystemSettings {
  readonly mode: 'local' | 'jgd-attribute'
  readonly origin: Point
  readonly rotationDeg: number
  readonly axisConvention: 'east-north' | 'custom'
  readonly planeRectangularZone?: number
  readonly verticalDatum?: string
}

/**
 * 詳細設計仕様書 §12.1 測点。
 * x/y は測量座標系の平面座標（x=東、y=北。§12.2 の式の前提）であり、
 * 内部座標（mm）とは単位も軸向きも異なる素の測量値として保持する。
 * elevation は標高、code は測点コード、note は備考。
 */
export interface SurveyPoint {
  readonly id: SurveyPointId
  readonly pointNumber: string
  readonly x: number
  readonly y: number
  readonly elevation?: number
  readonly code?: string
  readonly note?: string
}

/**
 * 測量座標系の平面座標（x=東・y=北）。
 * SurveyPoint から id/測点番号等の属性を除いた純粋な幾何値で、距離・方位角計算
 * （§12.2）や座標変換の入出力に用いる。
 */
export interface SurveyCoordinate {
  readonly x: number
  readonly y: number
}

/**
 * 詳細設計仕様書 §12.3 測点CSVの列割当。
 * CSVヘッダー名（正規化後）と SurveyPoint フィールドの対応を表す。
 */
export interface SurveyCsvMapping {
  readonly pointNumberColumn: string
  readonly xColumn: string
  readonly yColumn: string
  readonly elevationColumn?: string
  readonly codeColumn?: string
  readonly noteColumn?: string
}

/**
 * 詳細設計仕様書 §12.3 取込1行分の結果。
 * source は正規化前の生セル（列名→値）、normalized は取り込めた場合の変換結果、
 * issues はその行で検出した検証事項（行番号付き）。読める行は normalized を持ち、
 * 読めない行は normalized を持たず issues で理由を示す（graceful 取込）。
 */
export interface ImportRowResult<T> {
  readonly rowNumber: number
  readonly source: Readonly<Record<string, string>>
  readonly normalized?: T
  readonly issues: readonly ValidationIssue[]
}
