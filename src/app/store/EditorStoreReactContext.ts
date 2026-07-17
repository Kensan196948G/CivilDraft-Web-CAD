import { createContext } from 'react'
import type { EditorStore } from './editorStore'

export const EditorStoreContext = createContext<EditorStore | null>(null)
