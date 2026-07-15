import { describe, expect, it } from 'vitest'
import type {
  CivilAttribute,
  GeometryId,
  ManualAdjustment,
  QuantityItem,
  QuantityItemId,
  RevisionId,
  RoundingRule,
} from '@/shared/types'
import { QUANTITY_CSV_COLUMNS, exportQuantityCsv, type QuantityCsvContext } from '@/domain/quantities/quantityCsv'

const REVISION = 'rev-1' as RevisionId
const RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }
const CONTEXT: QuantityCsvContext = { projectNumber: 'P-001', drawingNumber: 'D-01', revisionNumber: '2' }

function item(overrides: Partial<QuantityItem>): QuantityItem {
  return {
    id: 'q1' as QuantityItemId,
    revisionId: REVISION,
    groupKey: 'g',
    method: 'length',
    unit: 'm',
    rawValue: 5,
    roundedValue: 5,
    roundingRule: RULE,
    sources: [{ geometryId: 'g1' as GeometryId, contributionRaw: 5 }],
    status: 'valid',
    ...overrides,
  }
}

describe('exportQuantityCsv / 列順（§24.2）', () => {
  it('ヘッダは §24.2 の列順・名称に一致する', () => {
    const { csv } = exportQuantityCsv({ rows: [], context: CONTEXT })
    expect(csv).toBe(QUANTITY_CSV_COLUMNS.join(','))
    expect(QUANTITY_CSV_COLUMNS[0]).toBe('projectNumber')
    expect(QUANTITY_CSV_COLUMNS[9]).toBe('method')
    expect(QUANTITY_CSV_COLUMNS[13]).toBe('sourceGeometryIds')
    expect(QUANTITY_CSV_COLUMNS[14]).toBe('adjustmentReason')
  })

  it('データ行が列順どおりに並ぶ', () => {
    const attr: CivilAttribute = { id: 'a1', category: '掘削', subcategory: '機械', workSectionId: 'W-1', station: 'No.3', tags: [] }
    const { csv } = exportQuantityCsv({ rows: [{ item: item({ workType: '土工', specification: 'BH0.8' }), attribute: attr }], context: CONTEXT })
    const dataRow = csv.split('\r\n')[1]!.split(',')
    expect(dataRow[0]).toBe('P-001') // projectNumber
    expect(dataRow[3]).toBe('W-1') // workSection
    expect(dataRow[5]).toBe('土工') // workType
    expect(dataRow[9]).toBe('length') // method
    expect(dataRow[12]).toBe('m') // unit
    expect(dataRow[13]).toBe('g1') // sourceGeometryIds
  })
})

describe('exportQuantityCsv / CSVインジェクション対策（§24.2）', () => {
  it('先頭が = のテキスト列はアポストロフィでエスケープし記録する', () => {
    const { csv, sanitizations } = exportQuantityCsv({
      rows: [{ item: item({ workType: '=SUM(A1)' }) }],
      context: CONTEXT,
    })
    expect(csv).toContain("'=SUM(A1)")
    expect(sanitizations).toHaveLength(1)
    expect(sanitizations[0]).toMatchObject({ rowIndex: 0, column: 'workType', action: 'escaped', original: '=SUM(A1)' })
  })

  it('先頭が @ の補正理由もエスケープする', () => {
    const adjustment: ManualAdjustment = { originalValue: 5, adjustedValue: 4, reason: '@cmd 実測', adjustedBy: '田中', adjustedAt: '2026-07-15T00:00:00Z' }
    const { csv } = exportQuantityCsv({
      rows: [{ item: item({ status: 'manuallyAdjusted', manualAdjustment: adjustment }) }],
      context: CONTEXT,
    })
    expect(csv).toContain("'@cmd 実測")
  })

  it('数値列（rawValue/roundedValue）の負数はエスケープしない（数値の破壊防止）', () => {
    const { csv, sanitizations } = exportQuantityCsv({
      rows: [{ item: item({ rawValue: -5, roundedValue: -5 }) }],
      context: CONTEXT,
    })
    const dataRow = csv.split('\r\n')[1]!.split(',')
    expect(dataRow[10]).toBe('-5') // rawValue: '-5 ではない
    expect(dataRow[11]).toBe('-5')
    expect(sanitizations).toHaveLength(0)
  })

  it('カンマを含むテキストは RFC4180 で二重引用符に囲む', () => {
    const { csv } = exportQuantityCsv({
      rows: [{ item: item({ specification: 'a,b' }) }],
      context: CONTEXT,
    })
    expect(csv).toContain('"a,b"')
  })
})
