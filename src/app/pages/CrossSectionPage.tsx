/**
 * 縦横断管理画面（詳細設計仕様書 §16 土工・断面）。
 * 測点別の横断面を一覧し、切土・盛土面積（§16.2）と 2 断面間の簡易土量（§16.3 平均断面法）を可視化する。
 *
 * 正本: pageStyles.ts の共通スタイル + HomePage.tsx / ConstructionStepsPage.tsx の構造
 * （サイドバー付きページのヘッダー/メイン、統計カード、パネル、テーブル）。デザイントークンは home.css。
 *
 * データ結線の方針:
 * - 面積・土量はドメイン層（@/domain/sections）に委ね、UI 側で幾何計算を再実装しない。
 *   面積: computeSectionAreas / 土量: computeEarthworkVolume（平均断面法）。
 * - 断面データは本番案件データ層への接続前のため、本画面ローカルの useState で保持する。
 *   既定は空（空状態を表示）で、「サンプル断面を読み込む」操作でデモ断面 SAMPLE_SECTIONS を投入する。
 *   将来のデータ層結線に備え、initialSections prop で初期断面を注入できる（親は通常未指定）。
 *
 * 単位: ドメインは内部座標 mm で計算する（ADR-0012）。本画面は表示境界で
 * 面積 mm²→m²、体積 mm³→m³、長さ mm→m へ変換して単位を明示する（m² / m³ / m）。
 * 未確定（§16.2 の面積未確定条件）は握り潰さず、warning バッジと理由メッセージで提示する。
 */
/*
 * eslint-disable-next-line は使わず、ファイル単位で react-refresh/only-export-components を無効化する。
 * 理由: 断面サンプルデータ（SAMPLE_SECTIONS）と単位フォーマッタをテスト/将来のデータ層向けに
 * 本コンポーネントと同一モジュールで公開するため（担当が本ページ 1 ファイルに限定される制約下での暫定）。
 * これらは HMR の粒度にのみ影響し、実行時の正しさには無関係。
 */
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  computeEarthworkVolume,
  computeSectionAreas,
  elevationAt,
  type Section,
  type SectionPoint,
} from '@/domain/sections'
import { isDemoMode } from '@/app/mode'
import type { SurveyPointId } from '@/shared/types'
import {
  createCivilDraftApiClient,
  type CivilDraftApiClient,
  type CloudSection,
} from '@/infrastructure/cloud/civilDraftApiClient'
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
  statusBadgeStyle,
  tdStyle,
  thStyle,
} from './pageStyles'

export interface CrossSectionPageProps {
  /** 初期断面（省略時は空 → 空状態）。将来のデータ層結線・テスト用の注入口。 */
  readonly initialSections?: readonly Section[]
  /** 本番モードでは false を渡すとサンプル断面の読込ボタンを表示しない（?demo=1 時は表示）。 */
  readonly enableSampleData?: boolean
  /** 実案件の改訂 ID。設定時は断面データ API（GET/PUT /sections）と連携する。 */
  readonly revisionId?: string
  /** テスト用の API クライアント注入（省略時は既定クライアント）。 */
  readonly apiClient?: CivilDraftApiClient
}

const MM2_PER_M2 = 1_000_000
const MM3_PER_M3 = 1_000_000_000
const MM_PER_M = 1_000

/** mm² を m² 表示文字列へ（小数 2 桁）。 */
export function formatSquareMeters(mm2: number): string {
  return (mm2 / MM2_PER_M2).toFixed(2)
}

/** mm³ を m³ 表示文字列へ（小数 2 桁）。 */
export function formatCubicMeters(mm3: number): string {
  return (mm3 / MM3_PER_M3).toFixed(2)
}

/** mm を m 表示文字列へ（小数 3 桁）。 */
export function formatMeters(mm: number): string {
  return (mm / MM_PER_M).toFixed(3)
}

/** 測点ラベル（station[mm] → No.表記）。デモは 1000mm=1m 刻みの整数測点。 */
export function stationLabel(station: number): string {
  return `No.${station / MM_PER_M}`
}

const sp = (id: string): SurveyPointId => id as SurveyPointId
const point = ([offset, elevation]: readonly [number, number]): SectionPoint => ({ offset, elevation })
const profile = (rows: readonly (readonly [number, number])[]): SectionPoint[] => rows.map(point)

/**
 * デモ断面（No.0 / No.20 / No.40 / No.60 / No.80、幅 10m）。本番案件データ層接続前のサンプル。
 * No.0: 全切土（現況が計画より 1m 高い）/ No.20: 左切土・右盛土の遷移 / No.40: 全盛土（計画が 0.8m 高い）。
 * 座標は mm（offset 左負右正・elevation 上正、§16.2 の規約）。
 */
