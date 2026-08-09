import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createPdfSignatureManifest, signatureManifestToJson } from '@/domain/pdf/pdfSignature'

describe('pdfSignature / 署名マニフェスト', () => {
  it('SHA-256 ハッシュと署名者情報を含むマニフェストを生成する', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    const bytes = await doc.save()
    const result = await createPdfSignatureManifest({
      fileName: 'drawing.pdf',
      bytes,
      signer: '山田 太郎',
      signerRole: '承認者',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(result.value.algorithm).toBe('SHA-256')
      expect(result.value.signer).toBe('山田 太郎')
      expect(result.value.note).toContain('電子署名ではありません')
      expect(signatureManifestToJson(result.value)).toContain('sha256')
    }
  })

  it('署名者名が空の場合はエラー', async () => {
    const doc = await PDFDocument.create()
    const bytes = await doc.save()
    const result = await createPdfSignatureManifest({
      fileName: 'drawing.pdf',
      bytes,
      signer: ' ',
      signerRole: '承認者',
    })
    expect(result.ok).toBe(false)
  })
})
