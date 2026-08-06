/**
 * Phase 1 の具体編集コマンド群（詳細設計仕様書 §7）。
 * すべて差分ベース: 各コマンドは影響した図形/レイヤーのみを payload に保持し、
 * 全図形スナップショットを持たない（R-001 のメモリ破綻回避）。
 *
 * execute/undo は純粋関数（新しい配列/オブジェクトを返し、入力を破壊しない）。
 * 履歴 LIFO の不変条件下で、あるコマンドの undo は「そのコマンドの execute 直後の状態」に
 * 対して呼ばれるため、DeleteGeometriesCommand は記録した元インデックスへ確実に復元できる。
 */
import type { DrawingLayer, Geometry, GeometryId, Point } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import { transformShape, type TransformOp } from '@/domain/geometry/shapeTransform'
import { filletLines } from '@/domain/geometry/filletEngine'
import { chamferLines } from '@/domain/geometry/chamferEngine'
import { createCommand, type DocumentState, type EditorCommand } from './editorCommand'

/** コマンド種別（監査ログ用。SCREAMING_SNAKE で統一）。 */
export const COMMAND_TYPES = {
  ADD_GEOMETRY: 'ADD_GEOMETRY',
  UPDATE_GEOMETRY: 'UPDATE_GEOMETRY',
  DELETE_GEOMETRIES: 'DELETE_GEOMETRIES',
  TRANSFORM_GEOMETRIES: 'TRANSFORM_GEOMETRIES',
  UPDATE_LAYER: 'UPDATE_LAYER',
  MOVE_GEOMETRIES: 'MOVE_GEOMETRIES',
  COPY_GEOMETRIES: 'COPY_GEOMETRIES',
  FILLET_GEOMETRIES: 'FILLET_GEOMETRIES',
  CHAMFER_GEOMETRIES: 'CHAMFER_GEOMETRIES',
  TRIM_GEOMETRY: 'TRIM_GEOMETRY',
  IMPORT_DOCUMENT: 'IMPORT_DOCUMENT',
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

export interface MoveGeometriesPayload {
  readonly dx: number
  readonly dy: number
  readonly pairs: readonly { readonly before: Geometry; readonly after: Geometry }[]
}

export interface CopyGeometriesPayload {
  readonly newGeometries: readonly Geometry[]
}

export interface FilletGeometriesPayload {
  readonly line1Id: GeometryId
  readonly line2Id: GeometryId
  readonly beforeLine1: Geometry
  readonly beforeLine2: Geometry
  readonly afterLine1: Geometry
  readonly afterLine2: Geometry
  readonly newArc: Geometry
}

export interface ChamferGeometriesPayload {
  readonly line1Id: GeometryId
  readonly line2Id: GeometryId
  readonly beforeLine1: Geometry
  readonly beforeLine2: Geometry
  readonly afterLine1: Geometry
  readonly afterLine2: Geometry
  readonly newLine: Geometry
}

export interface TrimGeometryPayload {
  readonly originalId: GeometryId
  readonly replacementIds: readonly GeometryId[]
  readonly original: Geometry
  readonly replacements: readonly Geometry[]
}

export interface ImportDocumentPayload {
  /** 取込前の図面状態（undo で完全復元するためのスナップショット）。 */
  readonly beforeGeometries: readonly Geometry[]
  readonly beforeLayers: readonly DrawingLayer[]
  /** 取込後の図面状態。 */
  readonly afterGeometries: readonly Geometry[]
  readonly afterLayers: readonly DrawingLayer[]
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

// --- 座標オフセットヘルパー（Move/Copy用） ---

/** Point を (dx, dy) だけ平行移動する。 */
function offsetPoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy }
}

/** Point[] 全体を (dx, dy) 平行移動する（新配列を返す）。 */
function offsetPoints(pts: readonly Point[], dx: number, dy: number): Point[] {
  return pts.map((p) => offsetPoint(p, dx, dy))
}

