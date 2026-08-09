/**
 * 現場説明モード（Issue #58）。
 * CAD 編集の全機能を見せず、現場管理者・発注者説明に必要な
 * 「施工ステップ」「数量（工種・数量・単位）」「根拠図形ハイライト」「承認状態」「PDF出力」を
 * 大きく・簡潔に表示する閲覧特化UI。
 *
 * データ方針:
 * - 数量・図形は EditorStore（現在のローカル図面）を正本とし、domain の計算サービスを再利用する。
 * - 案件/図面/改訂は AppShell が保持する CloudDraftSession から表示する。
 * - 承認状態は API 結線まで `revisionStatus` prop で受け取り、未取得時は「未取得」を表示する
 *   （実在しない状態を偽装しない）。
 * - 説明用PDFは既存の exportPdf（日本語フォント注入）をそのまま利用する。
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  DEFAULT_CONSTRUCTION_STEPS,
  getStepById,
} from '@/domain/construction-steps'
import { useEditorStore, useEditorStoreApi } from '@/app/store/useEditorStore'
import {
  computeQuantitySummary,
  formatQuantity,
} from '@/app/pages/quantitySummaryModel'
import {
  ghostButtonStyle,
  monoStyle,
  pageMainStyle,
  pageRootStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  tdStyle,
  thStyle,
} from '@/app/pages/pageStyles'
import type { CloudDraftSession } from '@/app/pages/CadEditorPage'
import type { ConstructionStepId } from '@/shared/types'

export type FieldRevisionStatus =
  | 'draft'
  | 'inReview'
  | 'pendingApproval'
  | 'approved'
  | 'returned'
  | 'obsolete'
  | 'unknown'

const STATUS_BADGE: Record<FieldRevisionStatus, { label: string; color: string }> = {
  draft: { label: '作成中', color: '#b7791f' },
  inReview: { label: '照査中', color: '#2f6f9f' },
  pendingApproval: { label: '承認待ち', color: '#7c5cbf' },
  approved: { label: '承認済み', color: '#1f7a3d' },
  returned: { label: '差戻し', color: '#b02a37' },
  obsolete: { label: '廃止', color: '#6c757d' },
  unknown: { label: '未取得', color: '#8a97a8' },
}

export interface FieldExplanationPageProps {
  /** CAD編集画面のセッション（案件・図面・改訂の表示用）。 */
  readonly cloudDraftSession?: CloudDraftSession
  /** 承認状態（API結線時は照査・承認の状態を渡す。未指定は「未取得」）。 */
  readonly revisionStatus?: FieldRevisionStatus
  /** CAD編集画面への遷移（根拠図形の確認用）。 */
  readonly onOpenEditor?: () => void
}

const fieldLabelStyle: CSSProperties = { fontSize: 13, color: 'var(--muted)', fontWeight: 600 }
const fieldValueStyle: CSSProperties = { fontSize: 20, fontWeight: 700, color: 'var(--ink)' }

