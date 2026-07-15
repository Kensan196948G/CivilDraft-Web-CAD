/**
 * 寸法線（Dimension）の作図補助と自動寸法生成エンジン。
 * 継承元: Civil-Draw src/utils/dimensionEngine.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 継承元との差分:
 * - 生座標（x1/y1/x2/y2/mx/my）引数を詳細設計仕様書§6のPoint値型へ置き換えた（ADR-0012、
 *   内部座標はmm単位・X軸右方向・Y軸下方向）。
 * - 継承元のBoundingBox型・computeBoundingBox()は再実装せず、責務一元化済みの
 *   shapeBBox.tsのunionBBox()/BBox型を再利用する（BBox計算=shapeBBox.tsへ集約）。
 *   これにより自動寸法の外接矩形はshapeBBox()と同じ図形別ロジック（text/symbolの
 *   近似幅、parametricObjectのnull扱い等）に従う。継承元computeBoundingBoxは
 *   未対応type（parametricObject/spline/ellipse/leader等）を単に無視し、text/symbolを
 *   ゼロ幅の点として扱っていたため、寸法対象範囲がshapeBBoxとは厳密には異なりうる。
 * - null条件の差異吸収: 継承元computeBoundingBoxは「shapes空」または「全図形が
 *   未対応typeでminXがInfinityのまま」でnullを返した。新unionBBoxは「BBoxを計算
 *   できる図形が1つも無い」場合にnullを返す。いずれも結果として自動寸法を生成しない
 *   （[]を返す）点で挙動は一致する。
 * - 派生図形（自動寸法のDimensionGeometry）生成はnanoid直呼びを廃し、
 *   GeometryCreationContext注入（ADR-0013）でid/createdAt/updatedAtを設定する。
 * - GeometryBaseが要求するstyle/constructionStepIds/createdAt/updatedAtを付与する。
 *   styleは任意のデフォルトを埋め込まず、呼び出し側がAutoDimConfig.styleで指定する
 *   （継承元Shapeはstyleを持たず、新モデルは図形本体とスタイルを分離するため）。
 * - cloud/mlineは新13種（§6）に存在せず対象外。parametricObjectは座標を直接持たず
 *   shapeBBox()がnullを返すため、自動寸法の対象範囲には寄与しない。
 */
import type { DimensionGeometry, Geometry, GeometryStyle, LayerId, Point } from '@/shared/types'
import { defaultCreationContext, type GeometryCreationContext } from './geometryFactory'
import { unionBBox } from './shapeBBox'

/** DimensionGeometryの向き（水平/垂直/平行）。型の単一ソースとして共用体から導出する。 */
export type DimensionOrientation = DimensionGeometry['orientation']

/** ユーザーが選択する寸法モード。'auto'は2点の傾きから水平/垂直を自動判定する。 */
export type DimensionMode = 'auto' | DimensionOrientation

/** ユーザー選択モードから最終的な向きを解決する。'auto'は|dx|>=|dy|で水平、それ以外は垂直。 */
export function resolveDimOrientation(
  mode: DimensionMode,
  start: Point,
  end: Point,
): DimensionOrientation {
  if (mode !== 'auto') return mode
  return Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical'
}

/**
 * 3クリック目（マウス点）から寸法線の符号付きオフセット値を計算する。
 *
 * - horizontal: 正のoffset → 寸法線はstart.yより上（Y軸下方向系のため y が小さい側）
 * - vertical:   正のoffset → 寸法線はstart.xより左
 * - parallel:   start-end線分に対するマウス点の符号付き垂直距離
 *               （線分の90°反時計回り単位法線との内積）
 */
export function computeDimOffset(
  orientation: DimensionOrientation,
  start: Point,
  end: Point,
  mouse: Point,
): number {
  if (orientation === 'horizontal') return start.y - mouse.y
  if (orientation === 'vertical') return start.x - mouse.x
  // parallel: start-end線分の90°反時計回り単位法線との内積
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return 0
  const nx = -dy / len
  const ny = dx / len
  return (mouse.x - start.x) * nx + (mouse.y - start.y) * ny
}

/** 自動寸法生成の設定。styleはGeometryBaseが必須とするため呼び出し側が指定する。 */
export interface AutoDimConfig {
  readonly layerId: LayerId
  readonly style: GeometryStyle
  readonly offset?: number
  readonly textHeight?: number
  readonly arrowSize?: number
}

/**
 * 図形群の外接矩形から水平・垂直の寸法線を生成する。
 * 幅・高さがそれぞれ有意（>1e-6）な場合のみ対応する寸法線を1本ずつ生成する。
 * 外接矩形が計算できない（BBox=null）場合は空配列を返す。
 */
export function generateAutoDimensions(
  geometries: readonly Geometry[],
  config: AutoDimConfig,
  ctx: GeometryCreationContext = defaultCreationContext,
): DimensionGeometry[] {
  const bbox = unionBBox(geometries)
  if (bbox === null) return []

  const { minX, minY, maxX, maxY } = bbox
  const width = maxX - minX
  const height = maxY - minY

  const offset = config.offset ?? 20
  const textHeight = config.textHeight ?? 12
  const arrowSize = config.arrowSize ?? 8

  const makeDim = (
    dimStart: Point,
    dimEnd: Point,
    orientation: DimensionOrientation,
  ): DimensionGeometry => {
    const timestamp = ctx.now()
    return {
      id: ctx.newId(),
      layerId: config.layerId,
      type: 'dimension',
      style: config.style,
      constructionStepIds: [],
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      start: dimStart,
      end: dimEnd,
      orientation,
      offset,
      textHeight,
      arrowSize,
    }
  }

  const result: DimensionGeometry[] = []
  if (width > 1e-6) {
    result.push(makeDim({ x: minX, y: minY }, { x: maxX, y: minY }, 'horizontal'))
  }
  if (height > 1e-6) {
    result.push(makeDim({ x: minX, y: minY }, { x: minX, y: maxY }, 'vertical'))
  }
  return result
}
