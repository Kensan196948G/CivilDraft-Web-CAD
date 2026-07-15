/**
 * 数量明細（QuantityItem）の構築と手動補正（詳細設計仕様書 §17.1 / §17.4）。
 *
 * 構築（buildQuantityItem）は複数図形の丸め前寄与を合計してから丸める（§17.3
 * 「丸め前値を合計してから集計単位で丸める」規則を明細生成にも適用）。
 * 手動補正（applyManualAdjustment）は自動値を rawValue に温存したまま roundedValue を
 * 人手値で上書きし、元値・補正値・理由・実施者・日時を ManualAdjustment に保持する（§17.4）。
 */
import type {
  Geometry,
  ManualAdjustment,
  QuantityItem,
  QuantityItemId,
  QuantityMethod,
  QuantitySource,
  QuantityUnit,
  Result,
  RevisionId,
  RoundingRule,
  ValidationIssue,
} from '@/shared/types'
import { computeContribution, type VolumeOptions } from './quantityCalculator'
import { applyRounding } from './rounding'

/** buildQuantityItem の入力。geometries の各寄与を合算して 1 明細を構成する。 */
export interface BuildQuantityItemInput {
  readonly id: QuantityItemId
  readonly revisionId: RevisionId
  readonly groupKey: string
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly roundingRule: RoundingRule
  readonly geometries: readonly Geometry[]
  readonly workType?: string
  readonly specification?: string
  /** volume 算出時の厚さ（面積×厚さ, §17.2）。他の算出区分では無視する。 */
  readonly volume?: VolumeOptions
}

/**
 * 自動算出の数量明細を構築する（§17.1 / §17.3 sum-then-round）。
 * method='manual' は自動算出できないため使用不可（buildManualQuantityItem を使う）。
 * 図形が空、または一部図形が算出不能な場合は全 ValidationIssue を集約してエラーを返す。
 */
export function buildQuantityItem(
  input: BuildQuantityItemInput,
): Result<QuantityItem, readonly ValidationIssue[]> {
  if (input.method === 'manual') {
    return {
      ok: false,
      error: [{ code: 'QTY_MANUAL_BUILD_UNSUPPORTED', severity: 'error', message: 'manual は buildManualQuantityItem を使用する' }],
    }
  }
  if (input.geometries.length === 0) {
    return {
      ok: false,
      error: [{ code: 'QTY_NO_SOURCE', severity: 'error', message: '数量明細には少なくとも1つの根拠図形が必要', entityId: input.id }],
    }
  }

  const sources: QuantitySource[] = []
  const issues: ValidationIssue[] = []
  for (const geometry of input.geometries) {
    const contribution = computeContribution(geometry, input.method, input.unit, { volume: input.volume })
    if (!contribution.ok) {
      issues.push(contribution.error)
      continue
    }
    sources.push({ geometryId: geometry.id, contributionRaw: contribution.value })
  }
  if (issues.length > 0) return { ok: false, error: issues }

  const rawValue = sources.reduce((sum, source) => sum + source.contributionRaw, 0)
  const item: QuantityItem = {
    id: input.id,
    revisionId: input.revisionId,
    groupKey: input.groupKey,
    workType: input.workType,
    specification: input.specification,
    method: input.method,
    unit: input.unit,
    rawValue,
    roundedValue: applyRounding(rawValue, input.roundingRule),
    roundingRule: input.roundingRule,
    sources,
    status: 'valid',
  }
  return { ok: true, value: item }
}

/** 手動補正・純手動明細の共通入力。理由・実施者・日時は必須（§17.4）。 */
export interface ManualAdjustmentInput {
  readonly adjustedValue: number
  readonly reason: string
  readonly adjustedBy: string
  readonly adjustedAt: string
}

