/**
 * 案件詳細画面。
 * 正本: Claude Design「CivilDraft Web CAD」Project Detail.dc.html（100%適用）。
 *
 * 本モジュールはデモ用サンプル実装（?demo=1 またはデモビルド時のみ使用）。
 * 本番モード（enableCloudData）では ProjectDetailCloudPage（実案件データ版・Issue #62）へ分岐する。
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { isDemoMode } from '@/app/mode'
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
import type { CloudDraftSession } from './CadEditorPage'
import {
  DEMO_PROJECTS,
  findDemoProject,
  type DemoDrawing,
  type DemoDrawingStatus,
  type DemoMemberRole,
  type DemoProject,
} from '@/app/demoProjects'
import {
  ProjectDetailCloudPage,
  type ProjectDetailCloudClient,
} from './ProjectDetailCloudPage'

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

type DrawingType = '施工ヤード図' | '仮設計画図' | '土工・断面図' | '数量根拠図'
type DrawingStatus = '作成中' | '照査待ち' | '承認済み' | '差戻し'
type FilterType = 'すべて' | DrawingType

interface DrawingRow {
  readonly no: string
  readonly name: string
  readonly type: DrawingType
  readonly rev: string
  readonly status: DrawingStatus
  readonly c: string
  readonly bg: string
  readonly by: string
}

interface ProjectInfoState {
  readonly name: string
  readonly status: '進行中' | '照査待ち' | '承認待ち' | '承認済み' | '差戻し'
  readonly area: string
  readonly clientSummary: string
  readonly periodSummary: string
  readonly districtCount: string
  readonly client: string
  readonly period: string
  readonly coordinateSystem: string
  readonly unitSystem: string
  readonly contractAmount: string
  readonly supervisor: string
  readonly address: string
  readonly tel: string
}

/** CloudDraftSession.drawingType へ渡す種別コード（Workers API契約と対応）。 */
const DRAWING_TYPE_CODES: Record<DrawingType, string> = {
  施工ヤード図: 'temporary-yard-plan',
  仮設計画図: 'temporary-plan',
  '土工・断面図': 'earthwork-plan',
  数量根拠図: 'quantity-basis',
}

const DRAWING_STATUS_STYLE: Readonly<Record<DemoDrawingStatus, { readonly c: string; readonly bg: string }>> = {
  作成中: { c: '#6B45B0', bg: '#EDE7F6' },
  照査待ち: { c: '#B5701A', bg: '#FDEFE0' },
  承認済み: { c: '#1F8255', bg: '#E4F3EC' },
  差戻し: { c: '#C5392F', bg: '#FCE9E7' },
}

const MEMBER_ROLE_STYLE: Readonly<Record<DemoMemberRole, { readonly c: string; readonly border: string }>> = {
  作成者: { c: '#E08A2B', border: '1px solid rgba(224,138,43,.4)' },
  照査者: { c: '#2E5AAC', border: '1px solid #C9D7EC' },
  承認者: { c: '#1F8255', border: '1px solid #9BCFB2' },
  閲覧者: { c: 'var(--muted)', border: '1px solid var(--line)' },
  数量担当: { c: '#6B45B0', border: '1px solid #D8C7F1' },
}

function toDrawingRow(demoDrawing: DemoDrawing): DrawingRow {
  const style = DRAWING_STATUS_STYLE[demoDrawing.status]
  return {
    no: demoDrawing.no,
    name: demoDrawing.name,
    type: demoDrawing.type,
    rev: demoDrawing.rev,
    status: demoDrawing.status,
    c: style.c,
    bg: style.bg,
    by: demoDrawing.by,
  }
}

function toProjectInfo(demoProject: DemoProject): ProjectInfoState {
  return {
    name: demoProject.name,
    status: demoProject.status,
    area: demoProject.area,
    clientSummary: demoProject.clientSummary,
    periodSummary: demoProject.period.replace(' 〜 ', '〜'),
    districtCount: demoProject.districtCount,
    client: demoProject.client,
    period: demoProject.period,
    coordinateSystem: demoProject.coordinateSystem,
    unitSystem: demoProject.unitSystem,
    contractAmount: demoProject.contractAmount,
    supervisor: demoProject.supervisor,
    address: demoProject.address,
    tel: demoProject.tel,
  }
}

const FILTERS: readonly FilterType[] = ['すべて', '施工ヤード図', '仮設計画図', '土工・断面図', '数量根拠図']

const ACTIVITY_COLORS = ['#2E9E6B', '#B5701A', '#C5392F', '#6B45B0', '#2E5AAC'] as const

export interface ProjectDetailPageProps {
  readonly onOpenEditor?: (session: CloudDraftSession) => void
  /** 編集権限（viewer ロールでは false。false 時は編集・作成ボタンを非表示）。 */
  readonly canEdit?: boolean
  /** 実案件ID（ホームの案件一覧から選択した案件）。 */
  readonly projectId?: string
  /** 実データ未選択時にホームへ戻る導線。 */
  readonly onNavigateHome?: () => void
  /** Workers API クライアント（テスト注入用）。 */
  readonly cloudApiClient?: ProjectDetailCloudClient
  /** 本番モード（共有データを API から取得し、サンプルデータを表示しない）。 */
  readonly enableCloudData?: boolean
}

