/**
 * 座標変換器。詳細設計仕様書 §9.2 の変換経路を固定実装する。
 *
 *   screen point ↕ viewport transform（pan・zoom） canvas point ↕ drawing transform（原点・軸方向・回転） domain point
 *
 * 描画コード・入力処理は独自変換式を書かず必ず本クラスを経由する（§9.2）。
 *
 * Phase 1 の drawing transform は恒等変換とする:
 * ADR-0012 により内部座標（domain）は mm・X右・Y下、Konva キャンバスも px・X右・Y下で
 * 軸方向が一致しており、図面原点オフセット・回転は未導入のため。将来、用紙原点や
 * 測量座標系（§12）を導入する際は canvasToDomain / domainToCanvas に実装を足す。
 *
 * 変換式は移植済み viewportCulling.ts / rulerUtils.ts と同一規約:
 *   domain = (screen - pan) / zoom、screen = domain * zoom + pan
 */
import type { Point } from '@/shared/types'

export interface ViewportTransform {
  /** 拡大率（screen px / domain mm）。正の有限値。 */
  readonly zoom: number
  /** パン量（screen px）。 */
  readonly panX: number
  readonly panY: number
}

export class CoordinateTransformer {
  constructor(private readonly viewport: ViewportTransform) {
    if (!Number.isFinite(viewport.zoom) || viewport.zoom <= 0) {
      throw new Error(`CoordinateTransformer: zoom must be a positive finite number, got ${viewport.zoom}`)
    }
  }

  /** screen px → canvas px（viewport transform の逆適用）。 */
  screenToCanvas(p: Point): Point {
    return {
      x: (p.x - this.viewport.panX) / this.viewport.zoom,
      y: (p.y - this.viewport.panY) / this.viewport.zoom,
    }
  }

  /** canvas px → screen px（viewport transform の適用）。 */
  canvasToScreen(p: Point): Point {
    return {
      x: p.x * this.viewport.zoom + this.viewport.panX,
      y: p.y * this.viewport.zoom + this.viewport.panY,
    }
  }

  /** canvas → domain（Phase 1 は恒等変換。将来の図面原点・回転の挿入点）。 */
  canvasToDomain(p: Point): Point {
    return p
  }

  /** domain → canvas（Phase 1 は恒等変換）。 */
  domainToCanvas(p: Point): Point {
    return p
  }

  /** screen px → domain mm（合成変換）。ポインタ座標→図形座標の標準経路。 */
  screenToDomain(p: Point): Point {
    return this.canvasToDomain(this.screenToCanvas(p))
  }

  /** domain mm → screen px（合成変換）。図形座標→描画座標の標準経路。 */
  domainToScreen(p: Point): Point {
    return this.canvasToScreen(this.domainToCanvas(p))
  }

  /**
   * screen 上の長さ（px）→ domain の長さ（mm）。
   * スナップ許容差・ヒットテスト許容ピクセルのドメイン距離換算（§9.3）に使う。
   */
  screenLengthToDomain(lengthPx: number): number {
    return lengthPx / this.viewport.zoom
  }

  /** domain の長さ（mm）→ screen 上の長さ（px）。 */
  domainLengthToScreen(lengthMm: number): number {
    return lengthMm * this.viewport.zoom
  }
}
