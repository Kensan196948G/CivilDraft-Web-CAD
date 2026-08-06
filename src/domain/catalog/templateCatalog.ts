/**
 * 記号・テンプレートカタログ（土木製図の定型図形群）。
 * 継承元: Civil-Draw src/utils/templateCatalog.ts（継承台帳、記号・テンプレートカタログ）。
 *
 * 継承元との差分:
 * - Shape型（フラット座標）をGeometry判別共用体（詳細設計仕様書§6、13種）へ変換した。
 *   line{x1,y1,x2,y2}→{start,end}、circle{cx,cy,radius}→{center,radius}、
 *   rect→rectangle{origin,width,height,rotationDeg}、text{x,y,fontSize,rotation}→
 *   {anchor,height,rotationDeg,horizontalAlign}、symbol{x,y,rotation,scale}→
 *   {position,rotationDeg,scale}、polyline/hatchの平坦number[]→readonly Point[]。
 * - GeometryTemplateのOmit対象を拡張した。継承元はid/layerId/lockedのみ除外していたが、
 *   新GeometryBaseが持つstyle/createdAt/updatedAt/constructionStepIdsも除外する。
 *   テンプレートは「形状の設計図」であり、スタイル・帰属・監査情報は実体化時に決まるため。
 * - 角度は度数法（ADR-0012）。pipe-culvertのarcはstartAngle:Math.PI/endAngle:0（ラジアン）を
 *   startAngleDeg:180/endAngleDeg:0へ変換した（Math.PI rad = 180°, 0 rad = 0°）。
 *   hatchのangle→angleDegは元値が度数のためそのまま。
 * - text.horizontalAlignは新モデルの必須フィールド。継承元に対応値が無いため既定'left'とした。
 * - earthwork-sectionのhatch boundaryPointsは(100,0)が連続重複するが継承元データをas_is維持。
 * - instantiateTemplate（テンプレート→実体Geometry合成）とgetTemplateById（ID検索）を新設した
 *   （継承元に無い。UI配置ツール用、symbolCatalog.getSymbolByIdとの対称性のため）。
 */
import type { Geometry, GeometryBase, GeometryStyle, LayerId } from '@/shared/types'
import {
  defaultCreationContext,
  type GeometryCreationContext,
} from '@/domain/geometry/geometryFactory'

/** 判別共用体のtype判別子を保持したままキーを除外する分配Omit。 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/**
 * テンプレートを構成する図形（形状の設計図）。
 * 実体化時に決まる帰属・スタイル・監査フィールドを除外する。継承元はid/layerId/lockedのみ
 * 除外したが、新GeometryBaseが追加で持つstyle/createdAt/updatedAt/constructionStepIdsも
 * テンプレートからは除外する（これらは実体化=instantiateTemplateの時点で確定するため）。
 */
export type GeometryTemplate = DistributiveOmit<
  Geometry,
  'id' | 'layerId' | 'locked' | 'style' | 'createdAt' | 'updatedAt' | 'constructionStepIds'
>

/** テンプレート定義。日本語のname/description/categoryは継承元as_is維持。 */
export interface TemplateDef {
  readonly id: string
  readonly name: string
  readonly category: '仮設' | '土工' | '舗装' | '測量' | '図面枠'
  readonly description: string
  readonly shapes: readonly GeometryTemplate[]
}

