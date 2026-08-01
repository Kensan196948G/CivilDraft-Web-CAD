import type { Geometry, GeometryId, Point } from '@/shared/types'
import { computeCentroid } from '@/domain/geometry/shapeTransform'
import { trimLine } from '@/domain/geometry/trimEngine'
import { extendLine } from '@/domain/geometry/extendEngine'
import { offsetShape } from '@/domain/geometry/offsetEngine'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type { EditorCommand } from '@/domain/commands/editorCommand'
import type { DocumentState } from '@/domain/commands/editorCommand'
import {
  createTransformGeometriesCommand,
  createUpdateGeometryCommand,
  createAddGeometryCommand,
  createMoveGeometriesCommand,
  createCopyGeometriesCommand,
  createFilletGeometriesCommand,
  createChamferGeometriesCommand,
  createTrimGeometryCommand,
} from '@/domain/commands/geometryCommands'

export type EditingToolType =
  | 'move'
  | 'copy'
  | 'rotate'
  | 'mirror'
  | 'trim'
  | 'extend'
  | 'offset'
  | 'fillet'
  | 'chamfer'

export interface EditingToolInfo {
  readonly tool: EditingToolType
  readonly icon: string
  readonly label: string
}

export const EDITING_TOOLS: readonly EditingToolInfo[] = [
  { tool: 'move', icon: '⇱', label: '移動' },
  { tool: 'copy', icon: '⧉', label: '複写' },
  { tool: 'rotate', icon: '↻', label: '回転' },
  { tool: 'mirror', icon: '⇔', label: '鏡像' },
  { tool: 'trim', icon: '✂', label: 'トリム' },
  { tool: 'extend', icon: '⤓', label: '延長' },
  { tool: 'offset', icon: '⇉', label: 'オフセット' },
  { tool: 'fillet', icon: '⌒', label: 'フィレット' },
  { tool: 'chamfer', icon: '⧄', label: '面取り' },
]

export const PARAM_EDITING_TOOLS: ReadonlySet<EditingToolType> = new Set([
  'offset',
  'fillet',
  'chamfer',
])

export const SELECTION_REQUIRED_TOOLS: ReadonlySet<EditingToolType> = new Set([
  'move',
  'copy',
  'rotate',
  'mirror',
  'offset',
  'fillet',
  'chamfer',
])

export const CLICK_REQUIRED_TOOLS: ReadonlySet<EditingToolType> = new Set([
  'move',
  'copy',
  'trim',
  'extend',
])

export interface EditingOperationInput {
  readonly tool: EditingToolType
  readonly document: DocumentState
  readonly selectedIds: readonly GeometryId[]
  readonly clickPoint: Point | null
  readonly offsetDistance: number
  readonly filletRadius: number
  readonly chamferDist: number
  readonly ctx: GeometryCreationContext
}

/**
 * ロック済みレイヤーの図形は変更不可（詳細設計仕様書 §6.3 / Issue #40）。
 * 選択表示はできるが、編集コマンドの対象から除外する。
 */
function isLayerLocked(document: DocumentState, geometry: Geometry): boolean {
  const layer = document.layers.find((l) => l.id === geometry.layerId)
  return layer?.locked === true
}

/** 編集対象（選択かつロックレイヤーでない図形）のみを抽出する。 */
function editableSelected(
  document: DocumentState,
  selectedIds: readonly GeometryId[],
): Geometry[] {
  return document.geometries.filter(
    (g) => selectedIds.includes(g.id) && !isLayerLocked(document, g),
  )
}

export function dispatchEditingOperation(input: EditingOperationInput): EditorCommand | null {
  const { tool, document, selectedIds, clickPoint, offsetDistance, filletRadius, chamferDist, ctx } = input
  const selected = editableSelected(document, selectedIds)

  switch (tool) {
    case 'move':
      return dispatchMove(document, selected, clickPoint, ctx)
    case 'copy':
      return dispatchCopy(document, selected, clickPoint, ctx)
    case 'rotate':
      return dispatchRotate(document, selected, ctx)
    case 'mirror':
      return dispatchMirror(document, selected, ctx)
    case 'trim':
      return dispatchTrim(document, clickPoint, ctx)
    case 'extend':
      return dispatchExtend(document, clickPoint, ctx)
    case 'offset':
      return dispatchOffset(selected, offsetDistance, ctx)
    case 'fillet':
      return dispatchFillet(document, selected, filletRadius, ctx)
    case 'chamfer':
      return dispatchChamfer(document, selected, chamferDist, ctx)
    default: {
      const exhaustive: never = tool
      throw new Error(`Unknown editing tool: ${String(exhaustive)}`)
    }
  }
}

