import { describe, expect, it } from 'vitest'
import { parseCoordinate } from '@/domain/geometry/coordParser'
import type { Point, Result, ValidationIssue } from '@/shared/types'

function expectOk(result: Result<Point, ValidationIssue>): Point {
  if (!result.ok) {
    throw new Error(`期待した成功が失敗した: ${result.error.message}`)
  }
  return result.value
}

function expectError(result: Result<Point, ValidationIssue>): ValidationIssue {
  if (result.ok) {
    throw new Error('期待した失敗が成功した')
  }
  return result.error
}

const ORIGIN: Point = { x: 0, y: 0 }

describe('parseCoordinate / 絶対座標', () => {
  it('整数のx,yをパースする', () => {
    expect(expectOk(parseCoordinate('100,200', ORIGIN))).toEqual({ x: 100, y: 200 })
  })

  it('負の値をパースする', () => {
    expect(expectOk(parseCoordinate('-50,-30', ORIGIN))).toEqual({ x: -50, y: -30 })
  })

  it('小数値をパースする', () => {
    expect(expectOk(parseCoordinate('1.5,2.75', ORIGIN))).toEqual({ x: 1.5, y: 2.75 })
  })

  it('絶対座標はbaseを無視する', () => {
    expect(expectOk(parseCoordinate('10,20', { x: 100, y: 200 }))).toEqual({ x: 10, y: 20 })
  })

  it('前後の空白をトリムする', () => {
    expect(expectOk(parseCoordinate('  10 , 20  ', ORIGIN))).toEqual({ x: 10, y: 20 })
  })
})

describe('parseCoordinate / 相対座標', () => {
  it('baseにオフセットを加算する', () => {
    expect(expectOk(parseCoordinate('@10,20', { x: 100, y: 200 }))).toEqual({ x: 110, y: 220 })
  })

  it('負の相対オフセットを処理する', () => {
    expect(expectOk(parseCoordinate('@-5,-3', { x: 50, y: 60 }))).toEqual({ x: 45, y: 57 })
  })

  it('オフセット0を処理する', () => {
    expect(expectOk(parseCoordinate('@0,0', { x: 30, y: 40 }))).toEqual({ x: 30, y: 40 })
  })

  it('小数の相対オフセットを処理する', () => {
    expect(expectOk(parseCoordinate('@0.5,1.5', { x: 10, y: 20 }))).toEqual({ x: 10.5, y: 21.5 })
  })
})

describe('parseCoordinate / 相対極座標 @distance<angle', () => {
  it('@100<0（東、+X方向）をパースする', () => {
    const p = expectOk(parseCoordinate('@100<0', ORIGIN))
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(0)
  })

  it('@100<90（視覚上の北、内部Y軸下方向のためyは減少）をパースする', () => {
    const p = expectOk(parseCoordinate('@100<90', ORIGIN))
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-100)
  })

  it('@100<180（西、-X方向）をパースする', () => {
    const p = expectOk(parseCoordinate('@100<180', ORIGIN))
    expect(p.x).toBeCloseTo(-100)
    expect(p.y).toBeCloseTo(0)
  })

  it('@100<270（視覚上の南、内部Y軸下方向のためyは増加）をパースする', () => {
    const p = expectOk(parseCoordinate('@100<270', ORIGIN))
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(100)
  })

  it('@50<45（北東方向）をパースする', () => {
    const p = expectOk(parseCoordinate('@50<45', ORIGIN))
    expect(p.x).toBeCloseTo(50 * Math.SQRT1_2)
    expect(p.y).toBeCloseTo(-50 * Math.SQRT1_2)
  })

  it('base座標のオフセットを適用する', () => {
    const p = expectOk(parseCoordinate('@100<0', { x: 50, y: 30 }))
    expect(p.x).toBeCloseTo(150)
    expect(p.y).toBeCloseTo(30)
  })

  it('小数の距離・角度を処理する', () => {
    const p = expectOk(parseCoordinate('@10.5<30', ORIGIN))
    expect(p.x).toBeCloseTo(10.5 * Math.cos(Math.PI / 6))
    expect(p.y).toBeCloseTo(-10.5 * Math.sin(Math.PI / 6))
  })

  it('@distance<（角度欠落）はエラーを返す', () => {
    expect(expectError(parseCoordinate('@100<', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })

  it('@<45（距離欠落）はエラーを返す', () => {
    expect(expectError(parseCoordinate('@<45', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })

  it('@10<20<30（<区切りが多すぎる）はエラーを返す', () => {
    expect(expectError(parseCoordinate('@10<20<30', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })
})

describe('parseCoordinate / 不正な入力', () => {
  it('空文字列はエラーを返す', () => {
    expect(expectError(parseCoordinate('', ORIGIN)).severity).toBe('error')
  })

  it('数値1つのみはエラーを返す', () => {
    expect(expectError(parseCoordinate('100', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })

  it('数値以外の値はエラーを返す', () => {
    expect(expectError(parseCoordinate('a,b', ORIGIN)).code).toBe('coordinate_parse_invalid_format')
  })

  it('カンマ区切りが多すぎる場合はエラーを返す', () => {
    expect(expectError(parseCoordinate('1,2,3', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })

  it('相対座標で数値以外の値はエラーを返す', () => {
    expect(expectError(parseCoordinate('@x,y', ORIGIN)).code).toBe(
      'coordinate_parse_invalid_format',
    )
  })
})
