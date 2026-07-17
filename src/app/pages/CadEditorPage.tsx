/**
 * CAD編集画面。
 * 正本: Claude Design「CivilDraft Web CAD」CAD Editor.dc.html（100%適用）。
 * ヘッダー（自動保存状態・Undo/Redo・施工ステップ絞込・出力導線）/ 左パネル（ツール・
 * 土木部材・レイヤー）/ キャンバス / 右パネル（選択図形プロパティ）の4ブロック構成。
 * ツール切替・グリッド表示・施工ステップ絞込・自動保存はEditorStoreへ実結線。
 * プロパティパネルの編集はdispatchCommand(createUpdateGeometryCommand)経由でUndo/Redo
 * 可能な1操作として記録する。
 *
 * デザインが示す「スナップ状態」「未確定数量バッジ」「業務属性の詳細（工種/規格/工区/
 * 測点）」「更新履歴の変更者・変更内容」は、対応する実データ・実装が現時点で存在しない
 * ため、正直に不掲載または「未設定」表示とする（捏造しない）。
 * DXF取込のUI導線は本画面に対応する置き場所がなく、別Issueで扱う。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { CanvasStage } from '../canvas/CanvasStage'
import type { AppView } from '../layout/Sidebar'
import { createDefaultLayer } from '../store/editorStore'
import { useEditorStore, useEditorStoreApi } from '../store/useEditorStore'
import { getCategories, SYMBOL_CATALOG } from '@/domain/catalog/symbolCatalog'
import { createUpdateGeometryCommand } from '@/domain/commands/geometryCommands'
import { DEFAULT_CONSTRUCTION_STEPS } from '@/domain/construction-steps'
import type { ToolType } from '@/domain/tools/draftGeometry'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import {
  createCivilDraftApiClient,
  type CloudContent,
  type CloudSaveDraftInput,
  type CloudSaveDraftResult,
} from '@/infrastructure/cloud/civilDraftApiClient'
import type { Result, ValidationIssue } from '@/shared/types'
import type { DrawingLayer, Geometry, GeometryStyle, GeometryType, LayerId } from '@/shared/types'
import { ghostButtonStyle, monoStyle, pageRootStyle, primaryButtonStyle, statusBadgeStyle } from './pageStyles'

export interface CadEditorPageProps {
  /** HomePage/DrawingComparePageと共有する自動保存ストア（復旧候補の一貫性のため同一インスタンス）。 */
  readonly autosaveStore: AutosaveStore
  readonly onNavigate: (view: AppView) => void
  /** Workers APIクライアント。テストでは実Workerハンドラやモックを注入する。 */
  readonly cloudApiClient?: CloudSaveClient
  /** 共有保存へ渡す案件・図面コンテキスト。ProjectDetailPage等の実画面導線から注入する。 */
  readonly cloudDraftSession?: CloudDraftSession
}

export interface CloudSaveClient {
  saveDraft(input: CloudSaveDraftInput): Promise<Result<CloudSaveDraftResult, ValidationIssue>>
  getRevisionContent(revisionId: string): Promise<Result<CloudContent, ValidationIssue>>
}

export interface CloudDraftSession {
  readonly projectNumber: string
  readonly projectName: string
  readonly clientName?: string
  readonly drawingNumber: string
  readonly drawingName: string
  readonly drawingType?: string
  readonly revisionNumber: string
  readonly changeSummary?: string
}

export const DEFAULT_CLOUD_DRAFT_SESSION: CloudDraftSession = {
  projectNumber: 'P-245-ROAD-WIDENING',
  projectName: '国道245号 道路拡幅工事',
  clientName: 'Mirai建設',
  drawingNumber: 'DWG-014',
  drawingName: '施工ヤード計画図',
  drawingType: 'temporary-yard-plan',
  revisionNumber: 'Rev.3',
  changeSummary: 'CAD編集画面から共有保存',
}

