/**
 * 案件詳細画面（実データ版・Issue #62）。
 * Workers API（GET /api/v1/projects/{id}・drawings・members / PATCH project /
 * POST drawings）から実案件を表示する。?demo=1 やデモビルドでは従来の
 * ProjectDetailPage（サンプル版）へフォールバックする。
 *
 * 表示方針:
 * - データ未取得時はローディング、失敗時はエラー、未選択時は空状態を表示する。
 * - サンプル・捏造データは表示しない（活動履歴など API に存在しない項目は
 *   「未実装」と正直に表示する）。
 * - CAD編集は改訂更新API（既存図面へのsave）が未実装のため、実データでは
 *   無効化し理由を表示する（サンプル版のみ有効）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CloudDraftSession } from './CadEditorPage'
import {
  createCivilDraftApiClient,
  type CloudDrawing,
  type CloudProject,
  type CloudProjectMember,
} from '@/infrastructure/cloud/civilDraftApiClient'
import type { Result, ValidationIssue } from '@/shared/types'
import {
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
  monoStyle,
} from './pageStyles'

type DrawingType = '施工ヤード図' | '仮設計画図' | '土工・断面図' | '数量根拠図'
type FilterType = 'すべて' | DrawingType

const DRAWING_TYPE_LABELS: Record<string, string> = {
  'temporary-yard-plan': '施工ヤード図',
  'temporary-plan': '仮設計画図',
  'earthwork-plan': '土工・断面図',
  'quantity-basis': '数量根拠図',
  general: '一般図',
}

const DRAWING_TYPE_CODES: Record<DrawingType, string> = {
  施工ヤード図: 'temporary-yard-plan',
  仮設計画図: 'temporary-plan',
  '土工・断面図': 'earthwork-plan',
  数量根拠図: 'quantity-basis',
}

const ROLE_LABELS: Record<CloudProjectMember['role'], string> = {
  viewer: '閲覧者',
  editor: '作成者',
  reviewer: '照査者',
  approver: '承認者',
  manager: '管理者',
}

const FILTERS: readonly FilterType[] = ['すべて', '施工ヤード図', '仮設計画図', '土工・断面図', '数量根拠図']

const filterChipActive: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  padding: '7px 13px',
  borderRadius: 8,
  border: '1px solid #E08A2B',
  background: '#FDEFE0',
  color: '#B5701A',
  cursor: 'pointer',
  textDecoration: 'none',
}

const filterChip: CSSProperties = {
  ...filterChipActive,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink2)',
}

const chipCount: CSSProperties = { ...monoStyle, opacity: 0.7, marginLeft: 3 }
const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink2)',
  padding: '8px 14px',
  borderRadius: 8,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
}
const fieldStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--ink)',
  padding: '8px 10px',
  font: 'inherit',
  fontSize: 12.5,
}
const tdBase: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--line2)' }
const tdLast: CSSProperties = { padding: '12px 16px' }
const typeBadge: CSSProperties = {
  color: 'var(--ink2)',
  background: 'var(--subtle)',
  border: '1px solid var(--line)',
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 11,
}

export interface ProjectDetailCloudClient {
  getProject(projectId: string): Promise<Result<CloudProject, ValidationIssue>>
  listProjectDrawings(projectId: string): Promise<Result<readonly CloudDrawing[], ValidationIssue>>
  listProjectMembers(projectId: string): Promise<Result<readonly CloudProjectMember[], ValidationIssue>>
  updateProject(
    projectId: string,
    input: {
      readonly projectNumber?: string
      readonly name?: string
      readonly clientName?: string
      readonly status?: 'active' | 'archived'
      readonly expectedVersion: number
    },
  ): Promise<Result<CloudProject, ValidationIssue>>
  createDrawing(
    projectId: string,
    input: {
      readonly drawingNumber: string
      readonly name: string
      readonly drawingType?: string
      readonly settings?: unknown
    },
  ): Promise<Result<CloudDrawing, ValidationIssue>>
}

export interface ProjectDetailCloudPageProps {
  readonly projectId?: string
  readonly onOpenEditor?: (session: CloudDraftSession) => void
  readonly onNavigateHome?: () => void
  readonly cloudApiClient?: ProjectDetailCloudClient
  /** 編集権限（viewer ロールでは false。false 時は編集・作成ボタンを非表示）。 */
  readonly canEdit?: boolean
}

interface CloudDetailState {
  readonly project: CloudProject
  readonly drawings: readonly CloudDrawing[]
  readonly members: readonly CloudProjectMember[]
}

type CloudMode = 'overview' | 'editProject' | 'newDrawing' | 'drawingDetail'

function typeLabel(drawing: CloudDrawing): string {
  const key = drawing.drawingType ?? 'general'
  return DRAWING_TYPE_LABELS[key] ?? drawing.drawingType ?? '一般図'
}

