/**
 * 詳細設計仕様書 §4.1 座標点
 * ADR-0012: 内部座標基準はmm単位の素number・X軸右方向・Y軸下方向。
 * Pointは内部演算専用の値型であり、domain/unitsの単位変換を経由しない
 * （変換が必要になるのはUI表示・DXF入出力などAPI境界のみ）。
 */
export interface Point {
  readonly x: number
  readonly y: number
}
