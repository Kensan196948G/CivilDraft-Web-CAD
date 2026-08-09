#!/usr/bin/env node
/* global TextEncoder, console, process */
/**
 * PDF/A-1b 指向サンプル PDF を生成する（外部検証 verapdf 用）。
 *
 * 使い方:
 *   node scripts/tools/generate-pdfa-sample.mjs [出力先.pdf]
 *   FONT_FILE=<ttf/otf> node scripts/tools/generate-pdfa-sample.mjs [出力先.pdf]
 *
 * 生成内容:
 * - 1 ページの PDF（文字入り）
 * - XMP（pdfaid part=1 / conformance=B）
 * - OutputIntent（GTS_PDFA1）＋公式 sRGB2014 ICC プロファイル（DestOutputProfile）
 *
 * このサンプルは「自己宣言」であり、適合は verapdf 等の外部検証と人間確認を要する。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function buildXmp() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="CivilDraft">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <pdf:Producer>CivilDraft</pdf:Producer>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml('CivilDraft PDF/A-1b サンプル')}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>CivilDraft</rdf:li></rdf:Seq></dc:creator>
      <xmp:CreatorTool>CivilDraft</xmp:CreatorTool>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <xmp:ModifyDate>${now}</xmp:ModifyDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

async function main() {
  const outPath = process.argv[2] ?? 'sample-pdfa.pdf'
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const page = doc.addPage([595, 842]) // A4 portrait

  // PDF/A-1b: 全フォントの埋め込みが必要（6.3.4）。日本語サブセット OTF を埋め込む。
  const fontPath =
    process.env.FONT_FILE ?? resolve('scripts/tools/assets/DejaVuSans.ttf')
  const fontBytes = readFileSync(fontPath)
  const font = await doc.embedFont(fontBytes)
  page.drawText('CivilDraft PDF/A-1b sample (self-declared, for external validation)', {
    x: 60,
    y: 760,
    size: 14,
    font,
  })
  page.drawText(`Generated at: ${new Date().toISOString()}`, { x: 60, y: 730, size: 10, font })

  // Info と XMP の Producer/Creator/日時を一致させる（6.7.3）。
  const now = new Date()
  doc.setProducer('CivilDraft')
  doc.setCreator('CivilDraft')
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  // PDF/A-1b: trailer ID 必須（6.1.3）。
  const idHex = randomBytes(16).toString('hex')
  const id = PDFHexString.of(idHex)
  doc.context.trailerInfo.ID = doc.context.obj([id, id])

  const xmpBytes = new TextEncoder().encode(buildXmp())
  const metadataDict = doc.context.obj({
    Type: 'Metadata',
    Subtype: 'XML',
    Length: xmpBytes.length,
  })
  doc.catalog.set(PDFName.of('Metadata'), PDFRawStream.of(metadataDict, xmpBytes))

  const iccPath = resolve('src/domain/pdf/assets/srgb-icc.icc')
  const iccBytes = new Uint8Array(readFileSync(iccPath))
  const iccDict = doc.context.obj({ Length: iccBytes.length, N: 3 })
  const iccStream = PDFRawStream.of(iccDict, iccBytes)
  const outputIntent = doc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB2014'),
    DestOutputProfile: iccStream,
  })
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([outputIntent]))

  // PDF/A-1b: xref stream は不可（6.1.4）。useObjectStreams=false で xref テーブル出力。
  const bytes = await doc.save({ useObjectStreams: false })
  writeFileSync(outPath, bytes)
  console.log(`PDF/A-1b 指向サンプルを生成しました: ${outPath}（${bytes.length} バイト）`)
  console.log('検証: scripts/tools/verify-pdfa.sh <pdf>（verapdf 導入後）または docs/edelivery-validation.md を参照')
}

main().catch((error) => {
  console.error(`[generate-pdfa-sample] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
