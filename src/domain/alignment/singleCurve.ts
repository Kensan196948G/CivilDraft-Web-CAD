/**
 * 単曲線（円曲線）の諸元計算と折れ線展開。詳細設計仕様書 §13.1。
 *
 * 座標・角度は ADR-0012 の内部基準に従う（長さ=mm、X軸右・Y軸下、角度=rad、
 * X軸正方向を0・反時計回りを正）。内部座標系はY軸下向きのため、`Math.atan2/cos/sin`
 * を内部座標へ直接適用した角度は「画面上は時計回りが正」に見える点に注意する。本モジュールは
 * 内部座標系で一貫して計算し、測量方位角（多くは北基準・時計回り）との変換層は扱わない
 * （ADR-0012 Consequences のとおり Phase 2 の別ADRで設計する）。
 *
 * 角度の公開API入力は `AngleValue`（度数法で与えてよい）とし、`toAngleRad` で内部rad表現へ
 * 正規化する（ADR-0012・詳細設計仕様書§4.1）。角度出力は内部基準の rad（`...Rad`）で返す。
 *
 * 簡易クロソイド（§13.2）は仕様正本により Phase 5 以降・別ADR確定事項であり、
 * 「Phase 1〜4 のモデルへ無理に組み込まない」と明記されているため本フェーズでは実装しない。
 */
import { EPSILON_ANGLE_RAD, EPSILON_LENGTH_MM, toAngleRad } from '@/domain/units'
import type { AngleValue, Point, Result, ValidationIssue } from '@/shared/types'

/** 曲線が進行方向に対して曲がる向き。`left`=左折、`right`=右折。 */
export type CurveDirection = 'left' | 'right'

/**
 * 単曲線の入力（IP=接線交点方式、詳細設計仕様書§13.1「始点・接線方向・半径・交角・曲線方向」）。
 * 座標は内部基準mm（ADR-0012）。
 */
export interface SingleCurveInput {
  /** 接線交点 IP（Intersection Point、内部座標mm）。 */
  readonly ip: Point
  /** バックタンジェント進行方向（IPへ向かう向き、X軸正方向=0）。 */
  readonly backTangentDirection: AngleValue
  /** 半径 R（内部mm、正値）。 */
  readonly radius: number
  /** 交角 Δ（0<Δ<180度）。バックタンジェントとフォワードタンジェントのなす偏角。 */
  readonly deflectionAngle: AngleValue
  /** 曲線方向（進行方向に対する左折/右折）。 */
  readonly direction: CurveDirection
}

/**
 * 単曲線の計算結果。座標は内部mm、角度は内部rad（ADR-0012）。
 * 記号は詳細設計仕様書§13.1に従う（T=接線長、L=曲線長、E=外線長）。
 */
export interface SingleCurve {
  /** 中心 O（内部座標mm）。 */
  readonly center: Point
  /** 半径 R（内部mm）。 */
  readonly radius: number
  /** 曲線始点 BC（Beginning of Curve、内部座標mm）。 */
  readonly bc: Point
  /** 曲線終点 EC（End of Curve、内部座標mm）。 */
  readonly ec: Point
  /** 接線交点 IP（内部座標mm）。 */
  readonly ip: Point
  /** 始角（中心O→BC の方向、内部rad）。 */
  readonly startAngleRad: number
  /** 終角（中心O→EC の方向、内部rad）。 */
  readonly endAngleRad: number
  /** 符号付き掃引角（始角→終角、内部rad）。右折で正・左折で負。 */
  readonly sweepAngleRad: number
  /** 交角 Δ（内部rad、常に正）。 */
  readonly deflectionAngleRad: number
  /** 接線長 T = R·tan(Δ/2)（mm）。 */
  readonly tangentLength: number
  /** 曲線長 L = R·Δ（mm、Δはrad）。 */
  readonly curveLength: number
  /** 外線長 E = R·(sec(Δ/2)−1)（mm、IPから曲線中央までの距離）。 */
  readonly externalLength: number
  /** 中央縦距 M = R·(1−cos(Δ/2))（mm、長弦中点から曲線中央までの距離）。 */
  readonly middleOrdinate: number
  /** 長弦 C = 2R·sin(Δ/2)（mm、BC-EC間の直線距離）。 */
  readonly longChord: number
  /** 曲線方向。 */
  readonly direction: CurveDirection
}

/** 曲線の折れ線展開オプション。`segments` 優先、無指定時は `chordToleranceMm` から分割数を決める。 */
export interface CurveExpansionOptions {
  /** 明示分割数（1以上の整数、端数は切り捨て）。 */
  readonly segments?: number
  /** 弦の最大逸脱許容差（mm、正値）。segments 未指定時に分割数決定へ使用。 */
  readonly chordToleranceMm?: number
}

/** 展開の既定弦逸脱許容差（mm）。詳細設計仕様書§11.1 の GeometryTolerance.coordinateEpsilon 相当を呼び出し側が渡せる。 */
export const DEFAULT_CHORD_TOLERANCE_MM = 1

/** 展開分割数の上限（許容差指定でも計算破綻を避けるための安全上限）。 */
export const MAX_EXPANSION_SEGMENTS = 8192

