import { describe, expect, it } from 'vitest'
import {
  bearingDistanceBetween,
  createCoordinateTransformer,
  pointFromBearingDistance,
} from '@/domain/survey/bearingDistance'
import { defaultCoordinateSystemSettings } from '@/domain/survey/coordinateSystem'
import type { CoordinateSystemSettings, SurveyCoordinate } from '@/shared/types'

const ORIGIN: SurveyCoordinate = { x: 0, y: 0 }

describe('pointFromBearingDistance / 距離・方位角からの点算出（§12.2）', () => {
  // §12.2: X₂=X₁+L·sinθ, Y₂=Y₁+L·cosθ（北基準・時計回り、x=東・y=北）
  it('方位角0°（北）はY(北)方向へ伸びる', () => {
    const p = pointFromBearingDistance(ORIGIN, 100, 0)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(100, 9)
  })

  it('方位角90°（東）はX(東)方向へ伸びる', () => {
    const p = pointFromBearingDistance(ORIGIN, 100, 90)
    expect(p.x).toBeCloseTo(100, 9)
    expect(p.y).toBeCloseTo(0, 9)
  })

  it('方位角180°（南）はY負方向へ伸びる', () => {
    const p = pointFromBearingDistance(ORIGIN, 100, 180)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(-100, 9)
  })

  it('方位角270°（西）はX負方向へ伸びる', () => {
    const p = pointFromBearingDistance(ORIGIN, 100, 270)
    expect(p.x).toBeCloseTo(-100, 9)
    expect(p.y).toBeCloseTo(0, 9)
  })

  it('方位角45°は東・北へ等分に伸びる', () => {
    const p = pointFromBearingDistance(ORIGIN, 100, 45)
    expect(p.x).toBeCloseTo(70.71067811865, 8)
    expect(p.y).toBeCloseTo(70.71067811865, 8)
  })

  it('起点が原点以外でもオフセットする', () => {
    const p = pointFromBearingDistance({ x: 10, y: 20 }, 50, 90)
    expect(p.x).toBeCloseTo(60, 9)
    expect(p.y).toBeCloseTo(20, 9)
  })
})

describe('bearingDistanceBetween / 距離・方位角の逆算', () => {
  it('東向きの2点は距離と方位角90°を返す', () => {
    const r = bearingDistanceBetween({ x: 0, y: 0 }, { x: 30, y: 0 })
    expect(r.distance).toBeCloseTo(30, 9)
    expect(r.azimuthDeg).toBeCloseTo(90, 9)
  })

  it('南向きは方位角180°を返す', () => {
    const r = bearingDistanceBetween({ x: 0, y: 0 }, { x: 0, y: -10 })
    expect(r.azimuthDeg).toBeCloseTo(180, 9)
  })

  it('pointFromBearingDistance の逆演算になっている（往復一致）', () => {
    const start: SurveyCoordinate = { x: 12.5, y: -3.25 }
    const forward = pointFromBearingDistance(start, 123.456, 33.3)
    const inverse = bearingDistanceBetween(start, forward)
    expect(inverse.distance).toBeCloseTo(123.456, 6)
    expect(inverse.azimuthDeg).toBeCloseTo(33.3, 6)
  })
})

describe('createCoordinateTransformer / 測量⇔内部座標変換（ADR-0012）', () => {
  it('east-north既定: 北(上)は内部Y(下)へ反転し、mへ換算する', () => {
    const t = createCoordinateTransformer(defaultCoordinateSystemSettings)
    // 東1m=1000mm→+X、北1m→内部−1000（Y下向き）
    const p = t.surveyToInternal({ x: 1, y: 1 })
    expect(p.x).toBeCloseTo(1000, 9)
    expect(p.y).toBeCloseTo(-1000, 9)
  })

  it('原点オフセットを加算する', () => {
    const settings: CoordinateSystemSettings = {
      ...defaultCoordinateSystemSettings,
      origin: { x: 5000, y: 5000 },
    }
    const t = createCoordinateTransformer(settings)
    const p = t.surveyToInternal({ x: 0, y: 0 })
    expect(p.x).toBeCloseTo(5000, 9)
    expect(p.y).toBeCloseTo(5000, 9)
  })

  it('図面回転90°を吸収する', () => {
    const settings: CoordinateSystemSettings = {
      ...defaultCoordinateSystemSettings,
      rotationDeg: 90,
    }
    const t = createCoordinateTransformer(settings)
    // 東1m: ix0=1000, iy0=0 → 回転90°で (0, 1000)
    const p = t.surveyToInternal({ x: 1, y: 0 })
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(1000, 6)
  })

  it('internalToSurvey は surveyToInternal の逆変換（往復一致）', () => {
    const settings: CoordinateSystemSettings = {
      mode: 'local',
      origin: { x: 1234, y: -567 },
      rotationDeg: 37.5,
      axisConvention: 'east-north',
    }
    const t = createCoordinateTransformer(settings)
    const survey: SurveyCoordinate = { x: 42.5, y: -8.75 }
    const back = t.internalToSurvey(t.surveyToInternal(survey))
    expect(back.x).toBeCloseTo(survey.x, 6)
    expect(back.y).toBeCloseTo(survey.y, 6)
  })

  it('surveyUnit=mm を指定すると換算せずそのまま扱う', () => {
    const t = createCoordinateTransformer(defaultCoordinateSystemSettings, 'mm')
    const p = t.surveyToInternal({ x: 100, y: 0 })
    expect(p.x).toBeCloseTo(100, 9)
    expect(p.y).toBeCloseTo(0, 9)
  })
})