/** 図形の全座標を (dx, dy) 平行移動する（id は維持）。 */
function offsetGeometryCoords(geometry: Geometry, dx: number, dy: number): Geometry {
  switch (geometry.type) {
    case 'line':
    case 'dimension':
    case 'leader':
      return {
        ...geometry,
        start: offsetPoint(geometry.start, dx, dy),
        end: offsetPoint(geometry.end, dx, dy),
      }
    case 'rectangle':
      return {
        ...geometry,
        origin: offsetPoint(geometry.origin, dx, dy),
      }
    case 'circle':
      return {
        ...geometry,
        center: offsetPoint(geometry.center, dx, dy),
      }
    case 'arc':
      return {
        ...geometry,
        center: offsetPoint(geometry.center, dx, dy),
      }
    case 'ellipse':
      return {
        ...geometry,
        center: offsetPoint(geometry.center, dx, dy),
      }
    case 'polyline':
    case 'spline':
      return {
        ...geometry,
        points: offsetPoints(geometry.points, dx, dy),
      }
    case 'hatch':
      return {
        ...geometry,
        boundaryPoints: offsetPoints(geometry.boundaryPoints, dx, dy),
      }
    case 'text':
      return {
        ...geometry,
        anchor: offsetPoint(geometry.anchor, dx, dy),
      }
    case 'symbol':
      return {
        ...geometry,
        position: offsetPoint(geometry.position, dx, dy),
      }
    case 'parametricObject':
      return geometry
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

// --- MoveGeometriesCommand ---

/**
 * 指定 id 群を (dx, dy) 平行移動する。変換前後のペアを保持する差分。
 * Move と Copy で共用するため、オフセット後の Geometry 群を返すヘルパーも提供する。
 */
export function createMoveGeometriesCommand(
  document: DocumentState,
  ids: readonly GeometryId[],
  dx: number,
  dy: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<MoveGeometriesPayload> {
  const idSet = new Set<GeometryId>(ids)
  const pairs: { readonly before: Geometry; readonly after: Geometry }[] = []
  for (const g of document.geometries) {
    if (!idSet.has(g.id)) continue
    pairs.push({ before: g, after: offsetGeometryCoords(g, dx, dy) })
  }

  const forward = new Map(pairs.map((p) => [p.after.id, p.after] as const))
  const backward = new Map(pairs.map((p) => [p.before.id, p.before] as const))

  return createCommand<MoveGeometriesPayload>(
    COMMAND_TYPES.MOVE_GEOMETRIES,
    { dx, dy, pairs },
    (doc) => replaceGeometries(doc, forward),
    (doc) => replaceGeometries(doc, backward),
    ctx,
  )
}

// --- CopyGeometriesCommand ---

/**
 * 指定 id 群を (dx, dy) 位置へ複写する。新規 ID を ctx.newId() で発番する。
 * execute: 新図形を末尾へ追加。undo: id で除去。
 */
export function createCopyGeometriesCommand(
  document: DocumentState,
  ids: readonly GeometryId[],
  dx: number,
  dy: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<CopyGeometriesPayload> {
  const idSet = new Set<GeometryId>(ids)
  const now = ctx.now()
  const newGeometries: Geometry[] = []
  for (const g of document.geometries) {
    if (!idSet.has(g.id)) continue
    const moved = offsetGeometryCoords(g, dx, dy)
    newGeometries.push({ ...moved, id: ctx.newId(), createdAt: now, updatedAt: now })
  }

  const newIds = new Set(newGeometries.map((g) => g.id))

  return createCommand<CopyGeometriesPayload>(
    COMMAND_TYPES.COPY_GEOMETRIES,
    { newGeometries },
    (doc) => withGeometries(doc, [...doc.geometries, ...newGeometries]),
    (doc) => withGeometries(doc, doc.geometries.filter((g) => !newIds.has(g.id))),
    ctx,
  )
}

// --- FilletGeometriesCommand ---

/**
 * 2 本の線分にフィレットを適用する複合コマンド。
 * execute: 元線分を削除 → トリム済み線分 2 本 + 円弧 1 本を追加。
 * undo: 新規図形を削除 → 元線分を復元。
 */
export function createFilletGeometriesCommand(
  document: DocumentState,
  line1Id: GeometryId,
  line2Id: GeometryId,
  radius: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<FilletGeometriesPayload> | null {
  const line1 = document.geometries.find((g) => g.id === line1Id)
  const line2 = document.geometries.find((g) => g.id === line2Id)
  if (line1 === undefined || line2 === undefined) return null
  if (line1.type !== 'line' || line2.type !== 'line') return null

  const result = filletLines(line1, line2, radius, ctx)
  if (result === null) return null

  const newIds = new Set([
    result.line1.id,
    result.line2.id,
    result.arc.id,
  ])
  const removeIds = new Set([line1Id, line2Id])

  return createCommand<FilletGeometriesPayload>(
    COMMAND_TYPES.FILLET_GEOMETRIES,
    {
      line1Id,
      line2Id,
      beforeLine1: line1,
      beforeLine2: line2,
      afterLine1: result.line1,
      afterLine2: result.line2,
      newArc: result.arc,
    },
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => !removeIds.has(g.id)),
      result.line1,
      result.line2,
      result.arc,
    ]),
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => !newIds.has(g.id)),
      line1,
      line2,
    ]),
    ctx,
  )
}