export function FieldExplanationPage({
  cloudDraftSession,
  revisionStatus = 'unknown',
  onOpenEditor,
}: FieldExplanationPageProps = {}) {
  const storeApi = useEditorStoreApi()
  const geometries = useEditorStore((s) => s.geometries)
  const currentStepId = useEditorStore((s) => s.currentStepId)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)
  const highlightedGeometryIds = useEditorStore((s) => s.highlightedGeometryIds)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const summary = useMemo(() => computeQuantitySummary(geometries), [geometries])
  const stepIndex = useMemo(() => {
    if (currentStepId === null) return -1
    return DEFAULT_CONSTRUCTION_STEPS.findIndex((step) => step.id === currentStepId)
  }, [currentStepId])

  const status = STATUS_BADGE[revisionStatus]
  const session = cloudDraftSession

  const handleSelectStep = (stepId: ConstructionStepId | null) => {
    setCurrentStep(stepId)
  }

  const moveStep = (direction: -1 | 1) => {
    const next = stepIndex + direction
    if (next < 0) {
      handleSelectStep(null)
      return
    }
    const step = DEFAULT_CONSTRUCTION_STEPS[next]
    if (step !== undefined) handleSelectStep(step.id)
  }

  const handleSelectQuantity = (itemId: string) => {
    const item = summary.items.find((candidate) => candidate.id === itemId)
    if (item === undefined) return
    const geometryIds = item.sources.map((source) => source.geometryId)
    storeApi.getState().setHighlightedGeometryIds(geometryIds)
    setSelectedItemId(itemId)
    setMessage(`根拠図形 ${geometryIds.length} 件をハイライトしました`)
  }

  const handleExportPdf = async () => {
    try {
      setExporting(true)
      const s = storeApi.getState()
      if (s.geometries.length === 0) {
        setMessage('⚠️ 出力対象の図面データがありません。CAD編集で図形を作成してください。')
        return
      }
      const [{ exportPdf }, { loadJapaneseFont }] = await Promise.all([
        import('@/domain/pdf/pdfExporter'),
        import('@/infrastructure/pdf/fontLoader'),
      ])
      const font = await loadJapaneseFont()
      const pdf = await exportPdf(s.geometries, s.layers, {
        paperSize: 'A3',
        orientation: 'landscape',
        scale: 100,
        titleBlock: {
          projectName: session?.projectName ?? '未設定',
          drawingNumber: session?.drawingNumber ?? '未設定',
          revision: session?.revisionNumber ?? '未設定',
        },
        ...(font.ok ? { japaneseFontBytes: font.value } : {}),
      })
      if (pdf.ok) {
        const blob = new Blob([pdf.value.bytes.slice()], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'civildraft-field-explanation.pdf'
        anchor.click()
        URL.revokeObjectURL(url)
        setMessage(`PDF出力しました${pdf.value.issues.length > 0 ? `（警告${pdf.value.issues.length}件）` : ''}`)
      } else {
        setMessage(`PDF出力に失敗しました: ${pdf.error.message}`)
      }
    } catch (error) {
      setMessage(`PDF出力に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={pageRootStyle}>
      <header
        style={{
          padding: '28px 32px 18px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>📢 現場説明モード</div>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
            施工ステップ・数量・承認状態を閲覧専用で表示（編集はCAD編集画面で実施）
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 999,
            backgroundColor: `${status.color}18`,
            color: status.color,
            fontWeight: 700,
            fontSize: 14,
            border: `1px solid ${status.color}55`,
          }}
          aria-label={`承認状態: ${status.label}`}
        >
          <span aria-hidden>●</span> 承認状態: {status.label}
        </span>
      </header>

      <main style={{ ...pageMainStyle, gap: 18 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>案件</div>
            <div style={{ padding: 16 }}>
              <div style={fieldLabelStyle}>案件名</div>
              <div style={fieldValueStyle}>{session?.projectName ?? '未選択'}</div>
              <div style={{ ...monoStyle, marginTop: 6 }}>{session?.projectNumber ?? 'LOCAL'}</div>
            </div>
          </div>
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>図面・改訂</div>
            <div style={{ padding: 16 }}>
              <div style={fieldLabelStyle}>図面</div>
              <div style={fieldValueStyle}>{session?.drawingName ?? '無題の図面'}</div>
              <div style={{ ...monoStyle, marginTop: 6 }}>
                {session?.drawingNumber ?? 'LOCAL'} / Rev.{session?.revisionNumber ?? 'LOCAL'}
              </div>
            </div>
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelHeaderStyle}>施工ステップ</div>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" style={ghostButtonStyle} onClick={() => moveStep(-1)}>
                ← 前へ
              </button>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', minWidth: 120, textAlign: 'center' }}>
                {currentStepId === null ? '全表示' : (getStepById(DEFAULT_CONSTRUCTION_STEPS, currentStepId)?.name ?? '全表示')}
              </span>
              <button type="button" style={primaryButtonStyle} onClick={() => moveStep(1)}>
                次へ →
              </button>
            </div>
            <input
              type="range"
              aria-label="施工ステップ選択"
              min={0}
              max={DEFAULT_CONSTRUCTION_STEPS.length}
              value={stepIndex < 0 ? 0 : stepIndex + 1}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (value === 0) {
                  handleSelectStep(null)
                } else {
                  const step = DEFAULT_CONSTRUCTION_STEPS[value - 1]
                  if (step !== undefined) handleSelectStep(step.id)
                }
              }}
              style={{ width: '100%', marginTop: 14 }}
            />
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelHeaderStyle}>数量表（簡易表示）</div>
          <div style={{ padding: 16, overflowX: 'auto' }}>
            {summary.items.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 15, padding: '12px 4px' }}>
                数量データがありません。CAD編集で図形を作成し、数量集計で算出してください。
              </div>
            ) : (
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 16 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>工種・名称</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>数量</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>単位</th>
                    <th style={{ ...thStyle, textAlign: 'left' }}>根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.items.map((item) => {
                    const active = item.id === selectedItemId
                    return (
                      <tr
                        key={item.id}
                        onClick={() => handleSelectQuantity(item.id)}
                        style={{
                          backgroundColor: active ? 'var(--side2)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        aria-label={`数量行 ${item.workType ?? item.groupKey}（クリックで根拠図形をハイライト）`}
                      >
                        <td style={{ ...tdStyle, fontSize: 16 }}>{item.workType ?? item.groupKey}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatQuantity(item.roundedValue)}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 16 }}>{item.unit}</td>
                        <td style={{ ...tdStyle, fontSize: 14, color: 'var(--muted)' }}>
                          {item.sources.length} 図形
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {highlightedGeometryIds.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 14, color: 'var(--ink2)' }}>
                ハイライト中: {highlightedGeometryIds.length} 図形
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" style={{ ...primaryButtonStyle, fontSize: 15 }} onClick={handleExportPdf} disabled={exporting}>
            {exporting ? '出力中...' : '📄 説明用PDF出力'}
          </button>
          <button type="button" style={ghostButtonStyle} onClick={() => onOpenEditor?.()}>
            ✏️ CAD編集で確認
          </button>
          {message !== null && <span style={{ fontSize: 14, color: 'var(--ink2)' }}>{message}</span>}
        </div>
      </main>
    </div>
  )
}
