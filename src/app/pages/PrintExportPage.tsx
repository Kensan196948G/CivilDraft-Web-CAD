/**
 * 印刷・出力画面。
 * 正本: Claude Design「CivilDraft Web CAD」Print Export.dc.html（100%適用）。
 * 「出力を実行」はデザインのモックではなく実出力に結線: PDF=exportPdf（日本語フォント
 * 注入）、DXF=exportDxf、CSV=数量算出→exportQuantityCsv（現在の図面データを使用）。
 * プレビューSVG・出力履歴はデザイン正本のサンプルを忠実表示（履歴永続化は本番データ層接続後）。
 */
import { useState } from 'react'
import type { ChangeEvent, CSSProperties } from 'react'
import { exportQuantityCsv } from '@/domain/quantities/quantityCsv'
import { CSV_CONTEXT, computeQuantitySummary } from './quantitySummaryModel'
import { useEditorStoreApi } from '@/app/store/useEditorStore'
import {
  addPdfWatermark,
  getPdfPageCount,
  mergePdfBytes,
  rotatePdfPages,
  splitPdfBytes,
} from '@/domain/pdf/pdfEdit'
import { createPdfSignatureManifest, signatureManifestToJson } from '@/domain/pdf/pdfSignature'
import { applyPdfAMetadata } from '@/domain/pdf/pdfA'
import { redactPdfText } from '@/domain/pdf/pdfRedact'
import { createPadesDetachedSignature } from '@/domain/pdf/pdfSignaturePades'
import { exportSxfP21 } from '@/domain/edelivery/sxfP21'
import {
  ghostButtonStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
} from './pageStyles'

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const checkLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }

interface ExportHistoryRow {
  readonly label: string
  readonly date: string
}

interface LoadedPdfFile {
  readonly name: string
  readonly bytes: Uint8Array
}

const pdfInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 9px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 12.5,
}

const pdfActionStyle: CSSProperties = { ...ghostButtonStyle, fontSize: 12 }

const INITIAL_HISTORY: readonly ExportHistoryRow[] = [
  { label: 'PDF・Rev.2', date: '07-10' },
  { label: 'DXF・Rev.1', date: '07-02' },
]

