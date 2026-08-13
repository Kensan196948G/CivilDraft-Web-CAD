/**
 * アプリケーションルート。
 * デザイン正本: Claude Design「CivilDraft Web CAD」Home.dc.html / CAD Editor.dc.html（100%適用）。
 * 画面構成: ホーム（サイドバー+案件一覧+復旧候補）⇄ CAD編集（CadEditorPage）⇄ 各業務ページ。
 * テーマ（light/dark）は data-theme 属性 + localStorage 'civildraft-theme' で永続化。
 *
 * 自動保存の役割分担:
 * - CadEditorPage: 図形/レイヤー変更のデバウンス保存 + 保存状態表示（エディタ画面）
 * - HomePage: 起動時の復旧候補表示と利用者主導の復元/破棄（デザインの意図に合わせ、
 *   旧実装の「マウント時サイレント自動復元」から明示操作へ変更）
 *
 * HomePage/DrawingComparePage/CadEditorPageは同一のautosaveStoreインスタンスを共有する
 * （エディタで保存したスナップショットをホームの復旧候補から見えるようにするため）。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar } from './layout/Sidebar'
import type { AppView } from './layout/Sidebar'
import { isDemoMode } from './mode'
import { fetchAccessIdentity } from '@/infrastructure/auth/accessIdentity'
import type { AccessIdentity } from '@/infrastructure/auth/accessIdentity'
import {
  permissionsFor,
  roleFromIdentity,
  type CivilDraftRole,
} from '@/infrastructure/auth/roles'
import {
  createNewDraftSession,
  DEFAULT_CLOUD_DRAFT_SESSION,
  type CloudDraftSession,
} from './pages/cloudDraftSession'
import { fetchFieldRevisionStatus, type FieldRevisionStatus } from './pages/fieldRevisionStatus'
import { HomePage } from './pages/HomePage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { createAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { formatRoute, parseRoute } from './hashRoute'
import './home.css'

// バンドル最適化（Issue #26）: 初期表示に不要なページ（CAD編集含む）はコード分割し、
// 遷移時に遅延読み込みする（pdf-lib/dxf 等の vendor チャンクの初期ロードを回避）。
const CadEditorPage = lazy(() =>
  import('./pages/CadEditorPage').then((m) => ({ default: m.CadEditorPage })),
)
const ProjectDetailPage = lazy(() =>
  import('./pages/ProjectDetailPage').then((m) => ({ default: m.ProjectDetailPage })),
)
const DrawingSettingsPage = lazy(() =>
  import('./pages/DrawingSettingsPage').then((m) => ({ default: m.DrawingSettingsPage })),
)
const SurveyPointsPage = lazy(() =>
  import('./pages/SurveyPointsPage').then((m) => ({ default: m.SurveyPointsPage })),
)
const PartsPalettePage = lazy(() =>
  import('./pages/PartsPalettePage').then((m) => ({ default: m.PartsPalettePage })),
)
const QuantitySummaryPage = lazy(() =>
  import('./pages/QuantitySummaryPage').then((m) => ({ default: m.QuantitySummaryPage })),
)
const CrossSectionPage = lazy(() =>
  import('./pages/CrossSectionPage').then((m) => ({ default: m.CrossSectionPage })),
)
const ConstructionStepsPage = lazy(() =>
  import('./pages/ConstructionStepsPage').then((m) => ({ default: m.ConstructionStepsPage })),
)
const FieldExplanationPage = lazy(() =>
  import('./pages/FieldExplanationPage').then((m) => ({ default: m.FieldExplanationPage })),
)
const DrawingComparePage = lazy(() =>
  import('./pages/DrawingComparePage').then((m) => ({ default: m.DrawingComparePage })),
)
const ReviewApprovalPage = lazy(() =>
  import('./pages/ReviewApprovalPage').then((m) => ({ default: m.ReviewApprovalPage })),
)
const PrintExportPage = lazy(() =>
  import('./pages/PrintExportPage').then((m) => ({ default: m.PrintExportPage })),
)
const EdeliveryPage = lazy(() =>
  import('./pages/EdeliveryPage').then((m) => ({ default: m.EdeliveryPage })),
)
const AuditLogPage = lazy(() =>
  import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
)
const SystemSettingsPage = lazy(() =>
  import('./pages/SystemSettingsPage').then((m) => ({ default: m.SystemSettingsPage })),
)

const THEME_STORAGE_KEY = 'civildraft-theme'

/** viewer ロールでサイドバーから除外する編集系ビュー（Issue #177）。 */
const VIEWER_HIDDEN_VIEWS: readonly AppView[] = [
  'editor',
  'newDrawing',
  'drawingSettings',
  'parts',
  'approval',
  'audit',
  'settings',
]

function loadTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function AppShell() {
  const initialRoute = useMemo(() => parseRoute(window.location.hash), [])
  const initialIsNewDrawing = initialRoute?.view === 'newDrawing'
  const [view, setView] = useState<AppView>(
    initialIsNewDrawing ? 'newDrawing' : initialRoute?.view ?? 'home',
  )
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [autosaveStore] = useState<AutosaveStore>(() => createAutosaveStore())
  const [identity, setIdentity] = useState<AccessIdentity | null>(null)
  const [fieldRevisionStatus, setFieldRevisionStatus] = useState<FieldRevisionStatus>('unknown')
  const [cloudDraftSession, setCloudDraftSession] = useState<CloudDraftSession>(
    initialIsNewDrawing ? createNewDraftSession() : initialRoute?.session ?? DEFAULT_CLOUD_DRAFT_SESSION,
  )
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialRoute?.projectId ?? null,
  )
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarMountRef = useRef<HTMLDivElement>(null)

  // ロール解決（Issue #177）: Cloudflare Access identity からロールを判定する。
  // 取得不可時は開発・テストでは engineer、本番では最小権限の viewer にフォールバックする。
  useEffect(() => {
    let cancelled = false
    void fetchAccessIdentity().then((result) => {
      if (cancelled) return
      setIdentity(
        result.ok && result.value.kind === 'authenticated' ? result.value.identity : null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  const isProduction = import.meta.env.MODE === 'production'
  const demoMode = isDemoMode()
  const role: CivilDraftRole = useMemo(() => {
    // デモ表示（MVP/Preview URL・?demo=1）では編集系導線をすべて有効にする。
    // Access 未ログイン時に viewer へフォールバックすると「CAD編集で開く」等が消えるため。
    if (demoMode) return 'engineer'
    if (identity !== null) return roleFromIdentity(identity)
    return isProduction ? 'viewer' : 'engineer'
  }, [identity, isProduction, demoMode])
  const canEdit = permissionsFor(role).canEdit

  // 現場説明モードの承認状態（Issue #178）: revisionId がある実案件のみ API から取得する。
  useEffect(() => {
    const revisionId = cloudDraftSession.revisionId
    if (view !== 'field' || revisionId === undefined) {
      return
    }
    let cancelled = false
    void fetchFieldRevisionStatus(revisionId).then((status) => {
      if (!cancelled) setFieldRevisionStatus(status)
    })
    return () => {
      cancelled = true
    }
  }, [view, cloudDraftSession.revisionId])

  // モバイル: サイドバーが開いたら最初のナビゲーション項目へフォーカスし、
  // 閉じたらメニューボタンへ復帰させる（キーボード・スクリーンリーダー操作の要件）。
  const wasSidebarOpenRef = useRef(false)
  useEffect(() => {
    if (isSidebarOpen) {
      wasSidebarOpenRef.current = true
      const firstNavItem = sidebarMountRef.current?.querySelector<HTMLButtonElement>('aside button')
      firstNavItem?.focus()
      return
    }
    if (wasSidebarOpenRef.current) {
      wasSidebarOpenRef.current = false
      menuButtonRef.current?.focus()
    }
  }, [isSidebarOpen])

  // モバイル: Escape でサイドバーを閉じる。
  useEffect(() => {
    if (!isSidebarOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen])

  const navigate = useCallback((next: AppView) => {
    if (next === 'newDrawing') {
      setCloudDraftSession(createNewDraftSession())
      setView('newDrawing')
      window.location.hash = formatRoute('newDrawing')
      return
    }
    setView(next)
    if (next === 'field') {
      // 表示開始時は常に「未取得」から始め、API 結果で上書きする（#178）。
      setFieldRevisionStatus('unknown')
    }
    window.location.hash = formatRoute(next, {
      projectId: next === 'project' ? (selectedProjectId ?? undefined) : undefined,
      session: next === 'editor' ? cloudDraftSession : undefined,
    })
  }, [cloudDraftSession, selectedProjectId])

  const openEditor = useCallback((session: CloudDraftSession = DEFAULT_CLOUD_DRAFT_SESSION) => {
    setCloudDraftSession(session)
    setView('editor')
    window.location.hash = formatRoute('editor', { session })
  }, [])

  /** ホームの実案件選択から共有の案件詳細画面へ遷移する（Issue #62）。 */
  const openProjectDetail = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    setView('project')
    window.location.hash = formatRoute('project', { projectId })
  }, [])

  // ブラウザの戻る/進む・URL直接入力との同期。
  useEffect(() => {
    const handleHashChange = () => {
      const route = parseRoute(window.location.hash)
      if (route === undefined) return
      if (route.view === 'newDrawing') {
        setCloudDraftSession(createNewDraftSession())
      }
      setView(route.view)
      if (route.view === 'project') {
        setSelectedProjectId(route.projectId ?? null)
      }
      if (route.view === 'editor' && route.session !== undefined) {
        setCloudDraftSession(route.session)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // ビューレジストリ: サイドバー右側へ表示するページ群。
  // ここへ登録すると Sidebar の disabled が自動解除される。
  const sidebarPages = useMemo<Partial<Record<AppView, React.ReactElement>>>(
    () => ({
      editor: (
        <CadEditorPage
          autosaveStore={autosaveStore}
          onNavigate={navigate}
          cloudDraftSession={cloudDraftSession}
          onOpenDrawing={openEditor}
        />
      ),
      newDrawing: (
        <CadEditorPage
          autosaveStore={autosaveStore}
          onNavigate={navigate}
          cloudDraftSession={cloudDraftSession}
          onOpenDrawing={openEditor}
        />
      ),
      project: (
        <ProjectDetailPage
          projectId={selectedProjectId ?? undefined}
          onOpenEditor={openEditor}
          onNavigateHome={() => navigate('home')}
          canEdit={canEdit}
          enableCloudData={import.meta.env.MODE === 'production'}
        />
      ),
      drawingSettings: <DrawingSettingsPage />,
      survey: <SurveyPointsPage enableSampleData={import.meta.env.MODE !== 'production'} />,
      parts: <PartsPalettePage onOpenEditor={() => openEditor()} />,
      quantity: <QuantitySummaryPage onNavigate={(view) => navigate(view as AppView)} />,
      section: (
        <CrossSectionPage
          enableSampleData={import.meta.env.MODE !== 'production'}
          revisionId={cloudDraftSession.revisionId}
        />
      ),
      steps: <ConstructionStepsPage />,
      field: (
        <FieldExplanationPage
          cloudDraftSession={cloudDraftSession}
          revisionStatus={fieldRevisionStatus}
          onOpenEditor={() => openEditor(cloudDraftSession)}
        />
      ),
      compare: <DrawingComparePage autosaveStore={autosaveStore} />,
      approval: (
        <ReviewApprovalPage
          enableCloudData={import.meta.env.MODE === 'production'}
          revisionId={cloudDraftSession.revisionId}
          initialRole={role}
        />
      ),
      print: <PrintExportPage enableSampleHistory={import.meta.env.MODE !== 'production'} />,
      delivery: <EdeliveryPage />,
      audit: <AuditLogPage enableSampleFallback={import.meta.env.MODE !== 'production'} />,
      settings: <SystemSettingsPage enableSampleData={import.meta.env.MODE !== 'production'} />,
    }),
    [autosaveStore, canEdit, cloudDraftSession, fieldRevisionStatus, role, selectedProjectId, navigate, openEditor],
  )

  const implementedViews: readonly AppView[] = [
    'home',
    ...(Object.keys(sidebarPages) as AppView[]),
  ]

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // localStorage不可の環境（プライベートモード等）では永続化せず切替のみ
    }
    setTheme(next)
  }

  // viewer は編集系画面を表示しない（deep link 直行もホームへフォールバック）。
  const effectiveView: AppView =
    !canEdit && (VIEWER_HIDDEN_VIEWS as readonly string[]).includes(view) ? 'home' : view
  const registeredPage = effectiveView !== 'home' ? sidebarPages[effectiveView] : undefined

  return (
    <div
      className="cd-app"
      data-theme={theme}
      style={{
        display: 'flex',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--ink)',
      }}
    >
      <button
        ref={menuButtonRef}
        type="button"
        className="cd-mobile-menu-button"
        aria-label="メニューを開く"
        aria-expanded={isSidebarOpen}
        aria-controls="cd-sidebar"
        onClick={() => setIsSidebarOpen((current) => !current)}
      >
        ☰
      </button>
      {isSidebarOpen && (
        <div
          className="cd-mobile-backdrop"
          aria-hidden="true"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <div
        ref={sidebarMountRef}
        id="cd-sidebar"
        className={`cd-sidebar-mount${isSidebarOpen ? ' cd-sidebar-open' : ''}`}
      >
        <Sidebar
          activeView={effectiveView}
          theme={theme}
          implementedViews={implementedViews}
          role={role}
          userName={identity?.name}
          onNavigate={(next) => {
            navigate(next)
            setIsSidebarOpen(false)
          }}
          onToggleTheme={toggleTheme}
        />
      </div>
      <Suspense
        fallback={
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
            読み込み中...
          </div>
        }
      >
        {registeredPage ?? (
          <HomePage
            autosaveStore={autosaveStore}
            onOpenEditor={() => openEditor()}
            onOpenProject={openProjectDetail}
            canEdit={canEdit}
            enableCloudData={import.meta.env.MODE === 'production'}
          />
        )}
      </Suspense>
    </div>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <EditorStoreProvider>
        <AppShell />
      </EditorStoreProvider>
    </ErrorBoundary>
  )
}
