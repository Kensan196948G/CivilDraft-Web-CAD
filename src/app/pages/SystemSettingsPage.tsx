/**
 * システム設定画面。
 * マスター管理・ログインユーザー設定・案件ロール・テンプレート・監査/認証設定を
 * 右側コンテンツとして詳細表示する。バックエンド永続化は本番データ層接続後。
 */
import type { CSSProperties } from 'react'
import { Fragment, useState } from 'react'
import { isDemoMode } from '@/app/mode'
import {
  ghostButtonStyle,
  monoStyle,
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
  tdStyle,
} from './pageStyles'

const compactCell: CSSProperties = { ...tdStyle, padding: '10px 14px' }
const compactHeader: CSSProperties = { ...thStyle, padding: '10px 14px' }

const detailGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.45fr) minmax(360px, 0.95fr)',
  gap: 16,
  alignItems: 'start',
}

const sectionStackStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 }

const kvStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  gap: '9px 16px',
  margin: 0,
  fontSize: 12.5,
}

const inputLikeStyle: CSSProperties = {
  border: '1px solid var(--line)',
  background: 'var(--subtle2)',
  borderRadius: 7,
  padding: '8px 10px',
  color: 'var(--ink)',
  fontSize: 12.5,
}

const cardRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '13px 18px',
  borderBottom: '1px solid var(--line2)',
}

interface MasterSetting {
  readonly kind: string
  readonly spec: string
  readonly unit: string
  readonly method: string
  readonly reviewer: string
  readonly active: boolean
}

const INITIAL_MASTERS: readonly MasterSetting[] = [
  {
    kind: '土工',
    spec: '切土・盛土・床掘・埋戻し',
    unit: 'm3',
    method: '平均断面法 / メッシュ集計',
    reviewer: '土木工事部',
    active: true,
  },
  {
    kind: '仮設工',
    spec: '鋼矢板III型・切梁H-300・腹起し',
    unit: '枚・本・m',
    method: '部材配置数 / 延長',
    reviewer: '施工計画課',
    active: true,
  },
  {
    kind: '法面',
    spec: '法長・法面積・小段',
    unit: 'm / m2',
    method: 'ポリライン長 / ハッチ面積',
    reviewer: '測量設計課',
    active: true,
  },
  {
    kind: '構造物工',
    spec: '擁壁・側溝・集水桝',
    unit: 'm・箇所',
    method: '属性別数量集計',
    reviewer: '品質管理課',
    active: false,
  },
  {
    kind: '舗装工',
    spec: '路盤・表層・区画線',
    unit: 'm2・m',
    method: 'ハッチ面積 / 線延長',
    reviewer: '舗装品質課',
    active: true,
  },
]

const LOGIN_USERS = [
  {
    name: '山田 太郎',
    email: 'taro.yamada@example.jp',
    department: '土木工事部',
    role: '作成者',
    current: true,
    mfa: true,
    status: '有効',
  },
  {
    name: '佐藤 花子',
    email: 'hanako.sato@example.jp',
    department: '測量設計課',
    role: '照査者',
    current: false,
    mfa: true,
    status: '有効',
  },
  {
    name: '高橋 一郎',
    email: 'ichiro.takahashi@example.jp',
    department: '品質管理課',
    role: '承認者',
    current: false,
    mfa: true,
    status: '有効',
  },
  {
    name: '管理 太郎',
    email: 'admin@example.jp',
    department: '情報システム部',
    role: '管理者',
    current: false,
    mfa: true,
    status: '制限付き',
  },
  {
    name: '中村 美咲',
    email: 'misaki.nakamura@example.jp',
    department: '数量管理課',
    role: '数量担当',
    current: false,
    mfa: true,
    status: '有効',
  },
] as const

const ROLE_MATRIX = [
  {
    role: '作成者',
    scope: '担当案件',
    users: '—',
    draw: true,
    review: false,
    approve: false,
    audit: false,
    admin: false,
  },
  {
    role: '照査者',
    scope: '所属部門案件',
    users: '—',
    draw: true,
    review: true,
    approve: false,
    audit: true,
    admin: false,
  },
  {
    role: '承認者',
    scope: '承認対象案件',
    users: '—',
    draw: false,
    review: true,
    approve: true,
    audit: true,
    admin: false,
  },
  {
    role: '管理者',
    scope: '全案件',
    users: '—',
    draw: true,
    review: true,
    approve: true,
    audit: true,
    admin: true,
  },
  {
    role: '数量担当',
    scope: '数量対象案件',
    users: '—',
    draw: false,
    review: false,
    approve: false,
    audit: true,
    admin: false,
  },
] as const

