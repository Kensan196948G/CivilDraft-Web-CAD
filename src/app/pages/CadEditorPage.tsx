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
import { createAddGeometryCommand, createUpdateGeometryCommand } from '@/domain/commands/geometryCommands'
import { DEFAULT_CONSTRUCTION_STEPS } from '@/domain/construction-steps'
import type { ToolType } from '@/domain/tools/draftGeometry'
import { EDITING_TOOLS, PARAM_EDITING_TOOLS, SELECTION_REQUIRED_TOOLS } from '@/domain/tools/editGeometry'
import { LAYER_TEMPLATES } from '@/domain/catalog/layerTemplates'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import {
  createCivilDraftApiClient,
  type CloudContent,
  type CloudSaveDraftInput,
  type CloudSaveDraftResult,
} from '@/infrastructure/cloud/civilDraftApiClient'
import type { Result, ValidationIssue } from '@/shared/types'
import type { DrawingLayer, Geometry, GeometryStyle, GeometryType, HatchPattern, LayerId, Point } from '@/shared/types'
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
  { tool: 'text', icon: 'A', label: '文字' },
  { tool: 'dimension', icon: '⟺', label: '寸法' },
  { tool: 'hatch', icon: '⧉', label: 'ハッチング' },
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

function getBoundaryPoints(geometry: Geometry): readonly Point[] | null {
  switch (geometry.type) {
    case 'polyline':
      return geometry.closed ? geometry.points : null
    case 'rectangle': {
      const { origin, width, height } = geometry
      return [
        origin,
        { x: origin.x + width, y: origin.y },
        { x: origin.x + width, y: origin.y + height },
        { x: origin.x, y: origin.y + height },
      ]
    }
    case 'circle': {
      const { center, radius } = geometry
      const n = 32
      const pts: Point[] = []
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        pts.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) })
      }
      return pts
    }
    default:
      return null
  }
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

const miniButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 11,
  font: 'inherit',
  padding: 0,
  flexShrink: 0,
}

const miniSelectStyle: CSSProperties = {
  width: 48,
  padding: '0 2px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--ink2)',
  fontSize: 10,
  font: 'inherit',
  flexShrink: 0,
}

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

const editParamRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: 'var(--ink2)',
}

const editParamInputStyle: CSSProperties = {
  width: 72,
  padding: '3px 6px',
  border: '1px solid var(--line)',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: 11,
  font: 'inherit',
  textAlign: 'right',
}

