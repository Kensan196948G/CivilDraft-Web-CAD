/**
 * 測点・座標一覧画面（詳細設計仕様書 §12、要件 FR-SURV-005/008、SCR-005）。
 * 座標系設定・測点CSV取込（行エラーの全件提示）・測点一覧・CSV出力・図面配置を担う。
 *
 * データ結線の方針:
 * - CSV解析・出力・座標変換は domain/survey を正本とし、UI側で再実装しない
 *   （parseSurveyCsv / exportSurveyCsv / createCoordinateTransformer）。
 * - 取込結果の行エラー（issues）は §12.3 の思想どおり黙って捨てず、行番号付きで
 *   警告パネルに全件表示する。
 * - 図面配置は Command 経由（createAddGeometryCommand → dispatchCommand）で行い、
 *   Undo 可能な 1 操作の積み重ねとする（直接変更アクションは使わない）。
 * - 座標系設定はページローカル state（useState）。詳細な測地変換は §12.1 の初期方針どおり
 *   属性保持に留め、本番データ層接続時に測地変換を拡張する。
 *
 * スタイルは pageStyles.ts の共通トークンのみ再利用する（独自の色トークンは定義しない）。
 */
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  DEFAULT_SURVEY_CSV_MAPPING,
  createCoordinateTransformer,
  defaultCoordinateSystemSettings,
  exportSurveyCsv,
  parseSurveyCsv,
  validateCoordinateSystemSettings,
} from '@/domain/survey'
import { createAddGeometryCommand } from '@/domain/commands/geometryCommands'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'
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
  statusBadgeStyle,
  tdStyle,
  thStyle,
} from '@/app/pages/pageStyles'
import type {
  CoordinateSystemSettings,
  DrawingLayer,
  Geometry,
  Point,
  SurveyPoint,
  SymbolGeometry,
  TextGeometry,
  ValidationIssue,
} from '@/shared/types'

/** 動作確認用サンプルCSV（正しい列構成の3行。x=東・y=北、単位はm）。 */
const SAMPLE_CSV = [
  'pointNumber,x,y,elevation,note',
  'No.1,1000.000,500.000,12.34,起点',
  'No.2,1020.000,505.000,12.50,測点',
  'No.3,1040.500,498.250,12.61,終点',
].join('\n')

/** 測点記号の symbolId（測量ベンチマーク相当）と表記ラベルの寸法（内部基準 mm）。 */
const SURVEY_SYMBOL_ID = 'bm'
const LABEL_HEIGHT_MM = 250
const LABEL_OFFSET_MM = 300

export interface SurveyPointsPageProps {
  /** 図面配置で発番する図形ID・タイムスタンプの生成器（ADR-0013）。省略時は既定。 */
  readonly creationContext?: GeometryCreationContext
}

function inputStyle(width: number): CSSProperties {
  return {
    width,
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    borderRadius: 8,
    padding: '6px 9px',
    font: 'inherit',
    fontSize: 12.5,
  }
}

const fieldLabelStyle: CSSProperties = { fontSize: 11, color: 'var(--muted)', fontWeight: 600 }

/** 表示用の数値整形（内容を変えない素の文字列化）。 */
function fmt(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value)
}

/** アクティブレイヤー（無ければ先頭）を解決する。 */
function resolveLayer(layers: readonly DrawingLayer[], activeLayerId: string): DrawingLayer {
  return layers.find((l) => l.id === activeLayerId) ?? layers[0]!
}

