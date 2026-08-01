/**
 * コマンドパレット（Issue #47）。
 *
 * Ctrl/Cmd+K で開き、ツール切替・編集操作・ファイル操作をキーボードだけで実行できる。
 * - ファジー検索: 入力文字がラベル/キーワードの部分列として（順序を保ったまま）一致するものを候補表示
 * - キーボード操作: ↑/↓ で移動、Enter で実行、Esc で閉じる
 * - アクセシビリティ: combobox/listbox/option の WAI-ARIA ロールを付与
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { matchCommand } from './commandPaletteSearch'

export interface CommandPaletteItem {
  readonly id: string
  readonly label: string
  /** 検索に含める別名（ローマ字読み・英語名など）。 */
  readonly keywords?: readonly string[]
  readonly icon?: string
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly run: () => void
}

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly items: readonly CommandPaletteItem[]
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '12vh',
  background: 'rgba(15, 23, 34, 0.42)',
}

const panelStyle: CSSProperties = {
  width: 480,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: '56vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface, #FFFFFF)',
  border: '1px solid var(--line, #D9DEE7)',
  borderRadius: 10,
  boxShadow: '0 18px 50px rgba(15, 23, 34, 0.28)',
  overflow: 'hidden',
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 16px',
  border: 'none',
  borderBottom: '1px solid var(--line, #D9DEE7)',
  outline: 'none',
  background: 'transparent',
  color: 'var(--ink, #1A2233)',
  fontSize: 14,
  font: 'inherit',
}

const listStyle: CSSProperties = {
  overflowY: 'auto',
  padding: 6,
}

const itemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '9px 12px',
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--ink, #1A2233)',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
}

const itemActiveStyle: CSSProperties = {
  ...itemRowStyle,
  background: 'var(--accent-soft, #EAF1FF)',
}

const itemDisabledStyle: CSSProperties = {
  ...itemRowStyle,
  opacity: 0.42,
  cursor: 'not-allowed',
}

const shortcutStyle: CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 7px',
  borderRadius: 4,
  background: 'var(--line-soft, #EEF1F6)',
  color: 'var(--muted, #5B6B7F)',
  fontSize: 11,
  fontFamily: "'IBM Plex Mono', monospace",
}

const emptyStyle: CSSProperties = {
  padding: '22px 14px',
  textAlign: 'center',
  color: 'var(--muted, #5B6B7F)',
  fontSize: 12,
}

export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    return items
      .map((item, index) => ({ item, index, score: matchCommand(query, item.label, item.keywords) }))
      .filter((entry): entry is { item: CommandPaletteItem; index: number; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index)
  }, [items, query])

  // 開いたら入力欄へフォーカスする。状態リセットは親側の条件レンダー（リマウント）で担保する。
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [open])

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, filtered.length - 1))

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-command-index="${safeActiveIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [safeActiveIndex])

  if (!open) return null

  const runAt = (index: number) => {
    const entry = filtered[index]
    if (entry === undefined || entry.item.disabled === true) return
    onClose()
    entry.item.run()
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runAt(safeActiveIndex)
    }
  }

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div style={panelStyle} role="dialog" aria-modal="true" aria-label="コマンドパレット">
        <input
          ref={inputRef}
          style={inputStyle}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder="コマンドを入力（例: 線分 / undo / 保存）"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={`command-option-${safeActiveIndex}`}
          autoComplete="off"
          spellCheck={false}
        />
        <div ref={listRef} id="command-palette-list" style={listStyle} role="listbox" aria-label="コマンド候補">
          {filtered.length === 0 && <div style={emptyStyle}>該当するコマンドがありません</div>}
          {filtered.map((entry, index) => {
            const active = index === safeActiveIndex
            return (
              <button
                key={entry.item.id}
                id={`command-option-${index}`}
                data-command-index={index}
                role="option"
                aria-selected={active}
                disabled={entry.item.disabled === true}
                style={
                  entry.item.disabled === true
                    ? itemDisabledStyle
                    : active
                      ? itemActiveStyle
                      : itemRowStyle
                }
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <span aria-hidden="true">{entry.item.icon ?? '›'}</span>
                <span>{entry.item.label}</span>
                {entry.item.shortcut !== undefined && (
                  <span style={shortcutStyle}>{entry.item.shortcut}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
