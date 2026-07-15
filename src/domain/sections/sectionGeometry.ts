/**
 * 断面（Section）から描画用 Geometry 群を生成する（詳細設計仕様書 §16.2）。
 *
 * 座標写像（section 座標 → 内部図形座標）:
 * - offset（横断位置, 左負右正） → Point.x（そのまま mm）。
 * - elevation（標高, 上が正）  → Point.y = **−elevation**。
 *   内部座標系は ADR-0012 で Y 下向きのため、標高の上向きを画面上向きに一致させるべく符号反転する。
 *
 * 生成物:
 * - 現況線・計画線をそれぞれ PolylineGeometry（closed=false）で生成する。
 * - ハッチスタイルが与えられ、かつ面積算出が成功した場合、切土・盛土領域を HatchGeometry で塗る
 *   （切土=rock パターン、盛土=earth パターン。earth は既存 templateCatalog の盛土表現に倣う）。
 *
 * ID・タイムスタンプは ADR-0013 の GeometryCreationContext 注入に委ね、本ファイルは発番しない。
 */
import type {
  Geometry,
  GeometryBase,
  GeometryStyle,
  HatchGeometry,
  LayerId,
  Point,
  PolylineGeometry,
} from '@/shared/types'
import {
  defaultCreationContext,
  type GeometryCreationContext,
} from '@/domain/geometry/geometryFactory'
import type { Section, SectionPoint } from './section'
import { computeSectionAreas } from './sectionArea'

/** 断面図形生成のスタイル指定。ハッチスタイル未指定なら領域塗りは生成しない。 */
export interface SectionGeometryStyleSet {
  readonly layerId: LayerId
  /** 現況線のスタイル。 */
  readonly existingStyle: GeometryStyle
  /** 計画線のスタイル。 */
  readonly plannedStyle: GeometryStyle
  /** 切土領域ハッチのスタイル（未指定なら切土塗りを省略）。 */
  readonly cutHatchStyle?: GeometryStyle
  /** 盛土領域ハッチのスタイル（未指定なら盛土塗りを省略）。 */
  readonly fillHatchStyle?: GeometryStyle
}

/** section 座標（offset/elevation）を内部図形座標 Point（X右/Y下）へ写像する。 */
export function sectionPointToPoint(p: SectionPoint): Point {
  return { x: p.offset, y: -p.elevation }
}

/** GeometryBase の共通フィールド（id/timestamp は ctx 発番）を合成する。 */
function makeBase(
  layerId: LayerId,
  style: GeometryStyle,
  ctx: GeometryCreationContext,
): Omit<GeometryBase, 'type'> {
  const timestamp = ctx.now()
  return {
    id: ctx.newId(),
    layerId,
    style,
    civilAttributeId: undefined,
    constructionStepIds: [],
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function makeGroundPolyline(
  points: readonly SectionPoint[],
  layerId: LayerId,
  style: GeometryStyle,
  ctx: GeometryCreationContext,
): PolylineGeometry {
  return {
    ...makeBase(layerId, style, ctx),
    type: 'polyline',
    points: points.map(sectionPointToPoint),
    closed: false,
  }
}

function makeRegionHatch(
  polygon: readonly SectionPoint[],
  pattern: HatchGeometry['pattern'],
  layerId: LayerId,
  style: GeometryStyle,
  ctx: GeometryCreationContext,
): HatchGeometry {
  return {
    ...makeBase(layerId, style, ctx),
    type: 'hatch',
    boundaryPoints: polygon.map(sectionPointToPoint),
    pattern,
    angleDeg: 45,
    spacing: 15,
  }
}

/**
 * 断面から描画 Geometry 群を生成する。
 * 現況線・計画線は各 2 点以上のときのみ生成する（点不足は退化図形を作らず省略）。
 * ハッチは cutHatchStyle/fillHatchStyle が与えられ、面積算出が成功したときのみ生成する
 * （面積未確定時は線のみ生成しハッチは省略する）。
 * @param ctx ID・タイムスタンプ注入（ADR-0013）。省略時は既定実装。
 */
export function buildSectionGeometries(
  section: Section,
  styles: SectionGeometryStyleSet,
  ctx: GeometryCreationContext = defaultCreationContext,
): Geometry[] {
  const geometries: Geometry[] = []

  if (styles.cutHatchStyle !== undefined || styles.fillHatchStyle !== undefined) {
    const areas = computeSectionAreas(section)
    if (areas.ok) {
      for (const region of areas.value.regions) {
        if (region.kind === 'cut' && styles.cutHatchStyle !== undefined) {
          geometries.push(
            makeRegionHatch(region.polygon, 'rock', styles.layerId, styles.cutHatchStyle, ctx),
          )
        } else if (region.kind === 'fill' && styles.fillHatchStyle !== undefined) {
          geometries.push(
            makeRegionHatch(region.polygon, 'earth', styles.layerId, styles.fillHatchStyle, ctx),
          )
        }
      }
    }
  }

  if (section.existingGround.length >= 2) {
    geometries.push(
      makeGroundPolyline(section.existingGround, styles.layerId, styles.existingStyle, ctx),
    )
  }
  if (section.plannedGround.length >= 2) {
    geometries.push(
      makeGroundPolyline(section.plannedGround, styles.layerId, styles.plannedStyle, ctx),
    )
  }

  return geometries
}
