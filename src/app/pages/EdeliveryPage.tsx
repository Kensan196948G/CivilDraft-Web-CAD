/**
 * 電子納品チェック・成果物管理画面。
 *
 * 適用基準: 国土交通省「工事完成図書の電子納品等要領（令和5年3月版）」および
 * 「電子納品等運用ガイドライン【土木工事編】（令和5年3月版）」。
 * 本画面はチェック支援と管理ファイル（CSV）生成を行い、電子納品の適合を自動断定しない。
 * 人による最終確認（検査職員・発注者）を必須とし、未確認では管理ファイルを出力できない。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  DELIVERY_FOLDERS,
  DELIVERY_STANDARD,
  checkDeliveryFiles,
  deliveryCheckToCsv,
  deliveryFolderTree,
  type DeliveryFileEntry,
  type DeliveryMeta,
} from '@/domain/edelivery'
import type { ValidationIssue } from '@/shared/types'
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

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 9px',
  borderRadius: 6,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 13,
}

const fieldRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px minmax(0, 1fr)',
  gap: 10,
  alignItems: 'center',
  fontSize: 12.5,
}

const fieldLabelStyle: CSSProperties = { color: 'var(--ink2)', fontWeight: 600 }

interface EdeliveryFileRow {
  readonly id: number
  readonly folder: string
  readonly fileName: string
  readonly pdfA: boolean
}

let nextRowId = 1

function newRow(): EdeliveryFileRow {
  return { id: nextRowId++, folder: 'DRAWINGF', fileName: '', pdfA: false }
}

function severityColor(severity: ValidationIssue['severity']): string {
  switch (severity) {
    case 'error':
      return '#C5392F'
    case 'warning':
      return '#B7791F'
    default:
      return '#2E6B9E'
  }
}

export function EdeliveryPage() {
  const [projectName, setProjectName] = useState('国道245号 道路拡幅工事')
  const [projectNumber, setProjectNumber] = useState('R05-001-245')
  const [orderer, setOrderer] = useState('国土交通省 関東地方整備局')
  const [workType, setWorkType] = useState('道路改良工事')
  const [clientName, setClientName] = useState('')
  const [rows, setRows] = useState<readonly EdeliveryFileRow[]>([newRow()])
  const [issues, setIssues] = useState<readonly ValidationIssue[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [lastFileCount, setLastFileCount] = useState(0)

  const updateRow = (id: number, patch: Partial<EdeliveryFileRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const runCheck = () => {
    const files: DeliveryFileEntry[] = rows
      .filter((row) => row.fileName.trim() !== '')
      .map((row) => ({ folder: row.folder, fileName: row.fileName.trim(), pdfA: row.pdfA }))
    const result = checkDeliveryFiles(files)
    setIssues(result.issues)
    setLastFileCount(result.fileCount)
    setMessage(
      `📊 検査完了: ${result.fileCount}ファイル / エラー${result.errorCount} / 警告${result.warningCount}`,
    )
  }

  const exportManifest = () => {
    if (!confirmed) {
      setMessage('⚠️ 人による最終確認（検査職員・発注者）の確認チェックを入れてから出力してください')
      return
    }
    if (clientName.trim() === '') {
      setMessage('⚠️ 最終確認者名を入力してください')
      return
    }
    const files: DeliveryFileEntry[] = rows
      .filter((row) => row.fileName.trim() !== '')
      .map((row) => ({ folder: row.folder, fileName: row.fileName.trim(), pdfA: row.pdfA }))
    const result = checkDeliveryFiles(files)
    const meta: DeliveryMeta = {
      projectName,
      projectNumber,
      clientName,
      workType,
      orderer,
      standard: DELIVERY_STANDARD.name,
    }
    downloadText(
      deliveryCheckToCsv(meta, files, result),
      `delivery-manifest-${projectNumber.replace(/[\\/:*?"<>|]/g, '_')}.csv`,
      'text/csv;charset=utf-8',
    )
    setMessage(`✅ 管理ファイル（管理項目一覧 CSV）を出力しました。適用基準: ${DELIVERY_STANDARD.revision}`)
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>電子納品</div>
          <div style={pageSubtitleStyle}>
            工事完成図書の電子納品等要領（令和5年3月版）対応チェック・管理ファイル生成
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {message !== null && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{message}</span>}
        <button style={ghostButtonStyle} onClick={runCheck}>
          チェック実行
        </button>
        <button style={primaryButtonStyle} onClick={exportManifest} disabled={!confirmed}>
          管理ファイル出力
        </button>
      </header>

      <main style={pageMainStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>案件情報</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>工事名称</span>
                  <input style={inputStyle} value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>工事番号</span>
                  <input style={inputStyle} value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>発注者</span>
                  <input style={inputStyle} value={orderer} onChange={(e) => setOrderer(e.target.value)} />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>対象工種</span>
                  <input style={inputStyle} value={workType} onChange={(e) => setWorkType(e.target.value)} />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>最終確認者</span>
                  <input
                    aria-label="最終確認者"
                    style={inputStyle}
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
              </div>
            </section>

            <section style={panelStyle}>
              <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>成果物一覧（フォルダ・ファイル名・形式）</div>
                <button
                  type="button"
                  style={ghostButtonStyle}
                  onClick={() => setRows((current) => [...current, newRow()])}
                >
                  ＋ 行を追加
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((row) => (
                  <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 110px 60px', gap: 8 }}>
                    <select
                      aria-label="フォルダ"
                      style={inputStyle}
                      value={row.folder}
                      onChange={(e) => updateRow(row.id, { folder: e.target.value })}
                    >
                      <option value="ルート">（ルート）</option>
                      {DELIVERY_FOLDERS.map((folder) => (
                        <option key={folder} value={folder}>
                          {folder}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="ファイル名"
                      style={inputStyle}
                      placeholder="例: 0001-001_SXF.P21"
                      value={row.fileName}
                      onChange={(e) => updateRow(row.id, { fileName: e.target.value })}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)' }}>
                      <input
                        type="checkbox"
                        checked={row.pdfA}
                        onChange={(e) => updateRow(row.id, { pdfA: e.target.checked })}
                      />
                      PDF/A
                    </label>
                    <button
                      type="button"
                      aria-label="行を削除"
                      style={ghostButtonStyle}
                      onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
                ※ SXF(P21)・PDF/A への変換は本システム未対応（課題）。形式判定は拡張子ベースです。
              </div>
            </section>

            {issues !== null && (
              <section style={panelStyle} aria-label="検査結果">
                <div style={panelHeaderStyle}>
                  検査結果（{lastFileCount} ファイル / エラー{issues.filter((i) => i.severity === 'error').length} / 警告
                  {issues.filter((i) => i.severity === 'warning').length}）
                </div>
                {issues.length === 0 && <div style={{ fontSize: 13, color: '#2E9E6B' }}>問題は見つかりませんでした（人による最終確認は必須です）</div>}
                {issues.map((issue, index) => (
                  <div
                    key={`${issue.code}:${index}`}
                    style={{
                      fontSize: 12.5,
                      color: severityColor(issue.severity),
                      padding: '5px 0',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    {issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🔵'} {issue.entityId ?? '全体'}
                    : {issue.message}
                  </div>
                ))}
              </section>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>適用基準</div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--ink2)' }}>
                {DELIVERY_STANDARD.name}
                <br />
                出典: {DELIVERY_STANDARD.sourceUrl}
                <br />
                版: {DELIVERY_STANDARD.revision}（{DELIVERY_STANDARD.publisher}）
              </div>
            </section>
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>標準フォルダ構成（案内）</div>
              <pre style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--ink2)', margin: 0 }}>
                {deliveryFolderTree()}
              </pre>
            </section>
            <section style={panelStyle}>
              <div style={panelHeaderStyle}>人による最終確認（必須）</div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.6 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                検査結果・フォルダ構成・命名規則を検査職員/発注者と最終確認し、納品可否を判断しました
              </label>
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>
                本システムは適合を自動断定しません。電子納品チェックシステム等による最終検査を推奨します。
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
