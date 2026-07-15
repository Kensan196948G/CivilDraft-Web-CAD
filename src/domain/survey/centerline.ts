/**
 * 中心線・測点（詳細設計仕様書 §12.4、FR-ALIGN-002/003）。
 *
 * 初期版の中心線は内部座標（ADR-0012: mm・X右・Y下）の点列（polyline）として扱う
 * （円弧セグメントは Phase 3 の線形実装で拡張。§13）。累加距離 station を線形上の
 * 位置に用い、測点ピッチ配置では開始・終了・頂点（直線境界）を重複なく生成する。
 *
 * 左右オフセットは中心線進行方向（station 増加方向）に対して定義する。内部 Y が
 * 下向きのため、進行方向 t=(tx,ty) に対し
 *   右法線 rightNormal = (−ty,  tx)   （進行方向を +90° 回した向き。画面上は下側）
 *   左法線 leftNormal  = ( ty, −tx)
 * とする。北を上に描いた図面では、進行方向に対する左＝北側・右＝南側に一致する。
 */
import { EPSILON_LENGTH_MM, fromLengthMm, toLengthMm } from '@/domain/units'
import type { LengthValue, Point, Result, ValidationIssue } from '@/shared/types'

/** 測点の種別。重複生成の抑止と用途区別に用いる。 */
export type StationKind = 'start' | 'pitch' | 'vertex' | 'end'

/** 中心線上の測点。 */
export interface CenterlineStation {
  /** 起点からの累加距離（内部基準 mm）。 */
  readonly station: number
  /** 中心線上の座標（内部座標）。 */
  readonly position: Point
  /** 進行方向の単位ベクトル（内部座標）。左右オフセットの基準。 */
  readonly tangent: Point
  /** No.表記ラベル（例: "No.3" / "No.3+15.00"）。 */
  readonly label: string
  readonly kind: StationKind
}

/** 左右オフセット点。 */
export interface OffsetStation {
  readonly station: number
  readonly center: Point
  readonly left: Point
  readonly right: Point
}

export interface GenerateStationsOptions {
  /** No.区間長（省略時はピッチと同一）。 */
  readonly noInterval?: LengthValue
  /** No.表記の「+」以降を表示する単位（省略時 m）。 */
  readonly stationDisplayUnit?: LengthValue['unit']
}

/** 中心線（点列）の総延長を内部基準 mm で返す。連続する重複点は無視する。 */
export function centerlineLength(points: readonly Point[]): number {
  const vertices = dedupeVertices(points)
  let total = 0
  for (let i = 1; i < vertices.length; i++) {
    total += distance(vertices[i - 1]!, vertices[i]!)
  }
  return total
}

/**
 * 中心線に沿って測点を生成する（§12.4）。
 * 生成対象は 起点(start)・ピッチ倍数(pitch)・中間頂点(vertex)・終点(end) で、
 * station が EPSILON_LENGTH_MM 以内で一致するものは重複として1つに統合する
 * （優先度 start > end > vertex > pitch）。
 */
export function generateStations(
  points: readonly Point[],
  pitch: LengthValue,
  options: GenerateStationsOptions = {},
): Result<readonly CenterlineStation[], ValidationIssue> {
  const vertices = dedupeVertices(points)
  if (vertices.length < 2) {
    return err('centerline_too_short', '中心線には有効な2点以上が必要です')
  }

  const pitchMm = toLengthMm(pitch)
  if (!(pitchMm > EPSILON_LENGTH_MM)) {
    return err('centerline_invalid_pitch', '測点ピッチは正の距離である必要があります')
  }

  const cumulative = cumulativeLengths(vertices)
  const total = cumulative[cumulative.length - 1]!
  if (!(total > EPSILON_LENGTH_MM)) {
    return err('centerline_zero_length', '中心線の総延長がゼロです')
  }

  const noIntervalMm = options.noInterval ? toLengthMm(options.noInterval) : pitchMm
  const displayUnit = options.stationDisplayUnit ?? 'm'

  // 量子化した station(mm) をキーに、元の station 値と kind を優先度付きで統合する。
  // キーは EPSILON 相当に丸めた整数だが、station 本体は丸めない元の値を保持する。
  const priority: Record<StationKind, number> = { pitch: 0, vertex: 1, end: 2, start: 3 }
  const chosen = new Map<number, { stationMm: number; kind: StationKind }>()
  const register = (stationMm: number, kind: StationKind): void => {
    const key = quantize(stationMm)
    const existing = chosen.get(key)
    if (existing === undefined) {
      chosen.set(key, { stationMm, kind })
    } else if (priority[kind] > priority[existing.kind]) {
      chosen.set(key, { stationMm: existing.stationMm, kind })
    }
  }

  register(0, 'start')
  register(total, 'end')
  for (let i = 1; i < vertices.length - 1; i++) {
    register(cumulative[i]!, 'vertex')
  }
  for (let n = 1; n * pitchMm < total - EPSILON_LENGTH_MM; n++) {
    register(n * pitchMm, 'pitch')
  }

  const stations = [...chosen.values()]
    .map(({ stationMm, kind }) => {
      const located = locate(vertices, cumulative, stationMm)
      return {
        station: stationMm,
        position: located.position,
        tangent: located.tangent,
        label: stationLabel(stationMm, noIntervalMm, displayUnit),
        kind,
      }
    })
    .sort((a, b) => a.station - b.station)

  return { ok: true, value: stations }
}

