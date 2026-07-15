import type { LayerId } from './brand'
import type { GeometryStyle } from './geometry'

/**
 * 詳細設計仕様書 §6.3 レイヤー
 * 図形のグルーピング・表示制御・印刷制御を担う。
 * 運用規則（実装先はstore層・UI層）:
 * - 削除対象レイヤーに図形がある場合は移動先指定または図形同時削除の確認を必須とする
 * - ロック済みレイヤーの図形は選択表示できるが変更できない
 * - 非表示レイヤーの図形が数量集計対象か否かは別設定で判定し、画面表示へ単純連動させない
 */
export interface DrawingLayer {
  readonly id: LayerId
  readonly name: string
  readonly order: number
  readonly visible: boolean
  readonly locked: boolean
  readonly printable: boolean
  readonly defaultStyle: GeometryStyle
}
