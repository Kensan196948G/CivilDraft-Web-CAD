/**
 * 案件詳細画面。
 * 正本: Claude Design「CivilDraft Web CAD」Project Detail.dc.html（100%適用）。
 * 案件管理バックエンドへの本番接続前のため、画面内状態で編集・図面作成・一覧絞り込みを処理する。
 */
import { useMemo, useState } from 'react'
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
const secondaryButtonStyle: CSSProperties = {
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
}
const fieldStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--ink)',
  padding: '8px 10px',
  font: 'inherit',
  fontSize: 12.5,
}

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

type DrawingType = '施工ヤード図' | '仮設計画図' | '土工・断面図' | '数量根拠図'
type DrawingStatus = '作成中' | '照査待ち' | '承認済み' | '差戻し'
type FilterType = 'すべて' | DrawingType

interface DrawingRow {
  readonly no: string
  readonly name: string
  readonly type: DrawingType
  readonly rev: string
  readonly status: DrawingStatus
  readonly c: string
  readonly bg: string
  readonly by: string
}

interface ProjectInfoState {
  readonly name: string
  readonly status: '進行中' | '照査待ち' | '承認待ち' | '承認済み' | '差戻し'
  readonly area: string
  readonly clientSummary: string
  readonly periodSummary: string
  readonly districtCount: string
  readonly client: string
  readonly period: string
  readonly coordinateSystem: string
  readonly unitSystem: string
  readonly contractAmount: string
  readonly supervisor: string
}

const DRAWINGS: readonly DrawingRow[] = [
  { no: 'DWG-014', name: '施工ヤード計画図', type: '施工ヤード図', rev: 'Rev.3', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '山田 太郎' },
  { no: 'DWG-011', name: '仮設計画図（矢板・切梁）', type: '仮設計画図', rev: 'Rev.2', status: '照査待ち', c: '#B5701A', bg: '#FDEFE0', by: '山田 太郎' },
  { no: 'DWG-009', name: '土工平面図・法面計画', type: '土工・断面図', rev: 'Rev.5', status: '承認済み', c: '#1F8255', bg: '#E4F3EC', by: '鈴木 花子' },
  { no: 'DWG-002', name: '数量根拠図（土工数量）', type: '数量根拠図', rev: 'Rev.1', status: '差戻し', c: '#C5392F', bg: '#FCE9E7', by: '山田 太郎' },
  { no: 'DWG-018', name: '重機作業半径図', type: '仮設計画図', rev: 'Rev.1', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '佐藤 次郎' },
  { no: 'DWG-020', name: '施工ヤード資材配置図', type: '施工ヤード図', rev: 'Rev.1', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '中村 美咲' },
  { no: 'DWG-021', name: '施工ヤード排水計画図', type: '施工ヤード図', rev: 'Rev.1', status: '照査待ち', c: '#B5701A', bg: '#FDEFE0', by: '山田 太郎' },
  { no: 'DWG-022', name: '標準横断図 No.20', type: '土工・断面図', rev: 'Rev.2', status: '承認済み', c: '#1F8255', bg: '#E4F3EC', by: '鈴木 花子' },
  { no: 'DWG-023', name: '法面断面図 No.40', type: '土工・断面図', rev: 'Rev.2', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '山田 太郎' },
  { no: 'DWG-024', name: '掘削断面図 No.60', type: '土工・断面図', rev: 'Rev.1', status: '照査待ち', c: '#B5701A', bg: '#FDEFE0', by: '佐藤 次郎' },
  { no: 'DWG-025', name: '数量根拠図（舗装数量）', type: '数量根拠図', rev: 'Rev.1', status: '承認済み', c: '#1F8255', bg: '#E4F3EC', by: '中村 美咲' },
  { no: 'DWG-026', name: '数量根拠図（仮設材数量）', type: '数量根拠図', rev: 'Rev.1', status: '作成中', c: '#6B45B0', bg: '#EDE7F6', by: '山田 太郎' },
] as const

const FILTERS: readonly FilterType[] = ['すべて', '施工ヤード図', '仮設計画図', '土工・断面図', '数量根拠図']

const INITIAL_PROJECT: ProjectInfoState = {
  name: '国道245号 道路拡幅工事',
  status: '進行中',
  area: '2工区',
  clientSummary: '○○県土木部',
  periodSummary: '2026-04-01〜2027-03-31',
  districtCount: '2工区（第1・第2工区）',
  client: '○○県土木部 道路課',
  period: '2026-04-01 〜 2027-03-31',
  coordinateSystem: '平面直角座標系 第Ⅵ系',
  unitSystem: 'm（メートル）',
  contractAmount: '非公開（権限者のみ閲覧可）',
  supervisor: '○○県土木部 第2土木事務所',
}

