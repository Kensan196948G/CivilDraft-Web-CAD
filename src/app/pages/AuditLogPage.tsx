/**
 * 監査ログ画面。
 * Workers API（GET /api/v1/audit-logs と /audit-logs/verify）へ接続し、
 * 本番監査ログとハッシュチェーン検証結果を表示する（Issue #61）。
 * API 未接続時（Access未設定の fail-closed 等）は従来のサンプル表示へフォールバックする。
 * CSV/PDF/HTMLとしてローカルエクスポートできる。
 */
import { useCallback, useEffect, useState } from 'react'
import { createCivilDraftApiClient, type CloudAuditChainVerification } from '@/infrastructure/cloud/civilDraftApiClient'
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
import type { CSSProperties } from 'react'
import { escapeCsvCell } from '@/domain/csv/csvCell'

const filterInputStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid var(--line)',
  borderRadius: 6,
  background: 'var(--surface)',
  color: 'var(--ink)',
  minWidth: 120,
}

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

interface AuditDisplayRow {
  readonly time: string
  readonly actor: string
  readonly action: string
  readonly target: string
  readonly result: string
  readonly kind: 'success' | 'warning'
  readonly key: string
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

function apiRowsToDisplay(logs: readonly CloudAuditLogLike[]): AuditDisplayRow[] {
  return logs.map((log, index) => ({
    time: formatTime(log.occurredAt),
    actor: log.actorId,
    action: log.eventName,
    target:
      log.entityType !== undefined
        ? `${log.entityType}${log.entityId !== undefined ? `:${log.entityId}` : ''}`
        : (log.projectId ?? '-'),
    result: log.result === 'success' ? '成功' : '失敗',
    kind: log.result === 'success' ? 'success' : 'warning',
    key: `${log.id}-${index}`,
  }))
}

type CloudAuditLogLike = {
  readonly id: string
  readonly occurredAt: string
  readonly eventName: string
  readonly actorId: string
  readonly projectId?: string
  readonly entityType?: string
  readonly entityId?: string
  readonly result: 'success' | 'failure'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function exportCsv(rows: readonly AuditDisplayRow[]): void {
  const header = ['日時', '利用者', '操作', '対象', '結果']
  const csvRows = rows.map((row) => [row.time, row.actor, row.action, row.target, row.result])
  const csv = [header, ...csvRows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'civildraft-audit-log.csv')
}

function exportHtml(rows: readonly AuditDisplayRow[]): void {
  const bodyRows = rows.map(
    (row) =>
      `<tr><td>${escapeHtml(row.time)}</td><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.target)}</td><td>${escapeHtml(row.result)}</td></tr>`,
  ).join('')
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>CivilDraft 監査ログ</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}</style><h1>監査ログ</h1><p>保存、承認、出力、認証イベントの記録</p><table><thead><tr><th>日時</th><th>利用者</th><th>操作</th><th>対象</th><th>結果</th></tr></thead><tbody>${bodyRows}</tbody></table></html>`
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'civildraft-audit-log.html')
}

async function exportPdf(rows: readonly AuditDisplayRow[]): Promise<void> {
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
    ...rows.map((row) => `${row.time}  ${row.actor}  ${row.action}  ${row.target}  ${row.result}`),
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
  const [rows, setRows] = useState<AuditDisplayRow[]>(() =>
    AUDIT_ROWS.map((row, index) => ({
      time: row.time,
      actor: row.actor,
      action: row.action,
      target: row.target,
      result: row.result,
      kind: row.result === '成功' ? 'success' : 'warning',
      key: `${row.time}-${index}`,
    })),
  )
  const [chain, setChain] = useState<CloudAuditChainVerification | null>(null)
  const [apiConnected, setApiConnected] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [eventName, setEventName] = useState('')
  const [actorIdFilter, setActorIdFilter] = useState('')
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<string[]>([])

  const loadLogs = useCallback(
    async (
      cursor?: string,
      filterOverride?: { readonly from?: string; readonly to?: string; readonly eventName?: string; readonly actorId?: string },
    ) => {
      const client = createCivilDraftApiClient()
      try {
        const filters = filterOverride ?? { from, to, eventName, actorId: actorIdFilter }
        const logsResult = await client.listAuditLogs({
          limit: 100,
          from: filters.from?.trim() === '' ? undefined : filters.from?.trim(),
          to: filters.to?.trim() === '' ? undefined : filters.to?.trim(),
          eventName: filters.eventName?.trim() === '' ? undefined : filters.eventName?.trim(),
          actorId: filters.actorId?.trim() === '' ? undefined : filters.actorId?.trim(),
          cursor,
        })
      if (!logsResult.ok) {
        setMessage('⚠️ 監査APIに接続できないためサンプルを表示しています（Access設定後に本番ログへ切替）')
        return
      }
      const page = logsResult.value
      setRows(apiRowsToDisplay([...page.auditLogs].reverse()))
      setTotal(page.total)
      setNextCursor(page.nextCursor)
      setCursorHistory((history) => (cursor === undefined ? [] : [...history, cursor]))
      setMessage(null)
      if (cursor === undefined) {
        const chainResult = await client.verifyAuditChain()
        if (chainResult.ok) {
          setChain(chainResult.value)
          setApiConnected(true)
        } else {
          setApiConnected(false)
        }
      }
      } catch {
        setMessage('⚠️ 監査APIに接続できないためサンプルを表示しています（Access設定後に本番ログへ切替）')
      }
    },
    [from, to, eventName, actorIdFilter],
  )

  useEffect(() => {
    // 初回マウント時の読み込みのみ（フィルタ変更は「適用」ボタンで明示的に再取得する）
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) void loadLogs(undefined)
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = () => {
    void loadLogs(undefined)
  }

  const resetFilters = () => {
    setFrom('')
    setTo('')
    setEventName('')
    setActorIdFilter('')
    void loadLogs(undefined, { from: '', to: '', eventName: '', actorId: '' })
  }

  const goNewer = () => {
    if (cursorHistory.length === 0) return
    const previous = cursorHistory[cursorHistory.length - 2]
    setCursorHistory((history) => history.slice(0, -1))
    void loadLogs(previous)
  }

  const runExport = async (type: 'csv' | 'pdf' | 'html') => {
    try {
      if (type === 'csv') exportCsv(rows)
      if (type === 'pdf') await exportPdf(rows)
      if (type === 'html') exportHtml(rows)
      setMessage(`${type.toUpperCase()}エクスポートを作成しました`)
    } catch (error) {
      setMessage(`⚠️ ${type.toUpperCase()}エクスポートに失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const chainStatus =
    chain === null
      ? null
      : chain.valid
        ? chain.hashedCount > 0
          ? `✅ 監査チェーン検証: 正常（${chain.hashedCount}件ハッシュ連結・検査${chain.checkedCount}件）`
          : `✅ 監査チェーン検証: 正常（レガシー${chain.legacyCount}件は未ハッシュ・新規分から連結）`
        : '🚨 監査チェーンに不整合を検出（要調査）'

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={panelHeaderStyle}>監査ログ</div>
            {apiConnected && chainStatus !== null && (
              <span
                style={{
                  fontSize: 12,
                  color: chain?.valid === true ? 'var(--success, #1F8255)' : '#B3261E',
                  fontWeight: 600,
                }}
              >
                {chainStatus}
              </span>
            )}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
              padding: '10px 18px',
              borderBottom: '1px solid var(--line2)',
            }}
          >
            <input type="date" aria-label="開始日" value={from} onChange={(e) => setFrom(e.target.value)} style={filterInputStyle} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>〜</span>
            <input type="date" aria-label="終了日" value={to} onChange={(e) => setTo(e.target.value)} style={filterInputStyle} />
            <input
              type="text"
              aria-label="イベント名"
              placeholder="イベント名"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              style={filterInputStyle}
            />
            <input
              type="text"
              aria-label="操作者"
              placeholder="操作者（email）"
              value={actorIdFilter}
              onChange={(e) => setActorIdFilter(e.target.value)}
              style={filterInputStyle}
            />
            <button style={primaryButtonStyle} onClick={applyFilters}>
              適用
            </button>
            <button style={ghostButtonStyle} onClick={resetFilters}>
              リセット
            </button>
          </div>
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
              {rows.map((row) => (
                <tr key={row.key}>
                  <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)' }}>{row.time}</td>
                  <td style={tdStyle}>{row.actor}</td>
                  <td style={tdStyle}>{row.action}</td>
                  <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{row.target}</td>
                  <td style={tdStyle}>
                    <span
                      style={
                        row.kind === 'success'
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 18px',
              borderTop: '1px solid var(--line2)',
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            <button
              style={ghostButtonStyle}
              onClick={goNewer}
              disabled={cursorHistory.length === 0}
            >
              ← 新しい記録
            </button>
            <button
              style={ghostButtonStyle}
              onClick={() => {
                if (nextCursor !== undefined) void loadLogs(nextCursor)
              }}
              disabled={nextCursor === undefined}
            >
              さらに古い記録 →
            </button>
            <span style={{ marginLeft: 'auto' }}>
              {apiConnected
                ? `フィルタ該当 ${total} 件・表示 ${rows.length} 件`
                : 'サンプル表示（API未接続）'}
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
