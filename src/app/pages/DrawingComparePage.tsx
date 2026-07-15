/**
 * 図面比較画面。詳細設計仕様書 §20 図面差分を画面化する。
 *
 * 正本: pageStyles.ts の共通スタイル + HomePage.tsx の構造（サイドバー付きページの
 * ヘッダー/メイン、統計カード、パネル、テーブル）。デザイントークンは src/app/home.css。
 *
 * データ結線の方針:
 * - 比較先（after）= 現在編集中の図面。EditorStore の geometries を購読する。
 * - 比較元（before）= 自動保存の「保存済み下書き」。AutosaveStore を props 注入で受け取り
 *   load() で取得する（HomePage と同じ結線）。下書きが無ければ比較対象なしを表示する。
 * - 差分計算は diffDrawings(下書き, 現図面) を「差分を計算」ボタン押下時に実行する
 *   （§20 の「下書き→現在」の変化として読める向き）。
 *
 * TBD（将来拡張）: Phase 6 現時点の比較対象は「現在の図面 vs 自動保存の下書き」のみ。
 * 改訂（DrawingRevision）間の比較（Rev.1 vs Rev.2 等）は改訂の永続化層が整い次第、
 * 比較元セレクタを改訂リストへ拡張する。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AutosaveSnapshot, AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { diffDrawings } from '@/domain/diff'
import type { DrawingDiff, GeometryChange } from '@/domain/diff'
import { useEditorStore } from '@/app/store/useEditorStore'
import type { Geometry, GeometryId } from '@/shared/types'
import {
  monoStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  statCardStyle,
  statValueStyle,
  statusBadgeStyle,
  tdStyle,
  thStyle,
} from './pageStyles'

export interface DrawingComparePageProps {
  readonly autosaveStore: AutosaveStore
}

/** 差分明細テーブルの 1 行。 */
interface DiffRow {
  readonly id: string
  readonly kind: '追加' | '削除' | '変更'
  readonly type: string
  /** 変更行のみ: 変わった側面（座標・スタイル・属性・ステップ）を「・」区切りで示す。 */
  readonly detail: string
}

const cardTitleStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }
const cardSubLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 500, color: 'var(--muted)' }
const metaTextStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)' }

/** 分類ごとのバッジ配色（追加=緑系 / 削除=赤系 / 変更=橙系）。HomePage のサンプル配色に揃える。 */
const KIND_BADGE: Record<DiffRow['kind'], { readonly color: string; readonly bg: string }> = {
  追加: { color: '#1F8255', bg: '#E4F3EC' },
  削除: { color: '#C5392F', bg: '#FBE9E7' },
  変更: { color: '#B5701A', bg: '#FDEFE0' },
}

/**
 * DrawingDiff を明細行へ展開する。変更系 4 カテゴリ（§20.1）は同一 GeometryId が
 * 複数該当しうるため、ID 単位に集約して「変更」1 行にまとめ、変わった側面を併記する。
 */
function buildDiffRows(
  diff: DrawingDiff,
  before: readonly Geometry[],
  after: readonly Geometry[],
): readonly DiffRow[] {
  const beforeMap = new Map<GeometryId, Geometry>(before.map((g) => [g.id, g]))
  const afterMap = new Map<GeometryId, Geometry>(after.map((g) => [g.id, g]))
  const rows: DiffRow[] = []

  for (const id of diff.added) {
    rows.push({ id, kind: '追加', type: afterMap.get(id)?.type ?? '不明', detail: '' })
  }
  for (const id of diff.removed) {
    rows.push({ id, kind: '削除', type: beforeMap.get(id)?.type ?? '不明', detail: '' })
  }

  const changed = new Map<GeometryId, { type: string; aspects: string[] }>()
  const collect = (changes: readonly GeometryChange[], label: string) => {
    for (const change of changes) {
      const entry = changed.get(change.id) ?? { type: change.after.type, aspects: [] }
      entry.aspects.push(label)
      changed.set(change.id, entry)
    }
  }
  collect(diff.geometryChanged, '座標')
  collect(diff.styleChanged, 'スタイル')
  collect(diff.attributeChanged, '属性')
  collect(diff.stepChanged, 'ステップ')
  for (const [id, entry] of changed) {
    rows.push({ id, kind: '変更', type: entry.type, detail: entry.aspects.join('・') })
  }

  return rows
}

/** 変更系 4 カテゴリを横断した「変更のあった図形 ID」の重複排除集合を返す。 */
function changedIdSet(diff: DrawingDiff): Set<GeometryId> {
  const ids = new Set<GeometryId>()
  for (const change of diff.geometryChanged) ids.add(change.id)
  for (const change of diff.styleChanged) ids.add(change.id)
  for (const change of diff.attributeChanged) ids.add(change.id)
  for (const change of diff.stepChanged) ids.add(change.id)
  return ids
}

