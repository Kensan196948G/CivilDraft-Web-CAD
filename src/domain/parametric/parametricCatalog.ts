/**
 * パラメトリック定義カタログとオーケストレーション（詳細設計仕様書 §15.1・§15.2）。
 *
 * PARAMETRIC_CATALOG は §15.1 の 7 テンプレートを readonly 配列で保持する
 * （templateCatalog.TEMPLATE_CATALOG と同じ様式）。generateParametric は
 * 「validate → generate」を Result で束ね、regenerate は §15.2 の再生成規則
 * （パラメータを正本とし生成図形は派生物、旧 ID 破棄・新 ID 発番、定義版を保持）を実装する。
 */
import type { Geometry, GeometryId, ParametricGeometry, Result, ValidationIssue } from '@/shared/types'
import type { GenerationContext } from './generationContext'
import type { ParametricObjectDefinition, ParametricParams } from './parametricTypes'
import { heavyMachineRadiusDefinition } from './definitions/heavyMachineRadius'
import { craneWorkingSectorDefinition } from './definitions/craneWorkingSector'
import { steelPlateArrayDefinition } from './definitions/steelPlateArray'
import { temporaryFenceDefinition } from './definitions/temporaryFence'
import { barricadeLineDefinition } from './definitions/barricadeLine'
import { slopePatternDefinition } from './definitions/slopePattern'
import { trafficRouteDefinition } from './definitions/trafficRoute'

/** §15.1 の対象テンプレート（7 定義）。definitionId は一意。 */
export const PARAMETRIC_CATALOG: readonly ParametricObjectDefinition[] = [
  heavyMachineRadiusDefinition,
  craneWorkingSectorDefinition,
  steelPlateArrayDefinition,
  temporaryFenceDefinition,
  barricadeLineDefinition,
  slopePatternDefinition,
  trafficRouteDefinition,
]

/** definitionId で定義を検索する（getTemplateById と対称）。該当なしは undefined。 */
export function getDefinitionById(id: string): ParametricObjectDefinition | undefined {
  return PARAMETRIC_CATALOG.find((def) => def.definitionId === id)
}

/**
 * パラメータを検証してから図形を生成する。severity:'error' が 1 件でもあれば
 * 生成せず全 ValidationIssue を error として返す（warning/info のみなら生成する）。
 */
export function generateParametric(
  definition: ParametricObjectDefinition,
  params: ParametricParams,
  ctx: GenerationContext,
): Result<readonly Geometry[], readonly ValidationIssue[]> {
  const issues = definition.validate(params)
  if (issues.some((issue) => issue.severity === 'error')) {
    return { ok: false, error: issues }
  }
  return { ok: true, value: definition.generate(params, ctx) }
}

/** regenerate の成功結果。更新後の parametric 本体と、新規発番された派生図形群。 */
export interface RegenerateResult {
  /** generatedGeometryIds を新 ID へ差し替え、definitionVersion / updatedAt を更新した本体。 */
  readonly parametric: ParametricGeometry
  /** 新パラメータで生成した派生図形（新 ID 付き）。旧図形は呼び出し側が破棄する。 */
  readonly generated: readonly Geometry[]
}

/**
 * §15.2 の再生成規則に従い、ParametricGeometry を現在の parameters で再生成する。
 *
 * - パラメータを正本とし、generatedGeometryIds の旧図形群は破棄対象（本関数は純粋関数のため
 *   実際の削除は呼び出し側の責務。返す parametric.generatedGeometryIds には旧 ID を含めない）。
 * - 生成図形には ctx.newId() で新 ID を発番し、parametric.generatedGeometryIds を差し替える。
 * - definitionVersion をカタログ定義の version へ更新し（定義版を保持）、updatedAt を更新する。
 * - 定義が見つからない／パラメータ不正のときは ValidationIssue を返し、本体は変更しない。
 */
export function regenerate(
  parametric: ParametricGeometry,
  definitions: readonly ParametricObjectDefinition[],
  ctx: GenerationContext,
): Result<RegenerateResult, readonly ValidationIssue[]> {
  const definition = definitions.find((def) => def.definitionId === parametric.definitionId)
  if (definition === undefined) {
    return {
      ok: false,
      error: [
        {
          code: 'PARAMETRIC_DEFINITION_NOT_FOUND',
          severity: 'error',
          entityId: parametric.id,
          message: `パラメトリック定義が見つかりません: ${parametric.definitionId}`,
        },
      ],
    }
  }

  const generation = generateParametric(definition, parametric.parameters, ctx)
  if (!generation.ok) return { ok: false, error: generation.error }

  const generated = generation.value
  const generatedGeometryIds: readonly GeometryId[] = generated.map((geometry) => geometry.id)
  const updated: ParametricGeometry = {
    ...parametric,
    definitionVersion: definition.version,
    generatedGeometryIds,
    updatedAt: ctx.now(),
  }

  return { ok: true, value: { parametric: updated, generated } }
}
