/**
 * グリッド線の描画位置を計算する純粋関数。
 * 継承元: Civil-Draw src/canvas/gridRenderer.ts（継承台帳 modify、Canvas描画補助）。
 *
 * 配置判断: domain/canvas（framework非依存）。詳細設計仕様書§2.1により domain層は
 * React/Konva に依存できない（eslint no-restricted-imports で強制）。継承元は Konva.Layer を
 * 直接 destroyChildren / add / batchDraw する破壊的副作用を持っていたため、その副作用を排し、
 * 「どの位置に・どの種別（minor/major）・どの向きの線を引くか」だけを返す純粋関数へ分離した。
 * Konva.Layer への実描画（stroke色・線幅の適用を含む）はレンダリング層（Issue #6）が本関数の
 * 出力を消費して行う。
 *
 * 座標系: world = (screen - pan) / zoom（screen = world*zoom + pan）。移植済み rulerUtils.ts /
 * viewportCulling.ts と同一規約。ルーラー目盛りとグリッド線がピクセル一致するよう、目盛りと同じ
 * Math.floor(worldStart/interval)*interval のワールド整列アルゴリズムを用いる。
 *
 * 継承元との差分:
 * - 戻り値を GridLine[]（canvas px 座標 + 種別 + 向き）に変更。stroke色/線幅はレンダリング層へ移譲。
 * - LOD 閾値（minor: gridSize*zoom>=4、major: majorInterval*zoom>=8）は as_is で保全。
 * - minor を先・major を後に格納する順序（重なり位置で major が上書き描画されるための描画順）も保全。
 */

export interface GridConfig {
  readonly width: number
  readonly height: number
  /** minor grid 間隔（world単位=mm）。 */
  readonly gridSize: number
  readonly zoom: number
  readonly panX: number
  readonly panY: number
  /** x=0 からこの canvas-px 以内のグリッド線を省く（ルーラー領域回避）。既定0。 */
  readonly minCanvasX?: number
  /** y=0 からこの canvas-px 以内のグリッド線を省く（ルーラー領域回避）。既定0。 */
  readonly minCanvasY?: number
  /** major grid 間隔（world単位）。設定時、N単位ごとに太線（major）を引く。 */
  readonly majorInterval?: number
}

export interface GridLine {
  /** canvas px の [x1, y1, x2, y2]。 */
  readonly points: readonly [number, number, number, number]
  readonly kind: 'minor' | 'major'
  readonly orientation: 'vertical' | 'horizontal'
}

/** グリッド線（minor→majorの順）を計算して返す。実描画・配色はレンダリング層が担う。 */
export function computeGridLines(config: GridConfig): readonly GridLine[] {
  const { width, height, gridSize, zoom, panX, panY } = config
  const minX = config.minCanvasX ?? 0
  const minY = config.minCanvasY ?? 0
  const lines: GridLine[] = []

  const addVertical = (interval: number, kind: 'minor' | 'major'): void => {
    const worldLeft = -panX / zoom
    const worldRight = (width - panX) / zoom
    const startW = Math.floor(worldLeft / interval) * interval
    for (let w = startW; w <= worldRight + interval; w += interval) {
      const sx = w * zoom + panX
      if (sx < minX) continue
      if (sx > width) break
      lines.push({ points: [sx, minY, sx, height], kind, orientation: 'vertical' })
    }
  }

  const addHorizontal = (interval: number, kind: 'minor' | 'major'): void => {
    const worldTop = -panY / zoom
    const worldBottom = (height - panY) / zoom
    const startW = Math.floor(worldTop / interval) * interval
    for (let w = startW; w <= worldBottom + interval; w += interval) {
      const sy = w * zoom + panY
      if (sy < minY) continue
      if (sy > height) break
      lines.push({ points: [minX, sy, width, sy], kind, orientation: 'horizontal' })
    }
  }

  // minor grid（先に格納）
  if (gridSize * zoom >= 4) {
    addVertical(gridSize, 'minor')
    addHorizontal(gridSize, 'minor')
  }

  // major grid（後に格納。重なり位置で major が minor を上書きする描画順を表す）
  const major = config.majorInterval
  if (major !== undefined && major > 0 && major * zoom >= 8) {
    addVertical(major, 'major')
    addHorizontal(major, 'major')
  }

  return lines
}