const MEMBERS = [
  { initial: '山', name: '山田 太郎', role: '作成者', c: '#E08A2B', border: '1px solid rgba(224,138,43,.4)' },
  { initial: '鈴', name: '鈴木 花子', role: '照査者', c: '#2E5AAC', border: '1px solid #C9D7EC' },
  { initial: '高', name: '高橋 一郎', role: '承認者', c: '#1F8255', border: '1px solid #9BCFB2' },
  { initial: '佐', name: '佐藤 次郎', role: '閲覧者', c: 'var(--muted)', border: '1px solid var(--line)' },
  { initial: '中', name: '中村 美咲', role: '数量担当', c: '#6B45B0', border: '1px solid #D8C7F1' },
] as const

const ACTIVITIES = [
  { color: '#2E9E6B', text: '山田 太郎が DWG-014 Rev.3 を保存', when: '2026-07-14 18:42', line: true },
  { color: '#B5701A', text: '鈴木 花子が DWG-011 Rev.2 を照査依頼', when: '2026-07-13 11:20', line: true },
  { color: '#C5392F', text: '高橋 一郎が DWG-002 Rev.1 を差戻し', when: '2026-07-12 16:05', line: true },
  { color: '#6B45B0', text: '中村 美咲が数量CSVを出力', when: '2026-07-12 10:25', line: true },
  { color: '#2E5AAC', text: '佐藤 次郎が DWG-018 を新規作成', when: '2026-07-11 09:30', line: false },
] as const

export interface ProjectDetailPageProps {
  readonly onOpenEditor?: () => void
}

