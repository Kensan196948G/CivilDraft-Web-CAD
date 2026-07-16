/**
 * EditorStore の React 供給層（Provider）。
 * Issue #7（シングルトン解消）: storeはモジュールレベルで生成せず、
 * Provider経由でコンポーネントツリーへ注入する。テスト・複数図面で
 * 独立したstoreインスタンスを差し込める。
 * 購読フックは useEditorStore.ts（react-refresh対応のため分離）。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { createEditorStore } from './editorStore'
import type { EditorStore } from './editorStore'
import { EditorStoreContext } from './editorStoreContextValue'

export interface EditorStoreProviderProps {
  /** テスト・複数図面用に外部生成したstoreを注入する。省略時は内部で生成。 */
  readonly store?: EditorStore
  readonly children: ReactNode
}

export function EditorStoreProvider({ store, children }: EditorStoreProviderProps) {
  // 遅延初期化はuseStateのinitializerで行う（refのrender中アクセスはreact-hooks/refs違反）。
  const [fallbackStore] = useState(() => store ?? createEditorStore())
  const value = store ?? fallbackStore
  return <EditorStoreContext.Provider value={value}>{children}</EditorStoreContext.Provider>
}
