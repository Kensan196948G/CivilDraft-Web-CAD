/**
 * 図形の拡大縮小エンジン。基準点 (cx,cy) を固定して X/Y 個別倍率で図形をスケールする。
 * 継承元: Civil-Draw src/utils/scaleEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標）→ Geometry判別共用体（Point構造）へ移植。callout→leader、
 *   cloud / mline は新13種に存在しないため対象外。parametricObject は座標を直接持たないため
 *   スケール対象外とし null を返す。
 * - 継承元は新図形生成時に nanoid() を内部呼び出ししていたが、ADR-0013 に従い
 *   GeometryCreationContext（既定 = crypto.randomUUID）を注入する方式へ変更。
 *   scaleShape は「新しい id を持つスケール済みコピー」を返すため ctx.newId()/ctx.now() で
 *   id/createdAt/updatedAt を設定し、layerId/style/constructionStepIds/locked 等はスプレッドで維持する。
 * - scaleShapes は各図形を「同一 id で in-place 置換」する用途のため、id・createdAt・updatedAt を
 *   元図形から復元する（継承元は id のみ復元。createdAt/updatedAt は新設フィールドのため追加復元）。
 * - validateScaleConfig の返り値を継承元の string|null から ValidationIssue|null へ変更。
 * - 継承元の flat number[] 直接スケールを Point 単位のスケールへ表現変更（結果は同値）。
 *
 * 継承元踏襲の仕様: circle/arc の半径は max(sx,sy) 倍、text/symbol は基準点のみをスケールし
 * 文字高さ(height)・シンボル倍率(scale)は変えない。dimension/leader は端点のみをスケールする。
 */
import type { Geometry, Point, ValidationIssue } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from './geometryFactory'

export interface ScaleConfig {
  /** スケール基準点（ピボット）X。 */
  readonly cx: number
  /** スケール基準点（ピボット）Y。 */
  readonly cy: number
  /** X 方向倍率（> 0）。 */
  readonly sx: number
  /** Y 方向倍率（> 0）。 */
  readonly sy: number
}

function scaleX(x: number, cx: number, sx: number): number {
  return cx + (x - cx) * sx
}

function scaleY(y: number, cy: number, sy: number): number {
  return cy + (y - cy) * sy
}

function scalePoint(p: Point, config: ScaleConfig): Point {
  return { x: scaleX(p.x, config.cx, config.sx), y: scaleY(p.y, config.cy, config.sy) }
}

function scalePointList(points: readonly Point[], config: ScaleConfig): Point[] {
  return points.map((p) => scalePoint(p, config))
}

/**
 * 1 図形を基準点回りにスケールし、新しい id を持つコピーを返す。
 * 倍率が非正（sx<=0 または sy<=0）の場合と parametricObject の場合は null を返す。
 * parametricObject は switch 前で除外する（複製対象外のため新規 id を消費しない）。
 */
export function scaleShape(
  geometry: Geometry,
  config: ScaleConfig,
  ctx: GeometryCreationContext = defaultCreationContext,
): Geometry | null {
  if (config.sx <= 0 || config.sy <= 0) return null
  if (geometry.type === 'parametricObject') return null

  const now = ctx.now()
  const created = { id: ctx.newId(), createdAt: now, updatedAt: now }
  const { sx, sy } = config

  switch (geometry.type) {
    case 'line':
    case 'dimension':
    case 'leader':
      return {
        ...geometry,
        ...created,
        start: scalePoint(geometry.start, config),
        end: scalePoint(geometry.end, config),
      }
    case 'rectangle':
      return {
        ...geometry,
        ...created,
        origin: scalePoint(geometry.origin, config),
        width: geometry.width * sx,
        height: geometry.height * sy,
      }
    case 'circle':
      return {
        ...geometry,
        ...created,
        center: scalePoint(geometry.center, config),
        radius: geometry.radius * Math.max(sx, sy),
      }
    case 'arc':
      return {
        ...geometry,
        ...created,
        center: scalePoint(geometry.center, config),
        radius: geometry.radius * Math.max(sx, sy),
      }
    case 'ellipse':
      return {
        ...geometry,
        ...created,
        center: scalePoint(geometry.center, config),
        radiusX: geometry.radiusX * sx,
        radiusY: geometry.radiusY * sy,
      }
    case 'polyline':
    case 'spline':
      return { ...geometry, ...created, points: scalePointList(geometry.points, config) }
    case 'hatch':
      return { ...geometry, ...created, boundaryPoints: scalePointList(geometry.boundaryPoints, config) }
    case 'text':
      return { ...geometry, ...created, anchor: scalePoint(geometry.anchor, config) }
    case 'symbol':
      return { ...geometry, ...created, position: scalePoint(geometry.position, config) }
    default: {
      const exhaustive: never = geometry
      throw new Error(`Unhandled geometry type: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * 複数図形を in-place（同一 id）でスケールする。座標のみを更新し、id・createdAt・updatedAt を
 * 元図形から維持する。倍率不正・parametricObject の図形は結果から除外される。
 */
export function scaleShapes(geometries: readonly Geometry[], config: ScaleConfig): Geometry[] {
  return geometries.flatMap((g) => {
    const scaled = scaleShape(g, config)
    return scaled ? [{ ...scaled, id: g.id, createdAt: g.createdAt, updatedAt: g.updatedAt }] : []
  })
}

/** スケール設定を検証する。問題なければ null。 */
export function validateScaleConfig(config: ScaleConfig): ValidationIssue | null {
  if (config.sx <= 0 || config.sy <= 0) {
    return {
      code: 'SCALE_FACTOR_NOT_POSITIVE',
      severity: 'error',
      message: 'スケール倍率は 0 より大きい値を指定してください',
    }
  }
  return null
}