function dispatchMove(
  document: DocumentState,
  selected: readonly Geometry[],
  clickPoint: Point | null,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length === 0 || clickPoint === null) return null
  const { cx, cy } = computeCentroid(selected)
  const dx = clickPoint.x - cx
  const dy = clickPoint.y - cy
  if (dx === 0 && dy === 0) return null
  return createMoveGeometriesCommand(document, selected.map((g) => g.id), dx, dy, ctx)
}

function dispatchCopy(
  document: DocumentState,
  selected: readonly Geometry[],
  clickPoint: Point | null,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length === 0 || clickPoint === null) return null
  const { cx, cy } = computeCentroid(selected)
  const dx = clickPoint.x - cx
  const dy = clickPoint.y - cy
  if (dx === 0 && dy === 0) return null
  return createCopyGeometriesCommand(document, selected.map((g) => g.id), dx, dy, ctx)
}

function dispatchRotate(
  document: DocumentState,
  selected: readonly Geometry[],
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length === 0) return null
  const { cx, cy } = computeCentroid(selected)
  return createTransformGeometriesCommand(document, selected.map((g) => g.id), cx, cy, 'rotateCW', ctx)
}

function dispatchMirror(
  document: DocumentState,
  selected: readonly Geometry[],
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length === 0) return null
  const { cx, cy } = computeCentroid(selected)
  return createTransformGeometriesCommand(document, selected.map((g) => g.id), cx, cy, 'mirrorH', ctx)
}

function dispatchTrim(
  document: DocumentState,
  clickPoint: Point | null,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (clickPoint === null) return null
  const target = findClosestLine(document.geometries, clickPoint)
  if (target === null) return null
  if (isLayerLocked(document, target)) return null
  const cuttingShapes = document.geometries.filter((g) => g.id !== target.id)
  const result = trimLine(target, cuttingShapes, clickPoint, ctx)
  if (result === null || result.length === 0) return null
  return createTrimGeometryCommand(document, target, result, ctx)
}

function dispatchExtend(
  document: DocumentState,
  clickPoint: Point | null,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (clickPoint === null) return null
  const target = findClosestLine(document.geometries, clickPoint)
  if (target === null) return null
  if (isLayerLocked(document, target)) return null
  const boundaries = document.geometries.filter((g) => g.id !== target.id)
  const extended = extendLine(target, boundaries, clickPoint, ctx)
  if (extended === null) return null
  return createUpdateGeometryCommand(target, extended, ctx)
}

function dispatchOffset(
  selected: readonly Geometry[],
  distance: number,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length === 0 || distance === 0) return null
  const first = selected[0]
  if (first === undefined) return null
  const offset = offsetShape(first, distance, ctx)
  if (offset === null) return null
  return createAddGeometryCommand(offset, ctx)
}

function dispatchFillet(
  document: DocumentState,
  selected: readonly Geometry[],
  radius: number,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length < 2 || radius <= 0) return null
  const line1 = selected[0]
  const line2 = selected[1]
  if (line1 === undefined || line2 === undefined) return null
  if (line1.type !== 'line' || line2.type !== 'line') return null
  return createFilletGeometriesCommand(document, line1.id, line2.id, radius, ctx)
}

function dispatchChamfer(
  document: DocumentState,
  selected: readonly Geometry[],
  dist: number,
  ctx: GeometryCreationContext,
): EditorCommand | null {
  if (selected.length < 2 || dist <= 0) return null
  const line1 = selected[0]
  const line2 = selected[1]
  if (line1 === undefined || line2 === undefined) return null
  if (line1.type !== 'line' || line2.type !== 'line') return null
  return createChamferGeometriesCommand(document, line1.id, line2.id, dist, ctx)
}

function findClosestLine(geometries: readonly Geometry[], clickPoint: Point): Geometry | null {
  let best: Geometry | null = null
  let bestDist = Infinity
  for (const g of geometries) {
    if (g.type !== 'line') continue
    const dist = pointToSegmentDist(clickPoint, g.start, g.end)
    if (dist < bestDist) {
      bestDist = dist
      best = g
    }
  }
  if (bestDist > 50) return null
  return best
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