const GEOMETRY_TYPE_LABELS: Record<GeometryType, string> = {
  line: '線分',
  rectangle: '矩形',
  circle: '円',
  arc: '円弧',
  ellipse: '楕円',
  polyline: 'ポリライン',
  spline: 'スプライン',
  text: '文字',
  dimension: '寸法',
  leader: '引き出し線',
  hatch: 'ハッチング',
  symbol: '部材記号',
  parametricObject: 'パラメトリック',
}

const LINE_TYPE_LABELS: Record<GeometryStyle['lineType'], string> = {
  continuous: '実線',
  dashed: '破線',
  dashDot: '一点鎖線',
  double: '二重線',
}

const FIELD_LABELS: Record<string, string> = {
  start: '始点',
  end: '終点',
  center: '中心',
  radius: '半径',
  startAngleDeg: '開始角(°)',
  endAngleDeg: '終了角(°)',
  origin: '原点',
  width: '幅',
  height: '高さ',
  rotationDeg: '回転角(°)',
  radiusX: '半径X',
  radiusY: '半径Y',
  points: '頂点',
  closed: '閉合',
  tension: 'テンション',
  orientation: '方向',
  offset: 'オフセット',
  textHeight: '文字高さ',
  arrowSize: '矢印サイズ',
  text: '内容',
  boundaryPoints: '境界点',
  pattern: 'パターン',
  angleDeg: '角度(°)',
  spacing: '間隔',
  symbolId: '部材ID',
  position: '位置',
  scale: '倍率',
  definitionId: '定義ID',
  definitionVersion: 'バージョン',
  parameters: 'パラメータ',
  generatedGeometryIds: '生成図形',
  anchor: '位置',
  horizontalAlign: '配置',
}

const GEOMETRY_BASE_KEYS = new Set([
  'id',
  'layerId',
  'type',
  'style',
  'civilAttributeId',
  'constructionStepIds',
  'locked',
  'createdAt',
  'updatedAt',
])

const REAL_TOOLS: readonly { readonly tool: ToolType; readonly icon: string; readonly label: string }[] = [
  { tool: 'select', icon: '↖', label: '選択' },
  { tool: 'line', icon: '╱', label: '線分' },
  { tool: 'rectangle', icon: '▭', label: '矩形' },
  { tool: 'circle', icon: '○', label: '円' },
  { tool: 'polyline', icon: '⌇', label: 'ポリライン' },
]

const UNAVAILABLE_TOOLS: readonly { readonly icon: string; readonly label: string }[] = [
  { icon: 'A', label: '文字（未実装）' },
  { icon: '⟺', label: '寸法（未実装）' },
  { icon: '⧉', label: 'ハッチング（未実装）' },
]

const commaFmt = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/** activeLayerId に対応するレイヤーを解決する（見つからなければ先頭、無ければ既定レイヤー）。 */
function resolveActiveLayer(layers: readonly DrawingLayer[], activeLayerId: LayerId): DrawingLayer {
  return layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? createDefaultLayer()
}

function withUpdatedAt<T extends Geometry>(geometry: T, patch: Partial<T>): T {
  return { ...geometry, ...patch, updatedAt: new Date().toISOString() }
}

function formatFieldValue(value: unknown): string {
  if (value === undefined) return '未設定'
  if (typeof value === 'number') return value.toFixed(3)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `${value.length}件`
  if (value !== null && typeof value === 'object' && 'x' in value && 'y' in value) {
    const p = value as { x: number; y: number }
    return `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`
  }
  return String(value)
}

const sectionLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--side-label)',
  letterSpacing: 0.4,
  marginBottom: 8,
}

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12.5,
  color: 'var(--ink2)',
  marginBottom: 6,
}

const fieldLabelStyle: CSSProperties = { color: 'var(--muted)' }

