/**
 * ホーム・案件一覧画面。
 * 案件/図面管理の入口として、画面内で新規作成、案件詳細、全件表示、復旧候補、
 * 最近開いた図面、お知らせ、統計カードの絞り込みを処理する。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { createDemoDrawingGeometries } from '@/app/demoData'
import { isDemoMode } from '@/app/mode'
import {
  DEMO_PROJECTS,
  demoStaleReviewCount,
  recentDrawingsFromProjects,
  type DemoProject,
  type DemoProjectStatus,
} from '@/app/demoProjects'
import { createDefaultLayer } from '@/app/store/editorStore'
import { useEditorStoreApi } from '@/app/store/useEditorStore'
import type { AutosaveSnapshot, AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import {
  createCivilDraftApiClient,
  type CloudProject,
} from '@/infrastructure/cloud/civilDraftApiClient'

export interface HomePageProps {
  readonly autosaveStore: AutosaveStore
  readonly onOpenEditor: () => void
  /** 実案件選択時に共有の案件詳細画面（ProjectDetailPage）へ遷移する。 */
  readonly onOpenProject?: (projectId: string) => void
  /** Workers API クライアント（テスト注入用。未指定時は同一オリジン API を使用）。 */
  readonly cloudApiClient?: Pick<
    ReturnType<typeof createCivilDraftApiClient>,
    'listProjects' | 'createProject' | 'createDrawing'
  >
  /** 編集権限（viewer ロールでは false。false 時は作成・編集ボタンを非表示）。 */
  readonly canEdit?: boolean
  /** 本番モード（共有データを API から取得し、サンプルデータを表示しない）。App が MODE=production 時に true を渡す。 */
  readonly enableCloudData?: boolean
}

type HomeMode = 'dashboard' | 'new' | 'detail' | 'all' | 'recent' | 'notice' | 'metric'
type MetricKey = 'active' | 'review' | 'approval' | 'recovery'

interface ProjectRow {
  readonly id?: string
  readonly name: string
  readonly area: string
  readonly status: '進行中' | '照査待ち' | '承認待ち' | '承認済み' | '差戻し'
  readonly color: string
  readonly bg: string
  readonly drawings: number
  readonly updated: string
  readonly manager: string
  readonly client: string
  readonly note: string
}

interface RecentDrawing {
  readonly icon: string
  readonly name: string
  readonly project: string
  readonly no: string
  readonly rev: string
  readonly when: string
  readonly status: string
}

interface Notice {
  readonly title: string
  readonly date: string
  readonly body: string
  readonly severity: 'info' | 'maintenance'
}

const STATUS_COLOR: Record<DemoProjectStatus, string> = {
  進行中: '#2E5AAC',
  照査待ち: '#B5701A',
  承認待ち: '#6B45B0',
  承認済み: '#1F8255',
  差戻し: '#C5392F',
}

const STATUS_BG: Record<DemoProjectStatus, string> = {
  進行中: '#E9F0FB',
  照査待ち: '#FDEFE0',
  承認待ち: '#EDE7F6',
  承認済み: '#E4F3EC',
  差戻し: '#FCE9E7',
}

function toProjectRow(project: DemoProject): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    area: project.area,
    status: project.status,
    color: STATUS_COLOR[project.status],
    bg: STATUS_BG[project.status],
    drawings: project.drawings.length,
    updated: project.updated,
    manager: project.manager,
    client: project.clientSummary,
    note: project.note,
  }
}

const DEMO_PROJECT_ROWS: readonly ProjectRow[] = DEMO_PROJECTS.map(toProjectRow)
const RECENT_DRAWINGS: readonly RecentDrawing[] = recentDrawingsFromProjects(DEMO_PROJECTS)

const NOTICES: readonly Notice[] = [
  { title: 'DXF入出力の対応要素一覧を更新しました', date: '2026-07-11', body: 'line / circle / arc / ellipse / polyline / text の往復確認を追加しました。未対応要素は警告として表示されます。', severity: 'info' },
  { title: '定期メンテナンス予定', date: '2026-07-20 02:00-04:00', body: '共有版の認証・監査ログ基盤メンテナンス予定です。ローカル編集機能には影響しません。', severity: 'maintenance' },
  { title: '数量CSVのインジェクション対策を強化', date: '2026-07-10', body: 'CSV出力時に = + - @ で始まるセルを自動で無害化します。Excelで開く場合の安全性を改善しました。', severity: 'info' },
]