function fail(code: string, message: string, field: string): Result<SingleCurve, ValidationIssue> {
  return { ok: false, error: { code, severity: 'error', field, message } }
}

/**
 * IP・半径・交角・曲線方向から単曲線諸元（BC/EC/中心/始終角/T/L/E/M/C）を計算する。
 * 詳細設計仕様書§13.1のとおり、ゼロ半径・ほぼ0度・180度近傍を検査し Result で返す。
 */
export function computeSingleCurve(input: SingleCurveInput): Result<SingleCurve, ValidationIssue> {
  const R = input.radius
  if (!Number.isFinite(R) || R <= EPSILON_LENGTH_MM) {
    return fail('alignment_curve_radius_non_positive', '半径は正の値である必要があります', 'radius')
  }

  const delta = toAngleRad(input.deflectionAngle)
  if (!Number.isFinite(delta) || delta <= EPSILON_ANGLE_RAD) {
    return fail('alignment_curve_deflection_too_small', '交角が0度に近すぎます', 'deflectionAngle')
  }
  if (delta >= Math.PI - EPSILON_ANGLE_RAD) {
    return fail('alignment_curve_deflection_too_large', '交角が180度に近すぎます', 'deflectionAngle')
  }

  const back = toAngleRad(input.backTangentDirection)
  // 右折=内部座標系（Y下）で正方向の回転（画面上は時計回り）。左折はその逆。
  const turnSign = input.direction === 'right' ? 1 : -1

  const halfDelta = delta / 2
  const tangentLength = R * Math.tan(halfDelta)
  const curveLength = R * delta
  const externalLength = R * (1 / Math.cos(halfDelta) - 1)
  const middleOrdinate = R * (1 - Math.cos(halfDelta))
  const longChord = 2 * R * Math.sin(halfDelta)

  // BC: IP からバックタンジェントを接線長ぶん戻った点。
  const bc: Point = {
    x: input.ip.x - Math.cos(back) * tangentLength,
    y: input.ip.y - Math.sin(back) * tangentLength,
  }
  // フォワードタンジェント方向 = バックタンジェントを交角ぶん回した向き。
  const forward = back + turnSign * delta
  const ec: Point = {
    x: input.ip.x + Math.cos(forward) * tangentLength,
    y: input.ip.y + Math.sin(forward) * tangentLength,
  }
  // 中心: BC における接線の法線方向（曲がる側）へ半径ぶん。
  const centerAngle = back + turnSign * (Math.PI / 2)
  const center: Point = {
    x: bc.x + Math.cos(centerAngle) * R,
    y: bc.y + Math.sin(centerAngle) * R,
  }

  const startAngleRad = Math.atan2(bc.y - center.y, bc.x - center.x)
  const endAngleRad = Math.atan2(ec.y - center.y, ec.x - center.x)

  return {
    ok: true,
    value: {
      center,
      radius: R,
      bc,
      ec,
      ip: input.ip,
      startAngleRad,
      endAngleRad,
      sweepAngleRad: turnSign * delta,
      deflectionAngleRad: delta,
      tangentLength,
      curveLength,
      externalLength,
      middleOrdinate,
      longChord,
      direction: input.direction,
    },
  }
}

/** 展開分割数を決定する（segments 明示 > chordToleranceMm 由来、いずれも1以上・上限クランプ）。 */
function resolveSegmentCount(curve: SingleCurve, options: CurveExpansionOptions): number {
  if (options.segments !== undefined) {
    const n = Math.floor(options.segments)
    return Math.min(MAX_EXPANSION_SEGMENTS, Math.max(1, n))
  }
  const tol =
    options.chordToleranceMm !== undefined && options.chordToleranceMm > 0
      ? options.chordToleranceMm
      : DEFAULT_CHORD_TOLERANCE_MM
  // 弦逸脱（サジタ）s = R(1−cos(θ/2)) ≤ tol → θ ≤ 2·acos(1 − tol/R)。
  const ratio = 1 - tol / curve.radius
  if (ratio <= -1) return 1
  const maxSegmentAngle = 2 * Math.acos(Math.min(1, ratio))
  if (maxSegmentAngle <= EPSILON_ANGLE_RAD) return MAX_EXPANSION_SEGMENTS
  const n = Math.ceil(Math.abs(curve.sweepAngleRad) / maxSegmentAngle)
  return Math.min(MAX_EXPANSION_SEGMENTS, Math.max(1, n))
}

/**
 * 単曲線を折れ線（点列）へ展開する。始点は必ず BC、終点は必ず EC で、中間点は
 * 掃引角を等分した円周上の点。詳細設計仕様書§13の曲線展開に相当する。
 * 返り値の点数は分割数 n に対して n+1（両端含む）。
 */
export function expandCurve(
  curve: SingleCurve,
  options: CurveExpansionOptions = {},
): readonly Point[] {
  const n = resolveSegmentCount(curve, options)
  const points: Point[] = []
  for (let i = 0; i <= n; i++) {
    const angle = curve.startAngleRad + (curve.sweepAngleRad * i) / n
    points.push({
      x: curve.center.x + curve.radius * Math.cos(angle),
      y: curve.center.y + curve.radius * Math.sin(angle),
    })
  }
  return points
}
