/**
 * 図形の派生生成（トリム・フィレット・オフセット・配列複写等）で必要になる
 * ID発番・タイムスタンプ取得のコンテキスト。
 * ADR-0013: 継承元Civil-Drawはエンジン関数内部でnanoid()を直接呼んでいたが、
 * ドメイン関数から副作用を分離するためコンテキスト注入方式へ変更した。
 * 既定実装はWeb標準crypto.randomUUID（Node 24+/全モダンブラウザ内蔵、依存追加なし）。
 */
import type { GeometryId } from '@/shared/types'

export interface GeometryCreationContext {
  /** 新規図形のGeometryIdを発番する。 */
  readonly newId: () => GeometryId
  /** createdAt/updatedAtに設定するISO 8601タイムスタンプを返す。 */
  readonly now: () => string
}

export const defaultCreationContext: GeometryCreationContext = {
  newId: () => crypto.randomUUID() as GeometryId,
  now: () => new Date().toISOString(),
}
