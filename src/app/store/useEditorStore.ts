/**
 * EditorStore 購読フック。Provider は EditorStoreContext.tsx。
 */
import { useContext } from 'react'
import { useStore } from 'zustand'
import { EditorStoreContext } from './EditorStoreReactContext'
import type { EditorState, EditorStore } from './editorStore'

/** セレクター経由でstore状態を購読する（§8.2: 大きな配列全体を渡さず絞って選択）。 */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  const store = useContext(EditorStoreContext)
  if (store === null) {
    throw new Error('useEditorStore must be used within <EditorStoreProvider>')
  }
  return useStore(store, selector)
}

/** store API（getState/subscribe/getIndex）へ直接アクセスする。イベントハンドラ用。 */
export function useEditorStoreApi(): EditorStore {
  const store = useContext(EditorStoreContext)
  if (store === null) {
    throw new Error('useEditorStoreApi must be used within <EditorStoreProvider>')
  }
  return store
}
