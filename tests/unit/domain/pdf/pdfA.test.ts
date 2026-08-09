import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { applyPdfAMetadata } from '@/domain/pdf/pdfA'

async function makePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return doc.save()
}

describe('pdfA / PDF/A-1b 指向メタデータ', () => {
  it('Metadata と OutputIntent を Catalog へ付与する', async () => {
    const pdf = await makePdf()
    const result = await applyPdfAMetadata(pdf, {
      title: '施工ヤード計画図',
      author: 'Mirai建設',
      subject: '電子納品用（PDF/A-1b指向）',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.issues.length).toBeGreaterThan(0)

    const doc = await PDFDocument.load(result.value.bytes)
    const metadata = doc.catalog.get(PDFName.of('Metadata'))
    expect(metadata).toBeDefined()
    const outputIntents = doc.catalog.get(PDFName.of('OutputIntents'))
    expect(outputIntents).toBeDefined()
    const xmp = new TextDecoder().decode((metadata as { contents: Uint8Array }).contents)
    expect(xmp).toContain('pdfaid:part')
    expect(xmp).toContain('施工ヤード計画図')
    expect(doc.getTitle()).toBe('施工ヤード計画図')
    expect(doc.getAuthor()).toBe('Mirai建設')
  })

  it('不正バイトはエラーを返す', async () => {
    const result = await applyPdfAMetadata(new Uint8Array([1, 2, 3]), {
      title: 'x',
      author: 'y',
    })
    expect(result.ok).toBe(false)
  })
})
