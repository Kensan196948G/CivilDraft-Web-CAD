/**
 * アプリケーションルート。
 * デザイン正本: Claude Design「CivilDraft Web CAD」Home.dc.html（100%適用）。
 * 画面構成: ホーム（サイドバー+案件一覧+復旧候補）⇄ CAD編集（既存エディタ）。
 * テーマ（light/dark）は data-theme 属性 + localStorage 'civildraft-theme' で永続化。
 *
 * 自動保存の役割分担:
 * - AutosaveManager: 図形/レイヤー変更のデバウンス保存 + 保存状態表示（エディタ画面）
 * - HomePage: 起動時の復旧候補表示と利用者主導の復元/破棄（デザインの意図に合わせ、
 *   旧実装の「マウント時サイレント自動復元」から明示操作へ変更）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { Sidebar } from './layout/Sidebar'
import type { AppView } from './layout/Sidebar'
import { ConstructionStepsPage } from './pages/ConstructionStepsPage'
import { CrossSectionPage } from './pages/CrossSectionPage'
import { DrawingComparePage } from './pages/DrawingComparePage'
import { HomePage } from './pages/HomePage'
import { PartsPalettePage } from './pages/PartsPalettePage'
import { ReviewApprovalPage } from './pages/ReviewApprovalPage'
import { SurveyPointsPage } from './pages/SurveyPointsPage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { useEditorStore, useEditorStoreApi } from './store/useEditorStore'
import { TEMPLATE_CATALOG, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { importDxf } from '@/domain/dxf/dxfImporter'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import type { ToolType } from '@/domain/tools/draftGeometry'
import { createAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import { loadJapaneseFont } from '@/infrastructure/pdf/fontLoader'
import { createDefaultLayer } from './store/editorStore'
import './home.css'

const THEME_STORAGE_KEY = 'civildraft-theme'

/** Blobをファイルとしてダウンロードさせる（ブラウザ標準のa[download]方式）。 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function loadTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  flexWrap: 'wrap',
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--ink)',
  cursor: 'pointer',
  fontSize: 13,
  font: 'inherit',
}

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#E08A2B',
  borderColor: '#E08A2B',
  color: '#fff',
}

const TOOLS: readonly { readonly tool: ToolType; readonly label: string }[] = [
  { tool: 'select', label: '⬚ 選択' },
  { tool: 'line', label: '／ 線分' },
  { tool: 'rectangle', label: '▭ 矩形' },
  { tool: 'circle', label: '○ 円' },
  { tool: 'polyline', label: '〰 ポリライン' },
]

interface EditorToolbarProps {
  readonly onGoHome: () => void
}

function EditorToolbar({ onGoHome }: EditorToolbarProps) {
  const storeApi = useEditorStoreApi()
  const geometryCount = useEditorStore((s) => s.geometries.length)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const zoom = useEditorStore((s) => s.zoom)
  const activeTool = useEditorStore((s) => s.activeTool)
  const canUndo = useEditorStore((s) => s.undoStack.length > 0)
  const canRedo = useEditorStore((s) => s.redoStack.length > 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [ioMessage, setIoMessage] = useState<string | null>(null)

  const seedDemo = () => {
    const state = storeApi.getState()
    const layer = state.layers[0] ?? createDefaultLayer()
    for (const template of TEMPLATE_CATALOG) {
      state.addGeometries(
        instantiateTemplate(template, { layerId: layer.id, style: layer.defaultStyle }),
      )
    }
    state.zoomFit(window.innerWidth, window.innerHeight - 48)
  }

  const handleExportDxf = () => {
    const s = storeApi.getState()
    const dxf = exportDxf(s.geometries, s.layers)
    downloadBlob(new Blob([dxf], { type: 'application/dxf' }), 'civildraft.dxf')
    setIoMessage('📤 DXF出力完了（mm単位）')
  }

  const handleExportPdf = async () => {
    const s = storeApi.getState()
    // 同梱Noto Sans JPサブセットを注入（取得失敗時はフォント未注入の代替規則へ退避）
    const fontResult = await loadJapaneseFont()
    const result = await exportPdf(s.geometries, s.layers, {
      paperSize: 'A3',
      orientation: 'landscape',
      scale: 100,
      titleBlock: { projectName: 'CivilDraft', drawingNumber: 'DRW-001' },
      ...(fontResult.ok ? { japaneseFontBytes: fontResult.value } : {}),
    })
    if (!result.ok) {
      setIoMessage(`⚠️ PDF出力失敗: ${result.error.message}`)
      return
    }
    const warnings = result.value.issues.length + (fontResult.ok ? 0 : 1)
    downloadBlob(new Blob([result.value.bytes.slice()], { type: 'application/pdf' }), 'civildraft.pdf')
    setIoMessage(
      warnings > 0
        ? `📤 PDF出力完了（警告${warnings}件）`
        : '📤 PDF出力完了（A3横・1:100・日本語フォント埋込）',
    )
  }

  const handleImportDxf = async (file: File) => {
    const content = await file.text()
    const result = importDxf(content)
    if (!result.ok) {
      setIoMessage(`⚠️ DXF取込失敗: ${result.error.message}`)
      return
    }
    storeApi.getState().replaceDocument(result.value.geometries, result.value.layers)
    storeApi.getState().zoomFit(window.innerWidth, window.innerHeight - 48)
    setIoMessage(
      `📥 DXF取込完了: 図形${result.value.geometries.length}件、レイヤー${result.value.layers.length}件` +
        (result.value.issues.length > 0 ? `、警告${result.value.issues.length}件` : ''),
    )
  }

  return (
    <header style={headerStyle}>
      <button style={buttonStyle} onClick={onGoHome}>
        🏠 ホーム
      </button>
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
      <strong>CivilDraft</strong>
      {TOOLS.map(({ tool, label }) => (
        <button
          key={tool}
          style={activeTool === tool ? activeButtonStyle : buttonStyle}
          onClick={() => storeApi.getState().activateTool(tool)}
        >
          {label}
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
      <button style={buttonStyle} disabled={!canUndo} onClick={() => storeApi.getState().undo()}>
        ↩ 元に戻す
      </button>
      <button style={buttonStyle} disabled={!canRedo} onClick={() => storeApi.getState().redo()}>
        ↪ やり直す
      </button>
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
      <button style={buttonStyle} onClick={handleExportPdf}>
        📄 PDF出力
      </button>
      <button style={buttonStyle} onClick={handleExportDxf}>
        📤 DXF出力
      </button>
      <button style={buttonStyle} onClick={() => fileInputRef.current?.click()}>
        📥 DXF取込
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".dxf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportDxf(file)
          e.target.value = ''
        }}
      />
      <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
      <button style={buttonStyle} onClick={seedDemo}>
        📐 デモ図形
      </button>
      <button
        style={buttonStyle}
        onClick={() => storeApi.getState().zoomFit(window.innerWidth, window.innerHeight - 48)}
      >
        🔍 全体表示
      </button>
      <button style={buttonStyle} onClick={() => storeApi.getState().setGridVisible(!gridVisible)}>
        {gridVisible ? '⊞ グリッド非表示' : '⊞ グリッド表示'}
      </button>
      <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
        {ioMessage !== null && <span style={{ marginRight: 12 }}>{ioMessage}</span>}
        図形: {geometryCount} / ズーム: {(zoom * 100).toFixed(0)}% / ホイール: ズーム、中ボタン: パン、Esc: 中止、Enter: 確定
      </span>
    </header>
  )
}

interface AutosaveManagerProps {
  readonly autosaveStore: AutosaveStore
}

/**
 * 自動保存の配線（Issue #9）: 図形・レイヤー変更をデバウンス保存し、
 * 保存失敗（容量超過等）はステータス表示で警告する（R-006: 握り潰さない）。
 * 復旧候補の表示・復元はホーム画面（HomePage）が担う。
 */
