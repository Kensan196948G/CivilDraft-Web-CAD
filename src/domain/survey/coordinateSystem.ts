/**
 * 座標設定（詳細設計仕様書 §12.1 CoordinateSystemSettings）の検証と既定値。
 * mode / axisConvention の値域、回転角・原点の有限性、平面直角座標系番号（日本は
 * 1〜19系）の範囲を検査する。想定内の入力不正は Result で返す（既存 coordParser.ts と
 * 同方針、詳細設計仕様書 §4.2）。
 */
import type {
  CoordinateSystemSettings,
  Result,
  ValidationIssue,
} from '@/shared/types'

/** 日本の平面直角座標系の系番号は 1〜19 系（国土地理院 告示）。 */
const PLANE_RECTANGULAR_ZONE_MIN = 1
const PLANE_RECTANGULAR_ZONE_MAX = 19

/**
 * 既定の座標設定。原点は内部座標の (0,0)、回転なし、ローカル・東北軸。
 * jgd-attribute へ切り替える場合は planeRectangularZone 等を明示する。
 */
export const defaultCoordinateSystemSettings: CoordinateSystemSettings = {
  mode: 'local',
  origin: { x: 0, y: 0 },
  rotationDeg: 0,
  axisConvention: 'east-north',
}

function invalid(field: string, message: string): Result<never, ValidationIssue> {
  return {
    ok: false,
    error: {
      code: 'coordinate_settings_invalid',
      severity: 'error',
      field,
      message,
    },
  }
}

/**
 * 座標設定を検証する。すべての制約を満たせば同一設定を ok として返す。
 * 検証観点: mode / axisConvention の値域、rotationDeg・origin の有限性、
 * planeRectangularZone の整数・範囲（1〜19系）、verticalDatum の非空。
 */
export function validateCoordinateSystemSettings(
  settings: CoordinateSystemSettings,
): Result<CoordinateSystemSettings, ValidationIssue> {
  if (settings.mode !== 'local' && settings.mode !== 'jgd-attribute') {
    return invalid('mode', `未知の座標モードです: "${String(settings.mode)}"`)
  }

  if (settings.axisConvention !== 'east-north' && settings.axisConvention !== 'custom') {
    return invalid('axisConvention', `未知の軸規約です: "${String(settings.axisConvention)}"`)
  }

  if (!Number.isFinite(settings.rotationDeg)) {
    return invalid('rotationDeg', '回転角が数値ではありません')
  }

  if (!Number.isFinite(settings.origin.x) || !Number.isFinite(settings.origin.y)) {
    return invalid('origin', '原点座標が数値ではありません')
  }

  const zone = settings.planeRectangularZone
  if (zone !== undefined) {
    if (!Number.isInteger(zone) || zone < PLANE_RECTANGULAR_ZONE_MIN || zone > PLANE_RECTANGULAR_ZONE_MAX) {
      return invalid(
        'planeRectangularZone',
        `平面直角座標系番号は${PLANE_RECTANGULAR_ZONE_MIN}〜${PLANE_RECTANGULAR_ZONE_MAX}系の整数です: ${String(zone)}`,
      )
    }
  }

  if (settings.verticalDatum !== undefined && settings.verticalDatum.trim() === '') {
    return invalid('verticalDatum', '標高基準名が空です')
  }

  return { ok: true, value: settings }
}