export const SAMPLE_SECTIONS: readonly Section[] = [
  {
    id: 'section-no0',
    surveyPointId: sp('sp-no0'),
    station: 0,
    existingGround: profile([
      [-5000, 1000],
      [0, 1000],
      [5000, 1000],
    ]),
    plannedGround: profile([
      [-5000, 0],
      [0, 0],
      [5000, 0],
    ]),
  },
  {
    id: 'section-no20',
    surveyPointId: sp('sp-no20'),
    station: 20000,
    existingGround: profile([
      [-5000, 0],
      [0, 0],
      [5000, 0],
    ]),
    plannedGround: profile([
      [-5000, -1000],
      [0, 0],
      [5000, 1000],
    ]),
  },
  {
    id: 'section-no40',
    surveyPointId: sp('sp-no40'),
    station: 40000,
    existingGround: profile([
      [-5000, 0],
      [0, 0],
      [5000, 0],
    ]),
    plannedGround: profile([
      [-5000, 800],
      [0, 800],
      [5000, 800],
    ]),
  },
  {
    id: 'section-no60',
    surveyPointId: sp('sp-no60'),
    station: 60000,
    existingGround: profile([
      [-5000, 500],
      [0, 0],
      [5000, -500],
    ]),
    plannedGround: profile([
      [-5000, 0],
      [0, 0],
      [5000, 0],
    ]),
  },
  {
    id: 'section-no80',
    surveyPointId: sp('sp-no80'),
    station: 80000,
    existingGround: profile([
      [-5000, 1200],
      [0, 600],
      [5000, 1200],
    ]),
    plannedGround: profile([
      [-5000, 300],
      [0, 300],
      [5000, 300],
    ]),
  },
]

/** 断面線上の指定 offset の標高を返す（範囲外は null）。exact 一致を優先し、内挿は elevationAt に委ねる。 */
function lookupElevation(points: readonly SectionPoint[], offset: number): number | null {
  const exact = points.find((p) => p.offset === offset)
  if (exact !== undefined) return exact.elevation
  const offsets = points.map((p) => p.offset)
  if (offsets.length === 0) return null
  if (offset < Math.min(...offsets) || offset > Math.max(...offsets)) return null
  return elevationAt(points, offset)
}

/** 断面詳細（点列）の 1 行: offset・現況高・計画高（いずれも range 外は null）。 */
interface DetailRow {
  readonly offset: number
  readonly existing: number | null
  readonly planned: number | null
}

function buildDetailRows(section: Section): readonly DetailRow[] {
  const offsets = [
    ...new Set([
      ...section.existingGround.map((p) => p.offset),
      ...section.plannedGround.map((p) => p.offset),
    ]),
  ].sort((a, b) => a - b)
  return offsets.map((offset) => ({
    offset,
    existing: lookupElevation(section.existingGround, offset),
    planned: lookupElevation(section.plannedGround, offset),
  }))
}

/** 2 断面間で土量が算出できなかったペアの記録（握り潰さず提示する）。 */
interface UndeterminedPair {
  readonly fromLabel: string
  readonly toLabel: string
  readonly messages: readonly string[]
}

interface VolumeSummary {
  readonly cutVolumeMm3: number
  readonly fillVolumeMm3: number
  readonly netMm3: number
  readonly simplifiedNote: string | null
  readonly undetermined: readonly UndeterminedPair[]
  readonly pairCount: number
}

/** 連続断面ペアの簡易土量（平均断面法）を集計する。未確定ペアは記録して除外する。 */
function summarizeVolume(sections: readonly Section[]): VolumeSummary {
  let cut = 0
  let fill = 0
  let simplifiedNote: string | null = null
  const undetermined: UndeterminedPair[] = []
  let pairCount = 0

  for (let i = 0; i < sections.length - 1; i++) {
    const from = sections[i]!
    const to = sections[i + 1]!
    pairCount += 1
    const result = computeEarthworkVolume(from, to)
    if (result.ok) {
      cut += result.value.cut.volume
      fill += result.value.fill.volume
      if (simplifiedNote === null) {
        simplifiedNote =
          result.value.warnings.find((w) => w.code === 'EARTHWORK_SIMPLIFIED_METHOD')?.message ??
          null
      }
    } else {
      undetermined.push({
        fromLabel: stationLabel(from.station),
        toLabel: stationLabel(to.station),
        messages: result.error.map((e) => e.message),
      })
    }
  }

  return { cutVolumeMm3: cut, fillVolumeMm3: fill, netMm3: cut - fill, simplifiedNote, undetermined, pairCount }
}

