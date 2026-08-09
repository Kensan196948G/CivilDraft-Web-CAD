import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { filterRedactedContent, redactPdfText } from '@/domain/pdf/pdfRedact'
import type { PdfRect } from '@/domain/pdf/pdfEdit'

async function makeTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('KEEP_THIS_VISIBLE', { x: 20, y: 150, size: 12, font })
  page.drawText('SECRET_TEXT_MUST_GO', { x: 20, y: 60, size: 12, font })
  return doc.save()
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPage(0)
  const contents = page.node.Contents()
  const streams: PDFRawStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const item = contents.lookup(i)
      if (item instanceof PDFRawStream) streams.push(item)
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents)
  }
  return streams.map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n')
}

describe('filterRedactedContent / テキスト演算子フィルタ', () => {
  const rects: readonly PdfRect[] = [{ pageIndex: 0, x: 10, y: 45, width: 260, height: 30 }]

  it('墨消し領域に重なる Tj のみを除去し、他は保持する', () => {
    // Td は相対移動。2 番目の文字列は (20,150) + (0,-90) = (20,60) に配置される。
    const content = 'BT /F1 12 Tf 20 150 Td (KEEP_THIS_VISIBLE) Tj 0 -90 Td (SECRET_TEXT_MUST_GO) Tj ET'
    const result = filterRedactedContent(content, rects)
    expect(result.removedText).toEqual(['SECRET_TEXT_MUST_GO'])
    expect(result.rebuilt).toContain('KEEP_THIS_VISIBLE')
    expect(result.rebuilt).not.toContain('SECRET_TEXT_MUST_GO')
  })

  it('TJ 配列も領域内なら丸ごと除去する', () => {
    const content = 'BT /F1 12 Tf 20 150 Td 0 -90 Td [(SECRET_TEXT_MUST_GO)] TJ ET'
    const result = filterRedactedContent(content, rects)
    expect(result.removedText).toEqual(['SECRET_TEXT_MUST_GO'])
    expect(result.rebuilt).not.toContain('SECRET_TEXT_MUST_GO')
  })
})

describe('redactPdfText / PDF 全体', () => {
  it('対象文字列を物理削除し、非対象文字列を保持する', async () => {
    const pdf = await makeTextPdf()
    const result = await redactPdfText(pdf, [
      { pageIndex: 0, x: 10, y: 45, width: 260, height: 30 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.removedTextCount).toBeGreaterThanOrEqual(1)
    expect(result.value.issues.length).toBeGreaterThan(0)

    const text = await pageText(result.value.bytes)
    // pdf-lib はサブセットフォントのため文字列を hex で書く。物理削除の検証は
    // 各文字列の hex 表現の有無で行う。
    const keepHex = '4B4545505F544849535F56495349424C45' // KEEP_THIS_VISIBLE
    const secretHex = '5345435245545F544558545F4D5553545F474F' // SECRET_TEXT_MUST_GO
    expect(text).not.toContain(secretHex)
    expect(text).toContain(keepHex)
  })

  it('ページ範囲外はエラー、空領域はエラー', async () => {
    const pdf = await makeTextPdf()
    const badPage = await redactPdfText(pdf, [{ pageIndex: 9, x: 0, y: 0, width: 10, height: 10 }])
    expect(badPage.ok).toBe(false)
    const empty = await redactPdfText(pdf, [])
    expect(empty.ok).toBe(false)
  })
})
