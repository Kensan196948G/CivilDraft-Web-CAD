/**
 * アプリケーションルート。Phase 1 MVP: 図面キャンバス + ツールバー + 自動保存配線。
 * レイヤーパネル・プロパティパネル等のUIは後続Issueで追加する。
 * デモ配置ボタンはテンプレートカタログの動作確認用（暫定）。
 */
import { useEffect, useState } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { useEditorStore, useEditorStoreApi } from './store/useEditorStore'
import { TEMPLATE_CATALOG, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import type { ToolType } from '@/domain/tools/draftGeometry'
import { createAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import { createDefaultLayer } from './store/editorStore'

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderBottom: '1px solid #e2e8f0',
  background: '#f8fafc',
  fontFamily: 'sans-serif',
  flexWrap: 'wrap',
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 13,
}

const activeButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#dbeafe',
  borderColor: '#3b82f6',
}

const TOOLS: readonly { readonly tool: ToolType; readonly label: string }[] = [
  { tool: 'select', label: '⬚ 選択' },
  { tool: 'line', label: '／ 線分' },
  { tool: 'rectangle', label: '▭ 矩形' },
  { tool: 'circle', label: '○ 円' },
  { tool: 'polyline', label: '〰 ポリライン' },
]

function Toolbar() {
  const storeApi = useEditorStoreApi()
  const geometryCount = useEditorStore((s) => s.geometries.length)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const zoom = useEditorStore((s) => s.zoom)
  const activeTool = useEditorStore((s) => s.activeTool)
  const canUndo = useEditorStore((s) => s.undoStack.length > 0)
  const canRedo = useEditorStore((s) => s.redoStack.length > 0)

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

  return (
    <header style={headerStyle}>
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
      <span style={{ width: 1, height: 20, background: '#cbd5e1' }} />
      <button style={buttonStyle} disabled={!canUndo} onClick={() => storeApi.getState().undo()}>
        ↩ 元に戻す
      </button>
      <button style={buttonStyle} disabled={!canRedo} onClick={() => storeApi.getState().redo()}>
        ↪ やり直す
      </button>
      <span style={{ width: 1, height: 20, background: '#cbd5e1' }} />
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
      <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>
        図形: {geometryCount} / ズーム: {(zoom * 100).toFixed(0)}% / ホイール: ズーム、中ボタン: パン、Esc: 中止、Enter/W: 確定
      </span>
    </header>
  )
}

/**
 * 自動保存の配線（Issue #9 完了条件2: リロード後の下書き復元）。
 * 起動時に最新下書きを復元し、図形・レイヤー変更をデバウンス保存する。
 * 保存失敗（容量超過等）はステータス表示で警告する（R-006: 握り潰さない）。
 */
function AutosaveManager() {
  const storeApi = useEditorStoreApi()
  const [status, setStatus] = useState('💾 自動保存: 待機中')

  useEffect(() => {
    const autosaveStore = createAutosaveStore()

    void autosaveStore.load().then((result) => {
      if (result.ok && result.value !== null) {
        storeApi.getState().replaceDocument(result.value.geometries, result.value.layers)
        setStatus(`💾 下書きを復元（${result.value.savedAt}）`)
      } else if (!result.ok) {
        setStatus(`⚠️ 下書き読込失敗: ${result.error.message}`)
      }
    })

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
  }, [storeApi])

  return (
    <footer
      style={{
        padding: '4px 16px',
        borderTop: '1px solid #e2e8f0',
        background: '#f8fafc',
        fontSize: 12,
        color: '#64748b',
        fontFamily: 'sans-serif',
      }}
    >
      {status}
    </footer>
  )
}

export function App() {
  return (
    <EditorStoreProvider>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Toolbar />
        <main style={{ flex: 1, minHeight: 0, background: '#f1f5f9' }}>
          <CanvasStage />
        </main>
        <AutosaveManager />
      </div>
    </EditorStoreProvider>
  )
}
