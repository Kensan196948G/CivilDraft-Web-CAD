/**
 * CAD編集画面のプロパティ入力スタイル定数（Issue #179 で CadEditorPage から抽出）。
 */
import type { CSSProperties } from 'react'

export const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12.5,
  color: 'var(--ink2)',
  marginBottom: 6,
}

export const fieldLabelStyle: CSSProperties = { color: 'var(--muted)' }

export const fieldInputStyle: CSSProperties = {
  width: 112,
  padding: '4px 8px',
  border: '1px solid var(--line)',
  borderRadius: 6,
  background: 'var(--subtle2)',
  color: 'var(--ink)',
  fontSize: 12.5,
  font: 'inherit',
  textAlign: 'right',
}

export const editParamRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--ink2)',
}

export const editParamInputStyle: CSSProperties = {
  width: 72,
  padding: '3px 6px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 11,
  font: 'inherit',
  textAlign: 'right',
}
