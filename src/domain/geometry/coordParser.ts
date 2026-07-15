/**
 * 座標入力文字列を内部基準（ADR-0012: mm・X軸右方向・Y軸下方向）のPointへ変換する。
 * 継承元: Civil-Draw src/utils/coordParser.ts（継承台帳 modify、幾何演算エンジン群）。
 *
 * 対応フォーマット:
 *   "x,y"              — 絶対座標
 *   "@dx,dy"           — 相対座標（baseからのオフセット）
 *   "@distance<angle"  — 相対極座標（AutoCAD互換）。角度は東（X軸正方向）を0とし
 *                         反時計回りを正とする度数法（詳細設計仕様書の座標入力慣習）。
 *                         内部はY軸下方向（ADR-0012）のため、Y成分の符号を反転して写像する。
 */
import { toAngleRad } from '@/domain/units'
import type { Point, Result, ValidationIssue } from '@/shared/types'

export function parseCoordinate(input: string, base: Point): Result<Point, ValidationIssue> {
  const trimmed = input.trim()
  const relative = trimmed.startsWith('@')
  const body = relative ? trimmed.slice(1) : trimmed

  if (relative && body.includes('<')) {
    return parseRelativePolar(body, base, input)
  }
  return parseCartesian(body, base, relative, input)
}

function parseRelativePolar(
  body: string,
  base: Point,
  original: string,
): Result<Point, ValidationIssue> {
  const [distancePart, anglePart, extra] = body.split('<')
  if (distancePart === undefined || anglePart === undefined || extra !== undefined) {
    return invalidFormat(original)
  }

  const distance = Number.parseFloat(distancePart)
  const angleDeg = Number.parseFloat(anglePart)
  if (Number.isNaN(distance) || Number.isNaN(angleDeg)) {
    return invalidFormat(original)
  }

  const angleRad = toAngleRad({ value: angleDeg, unit: 'deg' })
  return {
    ok: true,
    value: {
      x: base.x + distance * Math.cos(angleRad),
      y: base.y - distance * Math.sin(angleRad),
    },
  }
}

function parseCartesian(
  body: string,
  base: Point,
  relative: boolean,
  original: string,
): Result<Point, ValidationIssue> {
  const [aPart, bPart, extra] = body.split(',')
  if (aPart === undefined || bPart === undefined || extra !== undefined) {
    return invalidFormat(original)
  }

  const a = Number.parseFloat(aPart)
  const b = Number.parseFloat(bPart)
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return invalidFormat(original)
  }

  return {
    ok: true,
    value: relative ? { x: base.x + a, y: base.y + b } : { x: a, y: b },
  }
}

function invalidFormat(input: string): Result<Point, ValidationIssue> {
  return {
    ok: false,
    error: {
      code: 'coordinate_parse_invalid_format',
      severity: 'error',
      message: `座標入力の形式が不正です: "${input}"`,
    },
  }
}
