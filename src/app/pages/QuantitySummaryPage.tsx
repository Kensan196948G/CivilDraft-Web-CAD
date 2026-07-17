/**
 * 数量集計画面（詳細設計仕様書 §17 数量計算 / §24.2 数量CSV列）。
 * 現在の図面（editorStore の geometries）から数量を算出・集計し、テーブル表示と
 * CSV出力を行う。算出・丸め・CSV整形は domain/quantities を正本とし UI では再実装しない。
 *
 * データ結線の方針:
 * - 算出は computeQuantitySummary（本ファイル）に集約し、内部で
 *   computeContribution / buildQuantityItem（domain/quantities）を用いる。
 * - 属性未付与図形の扱い（設計判断）: 本画面のスコープには CivilAttribute ストアが
 *   結線されていないため、図形 type から既定の算出区分（method）・単位（unit）を推定する
 *   （deriveDefaultQuantitySpec）。工種・種別・規格などの土木属性が後続で結線されたら、
 *   グルーピングと単位は属性側（deriveGroupKey / CivilAttribute）へ委譲する。
 * - 算出は「ボタン押下時のスナップショット」に対して行う。図面が変わったら再算出を促す
 *   （geometries 全体を常時購読せず、件数だけ購読して §8.2 の購読最小化に従う）。
 * - CSV出力は exportQuantityCsv を用い、インジェクション対策（数式起点セルの無害化）は
 *   ドメイン側で担保済み。案件番号・図面番号・改訂番号は案件管理（Phase 2以降）が
 *   未結線のため空（CSV_CONTEXT）。結線後に親が供給する。
 *
 * スタイルは pageStyles.ts の共通トークンのみ再利用する（独自の色トークンは定義しない）。
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { exportQuantityCsv } from '@/domain/quantities/quantityCsv'
import { useEditorStore, useEditorStoreApi } from '@/app/store/useEditorStore'
import {
  CSV_CONTEXT,
  computeQuantitySummary,
  formatQuantity,
  totalRoundedByUnit,
  type QuantitySummary,
} from '@/app/pages/quantitySummaryModel'
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
  statCardStyle,
  statValueStyle,
  tdStyle,
  thStyle,
} from '@/app/pages/pageStyles'
import type { QuantityItemId, QuantityMethod, QuantityUnit } from '@/shared/types'

const METHOD_LABELS: Record<QuantityMethod, string> = {
  length: '延長',
  perimeter: '外周',
  area: '面積',
  volume: '体積',
  count: '個数',
  manual: '手動',
}

const UNIT_LABELS: Record<QuantityUnit, string> = {
  m: 'm',
  m2: 'm²',
  m3: 'm³',
  count: '個',
  set: '式',
  custom: 'その他',
}

const fieldLabelStyle: CSSProperties = { fontSize: 11, color: 'var(--muted)', fontWeight: 600 }

export function QuantitySummaryPage() {
  const storeApi = useEditorStoreApi()
  // 全配列は常時購読せず件数のみ購読（§8.2）。算出はボタン押下時のスナップショットに対して行う。
  const geometryCount = useEditorStore((s) => s.geometries.length)

  const [summary, setSummary] = useState<QuantitySummary | null>(null)
  const [computedAtCount, setComputedAtCount] = useState<number | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<QuantityItemId | null>(null)

  // summary 不変時は参照を安定させ、下流 useMemo の再計算を避ける。
  const items = useMemo(() => summary?.items ?? [], [summary])
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  )

  const lengthTotal = useMemo(() => totalRoundedByUnit(items, 'm'), [items])
  const areaTotal = useMemo(() => totalRoundedByUnit(items, 'm2'), [items])
  const countTotal = useMemo(() => totalRoundedByUnit(items, 'count'), [items])

  // 算出後に図面が変わったら再算出を促す（件数差で検知）。
  const isStale = computedAtCount !== null && computedAtCount !== geometryCount

  const handleCompute = () => {
    const snapshot = storeApi.getState().geometries
    setSummary(computeQuantitySummary(snapshot))
    setComputedAtCount(snapshot.length)
    setSelectedItemId(null)
  }

  const handleExportCsv = () => {
    if (items.length === 0) return
    const result = exportQuantityCsv({
      rows: items.map((item) => ({ item })),
      context: CSV_CONTEXT,
    })
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'quantities.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const hasGeometries = geometryCount > 0

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>数量集計</div>
          <div style={pageSubtitleStyle}>図面からの数量算出・集計・CSV出力（§17 / §24.2）</div>
        </div>
      </header>

      <main style={pageMainStyle}>
        {/* サマリーカード */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
            gap: 14,
            marginBottom: 16,
          }}
        >
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>数量項目数</div>
            <div style={statValueStyle}>{items.length}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>算出区分×単位でまとめた明細</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>延長合計</div>
            <div style={{ ...statValueStyle, ...monoStyle }}>{formatQuantity(lengthTotal)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>m（線・円弧・開ポリライン）</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>面積合計</div>
            <div style={{ ...statValueStyle, ...monoStyle }}>{formatQuantity(areaTotal)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>m²（円・矩形・閉領域・ハッチ）</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>個数合計</div>
            <div style={{ ...statValueStyle, ...monoStyle }}>{formatQuantity(countTotal)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>個（記号・パラメトリック）</div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* 左カラム: 数量テーブル */}
          <div style={panelStyle}>
            <div
              style={{
                padding: '15px 18px',
                borderBottom: '1px solid var(--line2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', flex: 1, minWidth: 120 }}>
                数量明細
              </div>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleCompute}
                disabled={!hasGeometries}
              >
                現在の図面から数量を算出
              </button>
              <button
                type="button"
                style={ghostButtonStyle}
                onClick={handleExportCsv}
                disabled={items.length === 0}
              >
                数量CSVを出力
              </button>
            </div>

            {isStale && (
              <div role="status" style={{ padding: '9px 18px', fontSize: 12, color: '#8A5A12', background: '#FDEFE0' }}>
                ⚠️ 図面が変更されました。「現在の図面から数量を算出」で再算出してください。
              </div>
            )}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>工種</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>規格</th>
                  <th style={thStyle}>算出区分</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>丸め前値</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>表示値</th>
                  <th style={thStyle}>単位</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>根拠図形数</th>
                </tr>
              </thead>
              <tbody>
                {!hasGeometries ? (
                  <tr>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={8}>
                      図形がありません。CAD編集で図形を作図してから算出してください。
                    </td>
                  </tr>
                ) : summary === null ? (
                  <tr>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={8}>
                      「現在の図面から数量を算出」を押すと、図面の図形から数量を集計します。
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={8}>
                      算出対象の図形がありません（注記系のみ、または算出不能）。
                    </td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const selected = item.id === selectedItemId
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedItemId(item.id)}
                        style={{ cursor: 'pointer', background: selected ? 'var(--hover)' : undefined }}
                      >
                        <td style={tdStyle}>{item.workType ?? '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--muted)' }}>—</td>
                        <td style={tdStyle}>{item.specification ?? '—'}</td>
                        <td style={tdStyle}>{METHOD_LABELS[item.method]}</td>
                        <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right' }}>
                          {formatQuantity(item.rawValue)}
                        </td>
                        <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right', fontWeight: 600 }}>
                          {formatQuantity(item.roundedValue)}
                        </td>
                        <td style={tdStyle}>{UNIT_LABELS[item.unit]}</td>
                        <td style={{ ...tdStyle, ...monoStyle, textAlign: 'right' }}>
                          {item.sources.length}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 右カラム: 根拠図形 + 算出メッセージ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>根拠図形</div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedItem === null ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    明細行を選択すると、その数量の根拠図形が表示されます。
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>
                      根拠図形: {selectedItem.sources.length}件
                    </div>
                    <div
                      aria-label="根拠図形ID一覧"
                      style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflow: 'auto' }}
                    >
                      {selectedItem.sources.map((source) => (
                        <div key={source.geometryId} style={{ ...monoStyle, fontSize: 11.5, color: 'var(--ink2)' }}>
                          {source.geometryId.slice(0, 8)}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      根拠図形IDをCAD編集画面で照合できます。
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>CSV出力について</div>
              <div style={{ padding: 16, fontSize: 12, color: 'var(--ink2)', lineHeight: 1.6 }}>
                CSVは §24.2 の列順で出力します。数式起点（<code style={monoStyle}>= + - @</code> 等）の
                セルはインジェクション対策として無害化済みです。
              </div>
            </div>

            {summary !== null && (summary.issues.length > 0 || summary.skippedCount > 0) && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle}>算出メッセージ</div>
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}>
                  {summary.skippedCount > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      注記系など数量対象外の図形を {summary.skippedCount} 件スキップしました。
                    </div>
                  )}
                  {summary.issues.map((issue, i) => (
                    <div key={`${issue.code}-${i}`} style={{ fontSize: 12, color: '#8A5A12' }}>
                      ⚠️ {issue.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
