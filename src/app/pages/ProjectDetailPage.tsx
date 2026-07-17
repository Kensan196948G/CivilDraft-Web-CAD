/**
 * 案件詳細画面。
 * 正本: Claude Design「CivilDraft Web CAD」Project Detail.dc.html（100%適用）。
 * 案件管理バックエンドはPhase 6後続のため、デザイン正本のサンプルデータを忠実表示する。
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
import type { CloudDraftSession } from './CadEditorPage'

const filterChipActive: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  padding: '7px 13px',
  borderRadius: 8,
  border: '1px solid #E08A2B',
  background: '#FDEFE0',
  color: '#B5701A',
  cursor: 'pointer',
  textDecoration: 'none',
}

const filterChip: CSSProperties = {
  ...filterChipActive,
  border: '1px solid var(--line)',
  background: 'var(--surface)',
  color: 'var(--ink2)',
}

const chipCount: CSSProperties = { ...monoStyle, opacity: 0.7, marginLeft: 3 }

const tdBase: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--line2)' }
const tdLast: CSSProperties = { padding: '12px 16px' }

const typeBadge: CSSProperties = {
  color: 'var(--ink2)',
  background: 'var(--subtle)',
  border: '1px solid var(--line)',
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 11,
}

const PROJECT_CLOUD_CONTEXT = {
  projectNumber: 'P-245-ROAD-WIDENING',
  projectName: '国道245号 道路拡幅工事',
  clientName: '○○県土木部',
} as const

const DRAWINGS = [
  { no: 'DWG-014', name: '施工ヤード計画図', type: '施工ヤード図', drawingType: 'temporary-yard-plan', rev: 'Rev.3', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '山田 太郎' },
  { no: 'DWG-011', name: '仮設計画図（矢板・切梁）', type: '仮設計画図', drawingType: 'temporary-plan', rev: 'Rev.2', status: '照査待ち', c: '#B5701A', bg: '#FDEFE0', by: '山田 太郎' },
  { no: 'DWG-009', name: '土工平面図・法面計画', type: '土工・断面図', drawingType: 'earthwork-plan', rev: 'Rev.5', status: '承認済み', c: '#1F8255', bg: '#E4F3EC', by: '鈴木 花子' },
  { no: 'DWG-002', name: '数量根拠図（土工数量）', type: '数量根拠図', drawingType: 'quantity-basis', rev: 'Rev.1', status: '差戻し', c: '#C5392F', bg: '#FCE9E7', by: '山田 太郎' },
] as const

const MEMBERS = [
  { initial: '山', name: '山田 太郎', role: '作成者', c: '#E08A2B', border: '1px solid rgba(224,138,43,.4)' },
  { initial: '鈴', name: '鈴木 花子', role: '照査者', c: '#2E5AAC', border: '1px solid #C9D7EC' },
  { initial: '高', name: '高橋 一郎', role: '承認者', c: '#1F8255', border: '1px solid #9BCFB2' },
  { initial: '佐', name: '佐藤 次郎', role: '閲覧者', c: 'var(--muted)', border: '1px solid var(--line)' },
] as const

const ACTIVITIES = [
  { color: '#2E9E6B', text: '山田 太郎が DWG-014 Rev.3 を保存', when: '2026-07-14 18:42', line: true },
  { color: '#B5701A', text: '鈴木 花子が DWG-011 Rev.2 を照査依頼', when: '2026-07-13 11:20', line: true },
  { color: '#C5392F', text: '高橋 一郎が DWG-002 Rev.1 を差戻し', when: '2026-07-12 16:05', line: false },
] as const

const PROJECT_INFO = [
  ['工区数', '2工区（第1・第2工区）'],
  ['発注者', '○○県土木部 道路課'],
  ['工期', '2026-04-01 〜 2027-03-31'],
  ['座標系', '平面直角座標系 第Ⅵ系'],
  ['単位系', 'm（メートル）'],
  ['契約金額', '非公開（権限者のみ閲覧可）'],
  ['監督員', '○○県土木部 第2土木事務所'],
] as const

export interface ProjectDetailPageProps {
  readonly onOpenEditor?: (session: CloudDraftSession) => void
}

export function ProjectDetailPage({ onOpenEditor }: ProjectDetailPageProps) {
  const openDrawing = (drawing: (typeof DRAWINGS)[number]) => {
    onOpenEditor?.({
      ...PROJECT_CLOUD_CONTEXT,
      drawingNumber: drawing.no,
      drawingName: drawing.name,
      drawingType: drawing.drawingType,
      revisionNumber: drawing.rev,
      changeSummary: `${drawing.no} ${drawing.rev} をCAD編集画面から共有保存`,
    })
  }

  const createDrawing = () => {
    onOpenEditor?.({
      ...PROJECT_CLOUD_CONTEXT,
      drawingNumber: 'DWG-NEW',
      drawingName: '新規図面',
      drawingType: 'civil-drawing',
      revisionNumber: 'Rev.0',
      changeSummary: '新規図面をCAD編集画面から共有保存',
    })
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>国道245号 道路拡幅工事</div>
          <div style={pageSubtitleStyle}>2工区 ・ 発注者: ○○県土木部 ・ 工期 2026-04-01〜2027-03-31</div>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#E9F0FB',
            color: '#2E5AAC',
            padding: '6px 10px',
            borderRadius: 7,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          進行中
        </div>
        <button
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            border: '1px solid var(--line)',
            background: 'var(--surface)',
            color: 'var(--ink2)',
            padding: '8px 14px',
            borderRadius: 8,
            font: 'inherit',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          案件を編集
        </button>
        <button style={primaryButtonStyle} onClick={createDrawing}>
          ＋ 図面を作成
        </button>
      </header>

      <main style={pageMainStyle}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 392px',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={panelStyle}>
            <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>図面一覧</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '14px 18px 0' }}>
              <span style={filterChipActive}>
                すべて<span style={chipCount}>12</span>
              </span>
              <span style={filterChip}>
                施工ヤード図<span style={chipCount}>3</span>
              </span>
              <span style={filterChip}>
                仮設計画図<span style={chipCount}>2</span>
              </span>
              <span style={filterChip}>
                土工・断面図<span style={chipCount}>4</span>
              </span>
              <span style={filterChip}>
                数量根拠図<span style={chipCount}>3</span>
              </span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 14 }}>
              <thead>
                <tr>
                  <th style={thStyle}>図面番号</th>
                  <th style={thStyle}>名称</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>改訂</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}>更新者</th>
                </tr>
              </thead>
              <tbody>
                {DRAWINGS.map((d, i) => {
                  const td = i === DRAWINGS.length - 1 ? tdLast : tdBase
                  return (
                    <tr key={d.no} style={{ cursor: 'pointer' }} onClick={() => openDrawing(d)}>
                      <td style={{ ...td, ...monoStyle, color: 'var(--ink2)' }}>{d.no}</td>
                      <td style={td}>
                        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{d.name}</span>
                      </td>
                      <td style={td}>
                        <span style={typeBadge}>{d.type}</span>
                      </td>
                      <td style={{ ...td, ...monoStyle }}>{d.rev}</td>
                      <td style={td}>
                        <span style={statusBadgeStyle(d.c, d.bg)}>{d.status}</span>
                      </td>
                      <td style={{ ...td, color: 'var(--ink2)' }}>{d.by}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>案件情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 16px', margin: 0 }}>
                  {PROJECT_INFO.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                      <dt style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>{k}</dt>
                      <dd style={{ margin: 0, fontSize: 12.5 }}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>メンバー</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {MEMBERS.map((m) => (
                  <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: '#2A3850',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {m.initial}
                    </span>
                    <div style={{ flex: 1, fontSize: 12.5 }}>{m.name}</div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: m.c,
                        border: m.border,
                        padding: '1px 6px',
                        borderRadius: 5,
                      }}
                    >
                      {m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>最近のアクティビティ</div>
              <div style={{ padding: '16px 18px' }}>
                {ACTIVITIES.map((a) => (
                  <div key={a.text} style={{ display: 'flex', gap: 11 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 3, background: a.color }} />
                      {a.line && (
                        <span style={{ width: 2, flex: 1, background: 'var(--line2)', minHeight: 12 }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: a.line ? 13 : 0 }}>
                      <div style={{ fontSize: 12.5 }}>{a.text}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.when}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
