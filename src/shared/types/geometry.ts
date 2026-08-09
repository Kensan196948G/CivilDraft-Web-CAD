import type { ConstructionStepId, GeometryId, LayerId } from './brand'

/**
 * 詳細設計仕様書 §4.1 座標点
 * ADR-0012: 内部座標基準はmm単位の素number・X軸右方向・Y軸下方向。
 * Pointは内部演算専用の値型であり、domain/unitsの単位変換を経由しない
 * （変換が必要になるのはUI表示・DXF入出力などAPI境界のみ）。
 * 詳細設計仕様書の型名はPoint2Dだが、既存実装（本ファイル）はPointを正本とする
 * （Issue #20コメントでPoint維持を決定済み）。
 */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * 詳細設計仕様書 §6 図形データモデル
 * 図形の線種・色・印刷可否などの表示属性。図形本体（座標）とは分離する。
 */
export interface GeometryStyle {
  readonly strokeColor: string
  readonly strokeWidth: number
  readonly lineType: 'continuous' | 'dashed' | 'dashDot' | 'double'
  readonly fillColor?: string
  readonly opacity: number
  readonly printable: boolean
}

/**
 * 詳細設計仕様書 §6 図形データモデル
 * 全図形共通の基底フィールド。civilAttributeIdは土木属性拡張への任意リンク、
 * constructionStepIdsは出来形（施工ステップ）との紐付けを表す。
 */
