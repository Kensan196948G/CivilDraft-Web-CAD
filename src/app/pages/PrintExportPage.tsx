/**
 * 印刷・出力画面。
 * 正本: Claude Design「CivilDraft Web CAD」Print Export.dc.html（100%適用）。
 * 「出力を実行」はデザインのモックではなく実出力に結線: PDF=exportPdf（日本語フォント
 * 注入）、DXF=exportDxf、CSV=数量算出→exportQuantityCsv（現在の図面データを使用）。
 * プレビューSVG・出力履歴はデザイン正本のサンプルを忠実表示（履歴永続化はPhase 6後続）。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import { exportQuantityCsv } from '@/domain/quantities/quantityCsv'
import { loadJapaneseFont } from '@/infrastructure/pdf/fontLoader'
import { CSV_CONTEXT, computeQuantitySummary } from './quantitySummaryModel'
import { useEditorStoreApi } from '@/app/store/useEditorStore'
import {
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

export function PrintExportPage() {
  const storeApi = useEditorStoreApi()
  const [pdfChecked, setPdfChecked] = useState(true)
  const [dxfChecked, setDxfChecked] = useState(false)
  const [csvChecked, setCsvChecked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const runExport = async () => {
    const s = storeApi.getState()
    const results: string[] = []
    if (s.geometries.length === 0) {
      setMessage('⚠️ 図面に図形がありません（CAD編集で作図するか、デモ図形を配置してください）')
      return
    }
    if (pdfChecked) {
      const font = await loadJapaneseFont()
      const pdf = await exportPdf(s.geometries, s.layers, {
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
      const dxf = exportDxf(s.geometries, s.layers)
      downloadBlob(new Blob([dxf], { type: 'application/dxf' }), 'civildraft.dxf')
      results.push('DXF✓')
    }
    if (csvChecked) {
      const summary = computeQuantitySummary(s.geometries)
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
    setMessage(results.length > 0 ? `📤 出力完了: ${results.join(' / ')}` : '出力形式を選択してください')
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: '1px solid var(--line2)', fontSize: 12.5 }}>
                  <span>PDF・Rev.2</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--muted)' }}>07-10</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', fontSize: 12.5 }}>
                  <span>DXF・Rev.1</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ color: 'var(--muted)' }}>07-02</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
