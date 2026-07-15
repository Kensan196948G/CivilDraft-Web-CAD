/**
 * ホーム・案件一覧画面。
 * 正本: Claude Design「CivilDraft Web CAD」Home.dc.html（100%適用）。
 *
 * データ結線の方針:
 * - 「自動保存からの復旧候補」は実際の AutosaveStore の最新スナップショットへ結線
 *   （復元=エディタへ読込・破棄=clear が実際に機能する）。候補なしの場合はその旨を表示
 * - 案件一覧・統計カード・最近開いた図面・お知らせは案件管理（Phase 2以降）未実装のため
 *   デザインのサンプル値を忠実に表示（見た目の正本）
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AutosaveSnapshot, AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { useEditorStoreApi } from '@/app/store/useEditorStore'

export interface HomePageProps {
  readonly autosaveStore: AutosaveStore
  readonly onOpenEditor: () => void
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '16px 17px',
  boxShadow: 'var(--shadow)',
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
}

const cardTitleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const cardTitleStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }

const cardValueStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  color: 'var(--ink)',
  lineHeight: 1,
  letterSpacing: -0.5,
  fontVariantNumeric: 'tabular-nums',
}

const panelStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '11px 16px',
  borderBottom: '1px solid var(--line2)',
  fontSize: 11,
  color: 'var(--muted)',
  fontWeight: 600,
  background: 'var(--hover)',
}

function tdStyle(last: boolean): CSSProperties {
  return {
    padding: '12px 16px',
    borderBottom: last ? 'none' : '1px solid var(--line2)',
  }
}

function statusBadge(color: string, bg: string): CSSProperties {
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

const orangeButton: CSSProperties = {
  cursor: 'pointer',
  border: '1px solid #E08A2B',
  background: '#E08A2B',
  color: '#fff',
  padding: '6px 11px',
  borderRadius: 8,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
}

const ghostButton: CSSProperties = {
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

/** 案件管理（Phase 2以降）未実装のためのサンプル行（デザイン正本の値）。 */
const SAMPLE_PROJECTS = [
  { name: '国道245号 道路拡幅工事', area: '2工区', status: '進行中', color: '#2E5AAC', bg: '#E9F0FB', drawings: 12, updated: '2026-07-14' },
  { name: '大和川 河川護岸補修工事', area: '1工区', status: '照査待ち', color: '#B5701A', bg: '#FDEFE0', drawings: 7, updated: '2026-07-13' },
  { name: '中央幹線 下水道更新工事', area: '3工区', status: '承認済み', color: '#1F8255', bg: '#E4F3EC', drawings: 20, updated: '2026-07-10' },
  { name: '桜田地区 仮設ヤード計画', area: '仮設工区', status: '差戻し', color: '#B5701A', bg: '#FDEFE0', drawings: 4, updated: '2026-07-12' },
] as const

const SAMPLE_RECENT = [
  { icon: '📐', name: '施工ヤード計画図 Rev.3', project: '国道245号 道路拡幅工事', when: '10分前' },
  { icon: '📍', name: '測点配置図 Rev.1', project: '大和川 河川護岸補修工事', when: '2時間前' },
  { icon: '🧮', name: '数量根拠図（土工数量）', project: '国道245号 道路拡幅工事', when: '昨日' },
] as const

