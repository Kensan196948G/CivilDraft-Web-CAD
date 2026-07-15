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
import { computeContribution } from '@/domain/quantities/quantityCalculator'
import { buildQuantityItem } from '@/domain/quantities/quantityItem'
import { applyRounding } from '@/domain/quantities/rounding'
import { exportQuantityCsv, type QuantityCsvContext } from '@/domain/quantities/quantityCsv'
import { useEditorStore, useEditorStoreApi } from '@/app/store/useEditorStore'
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
import type {
  Geometry,
  QuantityItem,
  QuantityItemId,
  QuantityMethod,
  QuantityUnit,
  RevisionId,
  RoundingRule,
  ValidationIssue,
} from '@/shared/types'

/** 数量表示の既定丸め規則（土木の一般的表示として小数2桁・四捨五入, §17.2）。 */
export const DEFAULT_ROUNDING_RULE: RoundingRule = { mode: 'halfUp', decimalPlaces: 2 }

/**
 * 現図面から算出する明細に付す改訂ID。確定改訂ではなく「現在の作業中図面」を指すため
 * プレースホルダとする（確定版の数量は別途 revisions ドメインが発番する）。
 */
const CURRENT_REVISION_ID = 'current' as RevisionId

/**
 * 案件レベルの列（§24.2）。案件管理が未結線のため空。結線後に親が供給する。
 * 空でも exportQuantityCsv の列順・インジェクション対策には影響しない。
 */
export const CSV_CONTEXT: QuantityCsvContext = {
  projectNumber: '',
  drawingNumber: '',
  revisionNumber: '',
}

/** 図形 type から推定した既定の算出区分と単位。 */
export interface QuantitySpec {
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
}

/**
 * 属性未付与図形の既定算出区分を図形 type から推定する（設計判断）。
 * 注記系（text/dimension/leader）は数量対象外として null を返す。
 * 閉じたポリラインは面積、開いたポリライン・線・円弧・スプラインは延長、
 * 円・矩形・楕円・ハッチは面積、記号・パラメトリックは個数とする。
 */
export function deriveDefaultQuantitySpec(geometry: Geometry): QuantitySpec | null {
  switch (geometry.type) {
    case 'line':
    case 'arc':
    case 'spline':
      return { method: 'length', unit: 'm' }
    case 'polyline':
      return geometry.closed ? { method: 'area', unit: 'm2' } : { method: 'length', unit: 'm' }
    case 'circle':
    case 'rectangle':
    case 'ellipse':
    case 'hatch':
      return { method: 'area', unit: 'm2' }
    case 'symbol':
    case 'parametricObject':
      return { method: 'count', unit: 'count' }
    case 'text':
    case 'dimension':
    case 'leader':
      return null
    default: {
      const exhaustive: never = geometry
      throw new Error(`未知の図形種別: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 算出結果。items は算出区分×単位でまとめた明細、issues は算出不能図形の理由。 */
export interface QuantitySummary {
  readonly items: readonly QuantityItem[]
  readonly issues: readonly ValidationIssue[]
  /** 数量対象外（注記系）としてスキップした図形数。 */
  readonly skippedCount: number
}

interface SpecGroup {
  readonly method: QuantityMethod
  readonly unit: QuantityUnit
  readonly geometries: Geometry[]
}

/**
 * 現図面の geometries から数量明細を算出する（§17.2 算出 / §17.3 sum-then-round）。
 * 各図形の既定算出区分を推定し、算出区分×単位で束ねて 1 明細に合算する。
 * 個々に算出不能な図形（退化ポリゴン等）は明細から除外し issues に理由を残す
 *（黙って捨てない。§17.3 未確定の非握り潰し方針）。
 */
export function computeQuantitySummary(geometries: readonly Geometry[]): QuantitySummary {
  const issues: ValidationIssue[] = []
  let skippedCount = 0
  const order: string[] = []
  const groups = new Map<string, SpecGroup>()

  for (const geometry of geometries) {
    const spec = deriveDefaultQuantitySpec(geometry)
    if (spec === null) {
      skippedCount += 1
      continue
    }
    // 束ねる前に個別算出可否を確認し、不能図形はグループから除外して理由を残す。
    const contribution = computeContribution(geometry, spec.method, spec.unit)
    if (!contribution.ok) {
      issues.push(contribution.error)
      continue
    }
    const key = `${spec.method}|${spec.unit}`
    const existing = groups.get(key)
    if (existing === undefined) {
      order.push(key)
      groups.set(key, { method: spec.method, unit: spec.unit, geometries: [geometry] })
    } else {
      existing.geometries.push(geometry)
    }
  }

  const items: QuantityItem[] = []
  for (const key of order) {
    const group = groups.get(key)!
    const result = buildQuantityItem({
      id: `qty-${key}` as QuantityItemId,
      revisionId: CURRENT_REVISION_ID,
      groupKey: key,
      method: group.method,
      unit: group.unit,
      roundingRule: DEFAULT_ROUNDING_RULE,
      geometries: group.geometries,
    })
    if (result.ok) items.push(result.value)
    else issues.push(...result.error)
  }

  return { items, issues, skippedCount }
}

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

/** 数値の表示整形（内容は変えない素の文字列化）。丸め前値・表示値の双方に用いる。 */
export function formatQuantity(value: number): string {
  return Number.isFinite(value) ? String(value) : '—'
}

/** 単位別に表示値（roundedValue）を合計し、既定規則で再度丸めて浮動小数誤差を抑える。 */
function totalRoundedByUnit(items: readonly QuantityItem[], unit: QuantityUnit): number {
  const sum = items
    .filter((item) => item.unit === unit)
    .reduce((acc, item) => acc + item.roundedValue, 0)
  return applyRounding(sum, DEFAULT_ROUNDING_RULE)
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
                    {/* TODO: CAD画面での該当図形ハイライトは Canvas 連携（後続タスク）で実装する。 */}
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      ※ CAD画面での図形強調は今後対応（TBD）。
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