export function ProjectDetailPage({ onOpenEditor }: ProjectDetailPageProps) {
  const [project, setProject] = useState<ProjectInfoState>(INITIAL_PROJECT)
  const [draftProject, setDraftProject] = useState<ProjectInfoState>(INITIAL_PROJECT)
  const [drawings, setDrawings] = useState<readonly DrawingRow[]>(DRAWINGS)
  const [filter, setFilter] = useState<FilterType>('すべて')
  const [mode, setMode] = useState<'overview' | 'editProject' | 'newDrawing' | 'drawingDetail'>('overview')
  const [selectedDrawing, setSelectedDrawing] = useState<DrawingRow>(DRAWINGS[0]!)
  const [newDrawingName, setNewDrawingName] = useState('新規施工ヤード計画図')
  const [newDrawingType, setNewDrawingType] = useState<DrawingType>('施工ヤード図')

  const counts = useMemo(() => {
    const countByType = (type: DrawingType) => drawings.filter((d) => d.type === type).length
    return {
      すべて: drawings.length,
      施工ヤード図: countByType('施工ヤード図'),
      仮設計画図: countByType('仮設計画図'),
      '土工・断面図': countByType('土工・断面図'),
      数量根拠図: countByType('数量根拠図'),
    } satisfies Record<FilterType, number>
  }, [drawings])

  const filteredDrawings = filter === 'すべて' ? drawings : drawings.filter((drawing) => drawing.type === filter)

  const projectInfo = [
    ['工区数', project.districtCount],
    ['発注者', project.client],
    ['工期', project.period],
    ['座標系', project.coordinateSystem],
    ['単位系', project.unitSystem],
    ['契約金額', project.contractAmount],
    ['監督員', project.supervisor],
  ] as const

  const saveProject = () => {
    setProject(draftProject)
    setMode('overview')
  }

  const createDrawing = () => {
    const maxNo = Math.max(...drawings.map((drawing) => Number(drawing.no.replace('DWG-', ''))))
    const nextNo = `DWG-${String(maxNo + 1).padStart(3, '0')}`
    const drawing: DrawingRow = {
      no: nextNo,
      name: newDrawingName,
      type: newDrawingType,
      rev: 'Rev.1',
      status: '作成中',
      c: '#6B45B0',
      bg: '#EDE7F6',
      by: '山田 太郎',
    }
    setDrawings((current) => [drawing, ...current])
    setSelectedDrawing(drawing)
    setFilter('すべて')
    setMode('drawingDetail')
  }

  const openDrawing = (drawing: DrawingRow) => {
    setSelectedDrawing(drawing)
    setMode('drawingDetail')
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>{project.name}</div>
          <div style={pageSubtitleStyle}>{project.area} ・ 発注者: {project.clientSummary} ・ 工期 {project.periodSummary}</div>
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
          {project.status}
        </div>
        <button style={secondaryButtonStyle} onClick={() => { setDraftProject(project); setMode('editProject') }}>
          案件を編集
        </button>
        <button style={primaryButtonStyle} onClick={() => setMode('newDrawing')}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {mode === 'editProject' && (
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>案件を編集</div>
              <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>案件名</span><input value={draftProject.name} onChange={(e) => setDraftProject({ ...draftProject, name: e.target.value })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>工区</span><input value={draftProject.area} onChange={(e) => setDraftProject({ ...draftProject, area: e.target.value })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>発注者</span><input value={draftProject.client} onChange={(e) => setDraftProject({ ...draftProject, client: e.target.value, clientSummary: e.target.value.replace(' 道路課', '') })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>工期</span><input value={draftProject.period} onChange={(e) => setDraftProject({ ...draftProject, period: e.target.value, periodSummary: e.target.value.replace(' 〜 ', '〜') })} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>状態</span><select value={draftProject.status} onChange={(e) => setDraftProject({ ...draftProject, status: e.target.value as ProjectInfoState['status'] })} style={fieldStyle}><option value="進行中">進行中</option><option value="照査待ち">照査待ち</option><option value="承認待ち">承認待ち</option><option value="承認済み">承認済み</option><option value="差戻し">差戻し</option></select></label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                  <button style={primaryButtonStyle} onClick={saveProject}>保存</button>
                  <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>キャンセル</button>
                </div>
              </div>
            </div>
          )}

          {mode === 'newDrawing' && (
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>図面を作成</div>
              <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>名称</span><input value={newDrawingName} onChange={(e) => setNewDrawingName(e.target.value)} style={fieldStyle} /></label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>種別</span><select value={newDrawingType} onChange={(e) => setNewDrawingType(e.target.value as DrawingType)} style={fieldStyle}>{FILTERS.filter((f): f is DrawingType => f !== 'すべて').map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
                  <button style={primaryButtonStyle} onClick={createDrawing}>作成</button>
                  <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>キャンセル</button>
                </div>
              </div>
            </div>
          )}

          {mode === 'drawingDetail' && (
            <div style={panelStyle}>
              <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>図面詳細: {selectedDrawing.no} {selectedDrawing.name}</div>
                <button style={primaryButtonStyle} onClick={onOpenEditor}>CAD編集で開く</button>
                <button style={secondaryButtonStyle} onClick={() => setMode('overview')}>閉じる</button>
              </div>
              <div style={{ padding: 18, display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))', gap: 12, fontSize: 12.5 }}>
                <div><b>図面番号</b><br />{selectedDrawing.no}</div>
                <div><b>種別</b><br />{selectedDrawing.type}</div>
                <div><b>改訂</b><br />{selectedDrawing.rev}</div>
                <div><b>状態</b><br /><span style={statusBadgeStyle(selectedDrawing.c, selectedDrawing.bg)}>{selectedDrawing.status}</span></div>
                <div><b>更新者</b><br />{selectedDrawing.by}</div>
              </div>
            </div>
          )}

          <div style={panelStyle}>
            <div style={{ ...panelHeaderStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>図面一覧</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '14px 18px 0' }}>
              {FILTERS.map((nextFilter) => (
                <button key={nextFilter} style={filter === nextFilter ? filterChipActive : filterChip} onClick={() => setFilter(nextFilter)}>
                  {nextFilter}<span style={chipCount}>{counts[nextFilter]}</span>
                </button>
              ))}
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
                {filteredDrawings.map((d, i) => {
                  const td = i === filteredDrawings.length - 1 ? tdLast : tdBase
                  return (
                    <tr key={d.no} style={{ cursor: 'pointer' }} onClick={() => openDrawing(d)}>
                      <td style={{ ...td, ...monoStyle, color: 'var(--ink2)' }}>{d.no}</td>
                      <td style={td}>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            openDrawing(d)
                          }}
                          style={{
                            border: 0,
                            padding: 0,
                            background: 'none',
                            color: 'var(--ink)',
                            font: 'inherit',
                            fontWeight: 500,
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          {d.name}
                        </button>
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
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>案件情報</div>
              <div style={{ padding: '16px 18px' }}>
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 16px', margin: 0 }}>
                  {projectInfo.map(([k, v]) => (
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