function validateManualInput(input: ManualAdjustmentInput, entityId: string): ValidationIssue | null {
  if (input.reason.trim() === '') {
    return { code: 'QTY_ADJUSTMENT_REASON_REQUIRED', severity: 'error', field: 'reason', message: '手動補正には理由が必須', entityId }
  }
  if (input.adjustedBy.trim() === '') {
    return { code: 'QTY_ADJUSTMENT_ACTOR_REQUIRED', severity: 'error', field: 'adjustedBy', message: '手動補正には実施者が必須', entityId }
  }
  if (input.adjustedAt.trim() === '') {
    return { code: 'QTY_ADJUSTMENT_TIMESTAMP_REQUIRED', severity: 'error', field: 'adjustedAt', message: '手動補正には日時が必須', entityId }
  }
  if (!Number.isFinite(input.adjustedValue)) {
    return { code: 'QTY_ADJUSTMENT_VALUE_INVALID', severity: 'error', field: 'adjustedValue', message: '補正値が数値でない', entityId }
  }
  return null
}

/**
 * 既存の自動数量明細を手動補正する（§17.4）。
 * 自動値（roundedValue）を ManualAdjustment.originalValue へ退避し、rawValue は温存する。
 * 理由・実施者・日時のいずれか欠落時はエラーを返す（自動値は変更しない）。
 */
export function applyManualAdjustment(
  item: QuantityItem,
  input: ManualAdjustmentInput,
): Result<QuantityItem, ValidationIssue> {
  const validationError = validateManualInput(input, item.id)
  if (validationError !== null) return { ok: false, error: validationError }

  const adjustment: ManualAdjustment = {
    originalValue: item.roundedValue,
    adjustedValue: input.adjustedValue,
    reason: input.reason,
    adjustedBy: input.adjustedBy,
    adjustedAt: input.adjustedAt,
  }
  return {
    ok: true,
    value: { ...item, roundedValue: input.adjustedValue, status: 'manuallyAdjusted', manualAdjustment: adjustment },
  }
}

/**
 * 手動補正を取り消し、自動値へ戻す（rawValue から丸め規則で roundedValue を再導出）。
 * 補正が無い明細はそのまま返す。純手動明細（method='manual'）は自動値が無いため取消不可としてそのまま返す。
 */
export function revertManualAdjustment(item: QuantityItem): QuantityItem {
  if (item.manualAdjustment === undefined || item.method === 'manual') return item
  return {
    id: item.id,
    revisionId: item.revisionId,
    groupKey: item.groupKey,
    workType: item.workType,
    specification: item.specification,
    method: item.method,
    unit: item.unit,
    rawValue: item.rawValue,
    roundedValue: applyRounding(item.rawValue, item.roundingRule),
    roundingRule: item.roundingRule,
    sources: item.sources,
    status: 'valid',
  }
}

/** buildManualQuantityItem の入力。自動算出できない数量を人手値で起票する（§17.2 manual）。 */
export interface BuildManualQuantityItemInput {
  readonly id: QuantityItemId
  readonly revisionId: RevisionId
  readonly groupKey: string
  readonly unit: QuantityUnit
  readonly roundingRule: RoundingRule
  readonly adjustment: ManualAdjustmentInput
  readonly workType?: string
  readonly specification?: string
}

/**
 * 純手動の数量明細（method='manual'）を構築する（§17.2 / §17.4）。
 * 自動算出の根拠を持たないため sources は空、originalValue は 0（自動基準なし）とする。
 * 理由・実施者・日時のいずれか欠落時はエラーを返す。
 */
export function buildManualQuantityItem(
  input: BuildManualQuantityItemInput,
): Result<QuantityItem, ValidationIssue> {
  const validationError = validateManualInput(input.adjustment, input.id)
  if (validationError !== null) return { ok: false, error: validationError }

  const adjustment: ManualAdjustment = {
    originalValue: 0,
    adjustedValue: input.adjustment.adjustedValue,
    reason: input.adjustment.reason,
    adjustedBy: input.adjustment.adjustedBy,
    adjustedAt: input.adjustment.adjustedAt,
  }
  const item: QuantityItem = {
    id: input.id,
    revisionId: input.revisionId,
    groupKey: input.groupKey,
    workType: input.workType,
    specification: input.specification,
    method: 'manual',
    unit: input.unit,
    rawValue: input.adjustment.adjustedValue,
    roundedValue: applyRounding(input.adjustment.adjustedValue, input.roundingRule),
    roundingRule: input.roundingRule,
    sources: [],
    status: 'manuallyAdjusted',
    manualAdjustment: adjustment,
  }
  return { ok: true, value: item }
}