// --- ChamferGeometriesCommand ---

/**
 * 2 本の線分に面取りを適用する複合コマンド。
 * execute: 元線分を削除 → トリム済み線分 2 本 + 面取り線分 1 本を追加。
 * undo: 新規図形を削除 → 元線分を復元。
 */
export function createChamferGeometriesCommand(
  document: DocumentState,
  line1Id: GeometryId,
  line2Id: GeometryId,
  dist: number,
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<ChamferGeometriesPayload> | null {
  const line1 = document.geometries.find((g) => g.id === line1Id)
  const line2 = document.geometries.find((g) => g.id === line2Id)
  if (line1 === undefined || line2 === undefined) return null
  if (line1.type !== 'line' || line2.type !== 'line') return null

  const result = chamferLines(line1, line2, dist, ctx)
  if (result === null) return null

  const newIds = new Set([
    result.line1.id,
    result.line2.id,
    result.chamferLine.id,
  ])
  const removeIds = new Set([line1Id, line2Id])

  return createCommand<ChamferGeometriesPayload>(
    COMMAND_TYPES.CHAMFER_GEOMETRIES,
    {
      line1Id,
      line2Id,
      beforeLine1: line1,
      beforeLine2: line2,
      afterLine1: result.line1,
      afterLine2: result.line2,
      newLine: result.chamferLine,
    },
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => !removeIds.has(g.id)),
      result.line1,
      result.line2,
      result.chamferLine,
    ]),
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => !newIds.has(g.id)),
      line1,
      line2,
    ]),
    ctx,
  )
}

// --- TrimGeometryCommand ---

/**
 * トリム操作の複合コマンド。
 * execute: 元線分を削除 → 分割線分を追加。
 * undo: 分割線分を削除 → 元線分を復元。
 */
export function createTrimGeometryCommand(
  _document: DocumentState,
  original: Geometry,
  replacements: readonly Geometry[],
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<TrimGeometryPayload> {
  const replacementIds = new Set(replacements.map((g) => g.id))

  return createCommand<TrimGeometryPayload>(
    COMMAND_TYPES.TRIM_GEOMETRY,
    {
      originalId: original.id,
      replacementIds: [...replacementIds],
      original,
      replacements,
    },
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => g.id !== original.id),
      ...replacements,
    ]),
    (doc) => withGeometries(doc, [
      ...doc.geometries.filter((g) => !replacementIds.has(g.id)),
      original,
    ]),
    ctx,
  )
}

// --- ImportDocumentCommand ---

/**
 * DXF取込等で図面全体を置き換える複合コマンド（Issue #118）。
 * execute で取込後状態へ置き換え、undo で取込前状態を完全復元する。
 * 全図形スナップショットを保持するため大規模図面ではメモリを消費するが、
 * 取込は明示的なファイル操作であり 1 操作 = 1 undo の可逆性を優先する。
 */
export function createImportDocumentCommand(
  document: DocumentState,
  importedGeometries: readonly Geometry[],
  importedLayers: readonly DrawingLayer[],
  ctx: GeometryCreationContext = defaultCreationContext,
): EditorCommand<ImportDocumentPayload> {
  const beforeGeometries = [...document.geometries]
  const beforeLayers = [...document.layers]
  const afterGeometries = [...importedGeometries]
  const afterLayers = importedLayers.length > 0 ? [...importedLayers] : [...document.layers]
  return createCommand<ImportDocumentPayload>(
    COMMAND_TYPES.IMPORT_DOCUMENT,
    {
      beforeGeometries,
      beforeLayers,
      afterGeometries,
      afterLayers,
    },
    () => ({ geometries: afterGeometries, layers: afterLayers }),
    () => ({ geometries: beforeGeometries, layers: beforeLayers }),
    ctx,
  )
}