export const TEMPLATE_CATALOG: readonly TemplateDef[] = [
  {
    id: 'construction-zone',
    name: '工事ゾーン',
    category: '仮設',
    description: 'コーン4個 + バリケード2本',
    shapes: [
      { type: 'symbol', symbolId: 'cone', position: { x: -100, y: -100 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'cone', position: { x: 100, y: -100 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'cone', position: { x: -100, y: 100 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'cone', position: { x: 100, y: 100 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'barrier', position: { x: -50, y: 0 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'barrier', position: { x: 50, y: 0 }, rotationDeg: 0, scale: 1 },
    ],
  },
  {
    id: 'earthwork-section',
    name: '土工断面',
    category: '土工',
    description: '地盤線 + 盛土断面',
    shapes: [
      { type: 'line', start: { x: -200, y: 0 }, end: { x: 200, y: 0 } },
      {
        type: 'polyline',
        points: [
          { x: -100, y: 0 },
          { x: -50, y: -60 },
          { x: 0, y: -80 },
          { x: 50, y: -60 },
          { x: 100, y: 0 },
        ],
        closed: false,
      },
      {
        type: 'hatch',
        // 継承元データのas_is維持: (100,0)が連続重複（5・6点目）
        boundaryPoints: [
          { x: -100, y: 0 },
          { x: -50, y: -60 },
          { x: 0, y: -80 },
          { x: 50, y: -60 },
          { x: 100, y: 0 },
          { x: 100, y: 0 },
          { x: -100, y: 0 },
        ],
        pattern: 'earth',
        angleDeg: 45,
        spacing: 15,
      },
      {
        type: 'dimension',
        start: { x: -100, y: 0 },
        end: { x: 100, y: 0 },
        orientation: 'horizontal',
        offset: 30,
        textHeight: 12,
        arrowSize: 8,
      },
    ],
  },
  {
    id: 'paving',
    name: '舗装断面',
    category: '舗装',
    description: 'As + 路盤 + 路床の3層断面',
    shapes: [
      { type: 'rectangle', origin: { x: -100, y: -10 }, width: 200, height: 10, rotationDeg: 0 },
      {
        type: 'hatch',
        boundaryPoints: [
          { x: -100, y: -10 },
          { x: 100, y: -10 },
          { x: 100, y: 0 },
          { x: -100, y: 0 },
        ],
        pattern: 'asphalt',
        angleDeg: 0,
        spacing: 5,
      },
      { type: 'rectangle', origin: { x: -120, y: 0 }, width: 240, height: 20, rotationDeg: 0 },
      {
        type: 'hatch',
        boundaryPoints: [
          { x: -120, y: 0 },
          { x: 120, y: 0 },
          { x: 120, y: 20 },
          { x: -120, y: 20 },
        ],
        pattern: 'gravel',
        angleDeg: 0,
        spacing: 8,
      },
      { type: 'rectangle', origin: { x: -140, y: 20 }, width: 280, height: 20, rotationDeg: 0 },
      {
        type: 'hatch',
        boundaryPoints: [
          { x: -140, y: 20 },
          { x: 140, y: 20 },
          { x: 140, y: 40 },
          { x: -140, y: 40 },
        ],
        pattern: 'earth',
        angleDeg: 45,
        spacing: 12,
      },
    ],
  },
  {
    id: 'survey-layout',
    name: '測量レイアウト',
    category: '測量',
    description: '基準点3点 + 距離寸法',
    shapes: [
      { type: 'symbol', symbolId: 'bm', position: { x: -150, y: 0 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'bm', position: { x: 0, y: 0 }, rotationDeg: 0, scale: 1 },
      { type: 'symbol', symbolId: 'bm', position: { x: 150, y: 0 }, rotationDeg: 0, scale: 1 },
      {
        type: 'dimension',
        start: { x: -150, y: 0 },
        end: { x: 0, y: 0 },
        orientation: 'horizontal',
        offset: -30,
        textHeight: 12,
        arrowSize: 8,
      },
      {
        type: 'dimension',
        start: { x: 0, y: 0 },
        end: { x: 150, y: 0 },
        orientation: 'horizontal',
        offset: -30,
        textHeight: 12,
        arrowSize: 8,
      },
    ],
  },
  {
    id: 'survey-control-point',
    name: '測量基準点マーカー',
    category: '測量',
    description: '円形基準点 + 中心十字 + ラベル',
    shapes: [
      { type: 'circle', center: { x: 0, y: 0 }, radius: 20 },
      { type: 'line', start: { x: -25, y: 0 }, end: { x: 25, y: 0 } },
      { type: 'line', start: { x: 0, y: -25 }, end: { x: 0, y: 25 } },
      {
        type: 'text',
        anchor: { x: 25, y: -30 },
        text: 'CP',
        height: 12,
        rotationDeg: 0,
        // horizontalAlignは新モデルの必須フィールド。継承元に無いため既定'left'。
        horizontalAlign: 'left',
      },
    ],
  },
  {
    id: 'pipe-culvert',
    name: '管渠断面',
    category: '土工',
    description: '円形管渠 + 基礎砕石',
    shapes: [
      { type: 'circle', center: { x: 0, y: -50 }, radius: 40 },
      {
        type: 'arc',
        center: { x: 0, y: -50 },
        radius: 50,
        // 継承元: startAngle:Math.PI, endAngle:0（ラジアン）→度数法変換（ADR-0012）
        startAngleDeg: 180,
        endAngleDeg: 0,
      },
      { type: 'rectangle', origin: { x: -60, y: 0 }, width: 120, height: 20, rotationDeg: 0 },
      {
        type: 'hatch',
        boundaryPoints: [
          { x: -60, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 20 },
          { x: -60, y: 20 },
        ],
        pattern: 'gravel',
        angleDeg: 0,
        spacing: 8,
      },
    ],
  },
  {
    id: 'title-block-a3',
    name: '表題欄（A3）',
    category: '図面枠',
    description: 'A3横用の標準表題欄（工事名・図面名・図面番号・縮尺・作成/承認・日付）',
    shapes: [
      // 外枠・内枠
      { type: 'rectangle', origin: { x: 200, y: 227 }, width: 220, height: 70, rotationDeg: 0 },
      // 縦区切り
      { type: 'line', start: { x: 260, y: 227 }, end: { x: 260, y: 297 } },
      { type: 'line', start: { x: 340, y: 227 }, end: { x: 340, y: 297 } },
      { type: 'line', start: { x: 380, y: 227 }, end: { x: 380, y: 297 } },
      { type: 'line', start: { x: 400, y: 227 }, end: { x: 400, y: 297 } },
      // 横区切り
      { type: 'line', start: { x: 200, y: 247 }, end: { x: 420, y: 247 } },
      { type: 'line', start: { x: 200, y: 267 }, end: { x: 420, y: 267 } },
      { type: 'line', start: { x: 200, y: 287 }, end: { x: 420, y: 287 } },
      // ラベル（左列）
      { type: 'text', anchor: { x: 205, y: 236 }, text: '工事名', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 205, y: 256 }, text: '図面名', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 205, y: 276 }, text: '図面番号', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      // 値欄（左列の右側）
      { type: 'text', anchor: { x: 268, y: 236 }, text: '＿＿＿＿＿＿＿＿', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 268, y: 256 }, text: '＿＿＿＿＿＿＿＿', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 268, y: 276 }, text: '＿＿＿＿＿＿＿＿', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      // 縮尺・作成・承認
      { type: 'text', anchor: { x: 343, y: 236 }, text: '縮尺', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 343, y: 256 }, text: '作成', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 343, y: 276 }, text: '承認', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 383, y: 236 }, text: '1:100', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 383, y: 256 }, text: '＿＿＿＿', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 383, y: 276 }, text: '＿＿＿＿', height: 9, rotationDeg: 0, horizontalAlign: 'left' },
      // 日付・版
      { type: 'text', anchor: { x: 402, y: 236 }, text: '日付', height: 8, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 402, y: 256 }, text: '版', height: 8, rotationDeg: 0, horizontalAlign: 'left' },
      { type: 'text', anchor: { x: 402, y: 276 }, text: '＿＿', height: 8, rotationDeg: 0, horizontalAlign: 'left' },
      // 備考欄（最終行は上部セルより低いため下段に配置）
      { type: 'text', anchor: { x: 205, y: 292 }, text: '備考', height: 8, rotationDeg: 0, horizontalAlign: 'left' },
    ],
  },
]

