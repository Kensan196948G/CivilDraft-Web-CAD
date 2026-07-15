/**
 * 詳細設計仕様書 §14 土木属性 / §17 数量計算 の共有型。
 * 図形本体（geometry.ts）とは分離し、GeometryBase.civilAttributeId から
 * 本ファイルの CivilAttribute.id を任意参照する（§6 図形データモデルの拡張リンク）。
 *
 * 数値はいずれも QuantityUnit で表現した表示単位の値であり、ADR-0012 の内部座標基準
 * （mm/mm²/mm³）とは異なる。内部基準⇔表示単位の変換は domain/quantities（domain/units 経由）
 * に集約する。本ファイルは型のみを定義する。
 */
import type { GeometryId, QuantityItemId, RevisionId } from './brand'

/**
 * §14 数量単位。m/m2/m3 は寸法を持つ換算対象、count/set は無次元、
 * custom はマスター外の自由単位（換算対象外）。
 */
export type QuantityUnit = 'm' | 'm2' | 'm3' | 'count' | 'set' | 'custom'

/**
 * §14 / §17.2 算出区分。length=延長、area=面積、perimeter=外周、count=個数、
 * volume=簡易体積（面積×厚さ等）、manual=自動算出不可（値・理由・実施者を必須）。
 */
export type QuantityMethod = 'length' | 'area' | 'perimeter' | 'count' | 'volume' | 'manual'

/**
 * §14 土木属性。工種/種別/細別/規格/単位/工区/測点等。
 * 属性欠損は作図自体を禁止せず、数量確定・照査提出時に検査する（§14 末尾）。
 * マスター値と自由入力値の区別は §14 の要求だが、型上はどちらも同一フィールドで保持し、
 * マスター参照の有無は上位（マスター解決層）で管理する。
 */
export interface CivilAttribute {
  readonly id: string
  readonly workType?: string
  readonly category?: string
  readonly subcategory?: string
  readonly specification?: string
  readonly unit?: QuantityUnit
  readonly quantityMethod?: QuantityMethod
  readonly projectNumber?: string
  readonly workSectionId?: string
  readonly station?: string
  readonly tags: readonly string[]
}

/**
 * §14 複数図形一括編集用の Patch 型。変更対象フィールドだけを明示する。
 * id は同一性の基準のため Patch では変更不可（対象外）とする。
 * undefined を明示的に設定してフィールドを消去したい場合と区別するため、
 * 「フィールド未指定＝変更しない」という運用にする（applyCivilAttributePatch 参照）。
 */
export type CivilAttributePatch = Partial<Omit<CivilAttribute, 'id'>>

/**
 * §17.1 数量根拠。1 図形が数量へ寄与する丸め前の値（QuantityUnit 表示単位）。
 */
export interface QuantitySource {
  readonly geometryId: GeometryId
  readonly contributionRaw: number
}

/**
 * §17.1 丸め規則。丸め処理は一か所（domain/quantities/rounding）へ集約し、
 * 浮動小数点誤差を業務表示へ露出させない（§17.3）。
 */
export interface RoundingRule {
  readonly mode: 'halfUp' | 'halfEven' | 'floor' | 'ceil' | 'truncate'
  readonly decimalPlaces: number
}

/**
 * §17.4 手動補正。自動値を上書き消去せず、元値・補正値・理由・実施者・日時を保持する。
 * 差（adjustedValue - originalValue）は導出値のため保持しない。
 */
export interface ManualAdjustment {
  readonly originalValue: number
  readonly adjustedValue: number
  readonly reason: string
  readonly adjustedBy: string
  readonly adjustedAt: string
}

/**
 * §17.1 数量状態。
 * valid=最新、stale=依存変更により再計算待ち（照査提出・確定版作成を禁止, §17.3）、
 * invalid=根拠図形の欠落等で算出不能、manuallyAdjusted=手動補正済み。
 */
export type QuantityStatus = 'valid' | 'stale' | 'invalid' | 'manuallyAdjusted'

/**
 * §17.1 数量明細。CSV 出力列（§24.2）と 1 対 1 で整合する（rawValue/roundedValue/unit/
 * method/sources=sourceGeometryIds/manualAdjustment.reason=adjustmentReason）。
 * groupKey は集計単位の識別子（工種・規格等から導出）。
 */
export interface QuantityItem {
  readonly id: QuantityItemId
  readonly revisionId: RevisionId
  readonly groupKey: string
  readonly workType?: string
  readonly specification?: string
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly rawValue: number
  readonly roundedValue: number
  readonly roundingRule: RoundingRule
  readonly sources: readonly QuantitySource[]
  readonly status: QuantityStatus
  readonly manualAdjustment?: ManualAdjustment
}
