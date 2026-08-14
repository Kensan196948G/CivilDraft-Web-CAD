/**
 * MVP/Prototype 用の図面コンテンツ（図形・レイヤー）生成。
 *
 * デモ案件の図面を CAD エディタで開いたとき、空キャンバスではなく
 * 種別ごとの代表的な作図内容（線・矩形・円・円弧・ポリライン・寸法・
 * 文字・引出線・ハッチ・シンボル）を即座に表示する。
 * 座標は ADR-0012 準拠（mm・X右方向・Y下方向）。図面番号から決定的に
 * バリエーションを振るため、同じ図面は常に同じ内容になる。
 */
import type {
  DrawingLayer,
  Geometry,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'
import type { DemoProjectTheme } from './demoProjects'

export interface DemoDrawingContent {
  readonly geometries: readonly Geometry[]
  readonly layers: readonly DrawingLayer[]
}

export interface DemoDrawingContext {
  /** 案件番号（図面内容を案件テーマに合わせるための参照）。 */
  readonly projectNumber?: string
  /** 案件テーマ（案件内容に応じた図形を追記する）。 */
  readonly theme?: DemoProjectTheme
  /** 図面名（タイトル注記に使用）。 */
  readonly drawingName?: string
}

const CREATED_AT = '2026-07-16T00:00:00.000Z'

function style(
  strokeColor: string,
  lineType: GeometryStyle['lineType'] = 'continuous',
  extra: Partial<GeometryStyle> = {},
): GeometryStyle {
  return { strokeColor, strokeWidth: 1, lineType, opacity: 1, printable: true, ...extra }
}

function layer(
  id: string,
  name: string,
  order: number,
  strokeColor: string,
  lineType: GeometryStyle['lineType'] = 'continuous',
  strokeWidth = 1,
): DrawingLayer {
  return {
    id: id as LayerId,
    name,
    order,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: style(strokeColor, lineType, { strokeWidth }),
  }
}

const LAYERS: readonly DrawingLayer[] = [
  layer('l-0', 'レイヤー0', 0, '#141C29'),
  layer('l-boundary', '敷地・境界', 1, '#2E5AAC', 'dashed'),
  layer('l-temporary', '仮設', 2, '#B5701A', 'dashed'),
  layer('l-structure', '構造・躯体', 3, '#1F8255'),
  layer('l-center', '中心線', 4, '#C5392F', 'dashDot'),
  layer('l-hatch', 'ハッチ', 5, '#7C8B9F'),
  layer('l-text', '文字・注記', 6, '#141C29'),
  layer('l-guide', 'ガイド線', 7, '#475569', 'continuous', 2),
]

const byName: Readonly<Record<string, DrawingLayer>> = Object.fromEntries(
  LAYERS.map((item) => [item.id, item]),
)

function base(id: string, layerId: string): {
  id: GeometryId
  layerId: LayerId
  style: GeometryStyle
  constructionStepIds: readonly never[]
  locked: boolean
  createdAt: string
  updatedAt: string
} {
  const target = byName[layerId] ?? LAYERS[0]!
  return {
    id: id as GeometryId,
    layerId: target.id,
    style: target.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
}

function text(
  id: string,
  layerId: string,
  anchor: Point,
  content: string,
  height = 2200,
): Geometry {
  return {
    ...base(id, layerId),
    type: 'text',
    anchor,
    text: content,
    height,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

function dimension(
  id: string,
  start: Point,
  end: Point,
  offset: number,
  orientation: 'horizontal' | 'vertical' | 'parallel' = 'horizontal',
): Geometry {
  return {
    ...base(id, 'l-text'),
    type: 'dimension',
    start,
    end,
    orientation,
    offset,
    textHeight: 1800,
    arrowSize: 1400,
  }
}

function leader(id: string, start: Point, end: Point, content: string): Geometry {
  return {
    ...base(id, 'l-text'),
    type: 'leader',
    start,
    end,
    text: content,
    textHeight: 1800,
  }
}

/** 図面番号（DWG-014 等）から決定的なバリエーション（0〜2）を返す。 */
function variantOf(drawingNumber: string): number {
  const digits = drawingNumber.replace(/\D/g, '')
  const numeric = digits === '' ? 0 : Number(digits)
  return numeric % 3
}

/** バリエーションに応じた全体シフト（同じ図面は常に同じ位置になる）。 */
function shiftOf(drawingNumber: string): number {
  return variantOf(drawingNumber) * 6000
}

function rect(
  id: string,
  layerId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fillColor?: string,
): Geometry {
  return {
    ...base(id, layerId),
    type: 'rectangle',
    origin: { x, y },
    width,
    height,
    rotationDeg: 0,
    ...(fillColor === undefined ? {} : { style: { ...base(id, layerId).style, fillColor } }),
  }
}

function temporaryYardPlan(drawingNumber: string, title?: string): DemoDrawingContent {
  const dx = shiftOf(drawingNumber)
  const geometries: Geometry[] = [
    {
      ...base('ty-boundary', 'l-boundary'),
      type: 'polyline',
      points: [
        { x: 12000 + dx, y: 12000 },
        { x: 208000 + dx, y: 12000 },
        { x: 208000 + dx, y: 148000 },
        { x: 12000 + dx, y: 148000 },
      ],
      closed: true,
    },
    {
      ...base('ty-road', 'l-center'),
      type: 'mline',
      start: { x: 32000 + dx, y: 82000 },
      end: { x: 188000 + dx, y: 82000 },
      offset: 6000,
    },
    rect('ty-material', 'l-temporary', 42000 + dx, 26000, 44000, 26000, '#FDEFE0'),
    rect('ty-fabrication', 'l-temporary', 104000 + dx, 26000, 38000, 26000, '#FDEFE0'),
    rect('ty-stock', 'l-temporary', 66000 + dx, 104000, 50000, 22000, '#FDEFE0'),
    {
      ...base('ty-crane', 'l-temporary'),
      type: 'circle',
      center: { x: 154000 + dx, y: 70000 },
      radius: 38000,
    },
    {
      ...base('ty-crane-boom', 'l-structure'),
      type: 'arc',
      center: { x: 154000 + dx, y: 70000 },
      radius: 38000,
      startAngleDeg: 0,
      endAngleDeg: 180,
    },
    {
      ...base('ty-crane-axis', 'l-center'),
      type: 'line',
      start: { x: 116000 + dx, y: 70000 },
      end: { x: 192000 + dx, y: 70000 },
    },
    {
      ...base('ty-gate', 'l-structure'),
      type: 'symbol',
      symbolId: 'cone',
      position: { x: 52000 + dx, y: 12000 },
      rotationDeg: 0,
      scale: 1,
    },
    {
      ...base('ty-hatch-road', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 26000 + dx, y: 76000 },
        { x: 194000 + dx, y: 76000 },
        { x: 194000 + dx, y: 88000 },
        { x: 26000 + dx, y: 88000 },
      ],
      pattern: 'asphalt',
      angleDeg: 45,
      spacing: 2400,
    },
    text('ty-title', 'l-text', { x: 16000 + dx, y: 20000 }, title ?? '施工ヤード計画図（デモ）', 3200),
    text('ty-mat-label', 'l-text', { x: 46000 + dx, y: 32000 }, '材料置場'),
    text('ty-fab-label', 'l-text', { x: 108000 + dx, y: 32000 }, '加工場'),
    text('ty-crane-label', 'l-text', { x: 132000 + dx, y: 98000 }, 'クレーン作業半径 R=38.0m'),
    text('ty-road-label', 'l-text', { x: 40000 + dx, y: 95000 }, '場内道路 W=12.0m'),
    text('ty-north', 'l-text', { x: 196000 + dx, y: 24000 }, '北'),
    dimension('ty-dim-width', { x: 12000 + dx, y: 162000 }, { x: 208000 + dx, y: 162000 }, 6000),
    leader('ty-lead-stock', { x: 92000 + dx, y: 104000 }, { x: 102000 + dx, y: 126000 }, '仮置場（養生材）'),
  ]
  return { geometries, layers: LAYERS }
}

function temporaryPlan(drawingNumber: string, title?: string): DemoDrawingContent {
  const dx = shiftOf(drawingNumber)
  const geometries: Geometry[] = [
    {
      ...base('tp-excavation', 'l-boundary'),
      type: 'polyline',
      points: [
        { x: 20000 + dx, y: 30000 },
        { x: 180000 + dx, y: 30000 },
        { x: 180000 + dx, y: 120000 },
        { x: 20000 + dx, y: 120000 },
      ],
      closed: true,
    },
    {
      ...base('tp-hatch', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 26000 + dx, y: 36000 },
        { x: 174000 + dx, y: 36000 },
        { x: 174000 + dx, y: 114000 },
        { x: 26000 + dx, y: 114000 },
      ],
      pattern: 'earth',
      angleDeg: 0,
      spacing: 3200,
    },
    {
      ...base('tp-sheetpile-top', 'l-temporary'),
      type: 'mline',
      start: { x: 20000 + dx, y: 30000 },
      end: { x: 180000 + dx, y: 30000 },
      offset: 1600,
    },
    {
      ...base('tp-sheetpile-bottom', 'l-temporary'),
      type: 'mline',
      start: { x: 20000 + dx, y: 120000 },
      end: { x: 180000 + dx, y: 120000 },
      offset: 1600,
    },
    ...[0, 1, 2, 3].map((index): Geometry => ({
      ...base(`tp-strut-${index}`, 'l-structure'),
      type: 'line',
      start: { x: 26000 + dx, y: 48000 + index * 22000 },
      end: { x: 174000 + dx, y: 48000 + index * 22000 },
    })),
    ...[0, 1, 2].map((index): Geometry => ({
      ...base(`tp-wale-${index}`, 'l-temporary'),
      type: 'mline',
      start: { x: 26000 + dx, y: 59000 + index * 22000 },
      end: { x: 174000 + dx, y: 59000 + index * 22000 },
      offset: 1800,
    })),
    {
      ...base('tp-center', 'l-center'),
      type: 'line',
      start: { x: 100000 + dx, y: 26000 },
      end: { x: 100000 + dx, y: 126000 },
    },
    text('tp-title', 'l-text', { x: 24000 + dx, y: 22000 }, title ?? '仮設計画図（矢板・切梁）（デモ）', 3000),
    text('tp-sheetpile-label', 'l-text', { x: 26000 + dx, y: 38000 }, '鋼矢板 Ⅲ型 L=9.0m'),
    text('tp-strut-label', 'l-text', { x: 28000 + dx, y: 47000 }, '切梁 H-300'),
    text('tp-exc-label', 'l-text', { x: 100000 + dx, y: 108000 }, '掘削範囲', 2400),
    dimension('tp-dim-width', { x: 20000 + dx, y: 136000 }, { x: 180000 + dx, y: 136000 }, 6000),
    dimension('tp-dim-depth', { x: 18000 + dx, y: 30000 }, { x: 18000 + dx, y: 120000 }, 6000, 'vertical'),
    leader('tp-lead-depth', { x: 160000 + dx, y: 84000 }, { x: 148000 + dx, y: 90000 }, '一次掘削 GL-2.5m'),
  ]
  return { geometries, layers: LAYERS }
}

function earthworkPlan(drawingNumber: string, title?: string): DemoDrawingContent {
  const dx = shiftOf(drawingNumber)
  const existing: readonly Point[] = [
    { x: 0 + dx, y: 62000 },
    { x: 30000 + dx, y: 40000 },
    { x: 60000 + dx, y: 30000 },
    { x: 90000 + dx, y: 26000 },
    { x: 120000 + dx, y: 32000 },
    { x: 150000 + dx, y: 45000 },
    { x: 180000 + dx, y: 60000 },
  ]
  const planned: readonly Point[] = [
    { x: 0 + dx, y: 62000 },
    { x: 30000 + dx, y: 49000 },
    { x: 60000 + dx, y: 39000 },
    { x: 90000 + dx, y: 34000 },
    { x: 120000 + dx, y: 40000 },
    { x: 150000 + dx, y: 50000 },
    { x: 180000 + dx, y: 60000 },
  ]
  const geometries: Geometry[] = [
    {
      ...base('ew-existing', 'l-boundary'),
      type: 'polyline',
      points: existing,
      closed: false,
    },
    {
      ...base('ew-planned', 'l-structure'),
      type: 'polyline',
      points: planned,
      closed: false,
    },
    {
      ...base('ew-hatch', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [...planned, ...[...existing].reverse()],
      pattern: 'earth',
      angleDeg: 45,
      spacing: 2800,
    },
    {
      ...base('ew-center', 'l-center'),
      type: 'line',
      start: { x: 90000 + dx, y: 14000 },
      end: { x: 90000 + dx, y: 76000 },
    },
    {
      ...base('ew-baseline', 'l-center'),
      type: 'line',
      start: { x: -4000 + dx, y: 62000 },
      end: { x: 184000 + dx, y: 62000 },
    },
    text('ew-title', 'l-text', { x: 8000 + dx, y: 18000 }, title ?? '標準横断図 No.20（デモ）', 3200),
    text('ew-existing-label', 'l-text', { x: 24000 + dx, y: 36000 }, '現況地盤'),
    text('ew-planned-label', 'l-text', { x: 24000 + dx, y: 53000 }, '計画地盤'),
    text('ew-cut-label', 'l-text', { x: 72000 + dx, y: 36000 }, '切土'),
    text('ew-fill-label', 'l-text', { x: 106000 + dx, y: 42000 }, '盛土'),
    text('ew-cl-label', 'l-text', { x: 87000 + dx, y: 16000 }, 'CL'),
    dimension('ew-dim-width', { x: 0 + dx, y: 72000 }, { x: 180000 + dx, y: 72000 }, 5000),
    dimension('ew-dim-height', { x: -6000 + dx, y: 62000 }, { x: -6000 + dx, y: 26000 }, 6000, 'vertical'),
    leader('ew-lead', { x: 108000 + dx, y: 36000 }, { x: 116000 + dx, y: 30000 }, '計画高さ H=34.0m'),
  ]
  return { geometries, layers: LAYERS }
}

function quantityBasis(drawingNumber: string, title?: string): DemoDrawingContent {
  const dx = shiftOf(drawingNumber)
  const geometries: Geometry[] = [
    rect('qb-pave-a', 'l-temporary', 22000 + dx, 22000, 42000, 26000),
    rect('qb-pave-b', 'l-temporary', 76000 + dx, 22000, 46000, 26000),
    {
      ...base('qb-hatch-a', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 22000 + dx, y: 22000 },
        { x: 64000 + dx, y: 22000 },
        { x: 64000 + dx, y: 48000 },
        { x: 22000 + dx, y: 48000 },
      ],
      pattern: 'asphalt',
      angleDeg: 45,
      spacing: 2000,
    },
    {
      ...base('qb-hatch-b', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 76000 + dx, y: 22000 },
        { x: 122000 + dx, y: 22000 },
        { x: 122000 + dx, y: 48000 },
        { x: 76000 + dx, y: 48000 },
      ],
      pattern: 'asphalt',
      angleDeg: 45,
      spacing: 2000,
    },
    {
      ...base('qb-manhole', 'l-structure'),
      type: 'circle',
      center: { x: 148000 + dx, y: 35000 },
      radius: 6000,
    },
    {
      ...base('qb-manhole-x', 'l-center'),
      type: 'line',
      start: { x: 142000 + dx, y: 29000 },
      end: { x: 154000 + dx, y: 41000 },
    },
    {
      ...base('qb-manhole-y', 'l-center'),
      type: 'line',
      start: { x: 142000 + dx, y: 41000 },
      end: { x: 154000 + dx, y: 29000 },
    },
    {
      ...base('qb-gutter', 'l-structure'),
      type: 'mline',
      start: { x: 20000 + dx, y: 90000 },
      end: { x: 170000 + dx, y: 90000 },
      offset: 2400,
    },
    text('qb-title', 'l-text', { x: 24000 + dx, y: 12000 }, title ?? '数量根拠図（舗装数量）（デモ）', 3200),
    text('qb-a-label', 'l-text', { x: 26000 + dx, y: 28000 }, '舗装エリアA'),
    text('qb-a-area', 'l-text', { x: 26000 + dx, y: 56000 }, 'A = 42.0m × 26.0m = 1,092.0m2'),
    text('qb-b-label', 'l-text', { x: 80000 + dx, y: 28000 }, '舗装エリアB'),
    text('qb-b-area', 'l-text', { x: 80000 + dx, y: 56000 }, 'A = 46.0m × 26.0m = 1,196.0m2'),
    text('qb-manhole-label', 'l-text', { x: 140000 + dx, y: 48000 }, '既設マンホール'),
    dimension('qb-dim-a-w', { x: 22000 + dx, y: 60000 }, { x: 64000 + dx, y: 60000 }, 5000),
    dimension('qb-dim-b-w', { x: 76000 + dx, y: 60000 }, { x: 122000 + dx, y: 60000 }, 5000),
    leader('qb-lead-a', { x: 54000 + dx, y: 35000 }, { x: 64000 + dx, y: 64000 }, '数量集計対象'),
    leader('qb-lead-gutter', { x: 100000 + dx, y: 90000 }, { x: 106000 + dx, y: 98000 }, '側溝 L=150.0m'),
  ]
  return { geometries, layers: LAYERS }
}

function generalSample(drawingNumber: string, title?: string): DemoDrawingContent {
  const dx = shiftOf(drawingNumber)
  const geometries: Geometry[] = [
    {
      ...base('gs-line', 'l-structure'),
      type: 'line',
      start: { x: 20000 + dx, y: 30000 },
      end: { x: 80000 + dx, y: 30000 },
    },
    rect('gs-rect', 'l-temporary', 20000 + dx, 46000, 60000, 36000, '#E4F3EC'),
    {
      ...base('gs-circle', 'l-center'),
      type: 'circle',
      center: { x: 150000 + dx, y: 70000 },
      radius: 28000,
    },
    {
      ...base('gs-arc', 'l-structure'),
      type: 'arc',
      center: { x: 150000 + dx, y: 70000 },
      radius: 28000,
      startAngleDeg: 180,
      endAngleDeg: 360,
    },
    {
      ...base('gs-poly', 'l-boundary'),
      type: 'polyline',
      points: [
        { x: 40000 + dx, y: 108000 },
        { x: 90000 + dx, y: 96000 },
        { x: 120000 + dx, y: 118000 },
        { x: 80000 + dx, y: 134000 },
      ],
      closed: true,
    },
    {
      ...base('gs-hatch', 'l-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 40000 + dx, y: 108000 },
        { x: 90000 + dx, y: 96000 },
        { x: 120000 + dx, y: 118000 },
        { x: 80000 + dx, y: 134000 },
      ],
      pattern: 'concrete',
      angleDeg: 0,
      spacing: 2400,
    },
    text('gs-title', 'l-text', { x: 20000 + dx, y: 16000 }, title ?? 'サンプル図面（デモ）', 3200),
    text('gs-note', 'l-text', { x: 22000 + dx, y: 154000 }, '線・矩形・円・円弧・ポリライン・ハッチ・寸法・引出線のサンプル'),
    dimension('gs-dim', { x: 20000 + dx, y: 98000 }, { x: 80000 + dx, y: 98000 }, 5000),
    leader('gs-lead', { x: 150000 + dx, y: 42000 }, { x: 156000 + dx, y: 32000 }, '円弧サンプル'),
    {
      ...base('gs-symbol', 'l-temporary'),
      type: 'symbol',
      symbolId: 'cone',
      position: { x: 184000 + dx, y: 140000 },
      rotationDeg: 0,
      scale: 1,
    },
  ]
  return { geometries, layers: LAYERS }
}

/** 案件テーマに応じた図形（案件の業務内容を図面へ反映する）。 */
function themeDecorations(theme: DemoProjectTheme | undefined, drawingNumber: string): Geometry[] {
  if (theme === undefined) return []
  const dx = shiftOf(drawingNumber)
  switch (theme) {
    case 'road-widening':
      return [
        {
          ...base('th-road-existing', 'l-boundary'),
          type: 'line',
          start: { x: 20000 + dx, y: 46000 },
          end: { x: 200000 + dx, y: 46000 },
        },
        {
          ...base('th-road-proposed', 'l-temporary'),
          type: 'mline',
          start: { x: 20000 + dx, y: 56000 },
          end: { x: 200000 + dx, y: 56000 },
          offset: 9000,
        },
        text('th-road-station1', 'l-text', { x: 40000 + dx, y: 52000 }, 'No.10'),
        text('th-road-station2', 'l-text', { x: 160000 + dx, y: 52000 }, 'No.20'),
        leader('th-road-lead', { x: 80000 + dx, y: 48000 }, { x: 92000 + dx, y: 42000 }, '拡幅区間 L=160m'),
      ]
    case 'pump-station':
      return [
        rect('th-pump-tank', 'l-temporary', 52000 + dx, 68000, 32000, 20000, '#E9F6F5'),
        {
          ...base('th-pump-pipe', 'l-structure'),
          type: 'mline',
          start: { x: 84000 + dx, y: 78000 },
          end: { x: 160000 + dx, y: 78000 },
          offset: 1800,
        },
        {
          ...base('th-pump-1', 'l-center'),
          type: 'circle',
          center: { x: 120000 + dx, y: 78000 },
          radius: 7000,
        },
        {
          ...base('th-pump-2', 'l-center'),
          type: 'circle',
          center: { x: 140000 + dx, y: 78000 },
          radius: 7000,
        },
        text('th-pump-label', 'l-text', { x: 54000 + dx, y: 74000 }, '吸水槽'),
        text('th-pump-discharge', 'l-text', { x: 100000 + dx, y: 86000 }, '吐出管 φ1200'),
      ]
    case 'planting-paving':
      return [
        rect('th-plant-bed', 'l-temporary', 48000 + dx, 44000, 36000, 22000, '#E9F6E4'),
        ...Array.from({ length: 6 }, (_, index): Geometry => ({
          ...base(`th-tree-${index}`, 'l-structure'),
          type: 'circle',
          center: { x: 56000 + (index % 3) * 14000 + dx, y: 50000 + Math.floor(index / 3) * 10000 },
          radius: 1800,
        })),
        {
          ...base('th-paving-hatch', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 110000 + dx, y: 42000 },
            { x: 170000 + dx, y: 42000 },
            { x: 170000 + dx, y: 66000 },
            { x: 110000 + dx, y: 66000 },
          ],
          pattern: 'asphalt',
          angleDeg: 45,
          spacing: 2200,
        },
        text('th-plant-label', 'l-text', { x: 50000 + dx, y: 40000 }, '植栽帯（中木）'),
        text('th-pave-label', 'l-text', { x: 112000 + dx, y: 72000 }, '舗装エリア'),
      ]
    case 'retention-pond':
      return [
        {
          ...base('th-pond', 'l-structure'),
          type: 'ellipse',
          center: { x: 100000 + dx, y: 80000 },
          radiusX: 52000,
          radiusY: 26000,
          rotationDeg: 0,
        },
        {
          ...base('th-pond-water', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 48000 + dx, y: 80000 },
            { x: 100000 + dx, y: 54000 },
            { x: 152000 + dx, y: 80000 },
            { x: 100000 + dx, y: 106000 },
          ],
          pattern: 'water',
          angleDeg: 0,
          spacing: 3200,
        },
        {
          ...base('th-pond-in', 'l-temporary'),
          type: 'mline',
          start: { x: 24000 + dx, y: 80000 },
          end: { x: 48000 + dx, y: 80000 },
          offset: 1200,
        },
        {
          ...base('th-pond-out', 'l-temporary'),
          type: 'mline',
          start: { x: 152000 + dx, y: 80000 },
          end: { x: 180000 + dx, y: 80000 },
          offset: 1200,
        },
        text('th-pond-label', 'l-text', { x: 88000 + dx, y: 84000 }, '調整池'),
        text('th-pond-in-label', 'l-text', { x: 24000 + dx, y: 88000 }, '流入'),
        text('th-pond-out-label', 'l-text', { x: 164000 + dx, y: 88000 }, '流出'),
      ]
    case 'sewer-main':
      return [
        {
          ...base('th-sewer-pipe', 'l-structure'),
          type: 'mline',
          start: { x: 30000 + dx, y: 70000 },
          end: { x: 180000 + dx, y: 70000 },
          offset: 2600,
        },
        ...[0, 1, 2].map((index): Geometry => ({
          ...base(`th-manhole-${index}`, 'l-center'),
          type: 'circle',
          center: { x: 60000 + index * 50000 + dx, y: 70000 },
          radius: 5200,
        })),
        {
          ...base('th-sewer-existing', 'l-boundary'),
          type: 'line',
          start: { x: 30000 + dx, y: 84000 },
          end: { x: 180000 + dx, y: 84000 },
        },
        leader('th-sewer-lead', { x: 80000 + dx, y: 82000 }, { x: 90000 + dx, y: 90000 }, '既設管との離隔不足'),
        text('th-sewer-label', 'l-text', { x: 32000 + dx, y: 66000 }, '雨水幹線 φ1500'),
      ]
    case 'bridge-pier':
      return [
        rect('th-pier-footing', 'l-temporary', 70000 + dx, 90000, 36000, 18000),
        rect('th-pier-column', 'l-structure', 82000 + dx, 66000, 12000, 24000, '#E4F3EC'),
        {
          ...base('th-bridge-deck', 'l-structure'),
          type: 'mline',
          start: { x: 20000 + dx, y: 42000 },
          end: { x: 200000 + dx, y: 42000 },
          offset: 8000,
        },
        text('th-pier-label', 'l-text', { x: 76000 + dx, y: 50000 }, 'P2橋脚'),
        text('th-deck-label', 'l-text', { x: 30000 + dx, y: 38000 }, '橋桁（既設）'),
      ]
    case 'sidewalk':
      return [
        rect('th-walk-1', 'l-temporary', 30000 + dx, 30000, 26000, 70000, '#FDEFE0'),
        rect('th-walk-2', 'l-temporary', 62000 + dx, 30000, 26000, 70000, '#FDEFE0'),
        {
          ...base('th-walk-hatch', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 54000 + dx, y: 30000 },
            { x: 64000 + dx, y: 30000 },
            { x: 64000 + dx, y: 100000 },
            { x: 54000 + dx, y: 100000 },
          ],
          pattern: 'concrete',
          angleDeg: 45,
          spacing: 1800,
        },
        text('th-walk-label', 'l-text', { x: 32000 + dx, y: 36000 }, '歩道（有効幅2.5m）'),
        text('th-tactile-label', 'l-text', { x: 56000 + dx, y: 108000 }, '点字ブロック'),
      ]
    case 'revetment':
      return [
        ...Array.from({ length: 16 }, (_, index): Geometry => ({
          ...base(`th-block-${index}`, 'l-structure'),
          type: 'rectangle',
          origin: { x: 36000 + (index % 8) * 16000 + dx, y: 46000 + Math.floor(index / 8) * 12000 },
          width: 14000,
          height: 10000,
          rotationDeg: 0,
        })),
        {
          ...base('th-revet-water', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 30000 + dx, y: 72000 },
            { x: 170000 + dx, y: 72000 },
            { x: 170000 + dx, y: 96000 },
            { x: 30000 + dx, y: 96000 },
          ],
          pattern: 'water',
          angleDeg: 0,
          spacing: 3000,
        },
        text('th-revet-label', 'l-text', { x: 34000 + dx, y: 40000 }, '護岸ブロック（2段）'),
        text('th-revet-water-label', 'l-text', { x: 90000 + dx, y: 84000 }, '河川側'),
      ]
    case 'slope-protection':
      return [
        {
          ...base('th-slope-hatch', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 26000 + dx, y: 36000 },
            { x: 170000 + dx, y: 36000 },
            { x: 170000 + dx, y: 104000 },
            { x: 26000 + dx, y: 104000 },
          ],
          pattern: 'earth',
          angleDeg: 30,
          spacing: 2600,
        },
        ...[0, 1, 2].map((index): Geometry => ({
          ...base(`th-anchor-${index}`, 'l-center'),
          type: 'circle',
          center: { x: 52000 + index * 46000 + dx, y: 68000 },
          radius: 7000,
        })),
        text('th-slope-label', 'l-text', { x: 28000 + dx, y: 30000 }, '法面保護（吹付＋アンカー）'),
        text('th-anchor-label', 'l-text', { x: 88000 + dx, y: 72000 }, 'アンカー工 n=3'),
      ]
    case 'tunnel-portal':
      return [
        {
          ...base('th-portal', 'l-structure'),
          type: 'arc',
          center: { x: 100000 + dx, y: 82000 },
          radius: 30000,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
        {
          ...base('th-rock-hatch', 'l-hatch'),
          type: 'hatch',
          boundaryPoints: [
            { x: 30000 + dx, y: 36000 },
            { x: 170000 + dx, y: 36000 },
            { x: 170000 + dx, y: 68000 },
            { x: 30000 + dx, y: 68000 },
          ],
          pattern: 'rock',
          angleDeg: 0,
          spacing: 2800,
        },
        {
          ...base('th-portal-cloud', 'l-temporary'),
          type: 'cloud',
          x1: 56000 + dx,
          y1: 90000,
          x2: 144000 + dx,
          y2: 118000,
          arcSize: 2400,
        },
        text('th-portal-label', 'l-text', { x: 82000 + dx, y: 62000 }, '東坑口'),
        text('th-rock-label', 'l-text', { x: 32000 + dx, y: 42000 }, '落石防護工'),
      ]
  }
}

