/**
 * PDF/A-1b 指向メタデータ付与（自己宣言）。
 *
 * 実装内容:
 * - XMP メタデータ（PDF/A-1b conformance 宣言・タイトル/作成者/日時）を
 *   Catalog.Metadata へ埋め込む。
 * - OutputIntent（GTS_PDFA1・sRGB IEC61966-2.1）を Catalog へ付与する
 *   （DestOutputProfile に公式 sRGB2014 ICC プロファイルを埋め込む。
 *    出典: ICC Color Registry / registry.color.org）。
 * - フォントは pdfExporter の fontkit サブセット埋め込みに依存する。
 *
 * 正直な境界: これは「PDF/A-1b を指向したメタデータ付き PDF」であり、
 * 第三者機関や検証ツール（verapdf 等）による認証を受けた PDF/A ではありません。
 * 電子納品では必ず検証ツール/検査職員の確認を要する（適合の自動断定をしない方針）。
 */
import { PDFDocument, PDFName, PDFRawStream, PDFString, type PDFDict } from 'pdf-lib'
import type { Result, ValidationIssue } from '@/shared/types'
import { SRGB_ICC_2014_BASE64 } from '@/domain/pdf/srgbIcc'

export interface PdfAMetadata {
  readonly title: string
  readonly author: string
  readonly subject?: string
  readonly createdAt?: string
}

function buildXmp(meta: PdfAMetadata): string {
  const date = meta.createdAt ?? new Date().toISOString()
  const escapeXml = (value: string): string =>
    value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="CivilDraft">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escapeXml(meta.author)}</rdf:li></rdf:Seq></dc:creator>
      ${meta.subject === undefined ? '' : `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(meta.subject)}</rdf:li></rdf:Alt></dc:description>`}
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** base64（atob）からバイト列へ復号する。atob はブラウザ・Node 18+ で利用可。 */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/**
 * 既存 PDF バイト列へ PDF/A-1b 指向メタデータを付与する。
 * issues に「自己宣言であり検証必須」の警告を必ず含める。
 */
export async function applyPdfAMetadata(
  bytes: Uint8Array,
  meta: PdfAMetadata,
): Promise<Result<{ readonly bytes: Uint8Array; readonly issues: readonly string[] }, ValidationIssue>> {
  try {
    const doc = await PDFDocument.load(bytes)
    doc.setTitle(meta.title)
    doc.setAuthor(meta.author)
    if (meta.subject !== undefined) doc.setSubject(meta.subject)
    doc.setCreationDate(new Date(meta.createdAt ?? Date.now()))
    doc.setModificationDate(new Date(meta.createdAt ?? Date.now()))

    const xmpBytes = new TextEncoder().encode(buildXmp(meta))
    const metadataDict = doc.context.obj({
      Type: 'Metadata',
      Subtype: 'XML',
      Length: xmpBytes.length,
    }) as PDFDict
    const metadataStream = PDFRawStream.of(metadataDict, xmpBytes)
    doc.catalog.set(PDFName.of('Metadata'), metadataStream)

    // OutputIntent（GTS_PDFA1）+ 公式 sRGB2014 ICC プロファイル（DestOutputProfile）。
    const iccBytes = decodeBase64(SRGB_ICC_2014_BASE64)
    const iccDict = doc.context.obj({ Length: iccBytes.length, N: 3 }) as PDFDict
    const iccStream = PDFRawStream.of(iccDict, iccBytes)
    const outputIntent = doc.context.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFA1',
      OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
      Info: PDFString.of('sRGB IEC61966-2.1'),
      DestOutputProfile: iccStream,
    })
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([outputIntent]))

    return {
      ok: true,
      value: {
        bytes: await doc.save(),
        issues: [
          'PDF/A-1b 指向メタデータを付与しました（自己宣言）。認証を受けた PDF/A ではありません。',
          'OutputIntent へ公式 sRGB2014 ICC プロファイル（DestOutputProfile）を埋め込みました。',
          '適合は verapdf 等の検証ツールと人間による最終確認を要します（自動断定しない）。',
        ],
      },
    }
  } catch {
    return {
      ok: false,
      error: { code: 'PDFA_METADATA_FAILED', severity: 'error', message: 'PDF/A メタデータ付与に失敗しました' },
    }
  }
}
