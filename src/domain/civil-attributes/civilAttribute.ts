/**
 * 土木属性（CivilAttribute）の検証・一括編集・表示名スナップショット（詳細設計仕様書 §14）。
 *
 * §14 の 4 要求を実装で担保する:
 *  1. マスター値と自由入力値の区別 … MASTER_CANDIDATE_FIELDS / FREE_INPUT_FIELDS で区分する。
 *  2. 過去改訂の表示不変 … 確定改訂用に snapshotDisplayName で表示名を凍結する。
 *  3. 複数図形一括編集 … CivilAttributePatch を applyCivilAttributePatch で適用する。
 *  4. 属性欠損は作図では禁止せず数量確定・照査提出時に検査 … validateAttributeForQuantity。
 *
 * 単位(unit)と算出区分(quantityMethod)の整合規則は数量側と同一のため domain/quantities を参照する。
 */
import type { CivilAttribute, CivilAttributePatch, ValidationIssue } from '@/shared/types'
import { isUnitConsistentWithMethod } from '@/domain/quantities/quantityUnits'

/** マスター（工種体系）で管理される候補フィールド。マスター変更の影響を受けうる（§14）。 */
export const MASTER_CANDIDATE_FIELDS = [
  'workType',
  'category',
  'subcategory',
  'specification',
  'unit',
  'quantityMethod',
] as const satisfies readonly (keyof CivilAttribute)[]

/** 案件固有の自由入力フィールド。マスターに依存しない（§14 マスター値/自由入力の区別）。 */
export const FREE_INPUT_FIELDS = [
  'projectNumber',
  'workSectionId',
  'station',
  'tags',
] as const satisfies readonly (keyof CivilAttribute)[]

/**
 * 属性の構造的検証（作図時にも使える緩い検査）。
 * unit と quantityMethod が両方存在し次元不整合な場合のみエラーを立てる。
 * 欠損はここでは許容する（§14: 作図自体は禁止しない）。
 */
export function validateCivilAttribute(attribute: CivilAttribute): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (
    attribute.quantityMethod !== undefined &&
    attribute.unit !== undefined &&
    !isUnitConsistentWithMethod(attribute.quantityMethod, attribute.unit)
  ) {
    issues.push({
      code: 'CIVIL_UNIT_METHOD_MISMATCH',
      severity: 'error',
      entityId: attribute.id,
      message: `単位 ${attribute.unit} と算出区分 ${attribute.quantityMethod} が不整合`,
    })
  }
  return issues
}

/**
 * 数量確定・照査提出のための完全性検査（§14 末尾）。
 * 工種・単位・算出区分の欠落を error として列挙する。作図時ではなく確定時に呼ぶ。
 */
export function validateAttributeForQuantity(attribute: CivilAttribute): ValidationIssue[] {
  const issues: ValidationIssue[] = [...validateCivilAttribute(attribute)]
  if (attribute.workType === undefined || attribute.workType.trim() === '') {
    issues.push({ code: 'CIVIL_WORKTYPE_REQUIRED', severity: 'error', field: 'workType', entityId: attribute.id, message: '数量確定には工種が必須' })
  }
  if (attribute.unit === undefined) {
    issues.push({ code: 'CIVIL_UNIT_REQUIRED', severity: 'error', field: 'unit', entityId: attribute.id, message: '数量確定には単位が必須' })
  }
  if (attribute.quantityMethod === undefined) {
    issues.push({ code: 'CIVIL_METHOD_REQUIRED', severity: 'error', field: 'quantityMethod', entityId: attribute.id, message: '数量確定には算出区分が必須' })
  }
  return issues
}

/**
 * 一括編集の Patch を適用する（§14 複数図形一括編集）。
 * Patch に「現れないキー」および「値が undefined のキー」は変更しない（変更対象だけを明示する運用）。
 * id は同一性の基準のため Patch の対象外（型でも Omit 済み）。
 */
export function applyCivilAttributePatch(
  attribute: CivilAttribute,
  patch: CivilAttributePatch,
): CivilAttribute {
  const next: Record<string, unknown> = { ...attribute }
  for (const [key, value] of Object.entries(patch)) {
    // 値が undefined のキーは「変更しない」ため飛ばす（変更対象だけを明示する運用）。
    if (value !== undefined) next[key] = value
  }
  // next は attribute の全キー（id/tags 含む）を保持したうえで Patch を上書きしたもの。
  return next as unknown as CivilAttribute
}

/**
 * 複数属性へ同一 Patch を適用する（複数図形一括編集の実行本体）。
 * 各要素へ applyCivilAttributePatch を適用した新配列を返す（入力は不変）。
 */
export function applyCivilAttributePatchToMany(
  attributes: readonly CivilAttribute[],
  patch: CivilAttributePatch,
): CivilAttribute[] {
  return attributes.map((attribute) => applyCivilAttributePatch(attribute, patch))
}

/**
 * 集計・数量明細の groupKey を属性から導出する（工種/種別/細別/規格/単位/算出区分）。
 * 同一分類の図形が同一鍵に集まるよう安定な連結にする。未設定フィールドは空で埋める。
 */
export function deriveGroupKey(attribute: CivilAttribute): string {
  return [
    attribute.workType ?? '',
    attribute.category ?? '',
    attribute.subcategory ?? '',
    attribute.specification ?? '',
    attribute.unit ?? '',
    attribute.quantityMethod ?? '',
  ].join('|')
}

/**
 * 確定改訂用の表示名スナップショット（§14 過去改訂の表示不変）。
 * マスター変更後も過去改訂の表示が変わらないよう、確定時点の分類名を 1 本の文字列へ凍結する。
 * 例: "土工 / 掘削 / 機械掘削 [BH0.8]"。規格があれば角括弧で付す。
 */
export function snapshotDisplayName(attribute: CivilAttribute): string {
  const classification = [attribute.workType, attribute.category, attribute.subcategory]
    .filter((part): part is string => part !== undefined && part.trim() !== '')
    .join(' / ')
  const spec = attribute.specification?.trim()
  const base = classification === '' ? '(未分類)' : classification
  return spec !== undefined && spec !== '' ? `${base} [${spec}]` : base
}

/** 確定改訂に保存する属性スナップショット（表示名を凍結した監査用レコード）。 */
export interface CivilAttributeSnapshot {
  readonly attributeId: string
  readonly displayName: string
  readonly snapshotAt: string
}

/** 属性から表示名スナップショットを生成する（確定改訂の作成時に呼ぶ）。 */
export function createAttributeSnapshot(attribute: CivilAttribute, snapshotAt: string): CivilAttributeSnapshot {
  return { attributeId: attribute.id, displayName: snapshotDisplayName(attribute), snapshotAt }
}