export interface GeometryBase {
  readonly id: GeometryId
  readonly layerId: LayerId
  readonly type: GeometryType
  readonly style: GeometryStyle
  readonly civilAttributeId?: string
  readonly constructionStepIds: readonly ConstructionStepId[]
  readonly locked: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 詳細設計仕様書 §6 図形データモデル
 * 13種類の図形種別。switch文の網羅性検査（exhaustiveness check）の基盤となる判別子。
 */
export type GeometryType =
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
  | 'symbol'
  | 'parametricObject'

export interface LineGeometry extends GeometryBase {
  readonly type: 'line'
  readonly start: Point
  readonly end: Point
}

export interface CircleGeometry extends GeometryBase {
  readonly type: 'circle'
  readonly center: Point
  readonly radius: number
}

export interface PolylineGeometry extends GeometryBase {
  readonly type: 'polyline'
  readonly points: readonly Point[]
  readonly closed: boolean
}

export interface TextGeometry extends GeometryBase {
  readonly type: 'text'
  readonly anchor: Point
  readonly text: string
  readonly height: number
  readonly rotationDeg: number
  readonly horizontalAlign: 'left' | 'center' | 'right'
}

/**
 * 継承元: Civil-Draw ArcShape（cx/cy/radius/startAngle/endAngle）。
 * 角度はADR-0012のTextGeometry.rotationDegに倣いdegサフィックスで統一する。
 *
 * 円弧の掃引方向（ADR-0012 §3.1）:
 * - 角度は数学的規約: 度数法（deg）、X軸正方向を0°、Y軸下方向（画面下）を正方向（時計回り）とする。
 * - 円弧は startAngleDeg から endAngleDeg まで Y軸下方向へ掃引する。
 * - 例: startAngleDeg=0, endAngleDeg=90 は X軸正方向から 90° CW（画面下方向）へ掃引する弧。
 * - この規約は GeometryRenderer と pdfExporter で一貫して適用される。
 * - radToDeg/degToRad の変換が必要なのは filletEngine 等の Math.atan2 出力（ラジアン）のみ。
 */
export interface ArcGeometry extends GeometryBase {
  readonly type: 'arc'
  readonly center: Point
  readonly radius: number
  readonly startAngleDeg: number
  readonly endAngleDeg: number
}

/**
 * 継承元: Civil-Draw RectShape（x/y/width/height/rotation）。
 * originは矩形の左上角（回転前の基準点）を表す。
 */
export interface RectangleGeometry extends GeometryBase {
  readonly type: 'rectangle'
  readonly origin: Point
  readonly width: number
  readonly height: number
  readonly rotationDeg: number
}

/** 継承元: Civil-Draw EllipseShape（cx/cy/radiusX/radiusY/rotation）。 */
export interface EllipseGeometry extends GeometryBase {
  readonly type: 'ellipse'
  readonly center: Point
  readonly radiusX: number
  readonly radiusY: number
  readonly rotationDeg: number
}

/** 継承元: Civil-Draw DimensionShape。寸法線（水平/垂直/平行）を表す。 */
export interface DimensionGeometry extends GeometryBase {
  readonly type: 'dimension'
  readonly start: Point
  readonly end: Point
  readonly orientation: 'horizontal' | 'vertical' | 'parallel'
  readonly offset: number
  readonly textHeight: number
  readonly arrowSize: number
}

/**
 * 継承元: Civil-Draw CalloutShape（引出線＋注記テキスト）。
 * 詳細設計仕様書のGeometryTypeでは"leader"に対応する。
 */
export interface LeaderGeometry extends GeometryBase {
  readonly type: 'leader'
  readonly start: Point
  readonly end: Point
  readonly text: string
  readonly textHeight: number
}

/** 継承元: Civil-Draw HatchShape.pattern（土木製図で用いるハッチングパターン10種）。 */
export type HatchPattern =
  | 'parallel'
  | 'cross'
  | 'gravel'
  | 'earth'
  | 'concrete'
  | 'rock'
  | 'asphalt'
  | 'wood'
  | 'steel'
  | 'water'

/** 継承元: Civil-Draw HatchShape（points/pattern/angle/spacing）。 */
export interface HatchGeometry extends GeometryBase {
  readonly type: 'hatch'
  readonly boundaryPoints: readonly Point[]
  readonly pattern: HatchPattern
  readonly angleDeg: number
  readonly spacing: number
}

/** 継承元: Civil-Draw SymbolShape（symbolId/x/y/rotation/scale）。 */
export interface SymbolGeometry extends GeometryBase {
  readonly type: 'symbol'
  readonly symbolId: string
  readonly position: Point
  readonly rotationDeg: number
  readonly scale: number
}

/** 継承元: Civil-Draw SplineShape（points/tension）。 */
export interface SplineGeometry extends GeometryBase {
  readonly type: 'spline'
  readonly points: readonly Point[]
  readonly tension: number
}

/**
 * 継承元: Civil-Draw CloudShape（改訂雲マーク）。
 * 外接矩形（x1,y1）-(x2,y2) と各辺を半円で波打たせる arcSize で表現する。
 * DXF 入出力では円弧を弦で近似したポリラインへ変換する（Civil-Draw と同方針）。
 */
export interface CloudGeometry extends GeometryBase {
  readonly type: 'cloud'
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly arcSize: number
}

/**
 * 継承元: Civil-Draw MLineShape（平行2線・マルチライン）。
 * 中心線 start→end と、中心線からのオフセット幅 offset で 2 本の平行線を表す。
 * DXF 入出力では 2 本の LINE へ分解する（DXF に MLine 専用エンティティを持たないため）。
 */
export interface MLineGeometry extends GeometryBase {
  readonly type: 'mline'
  readonly start: Point
  readonly end: Point
  readonly offset: number
}

/**
 * 詳細設計仕様書 §15 パラメトリック図形。
 * 生成図形（generatedGeometryIds）は本体を正本とし、パラメータ変更時に再生成される派生物。
 * ParametricObjectDefinition（definitionId・generate関数を持つテンプレート定義本体）は
 * 別Issue（テンプレートカタログ実装）で扱うため、本ファイルでは図形インスタンス型のみ定義する。
 */
export interface ParametricGeometry extends GeometryBase {
  readonly type: 'parametricObject'
  readonly definitionId: string
  readonly definitionVersion: number
  readonly parameters: Readonly<Record<string, unknown>>
  readonly generatedGeometryIds: readonly GeometryId[]
}

/**
 * 詳細設計仕様書 §6 図形データモデル
 * 判別プロパティtypeによるGeometry判別共用体。switch文の網羅性検査を前提とする。
 */
export type Geometry =
  | LineGeometry
  | CircleGeometry
  | PolylineGeometry
  | TextGeometry
  | ArcGeometry
  | RectangleGeometry
  | EllipseGeometry
  | DimensionGeometry
  | LeaderGeometry
  | HatchGeometry
  | SymbolGeometry
  | SplineGeometry
  | CloudGeometry
  | MLineGeometry
  | ParametricGeometry
