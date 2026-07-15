import { describe, expect, it } from 'vitest'
import {
  defaultCoordinateSystemSettings,
  validateCoordinateSystemSettings,
} from '@/domain/survey/coordinateSystem'
import type { CoordinateSystemSettings } from '@/shared/types'

function settings(overrides: Partial<CoordinateSystemSettings> = {}): CoordinateSystemSettings {
  return { ...defaultCoordinateSystemSettings, ...overrides }
}

describe('validateCoordinateSystemSettings / 座標設定検証', () => {
  it('既定設定は妥当', () => {
    const result = validateCoordinateSystemSettings(defaultCoordinateSystemSettings)
    expect(result.ok).toBe(true)
  })

  it('jgd-attribute + 平面直角座標系番号(9系)は妥当', () => {
    const result = validateCoordinateSystemSettings(
      settings({ mode: 'jgd-attribute', planeRectangularZone: 9, verticalDatum: 'T.P.' }),
    )
    expect(result.ok).toBe(true)
  })

  it('未知のmodeを拒否する', () => {
    const result = validateCoordinateSystemSettings(
      settings({ mode: 'unknown' as CoordinateSystemSettings['mode'] }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('mode')
  })

  it('平面直角座標系番号の範囲外(20系)を拒否する', () => {
    const result = validateCoordinateSystemSettings(settings({ planeRectangularZone: 20 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('planeRectangularZone')
  })

  it('平面直角座標系番号が非整数だと拒否する', () => {
    const result = validateCoordinateSystemSettings(settings({ planeRectangularZone: 9.5 }))
    expect(result.ok).toBe(false)
  })

  it('回転角が非数値だと拒否する', () => {
    const result = validateCoordinateSystemSettings(settings({ rotationDeg: Number.NaN }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('rotationDeg')
  })

  it('原点が非有限だと拒否する', () => {
    const result = validateCoordinateSystemSettings(settings({ origin: { x: Infinity, y: 0 } }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('origin')
  })

  it('空のverticalDatumを拒否する', () => {
    const result = validateCoordinateSystemSettings(settings({ verticalDatum: '   ' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.field).toBe('verticalDatum')
  })
})
