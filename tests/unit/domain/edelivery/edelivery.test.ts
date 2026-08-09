import { describe, expect, it } from 'vitest'
import {
  DELIVERY_FOLDERS,
  DELIVERY_STANDARD,
  checkDeliveryFiles,
  deliveryCheckToCsv,
  deliveryFolderTree,
  validateFileName,
  validateFolder,
} from '@/domain/edelivery'

describe('edeliveryRules / フォルダ・命名規則', () => {
  it('標準フォルダは 10 種（土木工事編）', () => {
    expect(DELIVERY_FOLDERS).toContain('DRAWINGF')
    expect(DELIVERY_FOLDERS).toContain('OTHRS')
    expect(DELIVERY_FOLDERS).toHaveLength(10)
  })

  it('適用基準の版・出典が明示されている', () => {
    expect(DELIVERY_STANDARD.revision).toBe('R5.3')
    expect(DELIVERY_STANDARD.publisher).toBe('国土交通省')
    expect(DELIVERY_STANDARD.name).toContain('令和5年3月版')
  })

  it('validateFolder: 許容フォルダは小文字でも OK、不明フォルダはエラー', () => {
    expect(validateFolder('drawingf')).toBeNull()
    expect(validateFolder('DRAWINGF')).toBeNull()
    expect(validateFolder('PHOTO')?.code).toBe('EDELIVERY_UNKNOWN_FOLDER')
  })

  it('validateFileName: 半角英数字のみ許可、全角・禁則文字・記号はエラー', () => {
    expect(validateFileName('0001-001_SXF.P21')).toBeNull()
    expect(validateFileName('')).not.toBeNull()
    expect(validateFileName('施工図.pdf')?.code).toBe('EDELIVERY_NON_ASCII_NAME')
    expect(validateFileName('a/b.pdf')?.code).toBe('EDELIVERY_FORBIDDEN_CHAR')
    expect(validateFileName('①.pdf')?.code).toBe('EDELIVERY_FORBIDDEN_CHAR')
  })
})

describe('checkDeliveryFiles / 検査', () => {
  it('SXF + PDF/A の正常構成はエラーなし（警告は DRAWINGF 対応でゼロ）', () => {
    const result = checkDeliveryFiles([
      { folder: 'DRAWINGF', fileName: '0001-001.P21' },
      { folder: 'DRAWINGF', fileName: 'DRAWINGF.XML' },
      { folder: 'PLAN', fileName: 'sekoukeikaku.pdf', pdfA: true },
    ])
    expect(result.errorCount).toBe(0)
    expect(result.warningCount).toBe(0)
    expect(result.requiresHumanConfirmation).toBe(true)
  })

  it('DXF は標準外形式として警告、全角ファイル名はエラー', () => {
    const result = checkDeliveryFiles([
      { folder: 'DRAWINGF', fileName: '施工図.dxf' },
    ])
    expect(result.errorCount).toBeGreaterThanOrEqual(1)
    expect(result.warningCount).toBeGreaterThanOrEqual(1)
    const codes = result.issues.map((issue) => issue.code)
    expect(codes).toContain('EDELIVERY_FORMAT_NOT_STANDARD')
  })

  it('DRAWINGF に図面が無い場合は警告', () => {
    const result = checkDeliveryFiles([{ folder: 'PLAN', fileName: 'plan.pdf', pdfA: true }])
    expect(result.issues.some((issue) => issue.code === 'EDELIVERY_NO_DRAWING_FILES')).toBe(true)
  })

  it('PDF で PDF/A 未確認は警告', () => {
    const result = checkDeliveryFiles([
      { folder: 'DRAWINGF', fileName: '0001.P21' },
      { folder: 'PLAN', fileName: 'plan.pdf' },
    ])
    expect(result.issues.some((issue) => issue.code === 'EDELIVERY_PDFA_NOT_CONFIRMED')).toBe(true)
  })
})

describe('deliveryCheckToCsv / 管理ファイル', () => {
  it('案件情報・ファイル明細・集計を含む CSV を生成する', () => {
    const files = [{ folder: 'DRAWINGF', fileName: '0001-001.P21' }]
    const result = checkDeliveryFiles(files)
    const csv = deliveryCheckToCsv(
      {
        projectName: 'テスト工事',
        projectNumber: 'R05-001',
        clientName: '検査員A',
        workType: '道路改良',
        orderer: '発注者B',
        standard: DELIVERY_STANDARD.name,
      },
      files,
      result,
    )
    expect(csv).toContain('テスト工事')
    expect(csv).toContain('0001-001.P21')
    expect(csv).toContain('最終確認者')
    expect(csv).toContain('総ファイル数')
  })
})

describe('deliveryFolderTree / 構成案内', () => {
  it('標準フォルダの案内ツリーを返す', () => {
    const tree = deliveryFolderTree()
    expect(tree).toContain('DRAWINGF')
    expect(tree).toContain('INDEX_C.XML')
    expect(tree).toContain('OTHRS')
  })
})
