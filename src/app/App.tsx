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
import { lazy, Suspense, useMemo, useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar } from './layout/Sidebar'
import type { AppView } from './layout/Sidebar'
import { CadEditorPage, DEFAULT_CLOUD_DRAFT_SESSION } from './pages/CadEditorPage'
import type { CloudDraftSession } from './pages/CadEditorPage'
import { HomePage } from './pages/HomePage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { createAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import './home.css'

// バンドル最適化（Issue #26）: 初期表示に不要な業務ページはコード分割し、
// 遷移時に遅延読み込みする（pdf-lib/dxf 等の vendor チャンクの初期ロードを回避）。
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

function loadTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function AppShell() {
  const [view, setView] = useState<AppView>('home')
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [autosaveStore] = useState<AutosaveStore>(() => createAutosaveStore())
  const [cloudDraftSession, setCloudDraftSession] = useState<CloudDraftSession>(DEFAULT_CLOUD_DRAFT_SESSION)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const openEditor = (session: CloudDraftSession = DEFAULT_CLOUD_DRAFT_SESSION) => {
    setCloudDraftSession(session)
    setView('editor')
  }

  /** ホームの実案件選択から共有の案件詳細画面へ遷移する（Issue #62）。 */
  const openProjectDetail = (projectId: string) => {
    setSelectedProjectId(projectId)
    setView('project')
  }

  // ビューレジストリ: サイドバー右側へ表示するページ群。
  // ここへ登録すると Sidebar の disabled が自動解除される。
  const sidebarPages = useMemo<Partial<Record<AppView, React.ReactElement>>>(
    () => ({
      editor: <CadEditorPage autosaveStore={autosaveStore} onNavigate={setView} cloudDraftSession={cloudDraftSession} />,
      project: (
        <ProjectDetailPage
          projectId={selectedProjectId ?? undefined}
          onOpenEditor={openEditor}
          onNavigateHome={() => setView('home')}
          enableCloudData={import.meta.env.MODE === 'production'}
        />
      ),
      drawingSettings: <DrawingSettingsPage />,
      survey: <SurveyPointsPage enableSampleData={import.meta.env.MODE !== 'production'} />,
      parts: <PartsPalettePage onOpenEditor={() => openEditor()} />,
      quantity: <QuantitySummaryPage onNavigate={(view) => setView(view as AppView)} />,
      section: <CrossSectionPage enableSampleData={import.meta.env.MODE !== 'production'} />,
      steps: <ConstructionStepsPage />,
      compare: <DrawingComparePage autosaveStore={autosaveStore} />,
      approval: <ReviewApprovalPage enableCloudData={import.meta.env.MODE === 'production'} />,
      print: <PrintExportPage enableSampleHistory={import.meta.env.MODE !== 'production'} />,
      delivery: <EdeliveryPage />,
      audit: <AuditLogPage enableSampleFallback={import.meta.env.MODE !== 'production'} />,
      settings: <SystemSettingsPage />,
    }),
    [autosaveStore, cloudDraftSession, selectedProjectId],
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

  const registeredPage = view !== 'home' ? sidebarPages[view] : undefined

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
      <Sidebar
        activeView={view}
        theme={theme}
        implementedViews={implementedViews}
        onNavigate={setView}
        onToggleTheme={toggleTheme}
      />
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