const fieldInputStyle: CSSProperties = {
  width: 112,
  padding: '4px 8px',
  border: '1px solid var(--line)',
  borderRadius: 6,
  background: 'var(--subtle2)',
  color: 'var(--ink)',
  fontSize: 12.5,
  font: 'inherit',
  textAlign: 'right',
}

/** 数値入力欄。keyにgeometry.id+フィールド値を含めることで、選択切替・Undo/Redoによる外部変更時に defaultValue を再適用する（非制御コンポーネントの取りこぼしを防ぐ）。 */
function NumInput({
  value,
  onCommit,
  precision = 3,
}: {
  readonly value: number
  readonly onCommit: (next: number) => void
  readonly precision?: number
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      defaultValue={value.toFixed(precision)}
      style={fieldInputStyle}
      onBlur={(e) => {
        const next = Number(e.target.value)
        if (Number.isFinite(next) && next !== value) onCommit(next)
      }}
    />
  )
}

/** 選択図形の「幾何」フィールド。実データが存在するline/circle/rectangle/textのみ編集可能、他9種は実フィールドの読み取り専用表示とする。 */
function GeometryFields({
  geometry,
  onCommit,
}: {
  readonly geometry: Geometry
  readonly onCommit: (next: Geometry) => void
}) {
  switch (geometry.type) {
    case 'line': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 X</span>
            <NumInput key={`${g.id}:sx:${g.start.x}`} value={g.start.x} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>始点 Y</span>
            <NumInput key={`${g.id}:sy:${g.start.y}`} value={g.start.y} onCommit={(v) => onCommit(withUpdatedAt(g, { start: { ...g.start, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 X</span>
            <NumInput key={`${g.id}:ex:${g.end.x}`} value={g.end.x} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>終点 Y</span>
            <NumInput key={`${g.id}:ey:${g.end.y}`} value={g.end.y} onCommit={(v) => onCommit(withUpdatedAt(g, { end: { ...g.end, y: v } }))} />
          </div>
        </>
      )
    }
    case 'circle': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>中心 X</span>
            <NumInput key={`${g.id}:cx:${g.center.x}`} value={g.center.x} onCommit={(v) => onCommit(withUpdatedAt(g, { center: { ...g.center, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>中心 Y</span>
            <NumInput key={`${g.id}:cy:${g.center.y}`} value={g.center.y} onCommit={(v) => onCommit(withUpdatedAt(g, { center: { ...g.center, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>半径</span>
            <NumInput key={`${g.id}:r:${g.radius}`} value={g.radius} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { radius: v }))} />
          </div>
        </>
      )
    }
    case 'rectangle': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>原点 X</span>
            <NumInput key={`${g.id}:ox:${g.origin.x}`} value={g.origin.x} onCommit={(v) => onCommit(withUpdatedAt(g, { origin: { ...g.origin, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>原点 Y</span>
            <NumInput key={`${g.id}:oy:${g.origin.y}`} value={g.origin.y} onCommit={(v) => onCommit(withUpdatedAt(g, { origin: { ...g.origin, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>幅</span>
            <NumInput key={`${g.id}:w:${g.width}`} value={g.width} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { width: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>高さ</span>
            <NumInput key={`${g.id}:h:${g.height}`} value={g.height} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { height: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>回転角(°)</span>
            <NumInput key={`${g.id}:rot:${g.rotationDeg}`} value={g.rotationDeg} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { rotationDeg: v }))} />
          </div>
        </>
      )
    }
    case 'text': {
      const g = geometry
      return (
        <>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>位置 X</span>
            <NumInput key={`${g.id}:ax:${g.anchor.x}`} value={g.anchor.x} onCommit={(v) => onCommit(withUpdatedAt(g, { anchor: { ...g.anchor, x: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>位置 Y</span>
            <NumInput key={`${g.id}:ay:${g.anchor.y}`} value={g.anchor.y} onCommit={(v) => onCommit(withUpdatedAt(g, { anchor: { ...g.anchor, y: v } }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>内容</span>
            <input
              key={`${g.id}:text:${g.text}`}
              type="text"
              defaultValue={g.text}
              style={fieldInputStyle}
              onBlur={(e) => {
                if (e.target.value !== g.text) onCommit(withUpdatedAt(g, { text: e.target.value }))
              }}
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>文字高さ</span>
            <NumInput key={`${g.id}:height:${g.height}`} value={g.height} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { height: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>回転角(°)</span>
            <NumInput key={`${g.id}:rot:${g.rotationDeg}`} value={g.rotationDeg} precision={1} onCommit={(v) => onCommit(withUpdatedAt(g, { rotationDeg: v }))} />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>配置</span>
            <select
              value={g.horizontalAlign}
              style={fieldInputStyle}
              onChange={(e) => onCommit(withUpdatedAt(g, { horizontalAlign: e.target.value as typeof g.horizontalAlign }))}
            >
              <option value="left">左寄せ</option>
              <option value="center">中央</option>
              <option value="right">右寄せ</option>
            </select>
          </div>
        </>
      )
    }
    default: {
      const entries = Object.entries(geometry).filter(([key]) => !GEOMETRY_BASE_KEYS.has(key))
      return (
        <>
          {entries.map(([key, value]) => (
            <div key={key} style={fieldRowStyle}>
              <span style={fieldLabelStyle}>{FIELD_LABELS[key] ?? key}</span>
              <span style={monoStyle}>{formatFieldValue(value)}</span>
            </div>
          ))}
        </>
      )
    }
  }
}

const headerBarStyle: CSSProperties = {
  height: 56,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '0 18px',
  background: 'var(--surface)',
  borderBottom: '1px solid var(--line)',
}

const bodyRowStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex' }

const toolPanelStyle: CSSProperties = {
  width: 212,
  flexShrink: 0,
  borderRight: '1px solid var(--line)',
  background: 'var(--surface)',
  overflow: 'auto',
  padding: '16px 14px',
}

const canvasColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--canvas-wrap)',
  position: 'relative',
}

const canvasInnerStyle: CSSProperties = { flex: 1, overflow: 'hidden', position: 'relative' }

const statusBarStyle: CSSProperties = {
  height: 34,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '0 16px',
  background: 'var(--side)',
  color: 'var(--side-fg)',
  fontSize: 11.5,
}

const propsPanelStyle: CSSProperties = {
  width: 264,
  flexShrink: 0,
  borderLeft: '1px solid var(--line)',
  background: 'var(--surface)',
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const iconButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--line)',
  borderRadius: 6,
  background: 'var(--surface)',
  color: 'var(--ink2)',
  cursor: 'pointer',
  fontSize: 15,
  font: 'inherit',
}

const stepSelectStyle: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--line)',
  borderRadius: 8,
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 12.5,
  font: 'inherit',
}

const coordOverlayStyle: CSSProperties = {
  position: 'absolute',
  left: 20,
  bottom: 20,
  padding: '6px 12px',
  borderRadius: 6,
  background: 'rgba(20,28,41,.85)',
  color: '#E4E9F0',
  fontFamily: "'IBM Plex Mono'",
  fontSize: 12,
  pointerEvents: 'none',
}

const toolButtonStyle: CSSProperties = {
  height: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--line)',
  borderRadius: 6,
  background: 'var(--surface)',
  color: 'var(--ink2)',
  cursor: 'pointer',
  fontSize: 15,
  font: 'inherit',
}

const toolButtonActiveStyle: CSSProperties = {
  ...toolButtonStyle,
  background: '#FDEFE0',
  borderColor: '#E08A2B',
  color: '#B5701A',
}

const toolButtonDisabledStyle: CSSProperties = { ...toolButtonStyle, opacity: 0.35, cursor: 'not-allowed' }

const tagChipStyle: CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  background: 'var(--subtle)',
  color: 'var(--ink2)',
  border: '1px solid var(--line)',
}

const disclaimerBoxStyle: CSSProperties = {
  marginTop: 'auto',
  padding: '10px 12px',
  borderRadius: 8,
  background: '#FDEFE0',
  color: '#B5701A',
  fontSize: 11.5,
  lineHeight: 1.5,
}

function buildCloudSaveInput(
  session: CloudDraftSession,
  geometries: readonly Geometry[],
  layers: readonly DrawingLayer[],
): CloudSaveDraftInput {
  return {
    project: {
      projectNumber: session.projectNumber,
      name: session.projectName,
      clientName: session.clientName,
    },
    drawing: {
      drawingNumber: session.drawingNumber,
      name: session.drawingName,
      drawingType: session.drawingType,
      settings: { paperSize: 'A3', orientation: 'landscape', scaleDenominator: 100, drawingUnit: 'mm' },
    },
    revision: {
      revisionNumber: session.revisionNumber,
      changeSummary: session.changeSummary ?? 'CAD編集画面から共有保存',
    },
    document: { geometries, layers },
    exportFormat: 'json',
  }
}

function isDocumentContent(content: unknown): content is {
  readonly geometries: readonly Geometry[]
  readonly layers: readonly DrawingLayer[]
} {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return false
  const record = content as Record<string, unknown>
  return Array.isArray(record.geometries) && Array.isArray(record.layers)
}

export function CadEditorPage({
  autosaveStore,
  onNavigate,
  cloudApiClient,
  cloudDraftSession = DEFAULT_CLOUD_DRAFT_SESSION,
}: CadEditorPageProps) {
  const storeApi = useEditorStoreApi()
  const apiClient = useMemo<CloudSaveClient>(
    () => cloudApiClient ?? createCivilDraftApiClient(),
    [cloudApiClient],
  )
  const geometries = useEditorStore((s) => s.geometries)
  const layers = useEditorStore((s) => s.layers)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const activeTool = useEditorStore((s) => s.activeTool)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const currentStepId = useEditorStore((s) => s.currentStepId)
  const draftCursor = useEditorStore((s) => s.draftCursor)
  const activeLayerId = useEditorStore((s) => s.activeLayerId)
  const canUndo = useEditorStore((s) => s.undoStack.length > 0)
  const canRedo = useEditorStore((s) => s.redoStack.length > 0)

  const [autosaveStatus, setAutosaveStatus] = useState<{ readonly ok: boolean; readonly text: string }>({
    ok: true,
    text: '自動保存: 待機中',
  })
  const [cloudSaveStatus, setCloudSaveStatus] = useState<{
    readonly ok: boolean
    readonly text: string
  } | null>(null)
  const [cloudSaving, setCloudSaving] = useState(false)
  const [lastCloudRevisionId, setLastCloudRevisionId] = useState<string | null>(null)

  useEffect(() => {
    const scheduler = scheduleAutosave(
      () => {
        const s = storeApi.getState()
        return { savedAt: new Date().toISOString(), geometries: s.geometries, layers: s.layers }
      },
      autosaveStore,
      {
        onResult: (result) => {
          setAutosaveStatus(
            result.ok
              ? {
                  ok: true,
                  text: `自動保存済み・${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`,
                }
              : { ok: false, text: `自動保存失敗: ${result.error.message}` },
          )
        },
      },
    )

    const unsubscribe = storeApi.subscribe((state, prev) => {
      if (state.geometries !== prev.geometries || state.layers !== prev.layers) scheduler.trigger()
    })

    return () => {
      unsubscribe()
      scheduler.dispose()
      // dispose()はデバウンス中タイマーの破棄のみで保存は行わないため、
      // 画面離脱直前の未保存差分をここで明示的にflushする。
      // アンマウント後はUIへ結果を反映できないため、失敗時は最低限コンソールへ可視化する
      // （AutosaveStoreはR-006方針によりthrowせずResultで失敗を返す契約のため、握り潰さない）。
      const s = storeApi.getState()
      autosaveStore
        .save({ savedAt: new Date().toISOString(), geometries: s.geometries, layers: s.layers })
        .then((result) => {
          if (!result.ok) console.error('自動保存（画面離脱時flush）に失敗しました', result.error)
        })
    }
  }, [storeApi, autosaveStore])

  const activeLayer = resolveActiveLayer(layers, activeLayerId)
  const selectedGeometries = geometries.filter((g) => selectedIds.includes(g.id))
  const selected = selectedGeometries.length === 1 ? (selectedGeometries[0] ?? null) : null

  const commitGeometryUpdate = (next: Geometry) => {
    if (selected === null) return
    storeApi.getState().dispatchCommand(createUpdateGeometryCommand(selected, next))
  }

  const commitStyleUpdate = (patch: Partial<GeometryStyle>) => {
    if (selected === null) return
    const next = withUpdatedAt(selected, { style: { ...selected.style, ...patch } })
    storeApi.getState().dispatchCommand(createUpdateGeometryCommand(selected, next))
  }

  const runCloudSave = async () => {
    const s = storeApi.getState()
    if (s.geometries.length === 0) {
      setCloudSaveStatus({ ok: false, text: '共有保存できる図形がありません' })
      return
    }
    setCloudSaving(true)
    setCloudSaveStatus({ ok: true, text: '共有保存中...' })
    try {
      const result = await apiClient.saveDraft(buildCloudSaveInput(cloudDraftSession, s.geometries, s.layers))
      if (result.ok) {
        setLastCloudRevisionId(result.value.revision.id)
        setCloudSaveStatus({
          ok: true,
          text: `共有保存済み: ${result.value.project.projectNumber} / ${result.value.drawing.drawingNumber}`,
        })
      } else {
        setCloudSaveStatus({ ok: false, text: `共有保存失敗: ${result.error.message}` })
      }
    } catch (err) {
      setCloudSaveStatus({ ok: false, text: `共有保存失敗: ${String(err)}` })
    } finally {
      setCloudSaving(false)
    }
  }

  const runCloudReload = async () => {
    if (lastCloudRevisionId === null) {
      setCloudSaveStatus({ ok: false, text: '共有保存後に再読込できます' })
      return
    }
    setCloudSaving(true)
    setCloudSaveStatus({ ok: true, text: '共有再読込中...' })
    try {
      const result = await apiClient.getRevisionContent(lastCloudRevisionId)
      if (!result.ok) {
        setCloudSaveStatus({ ok: false, text: `共有再読込失敗: ${result.error.message}` })
        return
      }
      if (!isDocumentContent(result.value.content)) {
        setCloudSaveStatus({ ok: false, text: '共有再読込失敗: 図面内容の形式が不正です' })
        return
      }
      storeApi.getState().replaceDocument(result.value.content.geometries, result.value.content.layers)
      storeApi.getState().clearHistory()
      setCloudSaveStatus({
        ok: true,
        text: `共有再読込済み: ${result.value.contentVersion}版 / 図形${result.value.content.geometries.length}件`,
      })
    } catch (err) {
      setCloudSaveStatus({ ok: false, text: `共有再読込失敗: ${String(err)}` })
    } finally {
      setCloudSaving(false)
    }
  }

  return (
    <div style={pageRootStyle}>
      <header style={headerBarStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cloudDraftSession.projectName}</span>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{cloudDraftSession.drawingName}</span>
        </div>
        <span style={{ ...monoStyle, fontSize: 12, color: 'var(--muted)' }}>{cloudDraftSession.revisionNumber}</span>
        <span style={statusBadgeStyle(autosaveStatus.ok ? '#1F8255' : '#C5392F', autosaveStatus.ok ? '#E4F3EC' : '#FCE9E7')}>
          {autosaveStatus.text}
        </span>
        {cloudSaveStatus !== null && (
          <span style={statusBadgeStyle(cloudSaveStatus.ok ? '#1F8255' : '#C5392F', cloudSaveStatus.ok ? '#E4F3EC' : '#FCE9E7')}>
            {cloudSaveStatus.text}
          </span>
        )}
        <button
          title="元に戻す"
          disabled={!canUndo}
          style={{ ...iconButtonStyle, opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
          onClick={() => storeApi.getState().undo()}
        >
          ↶
        </button>
        <button
          title="やり直す"
          disabled={!canRedo}
          style={{ ...iconButtonStyle, opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
          onClick={() => storeApi.getState().redo()}
        >
          ↷
        </button>
        <span style={{ flex: 1 }} />
        <select
          value={currentStepId ?? ''}
          style={stepSelectStyle}
          onChange={(e) => {
            const value = e.target.value
            const step = DEFAULT_CONSTRUCTION_STEPS.find((s) => s.id === value)
            storeApi.getState().setCurrentStep(step?.id ?? null)
          }}
        >
          <option value="">全表示</option>
          {DEFAULT_CONSTRUCTION_STEPS.map((step) => (
            <option key={step.id} value={step.id}>
              {step.name}
            </option>
          ))}
        </select>
        <button style={ghostButtonStyle} onClick={() => storeApi.getState().setGridVisible(!gridVisible)}>
          表示
        </button>
        <button
          style={ghostButtonStyle}
          disabled={cloudSaving}
          onClick={() => {
            void runCloudSave()
          }}
        >
          {cloudSaving ? '共有保存中' : '共有保存'}
        </button>
        <button
          style={{
            ...ghostButtonStyle,
            opacity: lastCloudRevisionId === null || cloudSaving ? 0.55 : 1,
            cursor: lastCloudRevisionId === null || cloudSaving ? 'not-allowed' : 'pointer',
          }}
          disabled={lastCloudRevisionId === null || cloudSaving}
          onClick={() => {
            void runCloudReload()
          }}
        >
          共有再読込
        </button>
        <button style={primaryButtonStyle} onClick={() => onNavigate('print')}>
          出力
        </button>
      </header>

      <div style={bodyRowStyle}>
        <aside style={toolPanelStyle}>
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabelStyle}>作図・編集</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {REAL_TOOLS.map(({ tool, icon, label }) => (
                <button
                  key={tool}
                  title={label}
                  aria-pressed={activeTool === tool}
                  style={activeTool === tool ? toolButtonActiveStyle : toolButtonStyle}
                  onClick={() => storeApi.getState().activateTool(tool)}
                >
                  {icon}
                </button>
              ))}
              {UNAVAILABLE_TOOLS.map(({ icon, label }) => (
                <button key={icon} title={label} disabled style={toolButtonDisabledStyle}>
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabelStyle}>土木部材</div>
            {getCategories().map((category) => (
              <div key={category} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: 'var(--ink2)', marginBottom: 4 }}>{category}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {SYMBOL_CATALOG.filter((s) => s.category === category).map((s) => (
                    <span key={s.id} style={tagChipStyle}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <button style={{ ...ghostButtonStyle, width: '100%', marginTop: 4 }} onClick={() => onNavigate('parts')}>
              すべての部材を見る →
            </button>
          </div>

          <div>
            <div style={sectionLabelStyle}>レイヤー</div>
            {layers.map((layer) => (
              <label
                key={layer.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink2)', marginBottom: 6 }}
              >
                <input type="checkbox" checked={layer.visible} onChange={() => storeApi.getState().toggleLayerVisible(layer.id)} />
                {layer.name}
              </label>
            ))}
          </div>
        </aside>

        <div style={canvasColumnStyle}>
          <div style={canvasInnerStyle}>
            <CanvasStage />
            {draftCursor !== null && (
              <div style={coordOverlayStyle}>
                X: {commaFmt.format(draftCursor.x)} Y: {commaFmt.format(draftCursor.y)}
              </div>
            )}
          </div>
          <div style={statusBarStyle}>
            <span style={monoStyle}>
              {draftCursor !== null ? `X: ${commaFmt.format(draftCursor.x)} Y: ${commaFmt.format(draftCursor.y)}` : 'X: -- Y: --'}
            </span>
            <span style={{ color: 'var(--side-line)' }}>|</span>
            <span>レイヤー: {activeLayer.name}</span>
            <span style={{ marginLeft: 'auto' }} />
            <span style={{ color: autosaveStatus.ok ? '#2E9E6B' : '#C5392F' }}>● {autosaveStatus.text}</span>
          </div>
        </div>

        <aside style={propsPanelStyle}>
          <div style={sectionLabelStyle}>選択図形</div>
          {selectedGeometries.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>図形を選択すると詳細が表示されます。</div>
          )}
          {selectedGeometries.length > 1 && (
            <div style={{ color: 'var(--ink2)', fontSize: 12.5 }}>{selectedGeometries.length}件選択中（複数選択時は編集できません）</div>
          )}
          {selected !== null && (
            <>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{GEOMETRY_TYPE_LABELS[selected.type]}</div>
                <div style={{ ...monoStyle, fontSize: 11, color: 'var(--muted)' }}>
                  ID: {selected.id} ・ レイヤー: {resolveActiveLayer(layers, selected.layerId).name}
                </div>
              </div>

              <div>
                <div style={sectionLabelStyle}>幾何</div>
                <GeometryFields geometry={selected} onCommit={commitGeometryUpdate} />
              </div>

              <div>
                <div style={sectionLabelStyle}>スタイル</div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>線色</span>
                  <input
                    type="color"
                    value={selected.style.strokeColor}
                    onChange={(e) => commitStyleUpdate({ strokeColor: e.target.value })}
                  />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>線種</span>
                  <select
                    value={selected.style.lineType}
                    style={fieldInputStyle}
                    onChange={(e) => commitStyleUpdate({ lineType: e.target.value as GeometryStyle['lineType'] })}
                  >
                    {Object.entries(LINE_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>塗りつぶし色</span>
                  <input
                    type="color"
                    value={selected.style.fillColor ?? '#000000'}
                    onChange={(e) => commitStyleUpdate({ fillColor: e.target.value })}
                  />
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>不透明度(%)</span>
                  <NumInput
                    key={`${selected.id}:opacity:${selected.style.opacity}`}
                    value={selected.style.opacity * 100}
                    precision={0}
                    onCommit={(v) => commitStyleUpdate({ opacity: Math.min(100, Math.max(0, v)) / 100 })}
                  />
                </div>
              </div>

              <div>
                <div style={sectionLabelStyle}>業務属性</div>
                {selected.civilAttributeId !== undefined ? (
                  <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>業務属性ID: {selected.civilAttributeId}</div>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    業務属性は未設定です（工種・規格・工区等の詳細管理はPhase 2以降で対応予定）。
                  </div>
                )}
              </div>

              <div>
                <div style={sectionLabelStyle}>更新履歴</div>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>最終更新: {new Date(selected.updatedAt).toLocaleString('ja-JP')}</div>
              </div>

              <div>
                <div style={sectionLabelStyle}>関連する数量</div>
                <button style={{ ...ghostButtonStyle, width: '100%' }} onClick={() => onNavigate('quantity')}>
                  数量集計を見る →
                </button>
              </div>
            </>
          )}

          <div style={disclaimerBoxStyle}>
            ⚠ 本パネルの数値は図面データの表示・編集用です。数量・構造の正式判定は関連システムでご確認ください。
          </div>
        </aside>
      </div>
    </div>
  )
}
