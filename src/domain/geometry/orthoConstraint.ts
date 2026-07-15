/**
 * 直交モード（ortho）拘束: 基準点fromから見て水平・垂直のいずれか近い方向にpを拘束する。
 * 継承元: Civil-Draw src/utils/orthoConstraint.ts（継承台帳 modify、幾何演算エンジン群）。
 * |dx| >= |dy| の場合は水平（同値はタイブレークで水平を優先）、それ以外は垂直に拘束する。
 */
import type { Point } from '@/shared/types'

export function applyOrtho(p: Point, from: Point): Point {
  const dx = p.x - from.x
  const dy = p.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: p.x, y: from.y }
  }
  return { x: from.x, y: p.y }
}
