/**
 * 作図ツールのドラフト（作図途中の点列）から Geometry を構築する純粋関数群（詳細設計仕様書 §8.1）。
 * 継承元: Civil-Draw src/hooks/useTool.ts + src/store/toolStore.ts（継承台帳 modify、作図ツール状態機械）。
 *
 * 継承元との差分:
 * - 継承元は 800 行の toolStore（シングルトン）+ useTool フックで、内部に「点列→図形」構築・
 *   nanoid 発番・store 直接書き込みが混在していた。本設計はそれを 3 層へ分離する:
 *     1. 本ファイル（純粋関数）: 点列 → 図形固有フィールド、および途中プレビュー図形の合成。
 *     2. EditorStore.ToolSlice（editorStore.ts）: activate/addPoint/commit/cancel の状態機械。
 *     3. AddGeometryCommand（geometryCommands.ts）: 履歴・監査ログ（ADR-0009）への接続。
 * - ID 発番・タイムスタンプは ADR-0013 の GeometryCreationContext 注入に委ね、本ファイルは発番しない。
 * - 角度は ADR-0012 の度（Deg）。rectangle は対角 2 点指定・軸並行のため rotationDeg=0 固定。
 * - 座標は mm 単位・X 右/Y 下（本ファイルは座標変換を行わない。screen→domain 変換は呼び出し側の責務）。
 */
import type {
  ArcGeometry,
  CircleGeometry,
  CloudGeometry,
  DimensionGeometry,
  EllipseGeometry,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  LeaderGeometry,
  LineGeometry,
  MLineGeometry,
  Point,
  PolylineGeometry,
  RectangleGeometry,
  SplineGeometry,
} from '@/shared/types'
import { resolveDimOrientation } from '@/domain/geometry/dimensionEngine'

export type ToolType =
  | 'select'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'ellipse'
  | 'polyline'
  | 'spline'
  | 'cloud'
  | 'mline'
  | 'text'
  | 'dimension'
  | 'leader'
  | 'hatch'
  | 'measure'

/**
 * クリック点数の到達で自動確定するツールと、その必要点数。
 * ここに無いツール（polyline は commitDraft で明示確定、select は作図しない）は自動確定しない。
 */
export const AUTO_COMMIT_POINT_COUNT: Partial<Record<ToolType, number>> = {
  line: 2,
  rectangle: 2,
  circle: 2,
  arc: 3,
  ellipse: 2,
  leader: 2,
  cloud: 2,
  mline: 2,
  dimension: 2,
}

/** 途中プレビュー図形に付与する固定 ID（描画専用・永続化しない）。 */
export const DRAFT_PREVIEW_ID = 'draft-preview' as GeometryId

/** プレビュー図形の固定タイムスタンプ（永続化されないため実時刻は不要・決定的にする）。 */
const DRAFT_PREVIEW_TIMESTAMP = '1970-01-01T00:00:00.000Z'

/**
 * ツール別の図形固有フィールド（GeometryBase を除いた、各図形の本体部分）。
 * GeometryBase（id/layerId/style/タイムスタンプ等）は呼び出し側が composeDraftGeometry で合成する。
 */
export type DraftShapeFields =
  | Pick<LineGeometry, 'type' | 'start' | 'end'>
  | Pick<RectangleGeometry, 'type' | 'origin' | 'width' | 'height' | 'rotationDeg'>
  | Pick<CircleGeometry, 'type' | 'center' | 'radius'>
  | Pick<ArcGeometry, 'type' | 'center' | 'radius' | 'startAngleDeg' | 'endAngleDeg'>
  | Pick<EllipseGeometry, 'type' | 'center' | 'radiusX' | 'radiusY' | 'rotationDeg'>
  | Pick<PolylineGeometry, 'type' | 'points' | 'closed'>
  | Pick<SplineGeometry, 'type' | 'points' | 'tension'>
  | Pick<CloudGeometry, 'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'arcSize'>
  | Pick<MLineGeometry, 'type' | 'start' | 'end' | 'offset'>
  | Pick<LeaderGeometry, 'type' | 'start' | 'end' | 'text' | 'textHeight'>
  | Pick<DimensionGeometry, 'type' | 'start' | 'end' | 'orientation' | 'offset' | 'textHeight' | 'arrowSize'>

