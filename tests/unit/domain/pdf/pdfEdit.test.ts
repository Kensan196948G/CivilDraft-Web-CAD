import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  addPdfWatermark,
  getPdfPageCount,
  mergePdfBytes,
  redactPdfPages,
  rotatePdfPages,
  splitPdfBytes,
} from '@/domain/pdf/pdfEdit'

async function makePdf(label: string, pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200])
    page.drawText(`${label}-${i + 1}`, { x: 20, y: 100, size: 16, font })
  }
  return doc.save()
}

describe('pdfEdit / 結合・分割・回転・透かし・墨消し', () => {
  it('getPdfPageCount: ページ数を返す（不正バイトはエラー）', async () => {
    const pdf = await makePdf('a', 2)
    const result = await getPdfPageCount(pdf)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(2)
    const bad = await getPdfPageCount(new Uint8Array([1, 2, 3]))
    expect(bad.ok).toBe(false)
  })

  it('mergePdfBytes: 2 ファイルをページ順に結合する（1+2=3ページ）', async () => {
    const a = await makePdf('a', 1)
    const b = await makePdf('b', 2)
    const result = await mergePdfBytes([a, b])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const count = await getPdfPageCount(result.value)
      expect(count.ok && count.value).toBe(3)
    }
    const empty = await mergePdfBytes([])
    expect(empty.ok).toBe(false)
  })

  it('splitPdfBytes: ページ範囲で分割し、不正範囲はエラー', async () => {
    const pdf = await makePdf('s', 3)
    const result = await splitPdfBytes(pdf, [
      { start: 1, end: 1 },
      { start: 2, end: 3 },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(2)
      const c1 = await getPdfPageCount(result.value[0]!)
      const c2 = await getPdfPageCount(result.value[1]!)
      expect(c1.ok && c1.value).toBe(1)
      expect(c2.ok && c2.value).toBe(2)
    }
    const bad = await splitPdfBytes(pdf, [{ start: 1, end: 99 }])
    expect(bad.ok).toBe(false)
  })

  it('rotatePdfPages: 全ページを 90° 回転し、ページ数は維持する', async () => {
    const pdf = await makePdf('r')
    const rotated = await rotatePdfPages(pdf, 90)
    expect(rotated.ok).toBe(true)
    if (rotated.ok) {
      const doc = await PDFDocument.load(rotated.value)
      expect(doc.getPage(0)?.getRotation().angle).toBe(90)
      expect(doc.getPageCount()).toBe(1)
    }
  })

  it('addPdfWatermark: 空テキストはエラー、正常時はページ数維持', async () => {
    const pdf = await makePdf('w')
    const empty = await addPdfWatermark(pdf, { text: '  ' })
    expect(empty.ok).toBe(false)
    const result = await addPdfWatermark(pdf, { text: '社外秘' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const count = await getPdfPageCount(result.value)
      expect(count.ok && count.value).toBe(1)
    }
  })

  it('redactPdfPages: 領域を塗りつぶし、範囲外ページはエラー', async () => {
    const pdf = await makePdf('x')
    const result = await redactPdfPages(pdf, [
      { pageIndex: 0, x: 10, y: 10, width: 100, height: 40 },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const count = await getPdfPageCount(result.value)
      expect(count.ok && count.value).toBe(1)
    }
    const bad = await redactPdfPages(pdf, [{ pageIndex: 9, x: 0, y: 0, width: 10, height: 10 }])
    expect(bad.ok).toBe(false)
  })
})