const cardLabelStyle: CSSProperties = { fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }
const unitStyle: CSSProperties = { fontSize: 13, color: 'var(--muted)', fontWeight: 500, marginLeft: 4 }
const cardSubStyle: CSSProperties = { fontSize: 11, color: 'var(--muted)' }
const WARN_BADGE = { color: '#C5392F', bg: '#FBE9E7' } as const
const INFO_BADGE = { color: '#B5701A', bg: '#FDEFE0' } as const

export function CrossSectionPage({
  initialSections,
  enableSampleData = true,
  revisionId,
  apiClient: apiClientProp,
}: CrossSectionPageProps = {}) {
  const [sections, setSections] = useState<readonly Section[]>(initialSections ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sectionVersion, setSectionVersion] = useState<number | undefined>(undefined)
  const [cloudStatus, setCloudStatus] = useState<string | null>(null)
  const [cloudSaving, setCloudSaving] = useState(false)
  const showSampleData = enableSampleData || isDemoMode()

  const apiClient = useMemo(() => apiClientProp ?? createCivilDraftApiClient(), [apiClientProp])

  // 実案件の改訂に紐づく断面データを API から読み込む（断面データ API）。
  useEffect(() => {
    if (revisionId === undefined) return
    let cancelled = false
    void apiClient
      .getRevisionSections(revisionId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setCloudStatus(`断面データの読み込み失敗: ${result.error.message}`)
          return
        }
        setSections(result.value.sections as readonly Section[])
        setSectionVersion(result.value.sectionVersion)
        setSelectedId(null)
        setCloudStatus(
          result.value.sections.length === 0
            ? '断面データは未登録です（空状態）'
            : `断面データを読み込みました（${result.value.sections.length} 測点）`,
        )
      })
      .catch((error: unknown) => {
        if (!cancelled) setCloudStatus(`断面データの読み込み失敗: ${String(error)}`)
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, revisionId])

  const handleSaveSections = async () => {
    if (revisionId === undefined) {
      setCloudStatus('保存するには実案件の改訂を選択してください')
      return
    }
    setCloudSaving(true)
    setCloudStatus('断面データを保存中...')
    try {
      const result = await apiClient.putRevisionSections(
        revisionId,
        sections as readonly CloudSection[],
        sectionVersion,
      )
      if (!result.ok) {
        setCloudStatus(
          result.error.apiErrorCode === 'CD-CONFLICT-001'
            ? '保存失敗: サーバ上の断面データが更新されています。再読み込みしてください'
            : `保存失敗: ${result.error.message}`,
        )
        return
      }
      setSectionVersion(result.value.sectionVersion)
      setCloudStatus(`断面データを保存しました（v${result.value.sectionVersion}・${result.value.sections.length} 測点）`)
    } catch (error) {
      setCloudStatus(`保存失敗: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setCloudSaving(false)
    }
  }

  const areaRows = useMemo(
    () => sections.map((section) => ({ section, areas: computeSectionAreas(section) })),
    [sections],
  )
  const volume = useMemo(() => summarizeVolume(sections), [sections])

  const selected = selectedId === null ? undefined : sections.find((s) => s.id === selectedId)
  const detailRows = useMemo(
    () => (selected === undefined ? [] : buildDetailRows(selected)),
    [selected],
  )

  const loadSample = () => {
    setSections(SAMPLE_SECTIONS)
    setSelectedId(null)
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div style={{ flex: 1 }}>
          <div style={pageTitleStyle}>縦横断管理</div>
          <div style={pageSubtitleStyle}>測点別断面・切盛面積・簡易土量</div>
        </div>
        {revisionId !== undefined && (
          <button
            type="button"
            style={ghostButtonStyle}
            disabled={cloudSaving}
            onClick={() => void handleSaveSections()}
          >
            {cloudSaving ? '保存中...' : '断面を共有保存'}
          </button>
        )}
        {cloudStatus !== null && (
          <span style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 320 }}>{cloudStatus}</span>
        )}
      </header>

      <main style={pageMainStyle}>
        {sections.length === 0 ? (
          <div style={{ ...panelStyle, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
              断面データがありません
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
              測点別の横断面（現況線・計画線）を読み込むと、切土・盛土面積と簡易土量を集計します。
              {showSampleData
                ? '案件データ層へ接続する前に、サンプル断面で機能を確認できます。'
                : '実断面データのAPI連携は未実装です（空状態で表示します）。'}
            </div>
            {showSampleData && (
              <div>
                <button type="button" style={primaryButtonStyle} onClick={loadSample}>
                  サンプル断面を読み込む
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 土量サマリーカード（平均断面法・§16.3） */}
            <section aria-label="土量サマリー" style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                  gap: 14,
                }}
              >
                <div style={statCardStyle}>
                  <div style={cardLabelStyle}>切土量</div>
                  <div>
                    <span style={statValueStyle}>{formatCubicMeters(volume.cutVolumeMm3)}</span>
                    <span style={unitStyle}>m³</span>
                  </div>
                  <div style={cardSubStyle}>平均断面法（簡易計算）</div>
                </div>
                <div style={statCardStyle}>
                  <div style={cardLabelStyle}>盛土量</div>
                  <div>
                    <span style={statValueStyle}>{formatCubicMeters(volume.fillVolumeMm3)}</span>
                    <span style={unitStyle}>m³</span>
                  </div>
                  <div style={cardSubStyle}>平均断面法（簡易計算）</div>
                </div>
                <div style={statCardStyle}>
                  <div style={cardLabelStyle}>差引</div>
                  <div>
                    <span
                      style={{
                        ...statValueStyle,
                        color: volume.netMm3 >= 0 ? '#1F8255' : '#C5392F',
                      }}
                    >
                      {formatCubicMeters(volume.netMm3)}
                    </span>
                    <span style={unitStyle}>m³</span>
                  </div>
                  <div style={cardSubStyle}>{volume.netMm3 >= 0 ? '切土超過' : '盛土超過'}</div>
                </div>
              </div>

              {volume.simplifiedNote !== null && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={statusBadgeStyle(INFO_BADGE.color, INFO_BADGE.bg)}>簡易計算</span>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>{volume.simplifiedNote}</span>
                </div>
              )}
              {volume.undetermined.map((pair) => (
                <div
                  key={`${pair.fromLabel}-${pair.toLabel}`}
                  style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <span style={statusBadgeStyle(WARN_BADGE.color, WARN_BADGE.bg)}>土量未確定</span>
                  <span style={{ fontSize: 12, color: 'var(--ink2)' }}>
                    {pair.fromLabel}〜{pair.toLabel}: {pair.messages.join(' / ')}
                  </span>
                </div>
              ))}
            </section>

            {/* 断面一覧テーブル（切盛面積・§16.2） */}
            <div style={{ ...panelStyle, marginBottom: 16 }}>
              <div style={panelHeaderStyle}>断面一覧</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>測点</th>
                    <th style={thStyle}>切土面積</th>
                    <th style={thStyle}>盛土面積</th>
                    <th style={thStyle}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {areaRows.map(({ section, areas }) => {
                    const isSelected = section.id === selectedId
                    return (
                      <tr key={section.id} style={isSelected ? { background: 'var(--hover)' } : undefined}>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setSelectedId(section.id)}
                            style={{
                              cursor: 'pointer',
                              border: 'none',
                              background: 'none',
                              padding: 0,
                              font: 'inherit',
                              fontWeight: 600,
                              color: 'var(--ink)',
                              textDecoration: 'underline',
                            }}
                          >
                            {stationLabel(section.station)}
                          </button>
                        </td>
                        {areas.ok ? (
                          <>
                            <td style={{ ...tdStyle, ...monoStyle }}>
                              {formatSquareMeters(areas.value.cutArea)} m²
                            </td>
                            <td style={{ ...tdStyle, ...monoStyle }}>
                              {formatSquareMeters(areas.value.fillArea)} m²
                            </td>
                            <td style={tdStyle}>
                              <span style={statusBadgeStyle('#1F8255', '#E4F3EC')}>算出済</span>
                            </td>
                          </>
                        ) : (
                          <td style={{ ...tdStyle, color: 'var(--ink2)' }} colSpan={3}>
                            <span style={statusBadgeStyle(WARN_BADGE.color, WARN_BADGE.bg)}>
                              面積未確定
                            </span>
                            <span style={{ marginLeft: 8, fontSize: 11.5 }}>
                              {areas.error.map((e) => e.message).join(' / ')}
                            </span>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* 選択断面の詳細（点列・§16.2） */}
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>
                断面詳細
                {selected !== undefined && (
                  <span style={{ marginLeft: 8, fontWeight: 500, color: 'var(--muted)', fontSize: 12.5 }}>
                    {stationLabel(selected.station)}
                  </span>
                )}
              </div>
              {selected === undefined ? (
                <div style={{ padding: 18, fontSize: 12.5, color: 'var(--muted)' }}>
                  測点を選択すると、現況線・計画線の点列（offset / 現況高 / 計画高）を表示します。
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>offset (m)</th>
                      <th style={thStyle}>現況高 (m)</th>
                      <th style={thStyle}>計画高 (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => (
                      <tr key={row.offset}>
                        <td style={{ ...tdStyle, ...monoStyle }}>{formatMeters(row.offset)}</td>
                        <td style={{ ...tdStyle, ...monoStyle }}>
                          {row.existing === null ? '—' : formatMeters(row.existing)}
                        </td>
                        <td style={{ ...tdStyle, ...monoStyle }}>
                          {row.planned === null ? '—' : formatMeters(row.planned)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
