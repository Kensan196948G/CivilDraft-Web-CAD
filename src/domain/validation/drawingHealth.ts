/**
 * 図面健全性チェック（詳細設計仕様書 §30 図面品質 / Issue #59）。
 *
 * 現図面（geometries + layers）を対象に、納品前に確認すべき問題を検出する。
 * - unknown-layer : 存在しないレイヤーを参照する図形（error）
 * - off-paper     : 用紙領域の外に完全に配置された図形（warning）
 * - hidden-layer  : 非表示レイヤー上の図形（info）
 * - unlinked-quantity : 根拠図形が存在しない（または0件の）数量明細（error）
 * - stale-quantity    : 再計算待ち（stale）または算出不能（invalid）の数量明細（warning）
 * - unsupported-dxf   : DXF取込時に未対応として記録された要素・単位（warning）
 * - default-layer     : デフォルトレイヤー（既定 "0"）上の図形（info）
 * - unapproved-revision : 未承認の改訂が存在する（warning）
 */
import { getPaperSizeMm, type PaperOrientation, type PaperSize } from '@/domain/canvas/paperSize'
import { shapeBBox } from '@/domain/geometry/shapeBBox'
import type { DocumentState } from '@/domain/commands/editorCommand'
import type { GeometryId, QuantityItem, ValidationIssue } from '@/shared/types'

export type DrawingHealthIssueCode =
  | 'unknown-layer'
  | 'off-paper'
  | 'hidden-layer'
  | 'unlinked-quantity'
  | 'stale-quantity'
  | 'unsupported-dxf'
  | 'default-layer'
  | 'unapproved-revision'
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

/**
 * 図面に紐づく周辺ドメインの状態（Issue #59 第二弾）。
 * 呼び出し側（エディタ・クラウド読込・DXF取込画面）が持っている情報だけを渡し、
 * 渡されないチェックは結果に含めない（既存呼び出しの互換性を保つ）。
 */
export interface DrawingHealthContext {
  /** 数量明細（未接続・stale/invalid 検出）。 */
  readonly quantities?: readonly QuantityItem[]
  /** DXF 取込時の ValidationIssue（未対応要素・単位の検出）。 */
  readonly dxfIssues?: readonly ValidationIssue[]
  /** 未承認の改訂件数（呼び出し側で改訂状態から集計）。 */
  readonly unapprovedRevisionCount?: number
  /** デフォルトレイヤーとして扱うレイヤー名（既定 "0"、Jw_cad互換）。 */
  readonly defaultLayerName?: string
}

/** 結果に列挙する図形 ID の上限（メッセージは件数で全量を伝える）。 */
const MAX_LISTED_IDS = 20

/** DXF 取込で「未対応」として記録される ValidationIssue コード群。 */
const UNSUPPORTED_DXF_CODES: ReadonlySet<string> = new Set([
  'dxf-unsupported-entity',
  'dxf-unsupported-unit',
])

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
  context: DrawingHealthContext = {},
): DrawingHealthResult {
  const { geometries, layers } = document
  const { paperSize = 'A3', paperOrientation = 'landscape' } = options
  const { quantities = [], dxfIssues = [], unapprovedRevisionCount = 0, defaultLayerName = '0' } = context
  const paper = getPaperSizeMm(paperSize, paperOrientation)
  const layerIds = new Set(layers.map((layer) => layer.id))
  const hiddenLayerIds = new Set(layers.filter((layer) => !layer.visible).map((layer) => layer.id))
  const layerNameById = new Map(layers.map((layer) => [layer.id, layer.name]))

  const unknownLayer: GeometryId[] = []
  const offPaper: GeometryId[] = []
  const hiddenLayer: GeometryId[] = []
  const defaultLayer: GeometryId[] = []

  for (const geometry of geometries) {
    if (!layerIds.has(geometry.layerId)) {
      unknownLayer.push(geometry.id)
    }
    if (layerNameById.get(geometry.layerId) === defaultLayerName) {
      defaultLayer.push(geometry.id)
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

  // --- 数量明細（Issue #59 第二弾） ---
  const geometryIdSet = new Set<GeometryId>(geometries.map((g) => g.id))
  const unlinkedQuantityItems: QuantityItem[] = []
  const staleQuantityItems: QuantityItem[] = []
  for (const item of quantities) {
    const hasMissingSource = item.sources.length === 0 || item.sources.some((s) => !geometryIdSet.has(s.geometryId))
    if (hasMissingSource) unlinkedQuantityItems.push(item)
    if (item.status === 'stale' || item.status === 'invalid') staleQuantityItems.push(item)
  }
  if (unlinkedQuantityItems.length > 0) {
    const missingIds = [
      ...new Set(
        unlinkedQuantityItems.flatMap((item) => item.sources.map((s) => s.geometryId).filter((id) => !geometryIdSet.has(id))),
      ),
    ]
    issues.push({
      code: 'unlinked-quantity',
      severity: 'error',
      message: `根拠図形が存在しない数量明細が ${unlinkedQuantityItems.length} 件あります（再計算が必要です）`,
      geometryIds: missingIds.slice(0, MAX_LISTED_IDS),
      count: unlinkedQuantityItems.length,
    })
  }
  if (staleQuantityItems.length > 0) {
    issues.push({
      code: 'stale-quantity',
      severity: 'warning',
      message: `再計算待ちまたは算出不能の数量明細が ${staleQuantityItems.length} 件あります`,
      geometryIds: [],
      count: staleQuantityItems.length,
    })
  }

  // --- DXF 取込時の未対応要素・単位（Issue #59 第二弾） ---
  const unsupportedDxf = dxfIssues.filter((issue) => UNSUPPORTED_DXF_CODES.has(issue.code))
  if (unsupportedDxf.length > 0) {
    issues.push({
      code: 'unsupported-dxf',
      severity: 'warning',
      message: `DXF取込時に未対応として記録された要素・単位が ${unsupportedDxf.length} 件あります`,
      geometryIds: [],
      count: unsupportedDxf.length,
    })
  }

  // --- デフォルトレイヤー（Issue #59 第二弾） ---
  if (defaultLayer.length > 0) {
    issues.push({
      code: 'default-layer',
      severity: 'info',
      message: `デフォルトレイヤー「${defaultLayerName}」上の図形が ${defaultLayer.length} 件あります`,
      geometryIds: defaultLayer.slice(0, MAX_LISTED_IDS),
      count: defaultLayer.length,
    })
  }

  // --- 未承認改訂（Issue #59 第二弾） ---
  if (unapprovedRevisionCount > 0) {
    issues.push({
      code: 'unapproved-revision',
      severity: 'warning',
      message: `承認済みでない改訂が ${unapprovedRevisionCount} 件あります（提出前に照査・承認が必要です）`,
      geometryIds: [],
      count: unapprovedRevisionCount,
    })
  }

  return {
    issues,
    geometryCount: geometries.length,
    layerCount: layers.length,
    healthy: issues.length === 0,
  }
}
