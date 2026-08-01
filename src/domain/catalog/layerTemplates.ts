/**
 * 工種別の既定レイヤーテンプレート（詳細設計仕様書 §6.3 / Issue #40）。
 *
 * 土木の図面種別ごとに、実務で使うレイヤーセット（名前・既定色・線種・線幅・印刷可否）を
 * 提供する。適用時は既存レイヤーを残し、同名レイヤーが無いものだけを追加する
 * （editorStore.applyLayerTemplate の仕様。破壊的な置き換えは行わない）。
 */
import type { GeometryStyle } from '@/shared/types'

export interface LayerTemplateLayer {
  readonly name: string
  readonly strokeColor: string
  readonly lineType: GeometryStyle['lineType']
  /** 線幅（px 相当）。 */
  readonly lineWidth: number
  readonly printable: boolean
}

export interface LayerTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly layers: readonly LayerTemplateLayer[]
}

const continuous: GeometryStyle['lineType'] = 'continuous'
const dashed: GeometryStyle['lineType'] = 'dashed'
const dashDot: GeometryStyle['lineType'] = 'dashDot'

export const LAYER_TEMPLATES: readonly LayerTemplate[] = [
  {
    id: 'temporary-yard',
    name: '施工ヤード計画図',
    description: '基準線・構造物・仮設・車両動線・安全設備・測点・数量根拠・注記',
    layers: [
      { name: '基準線', strokeColor: '#141C29', lineType: continuous, lineWidth: 1, printable: true },
      { name: '構造物', strokeColor: '#C0392B', lineType: continuous, lineWidth: 1.5, printable: true },
      { name: '仮設', strokeColor: '#2C6E9E', lineType: continuous, lineWidth: 1, printable: true },
      { name: '車両動線', strokeColor: '#2E9E6B', lineType: dashed, lineWidth: 1, printable: true },
      { name: '安全設備', strokeColor: '#E08A2B', lineType: dashDot, lineWidth: 1, printable: true },
      { name: '測点', strokeColor: '#7A5FA0', lineType: continuous, lineWidth: 1, printable: true },
      { name: '数量根拠', strokeColor: '#8A5A12', lineType: dashed, lineWidth: 0.5, printable: true },
      { name: '注記', strokeColor: '#6B7280', lineType: continuous, lineWidth: 0.5, printable: true },
    ],
  },
  {
    id: 'temporary-works',
    name: '仮設計画図',
    description: '仮設・構造・安全設備・注記',
    layers: [
      { name: '仮設', strokeColor: '#2C6E9E', lineType: continuous, lineWidth: 1.5, printable: true },
      { name: '構造', strokeColor: '#141C29', lineType: continuous, lineWidth: 1, printable: true },
      { name: '安全設備', strokeColor: '#E08A2B', lineType: dashDot, lineWidth: 1, printable: true },
      { name: '注記', strokeColor: '#6B7280', lineType: continuous, lineWidth: 0.5, printable: true },
    ],
  },
  {
    id: 'survey',
    name: '測量図',
    description: '基準線・測点・地形・注記',
    layers: [
      { name: '基準線', strokeColor: '#141C29', lineType: continuous, lineWidth: 1, printable: true },
      { name: '測点', strokeColor: '#7A5FA0', lineType: continuous, lineWidth: 1, printable: true },
      { name: '地形', strokeColor: '#2E9E6B', lineType: continuous, lineWidth: 0.5, printable: true },
      { name: '注記', strokeColor: '#6B7280', lineType: continuous, lineWidth: 0.5, printable: true },
    ],
  },
  {
    id: 'quantity',
    name: '数量根拠図',
    description: '数量根拠・基準線・注記',
    layers: [
      { name: '数量根拠', strokeColor: '#8A5A12', lineType: dashed, lineWidth: 1, printable: true },
      { name: '基準線', strokeColor: '#141C29', lineType: continuous, lineWidth: 1, printable: true },
      { name: '注記', strokeColor: '#6B7280', lineType: continuous, lineWidth: 0.5, printable: true },
    ],
  },
  {
    id: 'general',
    name: '汎用作図',
    description: '主線・補助線・注記',
    layers: [
      { name: '主線', strokeColor: '#141C29', lineType: continuous, lineWidth: 1, printable: true },
      { name: '補助線', strokeColor: '#6B7280', lineType: dashed, lineWidth: 0.5, printable: false },
      { name: '注記', strokeColor: '#6B7280', lineType: continuous, lineWidth: 0.5, printable: true },
    ],
  },
]

export function findLayerTemplate(templateId: string): LayerTemplate | undefined {
  return LAYER_TEMPLATES.find((template) => template.id === templateId)
}
