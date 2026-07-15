/**
 * 距離・方位角からの点算出（詳細設計仕様書 §12.2）と、測量座標系⇔内部座標系の
 * 変換層（CoordinateTransformer）。
 *
 * 方位角の規約（§12.2 の式の前提）:
 *   - 基準方向は北、回転は時計回り。
 *   - 測量座標系は x=東・y=北。距離 L・方位角 θ に対し
 *       X₂ = X₁ + L·sinθ   （東成分）
 *       Y₂ = Y₁ + L·cosθ   （北成分）
 *     これは θ を北(y+)から時計回りに測ることと等価。
 *   - 角度は domain/units の toAngleRad で内部基準(rad)へ変換してから sin/cos に渡す。
 *
 * 内部座標（ADR-0012: mm・X右・Y下・反時計回り正）への写像:
 *   測量座標は x=東(右)・y=北(上)・実寸だが、内部座標は Y が下向き。したがって
 *   east-north 規約では「東→内部+X」「北→内部−Y（上下反転）」で写す。さらに図面回転
 *   （rotationDeg）と原点オフセット（origin）を CoordinateTransformer で吸収する。
 *   ADR-0012 が Phase 2 送りとした「画面座標系と測量座標系の変換層」がこれにあたる。
 */
import { fromLengthMm, toAngleRad, toLengthMm } from '@/domain/units'
import type {
  CoordinateSystemSettings,
  LengthUnit,
  Point,
  SurveyCoordinate,
} from '@/shared/types'

/** 全周（度）。方位角の正規化に用いる。 */
const FULL_TURN_DEG = 360

/**
 * 距離・方位角から次の測量点を算出する（§12.2）。
 * start は測量座標（x=東・y=北）、distance は同じ測量単位の距離、
 * azimuthDeg は北基準・時計回りの方位角（度）。戻り値も測量座標。
 */
export function pointFromBearingDistance(
  start: SurveyCoordinate,
  distance: number,
  azimuthDeg: number,
): SurveyCoordinate {
  const theta = toAngleRad({ value: azimuthDeg, unit: 'deg' })
  return {
    x: start.x + distance * Math.sin(theta),
    y: start.y + distance * Math.cos(theta),
  }
}

/**
 * 2測量点間の距離と方位角（北基準・時計回り、度）を算出する。
 * pointFromBearingDistance の逆演算。トラバース・測線（FR-SURV-006）で用いる。
 * azimuthDeg は [0, 360) に正規化する。
 */
export function bearingDistanceBetween(
  from: SurveyCoordinate,
  to: SurveyCoordinate,
): { readonly distance: number; readonly azimuthDeg: number } {
  const dEast = to.x - from.x
  const dNorth = to.y - from.y
  const distance = Math.hypot(dEast, dNorth)
  // 北(y+)から時計回りに測る方位角: atan2(東成分, 北成分)
  const azimuthRad = Math.atan2(dEast, dNorth)
  let azimuthDeg = (azimuthRad * 180) / Math.PI
  if (azimuthDeg < 0) {
    azimuthDeg += FULL_TURN_DEG
  }
  return { distance, azimuthDeg }
}

/**
 * 測量座標系と内部座標系（ADR-0012: mm・X右・Y下）の相互変換器。
 * 詳細設計仕様書 §12.2 が言及する CoordinateTransformer に対応し、入力単位・軸規約・
 * 図面回転・原点を吸収する。
 */
export interface CoordinateTransformer {
  /** 測量座標（surveyUnit）を内部座標（mm）へ写す。 */
  readonly surveyToInternal: (coordinate: SurveyCoordinate) => Point
  /** 内部座標（mm）を測量座標（surveyUnit）へ戻す。 */
  readonly internalToSurvey: (point: Point) => SurveyCoordinate
}

/**
 * 座標変換器を生成する。surveyUnit は測量座標値の長さ単位（既定: m）で、
 * toLengthMm/fromLengthMm を介して内部基準(mm)と換算する。
 *
 * east-north 規約の写像手順（surveyToInternal）:
 *   1. 東・北成分を mm へ換算（東=+X 方向、北は後段で反転）
 *   2. 北を上→下へ反転（内部 Y は下向き）: iy0 = −northMm
 *   3. 図面回転 φ=rotationDeg を内部フレームで適用（標準回転行列。内部 Y が下向きの
 *      ため、正の rotationDeg は画面上では時計回りに見える）
 *   4. 原点オフセット origin を加算
 * custom 規約は軸反転を行わず、測量 x/y をそのまま内部 X/Y（右・下）へ写す。
 */
export function createCoordinateTransformer(
  settings: CoordinateSystemSettings,
  surveyUnit: LengthUnit = 'm',
): CoordinateTransformer {
  const flipNorth = settings.axisConvention === 'east-north'
  const phi = toAngleRad({ value: settings.rotationDeg, unit: 'deg' })
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const { origin } = settings

  return {
    surveyToInternal(coordinate: SurveyCoordinate): Point {
      const eastMm = toLengthMm({ value: coordinate.x, unit: surveyUnit })
      const northMm = toLengthMm({ value: coordinate.y, unit: surveyUnit })
      const ix0 = eastMm
      const iy0 = flipNorth ? -northMm : northMm
      return {
        x: origin.x + (ix0 * cos - iy0 * sin),
        y: origin.y + (ix0 * sin + iy0 * cos),
      }
    },
    internalToSurvey(point: Point): SurveyCoordinate {
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      // φ による回転の逆回転（−φ）
      const ix0 = dx * cos + dy * sin
      const iy0 = -dx * sin + dy * cos
      const eastMm = ix0
      const northMm = flipNorth ? -iy0 : iy0
      return {
        x: fromLengthMm(eastMm, surveyUnit).value,
        y: fromLengthMm(northMm, surveyUnit).value,
      }
    },
  }
}
