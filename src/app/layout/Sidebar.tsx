/**
 * 左サイドバー（ナビゲーション・テーマ切替・ユーザー表示）。
 * 正本: Claude Design「CivilDraft Web CAD」Home.dc.html（100%適用）。
 * ナビ項目のうち実装済みは ホーム・案件一覧（home）と CAD編集（editor）のみで、
 * 他はPhase 2以降の画面（デザイン上のリンク先を disabled 表示で保持）。
 */
import type { CSSProperties } from 'react'

export type AppView =
  | 'home'
  | 'editor'
  | 'project'
  | 'drawingSettings'
  | 'survey'
  | 'parts'
  | 'quantity'
  | 'section'
  | 'steps'
  | 'compare'
  | 'approval'
  | 'print'
  | 'settings'

export interface SidebarProps {
  readonly activeView: AppView
  readonly theme: 'light' | 'dark'
  /** 実装済み（ナビゲート可能）なビュー。含まれない項目は disabled 表示（Phase 2以降）。 */
  readonly implementedViews: readonly AppView[]
  readonly onNavigate: (view: AppView) => void
  readonly onToggleTheme: () => void
}

interface NavEntry {
  readonly icon: string
  readonly label: string
  readonly view?: AppView
}

interface NavSection {
  readonly heading: string
  readonly items: readonly NavEntry[]
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    heading: '案件',
    items: [
      { icon: '🏠', label: 'ホーム・案件一覧', view: 'home' },
      { icon: '📁', label: '案件詳細', view: 'project' },
    ],
  },
  {
    heading: '作図',
    items: [
      { icon: '✏️', label: 'CAD編集', view: 'editor' },
      { icon: '📐', label: '図面設定', view: 'drawingSettings' },
      { icon: '📍', label: '測点・座標一覧', view: 'survey' },
      { icon: '🧱', label: '土木部材パレット', view: 'parts' },
    ],
  },
  {
    heading: '集計・照査',
    items: [
      { icon: '🧮', label: '数量集計', view: 'quantity' },
      { icon: '📉', label: '縦横断管理', view: 'section' },
      { icon: '🕒', label: '施工ステップ', view: 'steps' },
      { icon: '🔍', label: '図面比較', view: 'compare' },
      { icon: '✅', label: '照査・承認', view: 'approval' },
    ],
  },
  {
    heading: '出力・管理',
    items: [
      { icon: '🖨️', label: '印刷・出力', view: 'print' },
      { icon: '⚙️', label: 'システム設定', view: 'settings' },
    ],
  },
]

const sectionHeadingStyle: CSSProperties = {
  padding: '13px 8px 6px',
  fontSize: 10,
  letterSpacing: 1,
  color: 'var(--side-label)',
  fontWeight: 600,
}

function navItemStyle(active: boolean, implemented: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: active ? '8px 8px' : '8px 11px',
    borderRadius: 7,
    background: active ? 'var(--side2)' : 'transparent',
    color: active ? 'var(--side-heading)' : 'var(--side-fg)',
    fontSize: 13,
    fontWeight: 500,
    textDecoration: 'none',
    border: 'none',
    borderLeft: active ? '3px solid #E08A2B' : 'none',
    font: 'inherit',
    textAlign: 'left',
    width: '100%',
    cursor: implemented ? 'pointer' : 'default',
    opacity: implemented ? 1 : 0.55,
  }
}

export function Sidebar({
  activeView,
  theme,
  implementedViews,
  onNavigate,
  onToggleTheme,
}: SidebarProps) {
  return (
    <aside
      style={{
        width: 250,
        flexShrink: 0,
        background: 'var(--side)',
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--side-fg)',
      }}
    >
      <div
        style={{
          padding: '18px 18px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          borderBottom: '1px solid var(--side-line)',
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: '#E08A2B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: '#141C29',
          }}
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 21h18" />
            <path d="M5 21V7l8-4v18" />
            <path d="M19 21V11l-6-4" />
          </svg>
        </span>
        <div style={{ lineHeight: 1.2 }}>
          <div
            style={{
              color: 'var(--side-heading)',
              fontWeight: 600,
              fontSize: 14.5,
              letterSpacing: 0.2,
            }}
          >
            CivilDraft
          </div>
          <div style={{ fontSize: 11, color: 'var(--side-muted)' }}>土木施工図CAD</div>
        </div>
      </div>
      <nav
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px 12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {NAV_SECTIONS.map((section) => (
          <div key={section.heading} style={{ display: 'contents' }}>
            <div style={sectionHeadingStyle}>{section.heading}</div>
            {section.items.map((item) => {
              const implemented = item.view !== undefined && implementedViews.includes(item.view)
              const active = item.view === activeView
              return (
                <button
                  key={item.label}
                  style={navItemStyle(active, implemented)}
                  onClick={() => {
                    if (item.view !== undefined) onNavigate(item.view)
                  }}
                  disabled={!implemented}
                  title={implemented ? undefined : 'Phase 2以降で実装予定'}
                >
                  <span style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--side-line)' }}>
        <button
          onClick={onToggleTheme}
          style={{
            width: '100%',
            cursor: 'pointer',
            border: '1px solid var(--side-line)',
            background: 'transparent',
            color: 'var(--side-fg)',
            padding: '8px 11px',
            borderRadius: 7,
            font: 'inherit',
            fontSize: 12,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <span>{theme === 'light' ? '🌙' : '☀️'}</span>
          <span>{theme === 'light' ? 'ダーク' : 'ライト'}モードに切替</span>
        </button>
      </div>
      <div
        style={{
          padding: '13px 14px',
          borderTop: '1px solid var(--side-line)',
          display: 'flex',
          alignItems: 'center',
          gap: 11,
        }}
      >
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: '#2A3850',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          山
        </span>
        <div style={{ flex: 1, lineHeight: 1.25 }}>
          <div style={{ color: 'var(--side-heading)', fontSize: 13, fontWeight: 500 }}>
            山田 太郎
          </div>
          <div style={{ fontSize: 11, color: 'var(--side-muted)' }}>土木工事部</div>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#E08A2B',
            border: '1px solid rgba(224,138,43,.4)',
            padding: '1px 6px',
            borderRadius: 5,
          }}
        >
          作成者
        </span>
      </div>
    </aside>
  )
}
