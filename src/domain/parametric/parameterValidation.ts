/**
 * パラメータスキーマ検証と型付き読み取りヘルパー（詳細設計仕様書 §15.1）。
 *
 * validateAgainstSchema は ParameterSpec 群を解釈し、必須・型・範囲（min/max/exclusiveMin）を
 * 検査して ValidationIssue を返す。as* ヘルパーは検証済みパラメータを generate 内で安全に
 * 取り出すための強制変換（不正値は undefined を返し、呼び出し側で既定値へフォールバック）。
 */
import type { Point, ValidationIssue } from '@/shared/types'
import type { ParameterSpec, ParametricParams } from './parametricTypes'
import { parseSlopeRatio } from './slopeRatio'

/** 数値として妥当（有限）なら返す。 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 整数として妥当なら返す。 */
export function asInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

/** 文字列なら返す。 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** x/y が有限数の座標オブジェクトなら Point として返す。 */
export function asPoint(value: unknown): Point | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const x = asNumber(record.x)
  const y = asNumber(record.y)
  if (x === undefined || y === undefined) return undefined
  return { x, y }
}

/** 全要素が Point の配列なら readonly Point[] として返す。 */
export function asPointList(value: unknown): readonly Point[] | undefined {
  if (!Array.isArray(value)) return undefined
  const points: Point[] = []
  for (const item of value) {
    const point = asPoint(item)
    if (point === undefined) return undefined
    points.push(point)
  }
  return points
}

function missingIssue(spec: ParameterSpec): ValidationIssue {
  return {
    code: 'PARAM_REQUIRED',
    severity: 'error',
    field: spec.name,
    message: `${spec.label}は必須です`,
  }
}

function typeIssue(spec: ParameterSpec): ValidationIssue {
  return {
    code: 'PARAM_TYPE',
    severity: 'error',
    field: spec.name,
    message: `${spec.label}の型が不正です（${spec.type}）`,
  }
}

function rangeIssue(spec: ParameterSpec, detail: string): ValidationIssue {
  return {
    code: 'PARAM_RANGE',
    severity: 'error',
    field: spec.name,
    message: `${spec.label}が範囲外です（${detail}）`,
  }
}

/** 数値スカラ（number/integer/angle）の範囲検査を共通化する。 */
function checkNumericRange(spec: ParameterSpec, value: number, issues: ValidationIssue[]): void {
  if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) {
    issues.push(rangeIssue(spec, `${spec.exclusiveMin} より大きい値`))
  }
  if (spec.min !== undefined && value < spec.min) {
    issues.push(rangeIssue(spec, `${spec.min} 以上`))
  }
  if (spec.max !== undefined && value > spec.max) {
    issues.push(rangeIssue(spec, `${spec.max} 以下`))
  }
}

/**
 * パラメータをスキーマに照らして検証する。未指定かつ必須なら PARAM_REQUIRED、
 * 型不一致は PARAM_TYPE、範囲外は PARAM_RANGE を返す。未指定かつ任意はスキップ（既定値適用）。
 * 定義固有のクロスフィールド検査（例: maxRadius>minRadius）は各 definition.validate で補う。
 */
export function validateAgainstSchema(
  schema: readonly ParameterSpec[],
  params: ParametricParams,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const spec of schema) {
    const raw = params[spec.name]
    if (raw === undefined || raw === null) {
      if (spec.required) issues.push(missingIssue(spec))
      continue
    }

    switch (spec.type) {
      case 'number':
      case 'angle': {
        const value = asNumber(raw)
        if (value === undefined) {
          issues.push(typeIssue(spec))
          break
        }
        checkNumericRange(spec, value, issues)
        break
      }
      case 'integer': {
        const value = asInteger(raw)
        if (value === undefined) {
          issues.push(typeIssue(spec))
          break
        }
        checkNumericRange(spec, value, issues)
        break
      }
      case 'string': {
        const value = asString(raw)
        if (value === undefined || value.length === 0) {
          issues.push(typeIssue(spec))
        }
        break
      }
      case 'point': {
        if (asPoint(raw) === undefined) issues.push(typeIssue(spec))
        break
      }
      case 'pointList': {
        const points = asPointList(raw)
        if (points === undefined) {
          issues.push(typeIssue(spec))
          break
        }
        const minCount = spec.min ?? 2
        if (points.length < minCount) {
          issues.push(rangeIssue(spec, `頂点 ${minCount} 点以上`))
        }
        break
      }
      case 'slopeRatio': {
        const text = asString(raw)
        if (text === undefined) {
          issues.push(typeIssue(spec))
          break
        }
        const parsed = parseSlopeRatio(text)
        if (!parsed.ok) issues.push({ ...parsed.error, field: spec.name })
        break
      }
      default: {
        const exhaustive: never = spec.type
        throw new Error(`Unhandled parameter type: ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  return issues
}
