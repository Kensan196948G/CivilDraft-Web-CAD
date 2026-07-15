/**
 * 詳細設計仕様書 §20 図面差分。2 時点の図形集合を比較し、追加/削除/変更を分類する。
 *
 * §20.1 の DrawingDiff をそのまま踏襲し、変更は 4 分類（geometry/style/attribute/step）へ振り分ける。
 *
 * 照合・比較の判断:
 * - 照合は同一 GeometryId を基本とする（§20.1）。複製・インポート等で ID が変わる場合の
 *   形状類似推定は本エンジンでは行わない（§20.1「自動同一判定を確定しない」に従う）。
 * - 変更検知はフィールド比較。監査系メタ（updatedAt / createdAt）は無視した「実質比較」とする
 *   （updatedAt だけの差は差分としない）。
 * - 座標の微小差は coordinateTolerance（既定 0 = 完全一致）で許容する（§20「許容差を適用」）。
 *   許容差は幾何比較の数値リーフに適用する。
 */
import type { Geometry, GeometryId } from '@/shared/types'

/**
 * 変更された図形 1 件。差分表示（§20「差分基準を画面に表示する」）のため before/after を保持する。
 * 同一 id が複数分類（座標と属性の同時変更など）に現れることがある。
 */
export interface GeometryChange {
  readonly id: GeometryId
  readonly before: Geometry
  readonly after: Geometry
}

/** 詳細設計仕様書 §20.1 DrawingDiff。 */
export interface DrawingDiff {
  readonly added: readonly GeometryId[]
  readonly removed: readonly GeometryId[]
  readonly geometryChanged: readonly GeometryChange[]
  readonly styleChanged: readonly GeometryChange[]
  readonly attributeChanged: readonly GeometryChange[]
  readonly stepChanged: readonly GeometryChange[]
}

export interface DiffOptions {
  /** 幾何比較で許容する座標の絶対差（既定 0 = 完全一致）。§20 の許容差に対応。 */
  readonly coordinateTolerance?: number
}

/**
 * 幾何比較の対象外とするキー。
 * - id: 照合キーのため常に同一。
 * - style: styleChanged で個別に比較。
 * - civilAttributeId / layerId / locked: attributeChanged で比較する非幾何メタ。
 * - constructionStepIds: stepChanged で比較。
 * - createdAt / updatedAt: 監査系メタは無視（実質比較）。
 */
const NON_GEOMETRIC_KEYS: ReadonlySet<string> = new Set([
  'id',
  'style',
  'civilAttributeId',
  'layerId',
  'locked',
  'constructionStepIds',
  'createdAt',
  'updatedAt',
])

/** 図形の「幾何部分」（type + 座標・寸法パラメータ）だけを抜き出す。 */
function geometricPart(geometry: Geometry): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(geometry)) {
    if (!NON_GEOMETRIC_KEYS.has(key)) out[key] = value
  }
  return out
}

/**
 * JSON 相当の値の構造的等価比較。数値リーフは tolerance の絶対差まで等しいとみなす。
 * 配列は順序込みで比較する（頂点の並び替えは形状変更とみなすため）。
 */
function deepEqual(a: unknown, b: unknown, tolerance: number): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return Math.abs(a - b) <= tolerance
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i], tolerance))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key], tolerance),
    )
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function geometryChanged(before: Geometry, after: Geometry, tolerance: number): boolean {
  return !deepEqual(geometricPart(before), geometricPart(after), tolerance)
}

function styleChanged(before: Geometry, after: Geometry): boolean {
  // style は許容差の対象外（線幅・不透明度の微小差も明示差分とする）。
  return !deepEqual(before.style, after.style, 0)
}

function attributeChanged(before: Geometry, after: Geometry): boolean {
  return (
    before.civilAttributeId !== after.civilAttributeId ||
    before.layerId !== after.layerId ||
    before.locked !== after.locked
  )
}

function stepChanged(before: Geometry, after: Geometry): boolean {
  return !deepEqual(before.constructionStepIds, after.constructionStepIds, 0)
}

/**
 * 2 時点の図形集合の差分を求める（§20）。before→after を GeometryId で照合し、
 * added（after にのみ存在）/ removed（before にのみ存在）/ 各種変更へ分類する。
 * 同一 id が複数の変更分類に同時に現れることがある。
 */
export function diffDrawings(
  before: readonly Geometry[],
  after: readonly Geometry[],
  options: DiffOptions = {},
): DrawingDiff {
  const tolerance = options.coordinateTolerance ?? 0
  const beforeMap = new Map<GeometryId, Geometry>(before.map((g) => [g.id, g]))
  const afterMap = new Map<GeometryId, Geometry>(after.map((g) => [g.id, g]))

  const added: GeometryId[] = []
  const removed: GeometryId[] = []
  const geometry: GeometryChange[] = []
  const style: GeometryChange[] = []
  const attribute: GeometryChange[] = []
  const step: GeometryChange[] = []

  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id)) added.push(id)
  }
  for (const [id, beforeGeom] of beforeMap) {
    const afterGeom = afterMap.get(id)
    if (afterGeom === undefined) {
      removed.push(id)
      continue
    }
    const change: GeometryChange = { id, before: beforeGeom, after: afterGeom }
    if (geometryChanged(beforeGeom, afterGeom, tolerance)) geometry.push(change)
    if (styleChanged(beforeGeom, afterGeom)) style.push(change)
    if (attributeChanged(beforeGeom, afterGeom)) attribute.push(change)
    if (stepChanged(beforeGeom, afterGeom)) step.push(change)
  }

  return {
    added,
    removed,
    geometryChanged: geometry,
    styleChanged: style,
    attributeChanged: attribute,
    stepChanged: step,
  }
}