const TEMPLATES = [
  { name: '施工ヤード計画図（標準）', size: 'A1横', scale: '1:500', owner: '施工計画課', updated: '2026-07-14' },
  { name: '仮設計画図（標準）', size: 'A1横', scale: '1:200', owner: '土木工事部', updated: '2026-07-13' },
  { name: '数量根拠図（標準）', size: 'A2横', scale: '1:100', owner: '品質管理課', updated: '2026-07-12' },
  { name: '重機作業計画図（標準）', size: 'A1横', scale: '1:250', owner: '安全管理課', updated: '2026-07-11' },
  { name: '舗装展開図（標準）', size: 'A2横', scale: '1:200', owner: '舗装品質課', updated: '2026-07-10' },
] as const

const AUDIT_POLICIES = [
  ['保存期間', '7年', 'J-SOX/ISO27001 証跡要件'],
  ['改ざん検知', '有効', 'ハッシュチェーン方式（実装・本番適用済み）'],
  ['出力ログ', '有効', 'PDF/DXF/CSV出力を記録'],
  ['失敗認証', '即時警告', '3回連続失敗で管理者通知'],
] as const

const SYSTEM_INFO = [
  ['アプリ版', 'CivilDraft v0.4.0'],
  ['スキーマ版', 'v1.3'],
  ['保存先', 'IndexedDB（ローカル）'],
  ['共有基盤', 'Cloudflare Workers + Neon（本番接続済み）'],
  ['認証方式', 'Cloudflare Access（設定済み）'],
] as const

function permissionMark(enabled: boolean) {
  return (
    <span style={{ color: enabled ? '#1F8255' : '#C5392F', fontWeight: 700 }}>
      {enabled ? '可' : '不可'}
    </span>
  )
}

function field(label: string, value: string, helper?: string) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 600 }}>{label}</span>
      <span style={inputLikeStyle}>{value}</span>
      {helper !== undefined && <span style={{ color: 'var(--faint)', fontSize: 11 }}>{helper}</span>}
    </label>
  )
}

export interface SystemSettingsPageProps {
  /** 本番モードでは false を渡すとサンプルのログインユーザーを表示しない（?demo=1 時は表示）。 */
  readonly enableSampleData?: boolean
}