/**
 * デモ図面コンテンツを生成する。
 * drawingType は Workers API 契約の種別コード（未対応・未知は汎用サンプル）。
 * context に案件番号・テーマ・図面名を渡すと、案件の業務内容に応じた
 * 図形とタイトル注記を反映する（案件内容にしたがったサンプル2Dデータ）。
 */
export function createDemoDrawingContent(
  drawingType: string | undefined,
  drawingNumber: string,
  context: DemoDrawingContext = {},
): DemoDrawingContent {
  const baseContent: DemoDrawingContent = (() => {
    switch (drawingType) {
      case 'temporary-yard-plan':
        return temporaryYardPlan(drawingNumber, context.drawingName)
      case 'temporary-plan':
        return temporaryPlan(drawingNumber, context.drawingName)
      case 'earthwork-plan':
        return earthworkPlan(drawingNumber, context.drawingName)
      case 'quantity-basis':
        return quantityBasis(drawingNumber, context.drawingName)
      case 'blank':
        // 新規作図: グリッド内（初期ビュー付近）にガイド線を表示する。
        // ガイド線は専用レイヤー「ガイド線」に置き、レイヤーパネルから表示を切替可能。
        return {
          geometries: [
            {
              ...base('ng-horizontal', 'l-guide'),
              type: 'line',
              start: { x: 60, y: 220 },
              end: { x: 520, y: 220 },
            },
            {
              ...base('ng-vertical', 'l-guide'),
              type: 'line',
              start: { x: 220, y: 80 },
              end: { x: 220, y: 420 },
            },
            {
              ...base('ng-frame', 'l-guide'),
              type: 'rectangle',
              origin: { x: 80, y: 90 },
              width: 280,
              height: 260,
              rotationDeg: 0,
            },
            text('ng-label', 'l-guide', { x: 92, y: 398 }, 'ガイド線（レイヤー表示で切替可）', 18),
          ],
          layers: LAYERS,
        }
      default:
        return generalSample(drawingNumber, context.drawingName)
    }
  })()
  const decorations = themeDecorations(context.theme, drawingNumber)
  if (decorations.length === 0) return baseContent
  return { ...baseContent, geometries: [...baseContent.geometries, ...decorations] }
}
