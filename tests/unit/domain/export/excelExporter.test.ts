import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  createCivilDraftWorkbook,
  sanitizeExcelCell,
} from '@/domain/export/excelExporter'

describe('sanitizeExcelCell', () => {
  it('数式インジェクションの起点文字を無害化する', () => {
    expect(sanitizeExcelCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(sanitizeExcelCell('+1+1')).toBe("'+1+1")
    expect(sanitizeExcelCell('-1+1')).toBe("'-1+1")
    expect(sanitizeExcelCell('@cmd')).toBe("'@cmd")
    expect(sanitizeExcelCell('\tcmd')).toBe("'\tcmd")
  })

  it('通常のセル値はそのまま返す', () => {
    expect(sanitizeExcelCell('土工')).toBe('土工')
    expect(sanitizeExcelCell('1,000')).toBe('1,000')
  })
})

describe('createCivilDraftWorkbook', () => {
  it('3シート構成で数量・図面・サマリーを生成する', async () => {
    const bytes = await createCivilDraftWorkbook(
      [
        {
          workType: '掘削工',
          specification: '床堀',
          methodLabel: 'volume',
          unit: 'm3',
          roundedValue: 12.5,
          status: 'valid',
        },
      ],
      [
        {
          drawingNumber: 'D-01',
          name: '仮設平面図',
          revisionNumber: '2',
          status: 'approved',
        },
      ],
      {
        projectName: '試験工事',
        drawingNumber: 'D-01',
        revisionNumber: '2',
        generatedAt: '2026-08-10T00:00:00.000Z',
      },
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['数量明細', '図面リスト', 'サマリー'])

    const quantitySheet = workbook.getWorksheet('数量明細')
    expect(quantitySheet?.getCell('A1').value).toBe('工種')
    expect(quantitySheet?.getCell('A2').value).toBe('掘削工')
    expect(quantitySheet?.getCell('D2').value).toBe(12.5)

    const drawingSheet = workbook.getWorksheet('図面リスト')
    expect(drawingSheet?.getCell('A2').value).toBe('D-01')

    const summarySheet = workbook.getWorksheet('サマリー')
    expect(summarySheet?.getCell('A2').value).toBe('案件名')
    expect(summarySheet?.getCell('B2').value).toBe('試験工事')
  })

  it('インジェクション起点のセル値を無害化して保存する', async () => {
    const bytes = await createCivilDraftWorkbook(
      [
        {
          workType: '=HYPERLINK("http://example.com","x")',
          specification: undefined,
          methodLabel: 'manual',
          unit: 'custom',
          roundedValue: 1,
          status: 'valid',
        },
      ],
      [],
      { projectName: '@test', generatedAt: '2026-08-10T00:00:00.000Z' },
    )

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    const quantitySheet = workbook.getWorksheet('数量明細')
    expect(quantitySheet?.getCell('A2').value).toMatch(/^'=HYPERLINK/)
    const summarySheet = workbook.getWorksheet('サマリー')
    expect(summarySheet?.getCell('B2').value).toMatch(/^'@test/)
  })
})