export function SystemSettingsPage({ enableSampleData = true }: SystemSettingsPageProps = {}) {
  const showSampleData = enableSampleData || isDemoMode()
  const currentUser = showSampleData
    ? LOGIN_USERS.find((user) => user.current) ?? LOGIN_USERS[0]
    : undefined
  const [masters, setMasters] = useState(() => [...INITIAL_MASTERS])

  const addMaster = () => {
    setMasters((current) => [
      ...current,
      {
        kind: `追加工種${current.length + 1}`,
        spec: '現場追加規格',
        unit: '式',
        method: '手動入力 / 属性集計',
        reviewer: '土木工事部',
        active: false,
      },
    ])
  }

  const exportSettings = () => {
    const json = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        masters,
        loginUsers: showSampleData ? LOGIN_USERS : [],
        roleMatrix: ROLE_MATRIX,
        templates: TEMPLATES,
        auditPolicies: AUDIT_POLICIES,
        systemInfo: SYSTEM_INFO,
      },
      null,
      2,
    )
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'civildraft-system-settings.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>システム設定</div>
          <div style={pageSubtitleStyle}>
            工種・規格マスター、ログインユーザー、案件ロール、テンプレート、監査設定
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={ghostButtonStyle} onClick={exportSettings}>設定をエクスポート</button>
        <button style={primaryButtonStyle} onClick={addMaster}>＋ マスターを追加</button>
      </header>

      <main style={pageMainStyle}>
        <div style={detailGridStyle}>
          <div style={sectionStackStyle}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>ログインユーザー設定・権限（案件ロール）</div>
              {currentUser === undefined ? (
                <div style={{ padding: '18px', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                  ログインユーザー設定は本番データ層（メンバーAPI）接続後に実データで表示します。
                  サンプルユーザーは表示しません。
                </div>
              ) : (
                <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
                  {field('ログインユーザー', currentUser.name, '現在の操作主体として監査ログへ記録')}
                  {field('メールアドレス', currentUser.email)}
                  {field('所属部署', currentUser.department)}
                  {field('既定ロール', currentUser.role, '案件ごとの割当で上書き可能')}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={compactHeader}>ロール</th>
                    <th style={compactHeader}>対象範囲</th>
                    <th style={compactHeader}>割当</th>
                    <th style={compactHeader}>作図</th>
                    <th style={compactHeader}>照査</th>
                    <th style={compactHeader}>承認</th>
                    <th style={compactHeader}>監査</th>
                    <th style={compactHeader}>管理</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_MATRIX.map((role) => (
                    <tr key={role.role}>
                      <td style={{ ...compactCell, fontWeight: 600 }}>{role.role}</td>
                      <td style={{ ...compactCell, color: 'var(--ink2)' }}>{role.scope}</td>
                      <td style={{ ...compactCell, ...monoStyle }}>{role.users}</td>
                      <td style={compactCell}>{permissionMark(role.draw)}</td>
                      <td style={compactCell}>{permissionMark(role.review)}</td>
                      <td style={compactCell}>{permissionMark(role.approve)}</td>
                      <td style={compactCell}>{permissionMark(role.audit)}</td>
                      <td style={compactCell}>{permissionMark(role.admin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>ログインユーザー一覧</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>氏名</th>
                    <th style={thStyle}>所属</th>
                    <th style={thStyle}>ロール</th>
                    <th style={thStyle}>MFA</th>
                    <th style={thStyle}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {showSampleData
                    ? LOGIN_USERS.map((user) => (
                        <tr key={user.email}>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>{user.name}</div>
                            <div style={{ ...monoStyle, color: 'var(--muted)', fontSize: 11 }}>{user.email}</div>
                          </td>
                          <td style={tdStyle}>{user.department}</td>
                          <td style={tdStyle}>{user.role}</td>
                          <td style={tdStyle}>{user.mfa ? '有効' : '未設定'}</td>
                          <td style={tdStyle}>
                            <span
                              style={
                                user.status === '有効'
                                  ? statusBadgeStyle('#1F8255', '#E4F3EC')
                                  : statusBadgeStyle('#A15C00', '#FFF3D6')
                              }
                            >
                              {user.current ? 'ログイン中' : user.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    : (
                        <tr>
                          <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={5}>
                            本番のユーザー一覧は未連携です（サンプルは表示しません）。
                          </td>
                        </tr>
                      )}
                </tbody>
              </table>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>工種・規格マスター</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>工種</th>
                    <th style={thStyle}>規格例</th>
                    <th style={thStyle}>単位</th>
                    <th style={thStyle}>算出方式</th>
                    <th style={thStyle}>管理部署</th>
                    <th style={thStyle}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {masters.map((master) => (
                    <tr key={master.kind}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{master.kind}</td>
                      <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{master.spec}</td>
                      <td style={{ ...tdStyle, ...monoStyle }}>{master.unit}</td>
                      <td style={tdStyle}>{master.method}</td>
                      <td style={tdStyle}>{master.reviewer}</td>
                      <td style={tdStyle}>
                        {master.active ? (
                          <span style={statusBadgeStyle('#1F8255', '#E4F3EC')}>有効</span>
                        ) : (
                          <span style={statusBadgeStyle('var(--muted)', 'var(--subtle)')}>検討中</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={sectionStackStyle}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>認証・セッション設定</div>
              <div style={{ padding: 18, display: 'grid', gap: 12 }}>
                {field('認証プロバイダー', 'Cloudflare Access', 'メールドメインとグループをロールへ割当')}
                {field('セッション有効期限', '12時間', '現場端末の共有利用を想定して短めに固定')}
                {field('再認証が必要な操作', '承認 / 権限変更 / 設定エクスポート')}
                {field('許可メールドメイン', 'example.jp / partner.example.jp')}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>図面テンプレート</div>
              <div>
                {TEMPLATES.map((template, index) => (
                  <div
                    key={template.name}
                    style={{
                      ...cardRowStyle,
                      borderBottom: index === TEMPLATES.length - 1 ? 'none' : cardRowStyle.borderBottom,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>📐</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{template.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {template.owner} / 更新 {template.updated}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>
                      <div>{template.size}</div>
                      <div style={monoStyle}>{template.scale}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>監査ログ設定</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={compactHeader}>項目</th>
                    <th style={compactHeader}>設定</th>
                    <th style={compactHeader}>根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {AUDIT_POLICIES.map(([name, value, reason]) => (
                    <tr key={name}>
                      <td style={{ ...compactCell, fontWeight: 600 }}>{name}</td>
                      <td style={compactCell}>{value}</td>
                      <td style={{ ...compactCell, color: 'var(--ink2)' }}>{reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>システム情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={kvStyle}>
                  {SYSTEM_INFO.map(([label, value]) => (
                    <Fragment key={label}>
                      <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>
                        {label}
                      </dt>
                      <dd style={{ margin: 0, fontSize: 12.5 }}>
                        {value}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