function dateLabel(value: string | undefined): string {
  if (value === undefined || value === '') return '未設定'
  return value.slice(0, 10)
}

export function ProjectDetailCloudPage({
  projectId,
  onOpenEditor,
  onNavigateHome,
  cloudApiClient,
  canEdit = true,
}: ProjectDetailCloudPageProps) {
  const apiClient = useMemo<ProjectDetailCloudClient>(
    () => cloudApiClient ?? createCivilDraftApiClient(),
    [cloudApiClient],
  )
  const [data, setData] = useState<CloudDetailState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<CloudMode>('overview')
  const [filter, setFilter] = useState<FilterType>('すべて')
  const [selectedDrawing, setSelectedDrawing] = useState<CloudDrawing | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftClient, setDraftClient] = useState('')
  const [draftStatus, setDraftStatus] = useState<'active' | 'archived'>('active')
  const [newDrawingName, setNewDrawingName] = useState('新規施工ヤード計画図')
  const [newDrawingType, setNewDrawingType] = useState<DrawingType>('施工ヤード図')

  useEffect(() => {
    if (projectId === undefined) {
      return
    }
    let cancelled = false
    void Promise.all([
      apiClient.getProject(projectId),
      apiClient.listProjectDrawings(projectId),
      apiClient.listProjectMembers(projectId),
    ])
      .then(([projectResult, drawingsResult, membersResult]) => {
        if (cancelled) return
        if (!projectResult.ok) {
          setLoadError(projectResult.error.message)
          return
        }
        if (!drawingsResult.ok) {
          setLoadError(drawingsResult.error.message)
          return
        }
        if (!membersResult.ok) {
          setLoadError(membersResult.error.message)
          return
        }
        setData({
          project: projectResult.value,
          drawings: drawingsResult.value,
          members: membersResult.value,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, projectId])

  const counts = useMemo(() => {
    const countByType = (type: DrawingType) =>
      data?.drawings.filter((d) => typeLabel(d) === type).length ?? 0
    return {
      すべて: data?.drawings.length ?? 0,
      施工ヤード図: countByType('施工ヤード図'),
      仮設計画図: countByType('仮設計画図'),
      '土工・断面図': countByType('土工・断面図'),
      数量根拠図: countByType('数量根拠図'),
    } satisfies Record<FilterType, number>
  }, [data])

  const filteredDrawings = useMemo(() => {
    if (data === null) return []
    return filter === 'すべて' ? data.drawings : data.drawings.filter((d) => typeLabel(d) === filter)
  }, [data, filter])

  if (projectId === undefined) {
    return (
      <div style={pageRootStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <div style={pageTitleStyle}>案件詳細</div>
            <div style={pageSubtitleStyle}>実案件データ（Workers API）</div>
          </div>
        </header>
        <main style={pageMainStyle}>
          <div style={panelStyle}>
            <div style={{ padding: 42, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>案件が選択されていません</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginBottom: 18 }}>
                ホームの案件一覧から案件を選択すると、実案件の情報・図面一覧・メンバーを表示します。
              </div>
              {onNavigateHome !== undefined && (
                <button style={primaryButtonStyle} onClick={onNavigateHome}>
                  ホームへ戻る
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (loadError !== null) {
    return (
      <div style={pageRootStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <div style={pageTitleStyle}>案件詳細</div>
            <div style={pageSubtitleStyle}>実案件データ（Workers API）</div>
          </div>
        </header>
        <main style={pageMainStyle}>
          <div style={panelStyle}>
            <div style={{ padding: 42, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#C5392F', marginBottom: 8 }}>
                ⚠️ 案件データを取得できませんでした
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{loadError}</div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (data === null) {
    return (
      <div style={pageRootStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <div style={pageTitleStyle}>案件詳細</div>
            <div style={pageSubtitleStyle}>実案件データ（Workers API）</div>
          </div>
        </header>
        <main style={pageMainStyle}>
          <div style={panelStyle}>
            <div style={{ padding: 42, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              📡 案件データを読み込み中…
            </div>
          </div>
        </main>
      </div>
    )
  }

  const saveProject = () => {
    setActionMessage(null)
    void apiClient
      .updateProject(data.project.id, {
        name: draftName.trim() === '' ? data.project.name : draftName.trim(),
        clientName: draftClient.trim() === '' ? data.project.clientName : draftClient.trim(),
        status: draftStatus,
        expectedVersion: data.project.version,
      })
      .then((result) => {
        if (!result.ok) {
          setActionMessage(`⚠️ 保存失敗: ${result.error.message}`)
          return
        }
        setData({ ...data, project: result.value })
        setMode('overview')
      })
  }

  const createDrawing = () => {
    if (newDrawingName.trim() === '') {
      setActionMessage('⚠️ 図面名を入力してください')
      return
    }
    setActionMessage(null)
    const maxNo = data.drawings.reduce((max, drawing) => {
      const match = /^DWG-(\d+)$/.exec(drawing.drawingNumber)
      return match === null ? max : Math.max(max, Number(match[1]))
    }, 0)
    const nextNo = `DWG-${String(maxNo + 1).padStart(3, '0')}`
    void apiClient
      .createDrawing(data.project.id, {
        drawingNumber: nextNo,
        name: newDrawingName.trim(),
        drawingType: DRAWING_TYPE_CODES[newDrawingType],
        settings: { paperSize: 'A3', orientation: 'landscape', scaleDenominator: 100, drawingUnit: 'mm' },
      })
      .then(async (result) => {
        if (!result.ok) {
          setActionMessage(`⚠️ 図面作成失敗: ${result.error.message}`)
          return
        }
        const drawingsResult = await apiClient.listProjectDrawings(data.project.id)
        if (!drawingsResult.ok) {
          setActionMessage(`⚠️ 図面一覧の再取得に失敗: ${drawingsResult.error.message}`)
          return
        }
        setData({ ...data, drawings: drawingsResult.value })
        setSelectedDrawing(result.value)
        setFilter('すべて')
        setMode('drawingDetail')
      })
  }

  const toCloudSession = (drawing: CloudDrawing): CloudDraftSession => ({
    projectId: data.project.id,
    drawingId: drawing.id,
    revisionId: drawing.activeRevisionId,
    projectNumber: data.project.projectNumber,
    projectName: data.project.name,
    clientName: data.project.clientName,
    drawingNumber: drawing.drawingNumber,
    drawingName: drawing.name,
    drawingType: drawing.drawingType,
    revisionNumber: drawing.activeRevisionId === undefined ? '新規改訂' : '最新改訂',
    changeSummary: `${drawing.drawingNumber} をCAD編集画面から共有保存`,
  })

  const projectInfo: ReadonlyArray<readonly [string, string]> = [
    ['案件番号', data.project.projectNumber],
    ['状態', data.project.status === 'archived' ? 'アーカイブ' : '進行中'],
    ['発注者', data.project.clientName ?? '未設定'],
    ['作成日', dateLabel(data.project.createdAt)],
    ['更新日', dateLabel(data.project.updatedAt)],
    ['バージョン', `v${data.project.version}`],
  ]

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>{data.project.name}</div>
          <div style={pageSubtitleStyle}>
            案件番号: {data.project.projectNumber} ・ 発注者: {data.project.clientName ?? '未設定'} ・ 更新: {dateLabel(data.project.updatedAt)}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#E9F0FB',
            color: '#2E5AAC',
            padding: '6px 10px',
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {data.project.status === 'archived' ? 'アーカイブ' : '進行中'}
        </div>
        {canEdit && (
          <button
            style={secondaryButtonStyle}
            onClick={() => {
              setDraftName(data.project.name)
              setDraftClient(data.project.clientName ?? '')
              setDraftStatus(data.project.status ?? 'active')
              setMode('editProject')
            }}
          >
            案件を編集
          </button>
        )}
        {canEdit && (
          <button style={primaryButtonStyle} onClick={() => setMode('newDrawing')}>
            ＋ 図面を作成
          </button>
        )}
      </header>

      <main style={pageMainStyle}>
        {actionMessage !== null && (
          <div style={{ ...panelStyle, marginBottom: 12, padding: '10px 14px', fontSize: 12.5 }}>{actionMessage}</div>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 392px',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {mode === 'editProject' && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle}>案件を編集</div>
                <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>案件名</span>
                    <input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={fieldStyle} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>発注者</span>
                    <input value={draftClient} onChange={(e) => setDraftClient(e.target.value)} style={fieldStyle} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>状態</span>
                    <select
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value as 'active' | 'archived')}
                      style={fieldStyle}
                    >
                      <option value="active">進行中</option>
                      <option value="archived">アーカイブ</option>
                    </select>
                  </label>
                  <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                    <button style={primaryButtonStyle} onClick={saveProject}>保存</button>
                    <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>キャンセル</button>
                  </div>
                </div>
              </div>
            )}

            {mode === 'newDrawing' && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle}>図面を作成</div>
                <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>名称</span>
                    <input value={newDrawingName} onChange={(e) => setNewDrawingName(e.target.value)} style={fieldStyle} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>種別</span>
                    <select
                      value={newDrawingType}
                      onChange={(e) => setNewDrawingType(e.target.value as DrawingType)}
                      style={fieldStyle}
                    >
                      {FILTERS.filter((f): f is DrawingType => f !== 'すべて').map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
                    <button style={primaryButtonStyle} onClick={createDrawing}>作成</button>
                    <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>キャンセル</button>
                  </div>
                </div>
              </div>
            )}

            {mode === 'drawingDetail' && selectedDrawing !== null && (
              <div style={panelStyle}>
                <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>図面詳細: {selectedDrawing.drawingNumber} {selectedDrawing.name}</div>
                  {canEdit && (
                    <button
                      style={primaryButtonStyle}
                      disabled
                      title="実図面のCAD編集は改訂更新APIの実装後に利用可能になります（Issue #62 後続）"
                      onClick={() => onOpenEditor?.(toCloudSession(selectedDrawing))}
                    >
                      CAD編集で開く
                    </button>
                  )}
                  <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>閉じる</button>
                </div>
                <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, fontSize: 12.5 }}>
                  <div><b>図面番号</b><br />{selectedDrawing.drawingNumber}</div>
                  <div><b>種別</b><br />{typeLabel(selectedDrawing)}</div>
                  <div><b>状態</b><br /><span style={statusBadgeStyle('#2E5AAC', '#E9F0FB')}>{selectedDrawing.status === 'archived' ? 'アーカイブ' : '運用中'}</span></div>
                  <div><b>更新日</b><br />{dateLabel(selectedDrawing.updatedAt)}</div>
                  <div><b>更新者</b><br />{selectedDrawing.updatedBy ?? '未設定'}</div>
                </div>
                <div style={{ padding: '0 18px 16px', fontSize: 11.5, color: 'var(--muted)' }}>
                  ※ 実図面のCAD編集・共有保存は既存図面への改訂更新API（後続Issue）で対応予定です。
                </div>
              </div>
            )}

            <div style={panelStyle}>
              <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>図面一覧</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '14px 18px 0' }}>
                {FILTERS.map((nextFilter) => (
                  <button
                    key={nextFilter}
                    style={filter === nextFilter ? filterChipActive : filterChip}
                    onClick={() => setFilter(nextFilter)}
                  >
                    {nextFilter}<span style={chipCount}>{counts[nextFilter]}</span>
                  </button>
                ))}
              </div>
              {filteredDrawings.length === 0 ? (
                <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
                  該当する図面はありません。
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>図面番号</th>
                      <th style={thStyle}>名称</th>
                      <th style={thStyle}>種別</th>
                      <th style={thStyle}>状態</th>
                      <th style={thStyle}>更新日</th>
                      <th style={thStyle}>更新者</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrawings.map((drawing, index) => {
                      const td = index === filteredDrawings.length - 1 ? tdLast : tdBase
                      return (
                        <tr key={drawing.id} style={{ cursor: 'pointer' }} onClick={() => { setSelectedDrawing(drawing); setMode('drawingDetail') }}>
                          <td style={{ ...td, ...monoStyle, color: 'var(--ink2)' }}>{drawing.drawingNumber}</td>
                          <td style={td}>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                setSelectedDrawing(drawing)
                                setMode('drawingDetail')
                              }}
                              style={{
                                border: 0,
                                padding: 0,
                                background: 'none',
                                color: 'var(--ink)',
                                font: 'inherit',
                                fontWeight: 500,
                                cursor: 'pointer',
                                textAlign: 'left',
                              }}
                            >
                              {drawing.name}
                            </button>
                          </td>
                          <td style={td}><span style={typeBadge}>{typeLabel(drawing)}</span></td>
                          <td style={td}>
                            <span style={statusBadgeStyle('#2E5AAC', '#E9F0FB')}>
                              {drawing.status === 'archived' ? 'アーカイブ' : '運用中'}
                            </span>
                          </td>
                          <td style={{ ...td, ...monoStyle }}>{dateLabel(drawing.updatedAt)}</td>
                          <td style={{ ...td, color: 'var(--ink2)' }}>{drawing.updatedBy ?? '未設定'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>案件情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 16px', margin: 0 }}>
                  {projectInfo.map(([key, value]) => (
                    <div key={key} style={{ display: 'contents' }}>
                      <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>{key}</dt>
                      <dd style={{ margin: 0, fontSize: 12.5 }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>メンバー</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.members.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>メンバーは登録されていません。</div>
                ) : (
                  data.members.map((member) => (
                    <div key={member.userId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: '#2A3850',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 600,
                          fontSize: 12,
                          flexShrink: 0,
                        }}
                      >
                        {member.userId.slice(0, 1).toUpperCase()}
                      </span>
                      <div style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.userId}</div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#2E5AAC',
                          border: '1px solid #C9D7EC',
                          padding: '1px 6px',
                          borderRadius: 5,
                        }}
                      >
                        {ROLE_LABELS[member.role]}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>最近のアクティビティ</div>
              <div style={{ padding: '16px 18px', fontSize: 12, color: 'var(--muted)' }}>
                活動履歴の取得は未実装です（監査ログAPI連携は別Issue）。
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
