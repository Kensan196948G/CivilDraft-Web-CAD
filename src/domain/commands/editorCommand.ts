/**
 * Undo/Redo の Command パターン基盤（詳細設計仕様書 §7）。
 *
 * 背景（リスク台帳 R-001）: 継承元 Civil-Draw は Shape[][]（全図形スナップショット）を
 * 履歴として積む方式で、10,000 図形規模ではメモリが破綻する。本実装は 1 操作 = 1 コマンドの
 * 差分ベース（各コマンドは影響した図形/レイヤーのみ保持）へ再設計する。
 *
 * Phase 1 スコープ:
 * - execute/undo の対象は DrawingDocument（仕様書 §5）が未実装のため、暫定の DocumentState
 *   （geometries + layers）とする。§5 の DrawingDocument 実装後に本型を置き換え/拡張する。
 * - execute/undo は純粋関数（state in → state out、破壊的変更禁止）。同一 document を渡した
 *   往復（execute → undo）で元状態へ完全復元されることを不変条件とする。
 * - コマンドの id/occurredAt は ADR-0013 の GeometryCreationContext を注入して発番する
 *   （副作用分離・決定的テストのため）。
 * - 監査ログ再利用（ADR-0009）に備え、id/type/occurredAt/payload は JSON シリアライズ可能な
 *   データのみとする（関数は execute/undo のみ。payload に関数を持たせない）。
 */
import type { DrawingLayer, Geometry } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'

/**
 * Phase 1 の編集対象状態。将来的に詳細設計仕様書 §5 の DrawingDocument
 * （メタデータ・改訂・レイヤーツリー等を含む）へ拡張する。
 */
export interface DocumentState {
  readonly geometries: readonly Geometry[]
  readonly layers: readonly DrawingLayer[]
}

/**
 * 1 操作を表す編集コマンド（詳細設計仕様書 §7）。
 * id/type/occurredAt/payload は監査ログへシリアライズ可能なデータ、
 * execute/undo は DocumentState を変換する純粋関数。
 */
export interface EditorCommand<TPayload = unknown> {
  readonly id: string
  readonly type: string
  readonly occurredAt: string
  readonly payload: TPayload
  execute(document: DocumentState): DocumentState
  undo(document: DocumentState): DocumentState
}

/**
 * コマンド生成の基盤ヘルパー。id/occurredAt を GeometryCreationContext から発番する。
 * 具体コマンドのファクトリ（geometryCommands.ts）はこれを用いて payload と execute/undo を束ねる。
 */
export function createCommand<TPayload>(
  type: string,
  payload: TPayload,
  execute: (document: DocumentState) => DocumentState,
  undo: (document: DocumentState) => DocumentState,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<TPayload> {
  return {
    // GeometryId（Brand<string>）は string として代入可能。コマンド id は汎用文字列で扱う。
    id: ctx.newId(),
    type,
    occurredAt: ctx.now(),
    payload,
    execute,
    undo,
  }
}
