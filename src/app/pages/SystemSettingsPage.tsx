/**
 * システム設定画面。
 * 正本: Claude Design「CivilDraft Web CAD」System Settings.dc.html（100%適用）。
 * マスター管理・監査ログのバックエンドはPhase 6後続のため、デザイン正本の
 * サンプル値を忠実表示する。
 */
import type { CSSProperties } from 'react'
import {
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  statusBadgeStyle,
  thStyle,
  monoStyle,
} from './pageStyles'

const td: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--line2)' }
const tdLast: CSSProperties = { padding: '12px 16px' }
const ok: CSSProperties = { ...td, color: '#1F8255' }
const ng: CSSProperties = { ...td, color: '#C5392F' }
const okLast: CSSProperties = { ...tdLast, color: '#1F8255' }
const ngLast: CSSProperties = { ...tdLast, color: '#C5392F' }

const MASTERS = [
  { kind: '土工', spec: '切土・盛土・掘削', unit: 'm³', active: true, last: false },
  { kind: '仮設工', spec: '鋼矢板Ⅲ型・切梁H-300', unit: '枚・本', active: true, last: false },
  { kind: '法面', spec: '法面積・法長', unit: 'm²', active: true, last: false },
  { kind: '構造物工', spec: '擁壁・側溝・桝', unit: 'm・箇所', active: false, last: true },
] as const

const ROLES = [
  { role: '作成者', draw: true, review: false, approve: false, audit: false, last: false },
  { role: '照査者', draw: true, review: true, approve: false, audit: false, last: false },
  { role: '承認者', draw: false, review: true, approve: true, audit: false, last: false },
  { role: '管理者', draw: true, review: true, approve: true, audit: true, last: true },
] as const

const TEMPLATES = [
  { name: '施工ヤード計画図（標準）', size: 'A1横', last: false },
  { name: '仮設計画図（標準）', size: 'A1横', last: false },
  { name: '数量根拠図（標準）', size: 'A2横', last: true },
] as const

export function SystemSettingsPage() {
  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>システム設定</div>
          <div style={pageSubtitleStyle}>工種・規格マスター、テンプレート、権限、監査ログ</div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={primaryButtonStyle}>＋ マスターを追加</button>
      </header>

      <main style={pageMainStyle}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.65fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>工種・規格マスター</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>工種</th>
                    <th style={thStyle}>規格例</th>
                    <th style={thStyle}>単位</th>
                    <th style={thStyle}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {MASTERS.map((m) => {
                    const cell = m.last ? tdLast : td
                    return (
                      <tr key={m.kind}>
                        <td style={cell}>{m.kind}</td>
                        <td style={{ ...cell, color: 'var(--ink2)' }}>{m.spec}</td>
                        <td style={{ ...cell, ...monoStyle }}>{m.unit}</td>
                        <td style={cell}>
                          {m.active ? (
                            <span style={statusBadgeStyle('#1F8255', '#E4F3EC')}>有効</span>
                          ) : (
                            <span style={statusBadgeStyle('var(--muted)', 'var(--subtle)')}>検討中</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>権限（案件ロール）</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>ロール</th>
                    <th style={thStyle}>作図</th>
                    <th style={thStyle}>照査</th>
                    <th style={thStyle}>承認</th>
                    <th style={thStyle}>監査閲覧</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((r) => {
                    const y = r.last ? okLast : ok
                    const n = r.last ? ngLast : ng
                    const cell = r.last ? tdLast : td
                    return (
                      <tr key={r.role}>
                        <td style={{ ...cell, fontWeight: 500 }}>{r.role}</td>
                        <td style={r.draw ? y : n}>{r.draw ? '○' : '－'}</td>
                        <td style={r.review ? y : n}>{r.review ? '○' : '－'}</td>
                        <td style={r.approve ? y : n}>{r.approve ? '○' : '－'}</td>
                        <td style={r.audit ? y : n}>{r.audit ? '○' : '－'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>図面テンプレート</div>
              <div>
                {TEMPLATES.map((t) => (
                  <div
                    key={t.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '13px 18px',
                      borderBottom: t.last ? 'none' : '1px solid var(--line2)',
                    }}
                  >
                    <span>📐</span>
                    <div style={{ flex: 1, fontSize: 12.5 }}>{t.name}</div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t.size}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>監査ログ（最新）</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>山田 太郎がDWG-014を保存</span>
                  <span style={{ ...monoStyle, color: 'var(--muted)', fontSize: 11 }}>18:42</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>高橋 一郎がDWG-002を差戻し</span>
                  <span style={{ ...monoStyle, color: 'var(--muted)', fontSize: 11 }}>07-12</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: '#C5392F' }}>ログイン失敗（3回）</span>
                  <span style={{ ...monoStyle, color: 'var(--muted)', fontSize: 11 }}>07-11</span>
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>システム情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 16px', margin: 0 }}>
                  <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>アプリ版</dt>
                  <dd style={{ margin: 0, fontSize: 12.5 }}>CivilDraft v0.4.0（Phase 1）</dd>
                  <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>スキーマ版</dt>
                  <dd style={{ margin: 0, fontSize: 12.5 }}>v1.3</dd>
                  <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>保存先</dt>
                  <dd style={{ margin: 0, fontSize: 12.5 }}>IndexedDB（ローカル）</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
