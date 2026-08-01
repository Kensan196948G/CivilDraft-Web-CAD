/**
 * 図面健全性チェック（詳細設計仕様書 §30 図面品質 / Issue #59）。
 *
 * 現図面（geometries + layers）を対象に、納品前に確認すべき問題を検出する。
 * - unknown-layer : 存在しないレイヤーを参照する図形（error）
 * - off-paper     : 用紙領域の外に完全に配置された図形（warning）
 * - hidden-layer  : 非表示レイヤー上の図形（info）
 *
 * 将来拡張: 未接続数量・未対応DXF要素・未承認改訂は、それぞれ quantities / dxf /
 * revisions ドメインが図面へ結線された段階で追加する。
 */
import { getPaperSizeMm, type PaperOrientation, type PaperSize } from '@/domain/canvas/paperSize'
import { shapeBBox } from '@/domain/geometry/shapeBBox'
import type { DocumentState } from '@/domain/commands/editorCommand'
import type { GeometryId } from '@/shared/types'

export type DrawingHealthIssueCode = 'unknown-layer' | 'off-paper' | 'hidden-layer'
export type DrawingHealthSeverity = 'error' | 'warning' | 'info'

export interface DrawingHealthIssue {
  readonly code: DrawingHealthIssueCode
  readonly severity: DrawingHealthSeverity
  readonly message: string
  /** 該当図形 ID（表示上限で切り詰める）。 */
  readonly geometryIds: readonly GeometryId[]
  readonly count: number
}

export interface DrawingHealthResult {
  readonly issues: readonly DrawingHealthIssue[]
  readonly geometryCount: number
  readonly layerCount: number
  /** 検出問題が 0 件かどうか。 */
  readonly healthy: boolean
}

export interface DrawingHealthOptions {
  readonly paperSize?: PaperSize
  readonly paperOrientation?: PaperOrientation
}

/** 結果に列挙する図形 ID の上限（メッセージは件数で全量を伝える）。 */
const MAX_LISTED_IDS = 20

/** 矩形の回転（rotationDeg・原点基準）を考慮した AABB を計算する。 */
function rotatedRectangleBBox(geometry: Extract<DocumentState['geometries'][number], { type: 'rectangle' }>) {
  const rad = (geometry.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    { x: geometry.origin.x, y: geometry.origin.y },
    { x: geometry.origin.x + geometry.width, y: geometry.origin.y },
    { x: geometry.origin.x + geometry.width, y: geometry.origin.y + geometry.height },
    { x: geometry.origin.x, y: geometry.origin.y + geometry.height },
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corner of corners) {
    const dx = corner.x - geometry.origin.x
    const dy = corner.y - geometry.origin.y
    const rx = geometry.origin.x + dx * cos - dy * sin
    const ry = geometry.origin.y + dx * sin + dy * cos
    minX = Math.min(minX, rx)
    minY = Math.min(minY, ry)
    maxX = Math.max(maxX, rx)
    maxY = Math.max(maxY, ry)
  }
  return { minX, minY, maxX, maxY }
}

export function checkDrawingHealth(
  document: DocumentState,
  options: DrawingHealthOptions = {},
): DrawingHealthResult {
  const { geometries, layers } = document
  const { paperSize = 'A3', paperOrientation = 'landscape' } = options
  const paper = getPaperSizeMm(paperSize, paperOrientation)
  const layerIds = new Set(layers.map((layer) => layer.id))
  const hiddenLayerIds = new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.id))

  const unknownLayer: GeometryId[] = []
  const offPaper: GeometryId[] = []
  const hiddenLayer: GeometryId[] = []

  for (const geometry of geometries) {
    if (!layerIds.has(geometry.layerId)) {
      unknownLayer.push(geometry.id)
    }
    // 矩形は描画が rotationDeg を適用するため、回転後の AABB で用紙判定する（CodeRabbit #104）。
    const bbox =
      geometry.type === 'rectangle' && geometry.rotationDeg !== 0
        ? rotatedRectangleBBox(geometry)
        : shapeBBox(geometry)
    if (bbox !== null && (bbox.maxX < 0 || bbox.minX > paper.w || bbox.maxY < 0 || bbox.minY > paper.h)) {
      offPaper.push(geometry.id)
    }
    if (hiddenLayerIds.has(geometry.layerId)) {
      hiddenLayer.push(geometry.id)
    }
  }

  const issues: DrawingHealthIssue[] = []
  if (unknownLayer.length > 0) {
    issues.push({
      code: 'unknown-layer',
      severity: 'error',
      message: `存在しないレイヤーを参照している図形が ${unknownLayer.length} 件あります`,
      geometryIds: unknownLayer.slice(0, MAX_LISTED_IDS),
      count: unknownLayer.length,
    })
  }
  if (offPaper.length > 0) {
    issues.push({
      code: 'off-paper',
      severity: 'warning',
      message: `用紙（${paperSize}・${paperOrientation}）の外に配置された図形が ${offPaper.length} 件あります`,
      geometryIds: offPaper.slice(0, MAX_LISTED_IDS),
      count: offPaper.length,
    })
  }
  if (hiddenLayer.length > 0) {
    issues.push({
      code: 'hidden-layer',
      severity: 'info',
      message: `非表示レイヤー上の図形が ${hiddenLayer.length} 件あります`,
      geometryIds: hiddenLayer.slice(0, MAX_LISTED_IDS),
      count: hiddenLayer.length,
    })
  }

  return {
    issues,
    geometryCount: geometries.length,
    layerCount: layers.length,
    healthy: issues.length === 0,
  }
}