function DemoProjectDetail({
  onOpenEditor,
  canEdit = true,
  demoProjectId,
}: {
  readonly onOpenEditor?: (session: CloudDraftSession) => void
  readonly canEdit?: boolean
  readonly demoProjectId?: string
}) {
  const initialProject = findDemoProject(demoProjectId) ?? DEMO_PROJECTS[0]!
  const [project, setProject] = useState<ProjectInfoState>(() => toProjectInfo(initialProject))
  const [draftProject, setDraftProject] = useState<ProjectInfoState>(() => toProjectInfo(initialProject))
  const [drawings, setDrawings] = useState<readonly DrawingRow[]>(() => initialProject.drawings.map(toDrawingRow))
  const [filter, setFilter] = useState<FilterType>('すべて')
  const [mode, setMode] = useState<'overview' | 'editProject' | 'newDrawing' | 'drawingDetail'>('overview')
  const [selectedDrawing, setSelectedDrawing] = useState<DrawingRow | null>(initialProject.drawings[0] ? toDrawingRow(initialProject.drawings[0]!) : null)
  const [newDrawingName, setNewDrawingName] = useState('新規施工ヤード計画図')
  const [newDrawingType, setNewDrawingType] = useState<DrawingType>('施工ヤード図')

  const counts = useMemo(() => {
    const countByType = (type: DrawingType) => drawings.filter((d) => d.type === type).length
    return {
      すべて: drawings.length,
      施工ヤード図: countByType('施工ヤード図'),
      仮設計画図: countByType('仮設計画図'),
      '土工・断面図': countByType('土工・断面図'),
      数量根拠図: countByType('数量根拠図'),
    } satisfies Record<FilterType, number>
  }, [drawings])

  const filteredDrawings = filter === 'すべて' ? drawings : drawings.filter((drawing) => drawing.type === filter)

  const projectInfo = [
    ['工区数', project.districtCount],
    ['発注者', project.client],
    ['工期', project.period],
    ['座標系', project.coordinateSystem],
    ['単位系', project.unitSystem],
    ['契約金額', project.contractAmount],
    ['監督員', project.supervisor],
    ['住所', project.address],
    ['電話', project.tel],
  ] as const

  const activities = initialProject.activities.map((item, index) => ({
    ...item,
    color: ACTIVITY_COLORS[index % ACTIVITY_COLORS.length],
    line: index < initialProject.activities.length - 1,
  }))

  const saveProject = () => {
    setProject(draftProject)
    setMode('overview')
  }

  const createDrawing = () => {
    const maxNo = Math.max(...drawings.map((drawing) => Number(drawing.no.replace('DWG-', ''))))
    const nextNo = `DWG-${String(maxNo + 1).padStart(3, '0')}`
    const drawing: DrawingRow = {
      no: nextNo,
      name: newDrawingName,
      type: newDrawingType,
      rev: 'Rev.1',
      status: '作成中',
      c: '#6B45B0',
      bg: '#EDE7F6',
      by: initialProject.members.find((member) => member.role === '作成者')?.name ?? '担当者',
    }
    setDrawings((current) => [drawing, ...current])
    setSelectedDrawing(drawing)
    setFilter('すべて')
    setMode('drawingDetail')
  }

  const openDrawing = (drawing: DrawingRow) => {
    setSelectedDrawing(drawing)
    setMode('drawingDetail')
  }

  /** 選択図面から共有保存用のCloudDraftSessionを構築する（Workers API契約と対応）。 */
  const toCloudSession = (drawing: DrawingRow): CloudDraftSession => ({
    projectNumber: initialProject.projectNumber,
    projectName: project.name,
    clientName: project.client,
    drawingNumber: drawing.no,
    drawingName: drawing.name,
    drawingType: DRAWING_TYPE_CODES[drawing.type],
    revisionNumber: drawing.rev,
    changeSummary: `${drawing.no} ${drawing.rev} をCAD編集画面から共有保存`,
  })

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>{project.name}</div>
          <div style={pageSubtitleStyle}>{project.area} ・ 発注者: {project.clientSummary} ・ 工期 {project.periodSummary}</div>
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
          {project.status}
        </div>
        {canEdit && (
          <button style={secondaryButtonStyle} onClick={() => { setDraftProject(project); setMode('editProject') }}>
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>案件名</span><input value={draftProject.name} onChange={(e) => setDraftProject({ ...draftProject, name: e.target.value })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>工区</span><input value={draftProject.area} onChange={(e) => setDraftProject({ ...draftProject, area: e.target.value })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>発注者</span><input value={draftProject.client} onChange={(e) => setDraftProject({ ...draftProject, client: e.target.value, clientSummary: e.target.value.replace(' 道路課', '') })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>工期</span><input value={draftProject.period} onChange={(e) => setDraftProject({ ...draftProject, period: e.target.value, periodSummary: e.target.value.replace(' 〜 ', '〜') })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>状態</span><select value={draftProject.status} onChange={(e) => setDraftProject({ ...draftProject, status: e.target.value as ProjectInfoState['status'] })} style={fieldStyle}><option value="進行中">進行中</option><option value="照査待ち">照査待ち</option><option value="承認待ち">承認待ち</option><option value="承認済み">承認済み</option><option value="差戻し">差戻し</option></select></label>
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
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>名称</span><input value={newDrawingName} onChange={(e) => setNewDrawingName(e.target.value)} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>種別</span><select value={newDrawingType} onChange={(e) => setNewDrawingType(e.target.value as DrawingType)} style={fieldStyle}>{FILTERS.filter((f): f is DrawingType => f !== 'すべて').map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
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
                <div style={{ flex: 1 }}>図面詳細: {selectedDrawing.no} {selectedDrawing.name}</div>
                {canEdit && (
                  <button style={primaryButtonStyle} onClick={() => onOpenEditor?.(toCloudSession(selectedDrawing))}>
                    CAD編集で開く
                  </button>
                )}
                <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>閉じる</button>
              </div>
              <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, fontSize: 12.5 }}>
                <div><b>図面番号</b><br />{selectedDrawing.no}</div>
                <div><b>種別</b><br />{selectedDrawing.type}</div>
                <div><b>改訂</b><br />{selectedDrawing.rev}</div>
                <div><b>状態</b><br /><span style={statusBadgeStyle(selectedDrawing.c, selectedDrawing.bg)}>{selectedDrawing.status}</span></div>
                <div><b>更新者</b><br />{selectedDrawing.by}</div>
              </div>
            </div>
          )}

          <div style={panelStyle}>
            <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>図面一覧</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '14px 18px 0' }}>
              {FILTERS.map((nextFilter) => (
                <button key={nextFilter} style={filter === nextFilter ? filterChipActive : filterChip} onClick={() => setFilter(nextFilter)}>
                  {nextFilter}<span style={chipCount}>{counts[nextFilter]}</span>
                </button>
              ))}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle}>図面番号</th>
                  <th style={thStyle}>名称</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>改訂</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}>更新者</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrawings.map((d, i) => {
                  const td = i === filteredDrawings.length - 1 ? tdLast : tdBase
                  return (
                    <tr key={d.no} style={{ cursor: 'pointer' }} onClick={() => openDrawing(d)}>
                      <td style={{ ...td, ...monoStyle, color: 'var(--ink2)' }}>{d.no}</td>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openDrawing(d)
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
                          {d.name}
                        </button>
                      </td>
                      <td style={td}>
                        <span style={typeBadge}>{d.type}</span>
                      </td>
                      <td style={{ ...td, ...monoStyle }}>{d.rev}</td>
                      <td style={td}>
                        <span style={statusBadgeStyle(d.c, d.bg)}>{d.status}</span>
                      </td>
                      <td style={{ ...td, color: 'var(--ink2)' }}>{d.by}</td>
                    </tr>
                  )
                })}
              </tbody>
              {filteredDrawings.length === 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ padding: '18px 16px', fontSize: 12, color: 'var(--muted)' }}>
                      図面がまだありません。「＋ 図面を作成」から追加できます。
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>案件情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 16px', margin: 0 }}>
                  {projectInfo.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>{k}</dt>
                      <dd style={{ margin: 0, fontSize: 12.5 }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>メンバー</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {initialProject.members.map((m) => {
                  const roleStyle = MEMBER_ROLE_STYLE[m.role]
                  return (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                      {m.name.charAt(0)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>{m.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{m.email}</div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: roleStyle.c,
                        border: roleStyle.border,
                        padding: '1px 6px',
                        borderRadius: 5,
                        flexShrink: 0,
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                  )
                })}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>最近のアクティビティ</div>
              <div style={{ padding: '16px 18px' }}>
                {activities.map((a) => (
                  <div key={a.text} style={{ display: 'flex', gap: 11 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 3, background: a.color }} />
                      {a.line && (
                        <span style={{ width: 2, flex: 1, background: 'var(--line2)', minHeight: 12 }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: a.line ? 13 : 0 }}>
                      <div style={{ fontSize: 12.5 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.when}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export function ProjectDetailPage({
  onOpenEditor,
  canEdit = true,
  projectId,
  onNavigateHome,
  cloudApiClient,
  enableCloudData = false,
}: ProjectDetailPageProps) {
  const demoMode = isDemoMode()
  const useCloudData = enableCloudData && !demoMode
  if (!useCloudData) {
    return (
      <DemoProjectDetail
        key={projectId ?? 'demo-default'}
        demoProjectId={projectId}
        onOpenEditor={onOpenEditor}
        canEdit={canEdit}
      />
    )
  }
  return (
    <ProjectDetailCloudPage
      key={projectId ?? 'empty'}
      projectId={projectId}
      onOpenEditor={onOpenEditor}
      onNavigateHome={onNavigateHome}
      cloudApiClient={cloudApiClient}
      canEdit={canEdit}
    />
  )
}