/**
 * テンプレートを実体化し、配置可能なGeometry配列を生成する（継承元に無い新設）。
 * 各GeometryTemplateへ id=ctx.newId() / layerId / style / locked:false /
 * constructionStepIds:[] / createdAt=updatedAt=ctx.now() を合成する（ADR-0013）。
 * 座標の平行移動（配置位置へのオフセット）は含めない。配置は将来のtransform層の責務とし、
 * 本関数はテンプレート原点（ローカル座標）のまま実体化する。
 */
export function instantiateTemplate(
  template: TemplateDef,
  placement: { readonly layerId: LayerId; readonly style: GeometryStyle },
  ctx: GeometryCreationContext = defaultCreationContext,
): Geometry[] {
  return template.shapes.map((shape) => {
    const timestamp = ctx.now()
    const identity: Omit<GeometryBase, 'type'> = {
      id: ctx.newId(),
      layerId: placement.layerId,
      style: placement.style,
      locked: false,
      constructionStepIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    // スプレッド合成の結果は実行時に完全なGeometryだが、TSは判別共用体のスプレッドを
    // 正確に型付けできないためGeometryへキャストする（type判別子はshape側が保持）。
    return { ...shape, ...identity } as Geometry
  })
}

/**
 * IDでテンプレートを検索する（継承元に無い新設、symbolCatalog.getSymbolByIdとの対称性）。
 * 該当が無ければundefinedを返す。
 */
export function getTemplateById(id: string): TemplateDef | undefined {
  return TEMPLATE_CATALOG.find((t) => t.id === id)
}