/** GeometryBase 合成に必要な素材（ID・レイヤー・配色・タイムスタンプ）。 */
export interface DraftGeometryBase {
  readonly id: GeometryId
  readonly layerId: LayerId
  readonly style: GeometryStyle
  readonly createdAt: string
  readonly updatedAt: string
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * 始点・終点の 2 点から線分フィールドを作る。
 * 点不足（<2）またはゼロ長（始終点一致）の場合は null（退化図形は生成しない）。
 */
export function makeLineDraft(points: readonly Point[]): Pick<LineGeometry, 'type' | 'start' | 'end'> | null {
  const [start, end] = points
  if (start === undefined || end === undefined) return null
  if (start.x === end.x && start.y === end.y) return null
  return { type: 'line', start, end }
}

/**
 * 対角 2 点から軸並行の矩形フィールドを作る。
 * 負サイズは正規化し（origin=最小コーナー、width/height は絶対値）、rotationDeg=0 固定。
 * 点不足またはゼロ面積（幅か高さが 0）の場合は null。
 */
export function makeRectangleDraft(
  points: readonly Point[],
): Pick<RectangleGeometry, 'type' | 'origin' | 'width' | 'height' | 'rotationDeg'> | null {
  const [a, b] = points
  if (a === undefined || b === undefined) return null
  const width = Math.abs(b.x - a.x)
  const height = Math.abs(b.y - a.y)
  if (width === 0 || height === 0) return null
  return {
    type: 'rectangle',
    origin: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    width,
    height,
    rotationDeg: 0,
  }
}

/**
 * 中心点＋半径点の 2 点から円フィールドを作る（半径 = 2 点間の距離）。
 * 点不足または半径 0 の場合は null。
 */
export function makeCircleDraft(points: readonly Point[]): Pick<CircleGeometry, 'type' | 'center' | 'radius'> | null {
  const [center, edge] = points
  if (center === undefined || edge === undefined) return null
  const radius = distance(center, edge)
  if (radius === 0) return null
  return { type: 'circle', center, radius }
}

/**
 * 中心・半径点・終点角度点の 3 点から円弧フィールドを作る。
 * 角度は ADR-0012 の度数法（X 軸正=0°、Y 軸下方向を正=時計回り）。
 * 点不足または半径 0 の場合は null。
 */
export function makeArcDraft(
  points: readonly Point[],
): Pick<ArcGeometry, 'type' | 'center' | 'radius' | 'startAngleDeg' | 'endAngleDeg'> | null {
  const [center, radiusPoint, endPoint] = points
  if (center === undefined || radiusPoint === undefined || endPoint === undefined) return null
  const radius = distance(center, radiusPoint)
  if (radius === 0) return null
  const angleOf = (p: Point): number => {
    // canvas 系（Y 下）では atan2(dy, dx) がそのまま画面時計回りの角度（°）になる。
    return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI
  }
  return {
    type: 'arc',
    center,
    radius,
    startAngleDeg: angleOf(radiusPoint),
    endAngleDeg: angleOf(endPoint),
  }
}

/**
 * 中心＋半径点の 2 点から楕円フィールドを作る（radiusX=|dx|, radiusY=|dy|、回転 0）。
 * 点不足またはどちらかの半径 0 の場合は null。
 */
export function makeEllipseDraft(
  points: readonly Point[],
): Pick<EllipseGeometry, 'type' | 'center' | 'radiusX' | 'radiusY' | 'rotationDeg'> | null {
  const [center, edge] = points
  if (center === undefined || edge === undefined) return null
  const radiusX = Math.abs(edge.x - center.x)
  const radiusY = Math.abs(edge.y - center.y)
  if (radiusX === 0 || radiusY === 0) return null
  return { type: 'ellipse', center, radiusX, radiusY, rotationDeg: 0 }
}

/**
 * 確定点列から折れ線フィールドを作る（2 点以上、closed=false）。1 点以下は null。
 * points はスナップショットとしてコピーする（呼び出し側配列の後続変更から独立させる）。
 */
export function makePolylineDraft(
  points: readonly Point[],
): Pick<PolylineGeometry, 'type' | 'points' | 'closed'> | null {
  if (points.length < 2) return null
  return { type: 'polyline', points: [...points], closed: false }
}

/**
 * 確定点列からスプライン曲線フィールドを作る（2 点以上、tension=0.5）。
 * 1 点以下は null。points はスナップショットとしてコピーする。
 */
export function makeSplineDraft(
  points: readonly Point[],
): Pick<SplineGeometry, 'type' | 'points' | 'tension'> | null {
  if (points.length < 2) return null
  return { type: 'spline', points: [...points], tension: 0.5 }
}

/**
 * 対角 2 点から改訂雲マークの外接矩形フィールドを作る（arcSize=15、Civil-Draw 踏襲）。
 */
export function makeCloudDraft(
  points: readonly Point[],
): Pick<CloudGeometry, 'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'arcSize'> | null {
  const [a, b] = points
  if (a === undefined || b === undefined) return null
  if (a.x === b.x && a.y === b.y) return null
  return {
    type: 'cloud',
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    arcSize: 15,
  }
}

/**
 * 始点・終点の 2 点から平行 2 線フィールドを作る（offset=10、Civil-Draw 踏襲）。
 * 点不足またはゼロ長の場合は null。
 */
export function makeMlineDraft(
  points: readonly Point[],
): Pick<MLineGeometry, 'type' | 'start' | 'end' | 'offset'> | null {
  const [start, end] = points
  if (start === undefined || end === undefined) return null
  if (start.x === end.x && start.y === end.y) return null
  return { type: 'mline', start, end, offset: 10 }
}

