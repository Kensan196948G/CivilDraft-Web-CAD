/**
 * ルーラー（定規）の目盛り計算ユーティリティ。ズームレベルに応じた人間に読みやすい
 * 目盛り間隔（1-2-5系列）を選び、水平/垂直ルーラーの目盛り位置とワールド座標値を返す。
 * 継承元: Civil-Draw src/utils/rulerUtils.ts（継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: 図形型に依存しない純粋計算のため domain/canvas に置く。Konva等の描画層統合は
 * Issue #6で別途扱い、本ファイルはロジックのみを持つ（描画副作用なし）。
 *
 * 座標系: ADR-0012（mm単位・X軸右方向・Y軸下方向）。
 * world座標 = (screen座標 - pan) / zoom（逆にscreen = world * zoom + pan）。この変換規約は
 * 移植済みviewportCulling.tsと一致することを確認済み。垂直ルーラーの値はY軸下方向のため
 * 画面下へ向かって増加する。
 *
 * 継承元との差分:
 * - アルゴリズムはas_isで忠実に移植。RulerTickインターフェースのフィールドをreadonly化した。
 */

export interface RulerTick {
  /** 画面座標（px）。 */
  readonly pos: number
  /** ワールド座標値（mm）。 */
  readonly value: number
}

/** 指定ズームレベルに対する、人間に読みやすい目盛り間隔（1-2-5-10系列）を選ぶ。 */
export function calcTickInterval(zoom: number, minPxSpacing = 50): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const safeSpacing = Number.isFinite(minPxSpacing) && minPxSpacing > 0 ? minPxSpacing : 50
  const rawInterval = safeSpacing / safeZoom
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawInterval, 1e-9))))
  const normalized = rawInterval / mag
  let interval: number
  if (normalized < 1.5) interval = mag
  else if (normalized < 3.5) interval = 2 * mag
  else if (normalized < 7.5) interval = 5 * mag
  else interval = 10 * mag
  return interval
}

/** 水平ルーラーの目盛りを生成する（画面幅width内に収まる目盛りのみ）。 */
export function calcHorizontalTicks(
  panX: number,
  zoom: number,
  width: number,
  minPxSpacing = 50,
): readonly RulerTick[] {
  const interval = calcTickInterval(zoom, minPxSpacing)
  const worldLeft = -panX / zoom
  const worldRight = (width - panX) / zoom
  const start = Math.floor(worldLeft / interval) * interval
  const ticks: RulerTick[] = []
  for (let w = start; w <= worldRight + interval; w += interval) {
    const screenX = w * zoom + panX
    if (screenX >= 0 && screenX <= width) {
      ticks.push({ pos: screenX, value: w })
    }
  }
  return ticks
}

/** 垂直ルーラーの目盛りを生成する（画面高さheight内に収まる目盛りのみ）。 */
export function calcVerticalTicks(
  panY: number,
  zoom: number,
  height: number,
  minPxSpacing = 50,
): readonly RulerTick[] {
  const interval = calcTickInterval(zoom, minPxSpacing)
  const worldTop = -panY / zoom
  const worldBottom = (height - panY) / zoom
  const start = Math.floor(worldTop / interval) * interval
  const ticks: RulerTick[] = []
  for (let w = start; w <= worldBottom + interval; w += interval) {
    const screenY = w * zoom + panY
    if (screenY >= 0 && screenY <= height) {
      ticks.push({ pos: screenY, value: w })
    }
  }
  return ticks
}

/** 目盛りラベルの表示文字列を作る（1e6以上=M、1e3以上=k、それ未満=整数丸め）。 */
export function formatTickValue(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.round(value).toString()
}
