/**
 * 図形の配列複写エンジン。直線配列（linear）と矩形配列（rect）で図形群を複製する。
 * 継承元: Civil-Draw src/utils/arrayEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標）→ Geometry判別共用体（Point構造）へ移植。callout→leader、
 *   cloud / mline は新13種に存在しないため対象外。parametricObject は座標を直接持たないため
 *   複写対象外とし、複製結果から除外する（switch 前で除外し新規 id を消費しない）。
 * - 継承元は複製時に nanoid() を内部呼び出ししていたが、ADR-0013 に従い
 *   GeometryCreationContext（既定 = crypto.randomUUID）を注入する方式へ変更。複製図形は
 *   ctx.newId()/ctx.now() で id/createdAt/updatedAt を設定し、layerId/style/constructionStepIds/
 *   locked 等はスプレッドで維持する。
 * - validateArrayConfig の返り値を継承元の string|null から ValidationIssue|null へ変更。
 * - 継承元の flat number[] 直接平行移動を Point 単位へ表現変更（結果は同値）。
 *
 * 継承元踏襲の仕様: applyArray は複製分のみを返し、元図形は含めない（元図形を残すには入力配列を
 * 結果へ連結する）。直線配列は index 1..count-1、矩形配列は原点セル (0,0) を除く全セルを複製する。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from './geometryFactory'

export interface LinearArrayConfig {
  readonly kind: 'linear'
  /** 総数（元図形を含む。>= 2）。複製されるのは count-1 個。 */
  readonly count: number
  /** 1 ステップあたりの X オフセット（world 単位）。 */
  readonly dx: number
  /** 1 ステップあたりの Y オフセット（world 単位）。 */
  readonly dy: number
}

export interface RectArrayConfig {
  readonly kind: 'rect'
  /** 行数（>= 1）。 */
  readonly rows: number
  /** 列数（>= 1）。 */
  readonly cols: number
  /** 行間の Y オフセット。 */
  readonly rowSpacing: number
  /** 列間の X オフセット。 */
  readonly colSpacing: number
}

export type ArrayConfig = LinearArrayConfig | RectArrayConfig

function translatePoint(p: Point, dx: number, dy: number): Point {
  return { x: p.x + dx, y: p.y + dy }
}

function translatePointList(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((p) => translatePoint(p, dx, dy))
}

/**
 * 1 図形を (dx,dy) 平行移動し、新しい id を持つ複製を返す。
 * parametricObject は複写対象外のため null を返す（switch 前で除外し新規 id を消費しない）。
 */
function translateShape(
  geometry: Geometry,
  dx: number,
  dy: number,
  ctx: GeometryCreationContext,
): Geometry | null {
  if (geometry.type === 'parametricObject') return null

  const now = ctx.now()
  const created = { id: ctx.newId(), createdAt: now, updatedAt: now }

  switch (geometry.type) {
    case 'line':
    case 'dimension':
    case 'leader':
      return {
        ...geometry,
        ...created,
        start: translatePoint(geometry.start, dx, dy),
        end: translatePoint(geometry.end, dx, dy),
      }
    case 'mline':
      return {
        ...geometry,
        ...created,
        start: translatePoint(geometry.start, dx, dy),
        end: translatePoint(geometry.end, dx, dy),
      }
    case 'cloud':
      return {
        ...geometry,
        ...created,
        x1: geometry.x1 + dx,
        y1: geometry.y1 + dy,
        x2: geometry.x2 + dx,
        y2: geometry.y2 + dy,
      }
    case 'rectangle':
      return { ...geometry, ...created, origin: translatePoint(geometry.origin, dx, dy) }
    case 'text':
      return { ...geometry, ...created, anchor: translatePoint(geometry.anchor, dx, dy) }
    case 'symbol':
      return { ...geometry, ...created, position: translatePoint(geometry.position, dx, dy) }
    case 'circle':
    case 'arc':
    case 'ellipse':
      return { ...geometry, ...created, center: translatePoint(geometry.center, dx, dy) }
    case 'polyline':
    case 'spline':
      return { ...geometry, ...created, points: translatePointList(geometry.points, dx, dy) }
    case 'hatch':
      return { ...geometry, ...created, boundaryPoints: translatePointList(geometry.boundaryPoints, dx, dy) }
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 図形群の配列複写を生成する。返るのは複製分のみで、元図形は含まない。
 * parametricObject は複写対象外として結果から除外される。
 */
export function applyArray(
  geometries: readonly Geometry[],
  config: ArrayConfig,
  ctx: GeometryCreationContext = defaultCreationContext,
): Geometry[] {
  if (geometries.length === 0) return []

  const result: Geometry[] = []

  if (config.kind === 'linear') {
    const { count, dx, dy } = config
    // index 0 = 元図形（複製しない）、index 1..count-1 を複製する。
    for (let i = 1; i < count; i++) {
      for (const g of geometries) {
        const copy = translateShape(g, dx * i, dy * i, ctx)
        if (copy !== null) result.push(copy)
      }
    }
    return result
  }

  const { rows, cols, rowSpacing, colSpacing } = config
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue // 原点セルは元図形の位置なのでスキップ
      for (const g of geometries) {
        const copy = translateShape(g, colSpacing * c, rowSpacing * r, ctx)
        if (copy !== null) result.push(copy)
      }
    }
  }
  return result
}

/** 配列設定を検証する。問題なければ null。 */
export function validateArrayConfig(config: ArrayConfig): ValidationIssue | null {
  if (config.kind === 'linear') {
    if (config.count < 2) {
      return {
        code: 'ARRAY_COUNT_TOO_SMALL',
        severity: 'error',
        field: 'count',
        message: '複写数は 2 以上を指定してください',
      }
    }
    if (config.dx === 0 && config.dy === 0) {
      return {
        code: 'ARRAY_LINEAR_ZERO_OFFSET',
        severity: 'error',
        message: 'dx または dy のどちらかを 0 以外にしてください',
      }
    }
    return null
  }

  if (config.rows < 1 || config.cols < 1) {
    return {
      code: 'ARRAY_RECT_DIMENSION_TOO_SMALL',
      severity: 'error',
      message: '行数・列数は 1 以上を指定してください',
    }
  }
  if (config.rows === 1 && config.cols === 1) {
    return {
      code: 'ARRAY_RECT_SINGLE_CELL',
      severity: 'error',
      message: '行数または列数を 2 以上にしてください',
    }
  }
  if (config.rowSpacing === 0 && config.rows > 1) {
    return {
      code: 'ARRAY_RECT_ZERO_ROW_SPACING',
      severity: 'error',
      field: 'rowSpacing',
      message: '行間隔を指定してください',
    }
  }
  if (config.colSpacing === 0 && config.cols > 1) {
    return {
      code: 'ARRAY_RECT_ZERO_COL_SPACING',
      severity: 'error',
      field: 'colSpacing',
      message: '列間隔を指定してください',
    }
  }
  return null
}