export function SurveyPointsPage({ creationContext = defaultCreationContext }: SurveyPointsPageProps = {}) {
  const storeApi = useEditorStoreApi()
  const geometryCount = useEditorStore((s) => s.geometries.length)

  const [settings, setSettings] = useState<CoordinateSystemSettings>(defaultCoordinateSystemSettings)
  const [csvText, setCsvText] = useState('')
  const [points, setPoints] = useState<readonly SurveyPoint[]>([])
  const [issues, setIssues] = useState<readonly ValidationIssue[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [placeMessage, setPlaceMessage] = useState<string | null>(null)

  const errorCount = useMemo(() => issues.filter((i) => i.severity === 'error').length, [issues])
  const warningCount = useMemo(() => issues.filter((i) => i.severity === 'warning').length, [issues])

  const handleInsertSample = () => {
    setCsvText(SAMPLE_CSV)
    setPlaceMessage(null)
  }

  const handleImport = () => {
    setPlaceMessage(null)
    const result = parseSurveyCsv(csvText, { mapping: DEFAULT_SURVEY_CSV_MAPPING })
    if (!result.ok) {
      setImportError(result.error.message)
      setPoints([])
      setIssues([])
      return
    }
    setImportError(null)
    setPoints(result.value.points)
    setIssues(result.value.issues)
  }

  const handleExport = () => {
    if (points.length === 0) return
    const csv = exportSurveyCsv(points, DEFAULT_SURVEY_CSV_MAPPING)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'survey-points.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const dispatch = (geometry: Geometry): void => {
    storeApi.getState().dispatchCommand(createAddGeometryCommand(geometry, creationContext))
  }

  const handlePlace = () => {
    if (points.length === 0) return
    const validation = validateCoordinateSystemSettings(settings)
    if (!validation.ok) {
      setPlaceMessage(`⚠️ 座標系設定が不正です: ${validation.error.message}`)
      return
    }
    // 測量座標(m)→内部座標(mm)。写像は createCoordinateTransformer に集約（ADR-0012）。
    const transformer = createCoordinateTransformer(settings, 'm')
    const snapshot = storeApi.getState()
    const layer = resolveLayer(snapshot.layers, snapshot.activeLayerId)

    for (const point of points) {
      const position = transformer.surveyToInternal({ x: point.x, y: point.y })
      dispatch(makeSymbol(position, layer, creationContext))
      dispatch(makeText(labelAnchor(position), point.pointNumber, layer, creationContext))
    }
    setPlaceMessage(`✅ ${points.length}点を図面に配置しました（Undoで取消可能）`)
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>測点・座標一覧</div>
          <div style={pageSubtitleStyle}>座標系設定・CSV取込・測点管理</div>
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
            <div style={fieldLabelStyle}>取込済み測点</div>
            <div style={statValueStyle}>{points.length}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>CSVから取り込んだ件数</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>警告件数</div>
            <div style={{ ...statValueStyle, color: warningCount > 0 ? '#B5701A' : undefined }}>
              {warningCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>重複・インジェクション等</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>エラー行</div>
            <div style={{ ...statValueStyle, color: errorCount > 0 ? '#C5392F' : undefined }}>
              {errorCount}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>取込対象外の行</div>
          </div>
          <div style={statCardStyle}>
            <div style={fieldLabelStyle}>図面の総図形数</div>
            <div style={statValueStyle}>{geometryCount}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>配置で増加</div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.7fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* 左カラム: 座標系設定 + CSV取込 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>座標系設定</div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={fieldLabelStyle}>モード</span>
                  <select
                    aria-label="座標系モード"
                    value={settings.mode}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, mode: e.target.value as CoordinateSystemSettings['mode'] }))
                    }
                    style={inputStyle(180)}
                  >
                    <option value="local">ローカル座標</option>
                    <option value="jgd-attribute">平面直角座標系（属性）</option>
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={fieldLabelStyle}>系番号（1〜19）</span>
                  <input
                    aria-label="系番号"
                    type="number"
                    min={1}
                    max={19}
                    value={settings.planeRectangularZone ?? ''}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        planeRectangularZone: e.target.value === '' ? undefined : Number(e.target.value),
                      }))
                    }
                    style={inputStyle(90)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={fieldLabelStyle}>図面回転（度）</span>
                  <input
                    aria-label="図面回転"
                    type="number"
                    value={settings.rotationDeg}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, rotationDeg: Number(e.target.value) }))
                    }
                    style={inputStyle(90)}
                  />
                </label>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  初期版は座標系属性の保持のみ（§12.1）。測地変換の詳細は後続で拡張。
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>CSV取込</div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  aria-label="CSV貼り付け"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  placeholder={'測点番号,X,Y,標高,備考 の列で貼り付け'}
                  rows={6}
                  style={{ ...inputStyle(0), width: '100%', resize: 'vertical', ...monoStyle, fontSize: 12 }}
                />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={primaryButtonStyle} onClick={handleImport}>
                    取込
                  </button>
                  <button type="button" style={ghostButtonStyle} onClick={handleInsertSample}>
                    サンプルCSVを挿入
                  </button>
                </div>
                {importError !== null && (
                  <div
                    role="alert"
                    style={{
                      fontSize: 12,
                      color: '#C5392F',
                      background: '#FBE9E7',
                      border: '1px solid #F3C6C0',
                      borderRadius: 8,
                      padding: '8px 10px',
                    }}
                  >
                    ❌ 取込に失敗しました: {importError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右カラム: 測点一覧 + 警告 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {issues.length > 0 && (
              <div style={panelStyle}>
                <div style={panelHeaderStyle}>取込メッセージ（{issues.length}件）</div>
                <div
                  aria-label="取込メッセージ一覧"
                  style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto' }}
                >
                  {issues.map((issue, i) => (
                    <div
                      key={`${issue.code}-${i}`}
                      style={{
                        fontSize: 12,
                        color: issue.severity === 'error' ? '#C5392F' : '#8A5A12',
                        display: 'flex',
                        gap: 8,
                        alignItems: 'baseline',
                      }}
                    >
                      <span style={statusBadgeStyle(...severityBadge(issue.severity))}>
                        {issue.severity === 'error' ? 'エラー' : '警告'}
                      </span>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                  測点一覧
                </div>
                <button
                  type="button"
                  style={ghostButtonStyle}
                  onClick={handleExport}
                  disabled={points.length === 0}
                >
                  CSV出力
                </button>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={handlePlace}
                  disabled={points.length === 0}
                >
                  図面に配置
                </button>
              </div>
              {placeMessage !== null && (
                <div role="status" style={{ padding: '10px 18px', fontSize: 12, color: 'var(--ink2)' }}>
                  {placeMessage}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>測点名</th>
                    <th style={thStyle}>X（東）</th>
                    <th style={thStyle}>Y（北）</th>
                    <th style={thStyle}>標高</th>
                    <th style={thStyle}>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {points.length === 0 ? (
                    <tr>
                      <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={5}>
                        取込済みの測点はありません。CSVを貼り付けて「取込」してください。
                      </td>
                    </tr>
                  ) : (
                    points.map((p) => (
                      <tr key={p.id}>
                        <td style={{ ...tdStyle, fontWeight: 500 }}>{p.pointNumber}</td>
                        <td style={{ ...tdStyle, ...monoStyle }}>{fmt(p.x)}</td>
                        <td style={{ ...tdStyle, ...monoStyle }}>{fmt(p.y)}</td>
                        <td style={{ ...tdStyle, ...monoStyle }}>{fmt(p.elevation)}</td>
                        <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{p.note ?? ''}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

/** 重大度に対応するバッジ配色（[文字色, 背景色]）。 */
function severityBadge(severity: ValidationIssue['severity']): readonly [string, string] {
  return severity === 'error' ? ['#C5392F', '#FBE9E7'] : ['#8A5A12', '#FDEFE0']
}

/** ラベル文字の基準点（測点記号の右側へ少しずらす）。 */
function labelAnchor(position: Point): Point {
  return { x: position.x + LABEL_OFFSET_MM, y: position.y }
}

/** 測点記号（SymbolGeometry）を生成する。 */
function makeSymbol(position: Point, layer: DrawingLayer, ctx: GeometryCreationContext): SymbolGeometry {
  const timestamp = ctx.now()
  return {
    id: ctx.newId(),
    layerId: layer.id,
    type: 'symbol',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    symbolId: SURVEY_SYMBOL_ID,
    position,
    rotationDeg: 0,
    scale: 1,
  }
}

/** 測点名ラベル（TextGeometry）を生成する。 */
function makeText(anchor: Point, text: string, layer: DrawingLayer, ctx: GeometryCreationContext): TextGeometry {
  const timestamp = ctx.now()
  return {
    id: ctx.newId(),
    layerId: layer.id,
    type: 'text',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    anchor,
    text,
    height: LABEL_HEIGHT_MM,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}