export function DrawingComparePage({ autosaveStore }: DrawingComparePageProps) {
  const currentGeometries = useEditorStore((s) => s.geometries)
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [diff, setDiff] = useState<DrawingDiff | null>(null)

  useEffect(() => {
    // HomePage と同じ結線: 状態更新は load() 解決後（非同期コールバック内）に限定し、
    // effect 本体での同期 setState（cascading render）を避ける。autosaveStore は注入され
    // 寿命内で不変の前提のため、比較元切替に伴う diff リセットは扱わない。
    let cancelled = false
    void autosaveStore.load().then((result) => {
      if (cancelled) return
      if (result.ok) setSnapshot(result.value)
      else setLoadError(`⚠️ 下書きの読込に失敗: ${result.error.message}`)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [autosaveStore])

  const computeDiff = () => {
    if (snapshot === null) return
    setDiff(diffDrawings(snapshot.geometries, currentGeometries))
  }

  const rows = useMemo(
    () => (diff === null ? [] : buildDiffRows(diff, snapshot?.geometries ?? [], currentGeometries)),
    [diff, snapshot, currentGeometries],
  )

  const changedCount = diff === null ? 0 : changedIdSet(diff).size
  const hasDiff =
    diff !== null && (diff.added.length > 0 || diff.removed.length > 0 || changedCount > 0)

  const changeBreakdown =
    diff === null
      ? ''
      : [
          ['座標', diff.geometryChanged.length],
          ['属性', diff.attributeChanged.length],
          ['スタイル', diff.styleChanged.length],
          ['ステップ', diff.stepChanged.length],
        ]
          .filter(([, n]) => (n as number) > 0)
          .map(([label, n]) => `${label} ${n}`)
          .join('・')

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>図面比較</div>
          <div style={pageSubtitleStyle}>現図面と保存済み下書きの差分</div>
        </div>
      </header>

      <main style={pageMainStyle}>
        <div style={{ ...panelStyle, marginBottom: 16 }}>
          <div style={panelHeaderStyle}>比較元の選択</div>
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {loaded && snapshot === null ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                {loadError ?? '比較対象がありません（自動保存の下書きが必要です）'}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
                  gap: 14,
                }}
              >
                <div>
                  <div style={cardTitleStyle}>比較元（下書き）</div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: '4px 0 3px' }}>
                    自動保存の下書き
                  </div>
                  <div style={metaTextStyle}>
                    {snapshot !== null
                      ? `保存: ${snapshot.savedAt} ・ 図形${snapshot.geometries.length}件`
                      : '読込中…'}
                  </div>
                </div>
                <div>
                  <div style={cardTitleStyle}>比較先（現在）</div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', margin: '4px 0 3px' }}>
                    現在の図面
                  </div>
                  <div style={metaTextStyle}>図形{currentGeometries.length}件</div>
                </div>
              </div>
            )}
            <div>
              <button
                type="button"
                style={snapshot === null ? { ...primaryButtonStyle, opacity: 0.5, cursor: 'not-allowed' } : primaryButtonStyle}
                onClick={computeDiff}
                disabled={snapshot === null}
              >
                差分を計算
              </button>
            </div>
          </div>
        </div>

        {diff !== null &&
          (hasDiff ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <div style={statCardStyle}>
                  <div style={cardTitleStyle}>追加</div>
                  <div style={{ ...statValueStyle, color: KIND_BADGE.追加.color }}>{diff.added.length}</div>
                  <div style={cardSubLabelStyle}>現図面で追加された図形</div>
                </div>
                <div style={statCardStyle}>
                  <div style={cardTitleStyle}>削除</div>
                  <div style={{ ...statValueStyle, color: KIND_BADGE.削除.color }}>{diff.removed.length}</div>
                  <div style={cardSubLabelStyle}>下書きから削除された図形</div>
                </div>
                <div style={statCardStyle}>
                  <div style={cardTitleStyle}>変更</div>
                  <div style={{ ...statValueStyle, color: KIND_BADGE.変更.color }}>{changedCount}</div>
                  <div style={cardSubLabelStyle}>{changeBreakdown !== '' ? `内訳: ${changeBreakdown}` : '内訳なし'}</div>
                </div>
              </div>

              <div style={panelStyle}>
                <div style={panelHeaderStyle}>差分明細</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>分類</th>
                      <th style={thStyle}>図形ID</th>
                      <th style={thStyle}>図形種別</th>
                      <th style={thStyle}>変更内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const badge = KIND_BADGE[row.kind]
                      return (
                        <tr key={`${row.kind}-${row.id}`}>
                          <td style={tdStyle}>
                            <span style={statusBadgeStyle(badge.color, badge.bg)}>{row.kind}</span>
                          </td>
                          <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)' }}>{row.id}</td>
                          <td style={tdStyle}>{row.type}</td>
                          <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{row.detail || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ ...panelStyle, padding: '18px', fontSize: 12.5, color: 'var(--muted)' }}>
              差分はありません
            </div>
          ))}
      </main>
    </div>
  )
}
