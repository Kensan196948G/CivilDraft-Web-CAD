/**
 * 施工ステップ（出来形の段階）の定義と既定カタログ（詳細設計仕様書 §18）。
 *
 * - 図形（GeometryBase.constructionStepIds）は 0 個以上の対象ステップを持つ。
 *   空配列は「全ステップ共通」と解釈する（判定は stepFilter.ts の共通サービスが担う）。
 * - 既定 6 ステップ（標準値, standard=true）: before / excavation / temporaryWorks /
 *   structure / backfill / completed（施工前 / 掘削時 / 仮設設置時 / 構造物施工時 / 埋戻し時 / 完成時）。
 * - ConstructionStepId は code をそのままブランドとして採用する（決定的・安定 ID）。
 */
import type { ConstructionStepId } from '@/shared/types'

/** 施工ステップ定義（詳細設計仕様書 §18）。 */
export interface ConstructionStep {
  readonly id: ConstructionStepId
  readonly code: string
  readonly name: string
  readonly order: number
  /** 標準ステップ（既定カタログ由来）か、利用者追加のカスタムステップか。 */
  readonly standard: boolean
}

/** 標準ステップの code 一覧（詳細設計仕様書 §18 の標準値、順序どおり）。 */
export const STANDARD_STEP_CODES = [
  'before',
  'excavation',
  'temporaryWorks',
  'structure',
  'backfill',
  'completed',
] as const

export type StandardStepCode = (typeof STANDARD_STEP_CODES)[number]

/** code から ConstructionStepId を作る（code をそのままブランド化）。 */
export function stepIdOf(code: string): ConstructionStepId {
  return code as ConstructionStepId
}

/** 標準 code → 日本語表示名。 */
const STANDARD_STEP_NAMES: Readonly<Record<StandardStepCode, string>> = {
  before: '施工前',
  excavation: '掘削時',
  temporaryWorks: '仮設設置時',
  structure: '構造物施工時',
  backfill: '埋戻し時',
  completed: '完成時',
}

/** 既定 6 ステップのカタログ（順序どおり order=0..5, standard=true）。 */
export const DEFAULT_CONSTRUCTION_STEPS: readonly ConstructionStep[] = STANDARD_STEP_CODES.map(
  (code, index) => ({
    id: stepIdOf(code),
    code,
    name: STANDARD_STEP_NAMES[code],
    order: index,
    standard: true,
  }),
)

/** ID でステップを検索する。該当が無ければ undefined。 */
export function getStepById(
  steps: readonly ConstructionStep[],
  id: ConstructionStepId,
): ConstructionStep | undefined {
  return steps.find((s) => s.id === id)
}

/** 標準ステップのみを order 昇順で返す。 */
export function getStandardSteps(steps: readonly ConstructionStep[]): ConstructionStep[] {
  return steps.filter((s) => s.standard).sort((a, b) => a.order - b.order)
}
