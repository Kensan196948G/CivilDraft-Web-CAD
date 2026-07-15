/**
 * EditorStore の React Context 本体。
 * react-refresh 対応のため、コンポーネント（EditorStoreContext.tsx の Provider）とは
 * ファイルを分離している。利用側は useEditorStore.ts のフックを使う。
 */
import { createContext } from 'react'
import type { EditorStore } from './editorStore'

export const EditorStoreContext = createContext<EditorStore | null>(null)