const cardStyle: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '16px 17px', boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', gap: 7, cursor: 'pointer', textAlign: 'left' }
const cardTitleRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const cardTitleStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }
const cardValueStyle: CSSProperties = { fontSize: 28, fontWeight: 600, color: 'var(--ink)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }
const panelStyle: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow)', overflow: 'hidden' }
const thStyle: CSSProperties = { textAlign: 'left', padding: '11px 16px', borderBottom: '1px solid var(--line2)', fontSize: 11, color: 'var(--muted)', fontWeight: 600, background: 'var(--hover)' }
const orangeButton: CSSProperties = { cursor: 'pointer', border: '1px solid #E08A2B', background: '#E08A2B', color: '#fff', padding: '6px 11px', borderRadius: 8, font: 'inherit', fontSize: 12, fontWeight: 600 }
const ghostButton: CSSProperties = { cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink2)', padding: '6px 11px', borderRadius: 8, font: 'inherit', fontSize: 12, fontWeight: 600 }
const fieldStyle: CSSProperties = { border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', padding: '8px 10px', font: 'inherit', fontSize: 12.5 }
const demoBannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 14,
  padding: '8px 12px',
  borderRadius: 8,
  background: '#FFF7E8',
  border: '1px solid #F0D9B0',
  color: '#8A5A00',
  fontSize: 12,
}

function tdStyle(last: boolean): CSSProperties {
  return { padding: '12px 16px', borderBottom: last ? 'none' : '1px solid var(--line2)' }
}

function statusBadge(color: string, bg: string): CSSProperties {
  return { display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color, background: bg }
}

/** ダッシュボードのステータス分布チャート（表示順・配色はステータスバッジと一致）。 */
const STATUS_DISTRIBUTION: readonly { readonly label: string; readonly color: string }[] = [
  { label: '進行中', color: '#2E5AAC' },
  { label: '照査待ち', color: '#B5701A' },
  { label: '承認待ち', color: '#6B45B0' },
  { label: '承認済み', color: '#1F8255' },
  { label: '差戻し', color: '#C5392F' },
]

function metricProjects(metric: MetricKey, projects: readonly ProjectRow[]): readonly ProjectRow[] {
  const source = projects.length > 0 ? projects : DEMO_PROJECT_ROWS
  if (metric === 'active') return source.filter((p) => p.status === '進行中')
  if (metric === 'review') return source.filter((p) => p.status === '照査待ち')
  if (metric === 'approval') return source.filter((p) => p.status === '承認待ち')
  return []
}