function ParamInputControl({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: number
  readonly onChange: (v: number) => void
}) {
  return (
    <div style={editParamRowStyle}>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <input
        type="number"
        value={value}
        min={0.1}
        step={1}
        style={editParamInputStyle}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  )
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
  const activeEditingTool = useEditorStore((s) => s.activeEditingTool)
  const editingOffsetDistance = useEditorStore((s) => s.editingOffsetDistance)
  const editingFilletRadius = useEditorStore((s) => s.editingFilletRadius)
  const editingChamferDist = useEditorStore((s) => s.editingChamferDist)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const currentStepId = useEditorStore((s) => s.currentStepId)
  const draftCursor = useEditorStore((s) => s.draftCursor)
  const draftPoints = useEditorStore((s) => s.draftPoints)
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
  const [editNotice, setEditNotice] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(LAYER_TEMPLATES[0]?.id ?? '')

  const [textInputValue, setTextInputValue] = useState('')
  const [textFontSize, setTextFontSize] = useState(14)
  const [hatchPattern, setHatchPattern] = useState<HatchPattern>('parallel')
  const [hatchAngle, setHatchAngle] = useState(0)
  const [hatchSpacing, setHatchSpacing] = useState(20)

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
    if (layers.find((l) => l.id === selected.layerId)?.locked === true) {
      setEditNotice('ロックされたレイヤーの図形は変更できません（§6.3 / Issue #40）')
      return
    }
    setEditNotice(null)
    storeApi.getState().dispatchCommand(createUpdateGeometryCommand(selected, next))
  }

  const commitStyleUpdate = (patch: Partial<GeometryStyle>) => {
    if (selected === null) return
    if (layers.find((l) => l.id === selected.layerId)?.locked === true) {
      setEditNotice('ロックされたレイヤーの図形は変更できません（§6.3 / Issue #40）')
      return
    }
    setEditNotice(null)
    const next = withUpdatedAt(selected, { style: { ...selected.style, ...patch } })
    storeApi.getState().dispatchCommand(createUpdateGeometryCommand(selected, next))
  }

  const handlePlaceText = () => {
    const point = draftPoints[0]
    if (point === undefined || textInputValue.trim() === '') return
    if (activeLayer.locked) {
      setEditNotice('アクティブレイヤーがロックされています（§6.3 / Issue #40）')
      return
    }
    setEditNotice(null)
    const ctx = defaultCreationContext
    const timestamp = ctx.now()
    const textGeom: Geometry = {
      id: ctx.newId(),
      layerId: activeLayer.id,
      type: 'text',
      style: activeLayer.defaultStyle,
      constructionStepIds: [],
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      anchor: point,
      text: textInputValue,
      height: textFontSize,
      rotationDeg: 0,
      horizontalAlign: 'left',
    }
    storeApi.getState().dispatchCommand(createAddGeometryCommand(textGeom, ctx))
    storeApi.getState().cancelDraft()
    setTextInputValue('')
  }

  const handleCancelText = () => {
    storeApi.getState().cancelDraft()
    setTextInputValue('')
  }

  const handleApplyHatch = () => {
    if (selected === null) return
    if (activeLayer.locked) {
      setEditNotice('アクティブレイヤーがロックされています（§6.3 / Issue #40）')
      return
    }
    setEditNotice(null)
    const boundaryPoints = getBoundaryPoints(selected)
    if (boundaryPoints === null) return
    const ctx = defaultCreationContext
    const timestamp = ctx.now()
    const hatchGeom: Geometry = {
      id: ctx.newId(),
      layerId: activeLayer.id,
      type: 'hatch',
      style: activeLayer.defaultStyle,
      constructionStepIds: [],
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      boundaryPoints,
      pattern: hatchPattern,
      angleDeg: hatchAngle,
      spacing: hatchSpacing,
    }
    storeApi.getState().dispatchCommand(createAddGeometryCommand(hatchGeom, ctx))
    storeApi.getState().clearSelection()
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
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabelStyle}>編集</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {EDITING_TOOLS.map(({ tool, icon, label }) => {
                const isActive = activeEditingTool === tool
                const needsSelection = SELECTION_REQUIRED_TOOLS.has(tool)
                const disabled = needsSelection && selectedIds.length === 0
                return (
                  <button
                    key={tool}
                    title={label}
                    aria-pressed={isActive}
                    disabled={disabled}
                    style={
                      disabled
                        ? toolButtonDisabledStyle
                        : isActive
                          ? toolButtonActiveStyle
                          : toolButtonStyle
                    }
                    onClick={() => {
                      if (isActive) {
                        storeApi.getState().activateEditingTool(null)
                      } else {
                        storeApi.getState().activateEditingTool(tool)
                      }
                    }}
                  >
                    {icon}
                  </button>
                )
              })}
            </div>
            {activeEditingTool !== null && PARAM_EDITING_TOOLS.has(activeEditingTool) && (
              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'var(--subtle)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeEditingTool === 'offset' && (
                  <ParamInputControl
                    label="距離 (mm)"
                    value={editingOffsetDistance}
                    onChange={(v) => storeApi.getState().setEditingOffsetDistance(v)}
                  />
                )}
                {activeEditingTool === 'fillet' && (
                  <ParamInputControl
                    label="半径 (mm)"
                    value={editingFilletRadius}
                    onChange={(v) => storeApi.getState().setEditingFilletRadius(v)}
                  />
                )}
                {activeEditingTool === 'chamfer' && (
                  <ParamInputControl
                    label="距離 (mm)"
                    value={editingChamferDist}
                    onChange={(v) => storeApi.getState().setEditingChamferDist(v)}
                  />
                )}
              </div>
            )}
          </div>

          {activeTool === 'text' && draftPoints.length >= 1 && (
            <div style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 8, background: 'var(--subtle)', border: '1px solid var(--line)' }}>
              <div style={sectionLabelStyle}>文字入力</div>
              <input
                type="text"
                placeholder="文字を入力..."
                value={textInputValue}
                style={{ ...fieldInputStyle, width: '100%', textAlign: 'left', marginBottom: 8 }}
                onChange={(e) => setTextInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePlaceText() }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>文字高さ:</span>
                <input
                  type="number"
                  value={textFontSize}
                  min={4}
                  max={200}
                  style={{ ...fieldInputStyle, width: 64 }}
                  onChange={(e) => setTextFontSize(Math.max(4, Math.min(200, Number(e.target.value) || 14)))}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={{ ...primaryButtonStyle, flex: 1, justifyContent: 'center' }} onClick={handlePlaceText}>
                  配置
                </button>
                <button style={{ ...ghostButtonStyle, flex: 1 }} onClick={handleCancelText}>
                  取消
                </button>
              </div>
            </div>
          )}

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={sectionLabelStyle}>レイヤー</div>
              <button
                style={{ ...ghostButtonStyle, padding: '2px 8px', fontSize: 11 }}
                onClick={() => storeApi.getState().addLayer(`レイヤー${layers.length + 1}`)}
              >
                + 新規
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
              <select
                aria-label="レイヤーテンプレート"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                style={miniSelectStyle}
              >
                {LAYER_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <button
                style={{ ...ghostButtonStyle, padding: '2px 8px', fontSize: 11 }}
                onClick={() => storeApi.getState().applyLayerTemplate(selectedTemplateId)}
              >
                テンプレート適用
              </button>
            </div>
            {[...layers].sort((a, b) => a.order - b.order).map((layer) => (
              <div
                key={layer.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11.5,
                  color: 'var(--ink2)',
                  marginBottom: 4,
                  padding: '4px 6px',
                  borderRadius: 6,
                  background: layer.id === activeLayerId ? 'var(--hover)' : 'transparent',
                  border: layer.id === activeLayerId ? '1px solid var(--line)' : '1px solid transparent',
                }}
              >
                <button
                  title="表示/非表示"
                  style={{ ...miniButtonStyle, color: layer.visible ? 'var(--ink)' : 'var(--muted)' }}
                  onClick={() => storeApi.getState().toggleLayerVisible(layer.id)}
                >
                  {layer.visible ? '👁' : '─'}
                </button>
                <button
                  title={layer.locked ? 'ロック解除' : 'ロック'}
                  style={{ ...miniButtonStyle, color: layer.locked ? '#C5392F' : 'var(--muted)' }}
                  onClick={() => storeApi.getState().toggleLayerLock(layer.id)}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
                <button
                  title={layer.printable ? '印刷: 有効' : '印刷: 無効'}
                  style={{ ...miniButtonStyle, color: layer.printable ? 'var(--ink)' : 'var(--muted)', fontSize: 10 }}
                  onClick={() => storeApi.getState().toggleLayerPrintable(layer.id)}
                >
                  🖨
                </button>
                <input
                  type="text"
                  defaultValue={layer.name}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    background: 'transparent',
                    color: layer.id === activeLayerId ? 'var(--ink)' : 'var(--ink2)',
                    fontSize: 11.5,
                    fontWeight: layer.id === activeLayerId ? 600 : 400,
                    font: 'inherit',
                    padding: '2px 4px',
                    borderRadius: 4,
                  }}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== layer.name) {
                      storeApi.getState().updateLayerName(layer.id, e.target.value.trim())
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
                <select
                  title="線幅"
                  value={layer.defaultStyle.strokeWidth}
                  style={{ ...miniSelectStyle }}
                  onChange={(e) => storeApi.getState().updateLayerLineWidth(layer.id, Number(e.target.value))}
                >
                  {[0.5, 1, 1.5, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>{w}px</option>
                  ))}
                </select>
                <button
                  title="上へ"
                  style={miniButtonStyle}
                  onClick={() => storeApi.getState().reorderLayer(layer.id, 'up')}
                >
                  ▲
                </button>
                <button
                  title="下へ"
                  style={miniButtonStyle}
                  onClick={() => storeApi.getState().reorderLayer(layer.id, 'down')}
                >
                  ▼
                </button>
                {layers.length > 1 && (
                  <button
                    title="レイヤー削除"
                    style={{ ...miniButtonStyle, color: '#C5392F' }}
                    onClick={() => storeApi.getState().removeLayer(layer.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
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
          {editNotice !== null && (
            <div
              role="status"
              style={{
                fontSize: 12,
                color: '#A15C00',
                background: '#FFF3D6',
                border: '1px solid #F0D9A8',
                borderRadius: 8,
                padding: '8px 10px',
                marginBottom: 8,
              }}
            >
              {editNotice}
            </div>
          )}
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

          {activeTool === 'hatch' && selected !== null && getBoundaryPoints(selected) !== null && (
            <div style={{ padding: '12px 0', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
              <div style={sectionLabelStyle}>ハッチング設定</div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>パターン</span>
                <select
                  value={hatchPattern}
                  style={fieldInputStyle}
                  onChange={(e) => setHatchPattern(e.target.value as HatchPattern)}
                >
                  <option value="parallel">平行線</option>
                  <option value="cross">クロス</option>
                  <option value="gravel">砂利</option>
                  <option value="earth">土</option>
                  <option value="concrete">コンクリート</option>
                  <option value="rock">岩</option>
                  <option value="asphalt">アスファルト</option>
                  <option value="wood">木材</option>
                  <option value="steel">鋼材</option>
                  <option value="water">水</option>
                </select>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>角度(°)</span>
                <NumInput key={`hatch-angle:${hatchAngle}`} value={hatchAngle} precision={0} onCommit={setHatchAngle} />
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>間隔(mm)</span>
                <NumInput key={`hatch-spacing:${hatchSpacing}`} value={hatchSpacing} precision={1} onCommit={setHatchSpacing} />
              </div>
              <button style={{ ...primaryButtonStyle, width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={handleApplyHatch}>
                ハッチングを適用
              </button>
            </div>
          )}

          <div style={disclaimerBoxStyle}>
            ⚠ 本パネルの数値は図面データの表示・編集用です。数量・構造の正式判定は関連システムでご確認ください。
          </div>
        </aside>
      </div>
    </div>
  )
}