export function HomePage({ autosaveStore, onOpenEditor }: HomePageProps) {
  const storeApi = useEditorStoreApi()
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void autosaveStore.load().then((result) => {
      if (cancelled) return
      if (result.ok) setSnapshot(result.value)
      else setRecoveryMessage(`⚠️ 下書きの読込に失敗: ${result.error.message}`)
    })
    return () => {
      cancelled = true
    }
  }, [autosaveStore])

  const restoreSnapshot = () => {
    if (snapshot === null) return
    storeApi.getState().replaceDocument(snapshot.geometries, snapshot.layers)
    onOpenEditor()
  }

  const discardSnapshot = () => {
    void autosaveStore.clear().then((result) => {
      if (result.ok) {
        setSnapshot(null)
        setRecoveryMessage('下書きを破棄しました')
      } else {
        setRecoveryMessage(`⚠️ 破棄に失敗: ${result.error.message}`)
      }
    })
  }

  const recoveryCount = snapshot !== null ? 1 : 0

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header
        style={{
          height: 62,
          flexShrink: 0,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 22px',
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>
            ホーム・案件一覧
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            最近の図面、案件検索、新規作成、復旧候補
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: 'var(--subtle)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '7px 11px',
            color: 'var(--muted)',
          }}
        >
          <span>🔎</span>
          <input
            placeholder="案件名・図面番号で検索"
            style={{
              border: 'none',
              background: 'none',
              outline: 'none',
              font: 'inherit',
              fontSize: 12.5,
              width: 200,
              color: 'var(--ink)',
            }}
          />
        </div>
        <button
          onClick={onOpenEditor}
          style={{
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
          }}
        >
          ＋ 新規案件・図面
        </button>
      </header>

      <main style={{ flex: 1, overflow: 'auto', padding: 22 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
            gap: 14,
            marginBottom: 16,
          }}
        >
          <div style={cardStyle}>
            <div style={cardTitleRow}>
              <div style={cardTitleStyle}>進行中案件</div>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: '#2E5AAC' }} />
            </div>
            <div style={cardValueStyle}>9</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>全 14 案件中</div>
          </div>
          <div style={cardStyle}>
            <div style={cardTitleRow}>
              <div style={cardTitleStyle}>照査待ち図面</div>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: '#B5701A' }} />
            </div>
            <div style={cardValueStyle}>5</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#B5701A' }}>2件が3日以上滞留</div>
          </div>
          <div style={cardStyle}>
            <div style={cardTitleRow}>
              <div style={cardTitleStyle}>承認待ち図面</div>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: '#6B45B0' }} />
            </div>
            <div style={cardValueStyle}>3</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>承認者確認待ち</div>
          </div>
          <div style={cardStyle}>
            <div style={cardTitleRow}>
              <div style={cardTitleStyle}>自動保存の復旧候補</div>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: '#C5392F' }} />
            </div>
            <div style={cardValueStyle}>{recoveryCount}</div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: recoveryCount > 0 ? '#C5392F' : 'var(--muted)',
              }}
            >
              {recoveryCount > 0 ? '未確定の下書きあり' : '未確定の下書きなし'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.65fr) minmax(0,1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={panelStyle}>
            <div
              style={{
                padding: '15px 18px',
                borderBottom: '1px solid var(--line2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
                案件一覧
              </div>
              <span style={{ fontSize: 12, color: '#2E5AAC' }}>すべて表示 →</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件名</th>
                  <th style={thStyle}>工区</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}>図面数</th>
                  <th style={thStyle}>最終更新</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_PROJECTS.map((p, i) => {
                  const last = i === SAMPLE_PROJECTS.length - 1
                  return (
                    <tr key={p.name} style={{ cursor: 'pointer' }}>
                      <td style={tdStyle(last)}>
                        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{p.name}</span>
                      </td>
                      <td style={tdStyle(last)}>{p.area}</td>
                      <td style={tdStyle(last)}>
                        <span style={statusBadge(p.color, p.bg)}>{p.status}</span>
                      </td>
                      <td style={{ ...tdStyle(last), fontFamily: "'IBM Plex Mono'" }}>
                        {p.drawings}
                      </td>
                      <td style={{ ...tdStyle(last), color: 'var(--ink2)' }}>{p.updated}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--line2)',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                自動保存からの復旧候補
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {snapshot !== null ? (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                      未確定の下書き
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 8px' }}>
                      保存: {snapshot.savedAt} ・ 図形{snapshot.geometries.length}件 ・ レイヤー
                      {snapshot.layers.length}件
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button style={orangeButton} onClick={restoreSnapshot}>
                        復元
                      </button>
                      <button style={ghostButton} onClick={discardSnapshot}>
                        破棄
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {recoveryMessage ?? '復旧候補はありません'}
                  </div>
                )}
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--line2)',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                最近開いた図面
              </div>
              <div>
                {SAMPLE_RECENT.map((r, i) => (
                  <button
                    key={r.name}
                    onClick={onOpenEditor}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '13px 18px',
                      borderBottom:
                        i === SAMPLE_RECENT.length - 1 ? 'none' : '1px solid var(--line2)',
                      textDecoration: 'none',
                      color: 'inherit',
                      background: 'none',
                      border: 'none',
                      borderBottomStyle: i === SAMPLE_RECENT.length - 1 ? 'none' : 'solid',
                      width: '100%',
                      font: 'inherit',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{r.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                        {r.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.project}</div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.when}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={panelStyle}>
              <div
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--line2)',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                お知らせ
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
                  ・ DXF入出力の対応要素一覧を更新しました（07-11）
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
                  ・ 定期メンテナンス: 07-20 02:00〜04:00
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
