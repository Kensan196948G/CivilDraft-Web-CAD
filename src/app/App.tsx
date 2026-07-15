/**
 * アプリケーションルート。Phase 1 MVP: 図面キャンバス + 最小ツールバー。
 * 作図ツール・レイヤーパネル等のUIは ToolSlice/Commandパターン（Issue #8）
 * 整備後に追加する。デモ配置ボタンはツール未実装期間の動作確認用（暫定）。
 */
import { CanvasStage } from './canvas/CanvasStage'
import { EditorStoreProvider } from './store/EditorStoreContext'
import { useEditorStore, useEditorStoreApi } from './store/useEditorStore'
import { TEMPLATE_CATALOG, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import { createDefaultLayer } from './store/editorStore'

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  borderBottom: '1px solid #e2e8f0',
  background: '#f8fafc',
  fontFamily: 'sans-serif',
}

const buttonStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 13,
}

function Toolbar() {
  const storeApi = useEditorStoreApi()
  const geometryCount = useEditorStore((s) => s.geometries.length)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const zoom = useEditorStore((s) => s.zoom)

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
      <span style={{ color: '#64748b', fontSize: 12 }}>Phase 1 MVP（作図ツールは実装中）</span>
      <button style={buttonStyle} onClick={seedDemo}>
        📐 デモ図形を配置
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
        図形: {geometryCount} / ズーム: {(zoom * 100).toFixed(0)}%（ホイール: ズーム、中ボタン/Space+ドラッグ: パン、クリック: 選択）
      </span>
    </header>
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
      </div>
    </EditorStoreProvider>
  )
}
