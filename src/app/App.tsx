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
import { useMemo, useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { Sidebar } from './layout/Sidebar'
import type { AppView } from './layout/Sidebar'
import { CadEditorPage, DEFAULT_CLOUD_DRAFT_SESSION } from './pages/CadEditorPage'
import type { CloudDraftSession } from './pages/CadEditorPage'
import { ConstructionStepsPage } from './pages/ConstructionStepsPage'
import { CrossSectionPage } from './pages/CrossSectionPage'
import { AuditLogPage } from './pages/AuditLogPage'
import { DrawingComparePage } from './pages/DrawingComparePage'
import { DrawingSettingsPage } from './pages/DrawingSettingsPage'
import { HomePage } from './pages/HomePage'
import { PartsPalettePage } from './pages/PartsPalettePage'
import { PrintExportPage } from './pages/PrintExportPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { QuantitySummaryPage } from './pages/QuantitySummaryPage'
import { ReviewApprovalPage } from './pages/ReviewApprovalPage'
import { SurveyPointsPage } from './pages/SurveyPointsPage'
import { SystemSettingsPage } from './pages/SystemSettingsPage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { createAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import './home.css'

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

  const openEditor = (session: CloudDraftSession = DEFAULT_CLOUD_DRAFT_SESSION) => {
    setCloudDraftSession(session)
    setView('editor')
  }

  // ビューレジストリ: サイドバー右側へ表示するページ群。
  // ここへ登録すると Sidebar の disabled が自動解除される。
  const sidebarPages = useMemo<Partial<Record<AppView, React.ReactElement>>>(
    () => ({
      editor: <CadEditorPage autosaveStore={autosaveStore} onNavigate={setView} cloudDraftSession={cloudDraftSession} />,
      project: <ProjectDetailPage onOpenEditor={openEditor} />,
      drawingSettings: <DrawingSettingsPage />,
      survey: <SurveyPointsPage />,
      parts: <PartsPalettePage onOpenEditor={() => openEditor()} />,
      quantity: <QuantitySummaryPage />,
      section: <CrossSectionPage />,
      steps: <ConstructionStepsPage />,
      compare: <DrawingComparePage autosaveStore={autosaveStore} />,
      approval: <ReviewApprovalPage />,
      print: <PrintExportPage />,
      audit: <AuditLogPage />,
      settings: <SystemSettingsPage />,
    }),
    [autosaveStore, cloudDraftSession],
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
      {registeredPage ?? (
        <HomePage autosaveStore={autosaveStore} onOpenEditor={() => openEditor()} />
      )}
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
