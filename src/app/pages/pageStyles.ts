/**
 * サイドバー付きページの共通スタイル。
 * 正本: Claude Design「CivilDraft Web CAD」Home.dc.html のデザイントークン
 * （テーマ変数は src/app/home.css）。Phase 2以降の画面はここを再利用して
 * 視覚一貫性を保つ。
 */
import type { CSSProperties } from 'react'

export const pageRootStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

export const pageHeaderStyle: CSSProperties = {
  height: 62,
  flexShrink: 0,
  background: 'var(--surface)',
  borderBottom: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 22px',
  gap: 16,
}

export const pageTitleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--ink)',
  lineHeight: 1.2,
}

export const pageSubtitleStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)' }

export const pageMainStyle: CSSProperties = { flex: 1, overflow: 'auto', padding: 22 }

export const panelStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
}

export const panelHeaderStyle: CSSProperties = {
  padding: '15px 18px',
  borderBottom: '1px solid var(--line2)',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
}

export const statCardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '16px 17px',
  boxShadow: 'var(--shadow)',
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
}

export const statValueStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  color: 'var(--ink)',
  lineHeight: 1,
  letterSpacing: -0.5,
  fontVariantNumeric: 'tabular-nums',
}

export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '11px 16px',
  borderBottom: '1px solid var(--line2)',
  fontSize: 11,
  color: 'var(--muted)',
  fontWeight: 600,
  background: 'var(--hover)',
}

export const tdStyle: CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--line2)',
  color: 'var(--ink)',
}

export const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  border: '1px solid #E08A2B',
  background: '#E08A2B',
  color: '#fff',
  padding: '8px 14px',
  borderRadius: 8,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
}

export const ghostButtonStyle: CSSProperties = {
  cursor: 'pointer',
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink2)',
  padding: '6px 11px',
  borderRadius: 8,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
}

export function statusBadgeStyle(color: string, bg: string): CSSProperties {
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    color,
    background: bg,
  }
}

export const monoStyle: CSSProperties = { fontFamily: "'IBM Plex Mono'" }