export function PrintExportPage() {
  const storeApi = useEditorStoreApi()
  const [pdfChecked, setPdfChecked] = useState(true)
  const [dxfChecked, setDxfChecked] = useState(false)
  const [csvChecked, setCsvChecked] = useState(false)
  const [sxfChecked, setSxfChecked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly ExportHistoryRow[]>(INITIAL_HISTORY)
  const [pdfFiles, setPdfFiles] = useState<readonly LoadedPdfFile[]>([])
  const [watermarkText, setWatermarkText] = useState('社外秘')
  const [signerName, setSignerName] = useState('')
  const [signerKeyPem, setSignerKeyPem] = useState('')
  const [pdfMessage, setPdfMessage] = useState<string | null>(null)

  const runExport = async () => {
    try {
      const s = storeApi.getState()
      const geometries = s.geometries
      if (geometries.length === 0) {
        setMessage('⚠️ 出力対象の図面データがありません。CAD編集で図形を作成してから出力してください。')
        return
      }
      const results: string[] = []
      if (pdfChecked) {
        const [{ exportPdf }, { loadJapaneseFont }] = await Promise.all([
          import('@/domain/pdf/pdfExporter'),
          import('@/infrastructure/pdf/fontLoader'),
        ])
        const font = await loadJapaneseFont()
        const pdf = await exportPdf(geometries, s.layers, {
          paperSize: 'A3',
          orientation: 'landscape',
          scale: 100,
          titleBlock: { projectName: '国道245号 道路拡幅工事', drawingNumber: 'DWG-014', revision: 'Rev.3' },
          ...(font.ok ? { japaneseFontBytes: font.value } : {}),
        })
        if (pdf.ok) {
          downloadBlob(new Blob([pdf.value.bytes.slice()], { type: 'application/pdf' }), 'civildraft.pdf')
          results.push(`PDF✓${pdf.value.issues.length > 0 ? `(警告${pdf.value.issues.length})` : ''}`)
        } else {
          results.push(`PDF✗(${pdf.error.message})`)
        }
      }
      if (dxfChecked) {
        const { exportDxf } = await import('@/domain/dxf/dxfExporter')
        const dxf = exportDxf(geometries, s.layers)
        downloadBlob(new Blob([dxf], { type: 'application/dxf' }), 'civildraft.dxf')
        results.push('DXF✓')
      }
      if (csvChecked) {
        const summary = computeQuantitySummary(geometries)
        const result = exportQuantityCsv({
          rows: summary.items.map((item) => ({ item })),
          context: CSV_CONTEXT,
        })
        downloadBlob(
          new Blob([result.csv], { type: 'text/csv;charset=utf-8' }),
          'civildraft-quantities.csv',
        )
        results.push(`CSV✓(${summary.items.length}件)`)
      }
      if (sxfChecked) {
        const sxf = exportSxfP21(s.geometries, { fileName: 'civildraft.P21', drawingName: '施工ヤード計画図' })
        downloadBlob(new Blob([sxf.text], { type: 'application/step' }), 'civildraft.P21')
        results.push(
          `SXF✓(試作${sxf.exportedCount}件${sxf.issues.length > 0 ? `・警告${sxf.issues.length}` : ''})`,
        )
      }
      if (results.length > 0) {
        const today = new Date().toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '-')
        setHistory((current) => [
          { label: `${results.map((result) => result.replace(/[✓✗].*$/, '')).join('・')}・Rev.3`, date: today },
          ...current,
        ])
      }
      setMessage(results.length > 0 ? `📤 出力完了: ${results.join(' / ')}` : '出力形式を選択してください')
    } catch (error) {
      setMessage(`⚠️ 出力に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handlePdfFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? [])
    const loaded = await Promise.all(
      list.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
    )
    setPdfFiles(loaded)
    setPdfMessage(loaded.length > 0 ? `📄 ${loaded.length} 件の PDF を読み込みました` : null)
    event.target.value = ''
  }

  const downloadPdf = (bytes: Uint8Array, filename: string) => {
    downloadBlob(new Blob([bytes.slice()], { type: 'application/pdf' }), filename)
  }

  const runMerge = async () => {
    if (pdfFiles.length < 2) {
      setPdfMessage('⚠️ 結合には 2 件以上の PDF が必要です')
      return
    }
    const result = await mergePdfBytes(pdfFiles.map((file) => file.bytes))
    if (result.ok) {
      downloadPdf(result.value, 'merged.pdf')
      setPdfMessage('✅ PDF を結合しました')
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runSplit = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const countResult = await getPdfPageCount(file.bytes)
    if (!countResult.ok) {
      setPdfMessage(`⚠️ ${countResult.error.message}`)
      return
    }
    const ranges = Array.from({ length: countResult.value }, (_, i) => ({ start: i + 1, end: i + 1 }))
    const result = await splitPdfBytes(file.bytes, ranges)
    if (result.ok) {
      result.value.forEach((bytes, index) => {
        downloadPdf(bytes, `${file.name.replace(/\.pdf$/i, '')}-p${index + 1}.pdf`)
      })
      setPdfMessage(`✅ ${result.value.length} ページに分割しました`)
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runRotate = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const result = await rotatePdfPages(file.bytes, 90)
    if (result.ok) {
      downloadPdf(result.value, `${file.name.replace(/\.pdf$/i, '')}-rotated90.pdf`)
      setPdfMessage('✅ 全ページを 90° 回転しました')
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runWatermark = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const result = await addPdfWatermark(file.bytes, { text: watermarkText })
    if (result.ok) {
      downloadPdf(result.value, `${file.name.replace(/\.pdf$/i, '')}-watermarked.pdf`)
      setPdfMessage('✅ 透かしを追加しました')
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runRedact = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    // テキスト演算子を物理削除したうえで黒矩形を重ねる（画像内文字は削除不可）。
    const result = await redactPdfText(file.bytes, [
      { pageIndex: 0, x: 80, y: 80, width: 320, height: 48 },
    ])
    if (result.ok) {
      downloadPdf(result.value.bytes, `${file.name.replace(/\.pdf$/i, '')}-redacted.pdf`)
      setPdfMessage(
        `✅ 墨消しを適用しました（テキスト${result.value.removedTextCount}件を物理削除・画像内文字は要専用ツール）`,
      )
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runPdfA = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const result = await applyPdfAMetadata(file.bytes, {
      title: 'CivilDraft 図面出力',
      author: signerName || 'CivilDraft',
      subject: '電子納品用 PDF/A-1b 指向',
    })
    if (result.ok) {
      downloadPdf(result.value.bytes, `${file.name.replace(/\.pdf$/i, '')}-pdfa1b.pdf`)
      setPdfMessage(`✅ PDF/A-1b 指向メタデータを付与しました（自己宣言・検証必須）`)
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const runPades = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    if (signerKeyPem.trim() === '') {
      setPdfMessage('⚠️ PKCS#8 RSA 秘密鍵（PEM）を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const result = await createPadesDetachedSignature({
      pdfBytes: file.bytes,
      privateKeyPem: signerKeyPem,
      signerName,
    })
    if (result.ok) {
      downloadBlob(
        new Blob([result.value.p7sBytes.slice()], { type: 'application/pkcs7-signature' }),
        `${file.name.replace(/\.pdf$/i, '')}.p7s`,
      )
      setPdfMessage(
        `✅ PAdES-CMS detached 署名を生成しました（SHA-256: ${result.value.sha256.slice(0, 16)}… ※証明書なしのため電子署名法上の署名ではありません）`,
      )
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  const handleSignerKey = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    setSignerKeyPem(await file.text())
    event.target.value = ''
  }

  const runSignatureManifest = async () => {
    if (pdfFiles.length === 0) {
      setPdfMessage('⚠️ PDF を選択してください')
      return
    }
    const file = pdfFiles[0]
    if (file === undefined) return
    const result = await createPdfSignatureManifest({
      fileName: file.name,
      bytes: file.bytes,
      signer: signerName,
      signerRole: '承認者',
    })
    if (result.ok) {
      downloadBlob(
        new Blob([signatureManifestToJson(result.value)], { type: 'application/json' }),
        `${file.name.replace(/\.pdf$/i, '')}-signature-manifest.json`,
      )
      setPdfMessage('✅ 署名マニフェスト（SHA-256）を出力しました ※電子署名ではありません')
    } else {
      setPdfMessage(`⚠️ ${result.error.message}`)
    }
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>印刷・出力</div>
          <div style={pageSubtitleStyle}>施工ヤード計画図 Rev.3 ・ プレビュー、PDF、DXF、CSV、警告</div>
        </div>
        <div style={{ flex: 1 }} />
        {message !== null && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{message}</span>}
        <button style={primaryButtonStyle} onClick={() => void runExport()}>
          出力を実行
        </button>
      </header>

      <main style={pageMainStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 16, alignItems: 'start' }}>
          <div style={panelStyle}>
            <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>出力プレビュー（A1横・S=1:500）</div>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>1/1ページ</span>
            </div>
            <div style={{ padding: 24, background: 'var(--canvas-wrap, #DDE3EC)', display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  width: 640,
                  height: 452,
                  background: '#fff',
                  border: '2px solid #1A2433',
                  position: 'relative',
                  boxShadow: '0 4px 16px rgba(16,24,40,.12)',
                }}
              >
                <svg width="100%" height="100%" viewBox="0 0 640 452">
                  <rect x="14" y="14" width="612" height="424" fill="none" stroke="#8A97A8" strokeWidth="1" />
                  <polygon points="60,60 560,50 580,340 80,360" fill="none" stroke="#5A6678" strokeWidth="1.5" strokeDasharray="4 3" />
                  <rect x="90" y="260" width="100" height="50" fill="#F2F4F8" stroke="#5A6678" />
                  <circle cx="420" cy="180" r="65" fill="rgba(224,138,43,.10)" stroke="#E08A2B" strokeWidth="1.2" strokeDasharray="3 2" />
                  <rect x="405" y="165" width="30" height="30" fill="#B5701A" rx="3" />
                  <rect x="430" y="380" width="150" height="52" fill="#F8FAFB" stroke="#1A2433" />
                  <text x="440" y="396" fontSize="9" fill="#1A2433" fontWeight="600">
                    施工ヤード計画図
                  </text>
                  <text x="440" y="410" fontSize="8" fill="#5A6678">
                    {'DWG-014　Rev.3'}
                  </text>
                  <text x="440" y="422" fontSize="8" fill="#5A6678">
                    {'S=1:500　山田 太郎'}
                  </text>
                  <rect x="200" y="330" width="90" height="18" fill="#FCE9E7" stroke="#C5392F" strokeDasharray="2 2" />
                  <text x="205" y="343" fontSize="8" fill="#C5392F">
                    用紙外にはみ出し
                  </text>
                </svg>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>出力形式</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={pdfChecked}
                    onChange={(e) => setPdfChecked(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  PDF（印刷用・表題欄付き）
                </label>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={dxfChecked}
                    onChange={(e) => setDxfChecked(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  DXF（CAD交換用）
                </label>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={csvChecked}
                    onChange={(e) => setCsvChecked(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  CSV（数量根拠付き）
                </label>
                <label style={checkLabel}>
                  <input
                    type="checkbox"
                    checked={sxfChecked}
                    onChange={(e) => setSxfChecked(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  SXF(P21) 試作（AP202 サブセット・検証必須）
                </label>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>出力前チェック</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FCE9E7', color: '#C5392F', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                  ⚠ 資材置場Bが用紙範囲外にはみ出しています。
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FDEFE0', color: '#B5701A', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                  ⚠ 数量根拠1件が未確定です（掘削・第2工区）。
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: 'var(--subtle)', color: 'var(--ink2)', padding: '10px 12px', borderRadius: 8, fontSize: 12 }}>
                  ⓘ DXF出力では土木属性の一部が失われる場合があります。
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>出力履歴</div>
              <div>
                {history.map((row, index) => (
                  <div key={`${row.label}-${row.date}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: index === history.length - 1 ? 'none' : '1px solid var(--line2)', fontSize: 12.5 }}>
                    <span>{row.label}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: 'var(--muted)' }}>{row.date}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>PDF編集・署名</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  aria-label="PDFファイル選択"
                  onChange={(e) => void handlePdfFiles(e)}
                  style={{ fontSize: 12 }}
                />
                {pdfFiles.length > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {pdfFiles.map((file) => file.name).join(' / ')}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button type="button" style={pdfActionStyle} onClick={() => void runMerge()}>
                    結合
                  </button>
                  <button type="button" style={pdfActionStyle} onClick={() => void runSplit()}>
                    分割（1頁ずつ）
                  </button>
                  <button type="button" style={pdfActionStyle} onClick={() => void runRotate()}>
                    90°回転
                  </button>
                </div>
                <input
                  aria-label="透かしテキスト"
                  style={pdfInputStyle}
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                />
                <button type="button" style={pdfActionStyle} onClick={() => void runWatermark()}>
                  透かし追加
                </button>
                <button type="button" style={pdfActionStyle} onClick={() => void runRedact()}>
                  墨消し（先頭ページ中央・テキスト物理削除）
                </button>
                <button type="button" style={pdfActionStyle} onClick={() => void runPdfA()}>
                  PDF/A-1b 指向メタデータ付与
                </button>
                <input
                  type="file"
                  accept=".pem,.key,text/plain"
                  aria-label="署名鍵（PKCS#8 PEM）"
                  onChange={(e) => void handleSignerKey(e)}
                  style={{ fontSize: 12 }}
                />
                <input
                  aria-label="署名者名"
                  style={pdfInputStyle}
                  placeholder="署名者名（承認者）"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                />
                <button type="button" style={pdfActionStyle} onClick={() => void runSignatureManifest()}>
                  SHA-256 署名マニフェスト（JSON）
                </button>
                <button type="button" style={pdfActionStyle} onClick={() => void runPades()}>
                  PAdES-CMS detached 署名（.p7s）生成
                </button>
                {pdfMessage !== null && (
                  <div role="status" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {pdfMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
