/**
 * 監査ログ画面。
 * 恒久監査ログ API 接続前のため、画面構成とサンプル値を表示し、
 * CSV/PDF/HTMLとしてローカルエクスポートできるようにする。
 */
import { useState } from 'react'
import {
  ghostButtonStyle,
  monoStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  statusBadgeStyle,
  thStyle,
  tdStyle,
} from './pageStyles'

const AUDIT_ROWS = [
  {
    time: '2026-07-16 10:42',
    actor: '山田 太郎',
    action: 'DWG-014を保存',
    target: '施工ヤード計画図',
    result: '成功',
  },
  {
    time: '2026-07-16 09:18',
    actor: '高橋 一郎',
    action: 'DWG-002を差戻し',
    target: '仮設計画図',
    result: '成功',
  },
  {
    time: '2026-07-15 18:03',
    actor: '佐藤 花子',
    action: '数量CSVを出力',
    target: '数量根拠図',
    result: '成功',
  },
  {
    time: '2026-07-15 07:11',
    actor: 'unknown',
    action: 'ログイン失敗（3回）',
    target: 'Cloudflare Access',
    result: '警告',
  },
  {
    time: '2026-07-14 17:22',
    actor: '中村 美咲',
    action: 'システム設定をエクスポート',
    target: '設定スナップショット',
    result: '成功',
  },
] as const

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function exportCsv(): void {
  const header = ['日時', '利用者', '操作', '対象', '結果']
  const rows = AUDIT_ROWS.map((row) => [row.time, row.actor, row.action, row.target, row.result])
  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'civildraft-audit-log.csv')
}

function exportHtml(): void {
  const rows = AUDIT_ROWS.map(
    (row) =>
      `<tr><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.result)}</td></tr>`,
  ).join('')
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>CivilDraft 監査ログ</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}</style><h1>監査ログ</h1><p>保存、承認、出力、認証イベントの記録</p><table><thead><tr><th>日時</th><th>利用者</th><th>操作</th><th>対象</th><th>結果</th></tr></thead><tbody>${rows}</tbody></table></html>`
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'civildraft-audit-log.html')
}

async function exportPdf(): Promise<void> {
  const [{ PDFDocument, StandardFonts }, { loadJapaneseFont }] = await Promise.all([
    import('pdf-lib'),
    import('@/infrastructure/pdf/fontLoader'),
  ])
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const fontResult = await loadJapaneseFont()
  let font = await pdf.embedFont(StandardFonts.Helvetica)
  if (fontResult.ok) {
    const fontkit = await import('@pdf-lib/fontkit')
    pdf.registerFontkit(fontkit.default)
    font = await pdf.embedFont(fontResult.value, { subset: true })
  }
  const lines = [
    'CivilDraft Audit Log',
    '保存、承認、出力、認証イベントの記録',
    ...AUDIT_ROWS.map((row) => `${row.time}  ${row.actor}  ${row.action}  ${row.target}  ${row.result}`),
  ]
  lines.forEach((line, index) => {
    page.drawText(fontResult.ok ? line : line.replace(/[^\x20-\x7E]/g, '?'), {
      x: 40,
      y: 790 - index * 18,
      size: index === 0 ? 14 : 9,
      font,
    })
  })
  const bytes = await pdf.save()
  downloadBlob(new Blob([bytes.slice()], { type: 'application/pdf' }), 'civildraft-audit-log.pdf')
}

export function AuditLogPage() {
  const [message, setMessage] = useState<string | null>(null)
  const runExport = async (type: 'csv' | 'pdf' | 'html') => {
    try {
      if (type === 'csv') exportCsv()
      if (type === 'pdf') await exportPdf()
      if (type === 'html') exportHtml()
      setMessage(`${type.toUpperCase()}エクスポートを作成しました`)
    } catch (error) {
      setMessage(`⚠️ ${type.toUpperCase()}エクスポートに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>監査ログ</div>
          <div style={pageSubtitleStyle}>保存、承認、出力、認証イベントの記録</div>
        </div>
        <div style={{ flex: 1 }} />
        {message !== null && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{message}</span>}
        <button style={ghostButtonStyle} onClick={() => void runExport('csv')}>CSVエクスポート</button>
        <button style={ghostButtonStyle} onClick={() => void runExport('pdf')}>PDFエクスポート</button>
        <button style={primaryButtonStyle} onClick={() => void runExport('html')}>HTMLエクスポート</button>
      </header>

      <main style={pageMainStyle}>
        <div style={panelStyle}>
          <div style={panelHeaderStyle}>監査ログ</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>日時</th>
                <th style={thStyle}>利用者</th>
                <th style={thStyle}>操作</th>
                <th style={thStyle}>対象</th>
                <th style={thStyle}>結果</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_ROWS.map((row) => (
                <tr key={`${row.time}-${row.action}`}>
                  <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)' }}>{row.time}</td>
                  <td style={tdStyle}>{row.actor}</td>
                  <td style={tdStyle}>{row.action}</td>
                  <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{row.target}</td>
                  <td style={tdStyle}>
                    <span
                      style={
                        row.result === '成功'
                          ? statusBadgeStyle('#1F8255', '#E4F3EC')
                          : statusBadgeStyle('#A15C00', '#FFF3D6')
                      }
                    >
                      {row.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