export function HomePage({
  autosaveStore,
  onOpenEditor,
  onOpenProject,
  cloudApiClient,
  canEdit = true,
  enableCloudData = false,
}: HomePageProps) {
  const storeApi = useEditorStoreApi()
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null)
  const [mode, setMode] = useState<HomeMode>('dashboard')
  const [selectedProject, setSelectedProject] = useState<ProjectRow>(DEMO_PROJECT_ROWS[0]!)
  const [selectedRecent, setSelectedRecent] = useState<RecentDrawing>(RECENT_DRAWINGS[0]!)
  const [selectedNotice, setSelectedNotice] = useState<Notice>(NOTICES[0]!)
  const [metric, setMetric] = useState<MetricKey>('active')
  const [createdProjects, setCreatedProjects] = useState<ProjectRow[]>([])
  const [draftName, setDraftName] = useState('新規施工ヤード計画')
  const [draftDrawingName, setDraftDrawingName] = useState('施工ヤード計画図')
  const [draftArea, setDraftArea] = useState('1工区')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void autosaveStore.load().then((result) => {
      if (cancelled) return
      if (result.ok) setSnapshot(result.value)
      else setRecoveryMessage(`下書きの読込に失敗: ${result.error.message}`)
    })
    return () => {
      cancelled = true
    }
  }, [autosaveStore])

  const demoMode = isDemoMode()
  const useCloudData = enableCloudData && !demoMode
  const [cloudProjects, setCloudProjects] = useState<readonly CloudProject[] | null>(null)
  const [cloudError, setCloudError] = useState<string | null>(null)

  useEffect(() => {
    if (!useCloudData) return
    const client = cloudApiClient ?? createCivilDraftApiClient()
    let cancelled = false
    void client.listProjects().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setCloudProjects(result.value)
        setCloudError(null)
      } else {
        setCloudError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [cloudApiClient, useCloudData])

  const useDemoData = !useCloudData
  const projects = useMemo(() => {
    if (useDemoData) return [...createdProjects, ...DEMO_PROJECT_ROWS]
    return (cloudProjects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      area: '未設定',
      status: (project.status ?? 'active') === 'active' ? ('進行中' as const) : ('承認済み' as const),
      color: '#2E5AAC',
      bg: '#E9F0FB',
      drawings: 0,
      updated: '',
      manager: '',
      client: project.clientName ?? '',
      note: project.projectNumber,
    }))
  }, [useDemoData, createdProjects, cloudProjects])
  const activeCount = projects.filter((project) => project.status === '進行中').length
  const reviewCount = projects.filter((project) => project.status === '照査待ち').length
  const approvalCount = projects.filter((project) => project.status === '承認待ち').length
  const recoveryCount = snapshot !== null ? 1 : 0
  const statusCounts = useMemo(
    () =>
      STATUS_DISTRIBUTION.map((item) => ({
        ...item,
        count: projects.filter((project) => project.status === item.label).length,
      })),
    [projects],
  )

  const restoreSnapshot = () => {
    if (snapshot === null) return
    storeApi.getState().replaceDocument(snapshot.geometries, snapshot.layers)
    onOpenEditor()
  }

  const discardSnapshot = () => {
    void autosaveStore.clear().then((result) => {
      if (result.ok) {
        setSnapshot(null)
        setRecoveryMessage('下書きを破棄しました')
      } else {
        setRecoveryMessage(`破棄に失敗: ${result.error.message}`)
      }
    })
  }

  const createRecoveryCandidate = () => {
    const nextSnapshot: AutosaveSnapshot = {
      savedAt: new Date().toISOString(),
      geometries: createDemoDrawingGeometries(),
      layers: [createDefaultLayer()],
    }
    void autosaveStore.save(nextSnapshot).then((result) => {
      if (result.ok) {
        setSnapshot(nextSnapshot)
        setRecoveryMessage('デモ下書きを作成しました')
      } else {
        setRecoveryMessage(`下書き作成に失敗: ${result.error.message}`)
      }
    })
  }

  const submitNewProject = async () => {
    const name = draftName.trim()
    const drawingName = draftDrawingName.trim()
    const area = draftArea.trim()
    if (name === '') {
      setDraftError('案件名を入力してください')
      return
    }
    if (drawingName === '') {
      setDraftError('初期図面名を入力してください')
      return
    }
    if (useCloudData) {
      const client = cloudApiClient ?? createCivilDraftApiClient()
      const projectResult = await client.createProject({
        projectNumber: `P-${Date.now().toString(36).toUpperCase()}`,
        name,
        clientName: '',
      })
      if (!projectResult.ok) {
        setDraftError(`案件作成に失敗: ${projectResult.error.message}`)
        return
      }
      const drawingResult = await client.createDrawing(projectResult.value.id, {
        drawingNumber: 'DWG-001',
        name: drawingName,
        drawingType: 'temporary-yard-plan',
        settings: { paperSize: 'A3', orientation: 'landscape', scaleDenominator: 100, drawingUnit: 'mm' },
      })
      if (!drawingResult.ok) {
        setDraftError(`初期図面の作成に失敗: ${drawingResult.error.message}`)
        return
      }
      setDraftError(null)
      setCloudProjects((current) => [...(current ?? []), projectResult.value])
      setMode('dashboard')
      onOpenProject?.(projectResult.value.id)
      return
    }
    const project: ProjectRow = {
      name,
      area: area === '' ? '未設定' : area,
      status: '進行中',
      color: '#2E5AAC',
      bg: '#E9F0FB',
      drawings: 1,
      updated: new Date().toISOString().slice(0, 10),
      manager: '山田 太郎',
      client: '新規発注者',
      note: `${drawingName} を初期図面として作成`,
    }
    setDraftError(null)
    setCreatedProjects((current) => [project, ...current])
    setSelectedProject(project)
    setMode('detail')
  }

  const openProject = (project: ProjectRow) => {
    if (project.id !== undefined && onOpenProject !== undefined) {
      onOpenProject(project.id)
      return
    }
    setSelectedProject(project)
    setMode('detail')
  }

  const openRecent = (drawing: RecentDrawing) => {
    setSelectedRecent(drawing)
    setMode('recent')
  }

  const openNotice = (notice: Notice) => {
    setSelectedNotice(notice)
    setMode('notice')
  }

  const openMetric = (nextMetric: MetricKey) => {
    setMetric(nextMetric)
    setMode(nextMetric === 'recovery' ? 'dashboard' : 'metric')
  }

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const searchedProjects = normalizedSearch === ''
    ? projects
    : projects.filter((project) => {
      const drawingHit = RECENT_DRAWINGS.some(
        (drawing) =>
          drawing.project === project.name &&
          (drawing.no.toLowerCase().includes(normalizedSearch) ||
            drawing.name.toLowerCase().includes(normalizedSearch)),
      )
      return project.name.toLowerCase().includes(normalizedSearch) || drawingHit
    })
  const visibleProjects = mode === 'metric' ? metricProjects(metric, projects) : searchedProjects.slice(0, 5)
  const tableProjects = mode === 'all' ? searchedProjects : visibleProjects

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ height: 62, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', padding: '0 22px', gap: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>ホーム・案件一覧</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>案件管理、新規作成、復旧候補、最近の図面、お知らせ</div>
        </div>
        <div style={{ flex: 1 }} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="案件名・図面番号で検索"
          style={{ ...fieldStyle, width: 220 }}
        />
        {canEdit && (
          <button onClick={() => setMode('new')} style={{ ...orangeButton, padding: '8px 14px', fontSize: 12.5 }}>
            ＋ 新規案件・図面
          </button>
        )}
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: 22 }}>
        <div role="status" style={demoBannerStyle}>
          {useDemoData
            ? '⚠️ デモ表示: ?demo=1 のため案件一覧・統計はサンプルデータです。'
            : cloudError !== null
              ? `⚠️ 共有データに接続できません: ${cloudError}（サンプルデータは表示しません）`
              : cloudProjects === null
                ? '📡 共有データを読み込み中…'
                : '✅ 共有データ接続済み: 実案件データを表示中です。'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 14, marginBottom: 16 }}>
          <button style={cardStyle} onClick={() => openMetric('active')}>
            <div style={cardTitleRow}><div style={cardTitleStyle}>進行中案件</div><span style={{ width: 8, height: 8, borderRadius: 3, background: '#2E5AAC' }} /></div>
            <div style={cardValueStyle}>{activeCount}</div><div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>全 {projects.length} 案件中</div>
          </button>
          <button style={cardStyle} onClick={() => openMetric('review')}>
            <div style={cardTitleRow}><div style={cardTitleStyle}>照査待ち図面</div><span style={{ width: 8, height: 8, borderRadius: 3, background: '#B5701A' }} /></div>
            <div style={cardValueStyle}>{reviewCount}</div><div style={{ fontSize: 11, fontWeight: 500, color: '#B5701A' }}>{useDemoData ? `${demoStaleReviewCount(DEMO_PROJECTS)}件が3日以上滞留` : '照査ステータス集計は未連携'}</div>
          </button>
          <button style={cardStyle} onClick={() => openMetric('approval')}>
            <div style={cardTitleRow}><div style={cardTitleStyle}>承認待ち図面</div><span style={{ width: 8, height: 8, borderRadius: 3, background: '#6B45B0' }} /></div>
            <div style={cardValueStyle}>{approvalCount}</div><div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>{useDemoData ? '承認者確認待ち' : '承認ステータス集計は未連携'}</div>
          </button>
          <button style={cardStyle} onClick={() => openMetric('recovery')}>
            <div style={cardTitleRow}><div style={cardTitleStyle}>自動保存の復旧候補</div><span style={{ width: 8, height: 8, borderRadius: 3, background: '#C5392F' }} /></div>
            <div style={cardValueStyle}>{recoveryCount}</div><div style={{ fontSize: 11, fontWeight: 500, color: recoveryCount > 0 ? '#C5392F' : 'var(--muted)' }}>{recoveryCount > 0 ? '未確定の下書きあり' : '未確定の下書きなし'}</div>
          </button>
        </div>

        <div style={{ ...panelStyle, marginBottom: 16 }}>
          <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', fontSize: 14, fontWeight: 600 }}>
            案件ステータス分布
          </div>
          <div
            style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
            role="img"
            aria-label={`案件ステータス分布: ${statusCounts.map((item) => `${item.label} ${item.count}件`).join('、')}`}
          >
            {projects.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>表示できる案件がありません。</div>
            ) : (
              statusCounts.map((item) => {
                const percent = Math.round((item.count / projects.length) * 100)
                return (
                  <div
                    key={item.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '88px 1fr 42px',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: 'var(--ink2)', fontWeight: 500 }}>{item.label}</span>
                    <div style={{ height: 12, background: 'var(--subtle)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${percent}%`, height: '100%', background: item.color, borderRadius: 6 }} />
                    </div>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 11,
                        color: 'var(--ink2)',
                        textAlign: 'right',
                      }}
                    >
                      {item.count}件
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {mode === 'new' && (
          <div style={{ ...panelStyle, marginBottom: 16 }}>
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', fontSize: 14, fontWeight: 600 }}>新規案件・図面</div>
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={cardTitleStyle}>案件名</span><input value={draftName} onChange={(e) => setDraftName(e.target.value)} style={fieldStyle} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={cardTitleStyle}>初期図面名</span><input value={draftDrawingName} onChange={(e) => setDraftDrawingName(e.target.value)} style={fieldStyle} /></label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={cardTitleStyle}>工区</span><input value={draftArea} onChange={(e) => setDraftArea(e.target.value)} style={fieldStyle} /></label>
              {draftError !== null && <div style={{ gridColumn: '1 / -1', color: '#C5392F', fontSize: 12 }}>{draftError}</div>}
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                <button style={orangeButton} onClick={submitNewProject}>案件と図面を作成</button>
                <button style={ghostButton} onClick={() => setMode('dashboard')}>キャンセル</button>
              </div>
            </div>
          </div>
        )}

        {mode === 'detail' && (
          <div style={{ ...panelStyle, marginBottom: 16 }}>
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>案件詳細: {selectedProject.name}</div>
              {canEdit && <button style={orangeButton} onClick={onOpenEditor}>CAD編集で開く</button>}
              <button style={ghostButton} onClick={() => setMode('dashboard')}>閉じる</button>
            </div>
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, fontSize: 12.5 }}>
              <div><b>工区</b><br />{selectedProject.area}</div>
              <div><b>状態</b><br /><span style={statusBadge(selectedProject.color, selectedProject.bg)}>{selectedProject.status}</span></div>
              <div><b>図面数</b><br />{selectedProject.drawings}</div>
              <div><b>最終更新</b><br />{selectedProject.updated}</div>
              <div><b>担当</b><br />{selectedProject.manager}</div>
              <div><b>発注者</b><br />{selectedProject.client}</div>
              <div style={{ gridColumn: 'span 2' }}><b>状況</b><br />{selectedProject.note}</div>
            </div>
          </div>
        )}

        {mode === 'recent' && (
          <div style={{ ...panelStyle, marginBottom: 16 }}>
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>最近開いた図面: {selectedRecent.name}</div>
              {canEdit && <button style={orangeButton} onClick={onOpenEditor}>CAD編集で開く</button>}
              <button style={ghostButton} onClick={() => setMode('dashboard')}>閉じる</button>
            </div>
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, fontSize: 12.5 }}>
              <div><b>図面番号</b><br />{selectedRecent.no}</div><div><b>改訂</b><br />{selectedRecent.rev}</div><div><b>案件</b><br />{selectedRecent.project}</div><div><b>状態</b><br />{selectedRecent.status}</div><div><b>最終表示</b><br />{selectedRecent.when}</div>
            </div>
          </div>
        )}

        {mode === 'notice' && (
          <div style={{ ...panelStyle, marginBottom: 16 }}>
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>お知らせ詳細</div>
              <button style={ghostButton} onClick={() => setMode('dashboard')}>閉じる</button>
            </div>
            <div style={{ padding: 18, fontSize: 12.5, lineHeight: 1.7 }}>
              <b>{selectedNotice.title}</b><br /><span style={{ color: 'var(--muted)' }}>{selectedNotice.date}</span><br />{selectedNotice.body}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.65fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <div style={panelStyle}>
            <div style={{ padding: '15px 18px', borderBottom: '1px solid var(--line2)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>{mode === 'all' ? 'すべての案件' : mode === 'metric' ? '統計カード対象の案件' : '案件一覧'}</div>
              <button style={{ ...ghostButton, color: '#2E5AAC' }} onClick={() => setMode(mode === 'all' ? 'dashboard' : 'all')}>{mode === 'all' ? '通常表示へ戻る' : 'すべて表示 →'}</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr><th style={thStyle}>案件名</th><th style={thStyle}>工区</th><th style={thStyle}>状態</th><th style={thStyle}>図面数</th><th style={thStyle}>最終更新</th></tr></thead>
              <tbody>
                {tableProjects.map((p, i, rows) => {
                  const last = i === rows.length - 1
                  return (
                    <tr key={`${p.name}-${i}`} style={{ cursor: 'pointer' }} onClick={() => openProject(p)}>
                      <td style={tdStyle(last)}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openProject(p)
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
                          {p.name}
                        </button>
                      </td>
                      <td style={tdStyle(last)}>{p.area}</td>
                      <td style={tdStyle(last)}><span style={statusBadge(p.color, p.bg)}>{p.status}</span></td>
                      <td style={{ ...tdStyle(last), fontFamily: "'IBM Plex Mono'" }}>{p.drawings}</td>
                      <td style={{ ...tdStyle(last), color: 'var(--ink2)' }}>{p.updated}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line2)', fontSize: 14, fontWeight: 600 }}>自動保存からの復旧候補</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {snapshot !== null ? (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>未確定の下書き</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 8px' }}>保存: {snapshot.savedAt} ・ 図形{snapshot.geometries.length}件 ・ レイヤー{snapshot.layers.length}件</div>
                    {canEdit ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={orangeButton} onClick={restoreSnapshot}>復元</button>
                        <button style={ghostButton} onClick={discardSnapshot}>破棄</button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        保存済み下書きがあります。復元・破棄は権限のあるロールで行えます。
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{recoveryMessage ?? '復旧候補はありません'}</div>
                    {useDemoData && canEdit && (
                      <button style={ghostButton} onClick={createRecoveryCandidate}>デモ下書きを作成</button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line2)', fontSize: 14, fontWeight: 600 }}>最近開いた図面</div>
              <div>
                {useDemoData
                  ? RECENT_DRAWINGS.map((r, i) => <button key={r.no} onClick={() => openRecent(r)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', border: 'none', borderBottom: i === RECENT_DRAWINGS.length - 1 ? 'none' : '1px solid var(--line2)', width: '100%', background: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}><span>{r.icon}</span><div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name} {r.rev}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.project}</div></div><span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.when}</span></button>)
                  : <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--muted)' }}>閲覧履歴の共有連携は未実装です（実案件データのみ表示）。</div>}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line2)', fontSize: 14, fontWeight: 600 }}>お知らせ</div>
              <div style={{ padding: '10px 0' }}>
                {useDemoData
                  ? NOTICES.map((notice) => <button key={notice.title} onClick={() => openNotice(notice)} style={{ display: 'block', width: '100%', border: 'none', background: 'none', color: 'var(--ink2)', textAlign: 'left', padding: '8px 18px', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>・ {notice.title}（{notice.date}）</button>)
                  : <div style={{ padding: '0 18px', fontSize: 12, color: 'var(--muted)' }}>お知らせ配信機能は未実装です。</div>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
