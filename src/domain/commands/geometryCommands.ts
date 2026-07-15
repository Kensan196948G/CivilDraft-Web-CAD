/**
 * Phase 1 の具体編集コマンド群（詳細設計仕様書 §7）。
 * すべて差分ベース: 各コマンドは影響した図形/レイヤーのみを payload に保持し、
 * 全図形スナップショットを持たない（R-001 のメモリ破綻回避）。
 *
 * execute/undo は純粋関数（新しい配列/オブジェクトを返し、入力を破壊しない）。
 * 履歴 LIFO の不変条件下で、あるコマンドの undo は「そのコマンドの execute 直後の状態」に
 * 対して呼ばれるため、DeleteGeometriesCommand は記録した元インデックスへ確実に復元できる。
 */
import type { DrawingLayer, Geometry, GeometryId } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import { transformShape, type TransformOp } from '@/domain/geometry/shapeTransform'
import { createCommand, type DocumentState, type EditorCommand } from './editorCommand'

/** コマンド種別（監査ログ用。SCREAMING_SNAKE で統一）。 */
export const COMMAND_TYPES = {
  ADD_GEOMETRY: 'ADD_GEOMETRY',
  UPDATE_GEOMETRY: 'UPDATE_GEOMETRY',
  DELETE_GEOMETRIES: 'DELETE_GEOMETRIES',
  TRANSFORM_GEOMETRIES: 'TRANSFORM_GEOMETRIES',
  UPDATE_LAYER: 'UPDATE_LAYER',
} as const

export interface AddGeometryPayload {
  readonly geometry: Geometry
}

export interface UpdateGeometryPayload {
  readonly before: Geometry
  readonly after: Geometry
}

export interface DeletedEntry {
  /** 削除前の geometries 配列での位置。undo 時にこの位置へ splice で戻す。 */
  readonly index: number
  readonly geometry: Geometry
}

export interface DeleteGeometriesPayload {
  readonly entries: readonly DeletedEntry[]
}

export interface TransformGeometriesPayload {
  readonly cx: number
  readonly cy: number
  readonly op: TransformOp
  readonly pairs: readonly { readonly before: Geometry; readonly after: Geometry }[]
}

export interface UpdateLayerPayload {
  readonly before: DrawingLayer
  readonly after: DrawingLayer
}

// --- 純粋なドキュメント操作ヘルパー（破壊的変更なし） ---

function withGeometries(document: DocumentState, geometries: readonly Geometry[]): DocumentState {
  return { ...document, geometries }
}

/** 同一 id の図形を置換マップの内容で差し替える（存在しない id は無視）。 */
function replaceGeometries(
  document: DocumentState,
  replacements: ReadonlyMap<GeometryId, Geometry>,
): DocumentState {
  return withGeometries(
    document,
    document.geometries.map((g) => replacements.get(g.id) ?? g),
  )
}

// --- AddGeometryCommand ---

/** 1 図形を末尾へ追加する。undo は id で除去する。 */
export function createAddGeometryCommand(
  geometry: Geometry,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<AddGeometryPayload> {
  return createCommand<AddGeometryPayload>(
    COMMAND_TYPES.ADD_GEOMETRY,
    { geometry },
    (document) => withGeometries(document, [...document.geometries, geometry]),
    (document) => withGeometries(document, document.geometries.filter((g) => g.id !== geometry.id)),
    ctx,
  )
}

// --- UpdateGeometryCommand ---

/**
 * 1 図形を before → after へ差し替える（同一 id 前提）。before/after のみを保持する差分。
 * caller は before.id === after.id を保証すること。
 */
export function createUpdateGeometryCommand(
  before: Geometry,
  after: Geometry,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<UpdateGeometryPayload> {
  return createCommand<UpdateGeometryPayload>(
    COMMAND_TYPES.UPDATE_GEOMETRY,
    { before, after },
    (document) => replaceGeometries(document, new Map([[after.id, after]])),
    (document) => replaceGeometries(document, new Map([[before.id, before]])),
    ctx,
  )
}

// --- DeleteGeometriesCommand ---

/**
 * 指定 id 群を削除する。削除対象と「削除前の位置」のみを保持し、undo で元位置へ復元する。
 * 全体スナップショットは持たない。存在しない id は無視される。
 */
export function createDeleteGeometriesCommand(
  document: DocumentState,
  ids: readonly GeometryId[],
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<DeleteGeometriesPayload> {
  const idSet = new Set<GeometryId>(ids)
  // map で元の並び順を保ったまま index を採取するため、entries は index 昇順になる。
  const entries: DeletedEntry[] = document.geometries
    .map((geometry, index) => ({ index, geometry }))
    .filter((e) => idSet.has(e.geometry.id))
  const removeSet = new Set<GeometryId>(entries.map((e) => e.geometry.id))

  return createCommand<DeleteGeometriesPayload>(
    COMMAND_TYPES.DELETE_GEOMETRIES,
    { entries },
    (doc) => withGeometries(doc, doc.geometries.filter((g) => !removeSet.has(g.id))),
    (doc) => {
      // index 昇順に splice すると、先の挿入が後続の記録位置を正しく押し下げるため元配列を再現できる。
      const geometries = [...doc.geometries]
      for (const e of entries) geometries.splice(e.index, 0, e.geometry)
      return withGeometries(doc, geometries)
    },
    ctx,
  )
}

// --- TransformGeometriesCommand ---

/**
 * 指定 id 群を回転/鏡像変換する。変換前後のペア（影響図形のみ）を保持する差分。
 * transformShape が null を返す図形（parametricObject 等）は変換対象外としてスキップする。
 * undo は逆 op ではなく保存済み before で復元する（変換ロジックのバグに影響されない堅牢な復元）。
 */
export function createTransformGeometriesCommand(
  document: DocumentState,
  ids: readonly GeometryId[],
  cx: number,
  cy: number,
  op: TransformOp,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<TransformGeometriesPayload> {
  const idSet = new Set<GeometryId>(ids)
  const pairs: { readonly before: Geometry; readonly after: Geometry }[] = []
  for (const g of document.geometries) {
    if (!idSet.has(g.id)) continue
    const after = transformShape(g, cx, cy, op)
    if (after === null) continue // parametricObject 等は変換対象外
    pairs.push({ before: g, after })
  }

  const forward = new Map<GeometryId, Geometry>(pairs.map((p) => [p.after.id, p.after]))
  const backward = new Map<GeometryId, Geometry>(pairs.map((p) => [p.before.id, p.before]))

  return createCommand<TransformGeometriesPayload>(
    COMMAND_TYPES.TRANSFORM_GEOMETRIES,
    { cx, cy, op, pairs },
    (doc) => replaceGeometries(doc, forward),
    (doc) => replaceGeometries(doc, backward),
    ctx,
  )
}

// --- UpdateLayerCommand ---

/** 1 レイヤーを before → after へ差し替える（同一 id 前提）。 */
export function createUpdateLayerCommand(
  before: DrawingLayer,
  after: DrawingLayer,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<UpdateLayerPayload> {
  const applyLayer = (document: DocumentState, target: DrawingLayer): DocumentState => ({
    ...document,
    layers: document.layers.map((l) => (l.id === target.id ? target : l)),
  })

  return createCommand<UpdateLayerPayload>(
    COMMAND_TYPES.UPDATE_LAYER,
    { before, after },
    (document) => applyLayer(document, after),
    (document) => applyLayer(document, before),
    ctx,
  )
}