/**
 * 始点・終点の 2 点から引出線フィールドを作る。
 * テキストは既定値「注記」とし、選択後のプロパティ編集で変更できる（Civil-Draw は
 * window.prompt で入力していたが、アクセシビリティ・テスト容易性のため入力欄方式へ変更）。
 */
export function makeLeaderDraft(
  points: readonly Point[],
): Pick<LeaderGeometry, 'type' | 'start' | 'end' | 'text' | 'textHeight'> | null {
  const [start, end] = points
  if (start === undefined || end === undefined) return null
  if (start.x === end.x && start.y === end.y) return null
  return { type: 'leader', start, end, text: '注記', textHeight: 14 }
}

function makeDimensionDraft(
  points: readonly Point[],
): Pick<DimensionGeometry, 'type' | 'start' | 'end' | 'orientation' | 'offset' | 'textHeight' | 'arrowSize'> | null {
  const [start, end] = points
  if (start === undefined || end === undefined) return null
  if (start.x === end.x && start.y === end.y) return null
  const orientation = resolveDimOrientation('auto', start, end)
  return {
    type: 'dimension',
    start,
    end,
    orientation,
    offset: 50,
    textHeight: 12,
    arrowSize: 8,
  }
}

/**
 * ツール種別に対応するメーカーへ点列をディスパッチし、図形固有フィールドを得る。
 * 自動確定ツール（line/rectangle/circle）・polyline を横断的に扱う単一の入口。
 * select は作図しないため常に null。
 */
export function buildDraftFields(tool: ToolType, points: readonly Point[]): DraftShapeFields | null {
  switch (tool) {
    case 'line':
      return makeLineDraft(points)
    case 'rectangle':
      return makeRectangleDraft(points)
    case 'circle':
      return makeCircleDraft(points)
    case 'arc':
      return makeArcDraft(points)
    case 'ellipse':
      return makeEllipseDraft(points)
    case 'polyline':
      return makePolylineDraft(points)
    case 'spline':
      return makeSplineDraft(points)
    case 'cloud':
      return makeCloudDraft(points)
    case 'mline':
      return makeMlineDraft(points)
    case 'leader':
      return makeLeaderDraft(points)
    case 'dimension':
      return makeDimensionDraft(points)
    case 'select':
    case 'text':
    case 'hatch':
    case 'measure':
      return null
    default: {
      const exhaustive: never = tool
      throw new Error(`未知の作図ツール種別: ${String(exhaustive)}`)
    }
  }
}

/**
 * 図形固有フィールドと GeometryBase 素材を結合し、完全な Geometry を合成する。
 * switch は判別可能ユニオンの絞り込み（noUncheckedIndexedAccess + strict 下の型安全）を目的とする。
 */
export function composeDraftGeometry(fields: DraftShapeFields, base: DraftGeometryBase): Geometry {
  const common: Omit<GeometryBase, 'type'> = {
    id: base.id,
    layerId: base.layerId,
    style: base.style,
    constructionStepIds: [],
    locked: false,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  }
  switch (fields.type) {
    case 'line':
      return { ...common, ...fields }
    case 'rectangle':
      return { ...common, ...fields }
    case 'circle':
      return { ...common, ...fields }
    case 'arc':
      return { ...common, ...fields }
    case 'ellipse':
      return { ...common, ...fields }
    case 'polyline':
      return { ...common, ...fields }
    case 'spline':
      return { ...common, ...fields }
    case 'cloud':
      return { ...common, ...fields }
    case 'mline':
      return { ...common, ...fields }
    case 'leader':
      return { ...common, ...fields }
    case 'dimension':
      return { ...common, ...fields }
    default: {
      const exhaustive: never = fields
      throw new Error(`未知の作図フィールド種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** buildDraftPreview の入力（作図中の状態 + レイヤー由来の描画属性）。 */
export interface DraftPreviewInput {
  readonly tool: ToolType
  readonly draftPoints: readonly Point[]
  readonly draftCursor: Point | null
  readonly layerId: LayerId
  readonly style: GeometryStyle
}

/**
 * 作図途中のプレビュー図形を合成する（§8.1・§9.1 GuideLayer の isPreview 描画用）。
 * 確定済み点列 draftPoints に現在のカーソル位置 draftCursor を「次の点」として連結し、
 * 途中図形を組む。カーソル未設定・select ツール・退化形状の場合は null。
 * id は固定（DRAFT_PREVIEW_ID）で、履歴・空間索引には登録しない。
 */
export function buildDraftPreview(input: DraftPreviewInput): Geometry | null {
  const { tool, draftPoints, draftCursor } = input
  if (tool === 'select' || draftCursor === null) return null
  const fields = buildDraftFields(tool, [...draftPoints, draftCursor])
  if (fields === null) return null
  return composeDraftGeometry(fields, {
    id: DRAFT_PREVIEW_ID,
    layerId: input.layerId,
    style: input.style,
    createdAt: DRAFT_PREVIEW_TIMESTAMP,
    updatedAt: DRAFT_PREVIEW_TIMESTAMP,
  })
}