function AutosaveManager({ autosaveStore }: AutosaveManagerProps) {
  const storeApi = useEditorStoreApi()
  const [status, setStatus] = useState('💾 自動保存: 待機中')

  useEffect(() => {
    const scheduler = scheduleAutosave(
      () => {
        const s = storeApi.getState()
        return {
          savedAt: new Date().toISOString(),
          geometries: s.geometries,
          layers: s.layers,
        }
      },
      autosaveStore,
      {
        onResult: (result) => {
          setStatus(
            result.ok
              ? `💾 自動保存済み（${new Date().toLocaleTimeString('ja-JP')}）`
              : `⚠️ 自動保存失敗: ${result.error.message}`,
          )
        },
      },
    )

    const unsubscribe = storeApi.subscribe((state, prev) => {
      if (state.geometries !== prev.geometries || state.layers !== prev.layers) {
        scheduler.trigger()
      }
    })

    return () => {
      unsubscribe()
      scheduler.dispose()
    }
  }, [storeApi, autosaveStore])

  return (
    <footer
      style={{
        padding: '4px 16px',
        borderTop: '1px solid var(--line)',
        background: 'var(--surface)',
        fontSize: 12,
        color: 'var(--muted)',
      }}
    >
      {status}
    </footer>
  )
}

function AppShell() {
  const [view, setView] = useState<AppView>('home')
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [autosaveStore] = useState<AutosaveStore>(() => createAutosaveStore())

  // ビューレジストリ: サイドバー付きで表示するページ群（editorのみ全画面レイアウト）。
  // ここへ登録すると Sidebar の disabled が自動解除される。
  const sidebarPages = useMemo<Partial<Record<AppView, React.ReactElement>>>(
    () => ({
      survey: <SurveyPointsPage />,
      parts: <PartsPalettePage />,
      section: <CrossSectionPage />,
      steps: <ConstructionStepsPage />,
      compare: <DrawingComparePage autosaveStore={autosaveStore} />,
      approval: <ReviewApprovalPage />,
    }),
    [autosaveStore],
  )

  const implementedViews: readonly AppView[] = [
    'home',
    'editor',
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

  const registeredPage = view !== 'home' && view !== 'editor' ? sidebarPages[view] : undefined

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
      {view === 'editor' ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <EditorToolbar onGoHome={() => setView('home')} />
          <main style={{ flex: 1, minHeight: 0, background: 'var(--bg)' }}>
            <CanvasStage />
          </main>
          <AutosaveManager autosaveStore={autosaveStore} />
        </div>
      ) : (
        <>
          <Sidebar
            activeView={view}
            theme={theme}
            implementedViews={implementedViews}
            onNavigate={setView}
            onToggleTheme={toggleTheme}
          />
          {registeredPage ?? (
            <HomePage autosaveStore={autosaveStore} onOpenEditor={() => setView('editor')} />
          )}
        </>
      )}
    </div>
  )
}

export function App() {
  return (
    <EditorStoreProvider>
      <AppShell />
    </EditorStoreProvider>
  )
}