/** 1測点の左右オフセット点を算出する。offset は片側距離（左右対称）。 */
export function offsetStation(station: CenterlineStation, offset: LengthValue): OffsetStation {
  const offsetMm = toLengthMm(offset)
  const { tangent, position } = station
  const rightNormal = { x: -tangent.y, y: tangent.x }
  const leftNormal = { x: tangent.y, y: -tangent.x }
  return {
    station: station.station,
    center: position,
    left: { x: position.x + leftNormal.x * offsetMm, y: position.y + leftNormal.y * offsetMm },
    right: { x: position.x + rightNormal.x * offsetMm, y: position.y + rightNormal.y * offsetMm },
  }
}

/** 測点列の左右オフセット点をまとめて算出する（幅員線・幅杭。FR-ALIGN-003）。 */
export function generateOffsetStations(
  stations: readonly CenterlineStation[],
  offset: LengthValue,
): readonly OffsetStation[] {
  return stations.map((station) => offsetStation(station, offset))
}

interface Located {
  readonly position: Point
  readonly tangent: Point
}

function locate(
  vertices: readonly Point[],
  cumulative: readonly number[],
  stationMm: number,
): Located {
  const total = cumulative[cumulative.length - 1]!
  // 終点は最終セグメント末端として扱う（探索の境界条件を単純化する）。
  if (stationMm >= total - EPSILON_LENGTH_MM) {
    const a = vertices[vertices.length - 2]!
    const b = vertices[vertices.length - 1]!
    return { position: b, tangent: unit(a, b) }
  }
  for (let i = 1; i < vertices.length; i++) {
    if (stationMm <= cumulative[i]! + EPSILON_LENGTH_MM) {
      const a = vertices[i - 1]!
      const b = vertices[i]!
      const segLen = cumulative[i]! - cumulative[i - 1]!
      const t = segLen > EPSILON_LENGTH_MM ? (stationMm - cumulative[i - 1]!) / segLen : 0
      return {
        position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tangent: unit(a, b),
      }
    }
  }
  const a = vertices[0]!
  const b = vertices[1]!
  return { position: a, tangent: unit(a, b) }
}

function stationLabel(stationMm: number, noIntervalMm: number, displayUnit: LengthValue['unit']): string {
  const number = Math.floor(stationMm / noIntervalMm + EPSILON_LENGTH_MM)
  const remainderMm = stationMm - number * noIntervalMm
  if (remainderMm <= EPSILON_LENGTH_MM) {
    return `No.${number}`
  }
  const plus = fromLengthMm(remainderMm, displayUnit).value
  return `No.${number}+${plus.toFixed(2)}`
}

function cumulativeLengths(vertices: readonly Point[]): number[] {
  const cumulative = [0]
  for (let i = 1; i < vertices.length; i++) {
    cumulative.push(cumulative[i - 1]! + distance(vertices[i - 1]!, vertices[i]!))
  }
  return cumulative
}

/** 連続する重複点（EPSILON 以内）を除去して有効頂点列を返す。 */
function dedupeVertices(points: readonly Point[]): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const last = result[result.length - 1]
    if (last === undefined || distance(last, point) > EPSILON_LENGTH_MM) {
      result.push(point)
    }
  }
  return result
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function unit(a: Point, b: Point): Point {
  const len = distance(a, b)
  if (len <= EPSILON_LENGTH_MM) {
    return { x: 1, y: 0 }
  }
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
}

/** station(mm) を EPSILON 相当で量子化し、近接測点を同一キーへ寄せる。 */
function quantize(stationMm: number): number {
  return Math.round(stationMm / EPSILON_LENGTH_MM)
}

function err(code: string, message: string): Result<never, ValidationIssue> {
  return { ok: false, error: { code, severity: 'error', message } }
}
