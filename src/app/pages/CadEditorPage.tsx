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
 * DXF取込はヘッダーの「📥 取込」ボタンから行う（Issue #118）。取込は1操作として
 * Undo/Redo 履歴へ積まれ、取込前の図面へ1度で戻せる。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CanvasStage } from '../canvas/CanvasStage'
import { CommandPalette, type CommandPaletteItem } from '../components/CommandPalette'
import type { AppView } from '../layout/Sidebar'
import { createDefaultLayer } from '../store/editorStore'
import { useEditorStore, useEditorStoreApi } from '../store/useEditorStore'
import { getCategories, SYMBOL_CATALOG } from '@/domain/catalog/symbolCatalog'
import {
  createAddGeometryCommand,
  createBulkUpdateGeometriesCommand,
  createDeleteGeometriesCommand,
  createExplodeGeometryCommand,
  createImportDocumentCommand,
  createJoinLinesCommand,
  createUpdateGeometryCommand,
} from '@/domain/commands/geometryCommands'
import { importDxf } from '@/domain/dxf/dxfImporter'
import { classifyMigrationFile, migrationAdvice } from '@/domain/migration/migrationAssistant'
import { DEFAULT_CONSTRUCTION_STEPS } from '@/domain/construction-steps'
import type { ToolType } from '@/domain/tools/draftGeometry'
import { EDITING_TOOLS, PARAM_EDITING_TOOLS, SELECTION_REQUIRED_TOOLS } from '@/domain/tools/editGeometry'
import { LAYER_TEMPLATES } from '@/domain/catalog/layerTemplates'
import { CAD_COMMAND_HELP, parseCadCommand } from '@/domain/cadCommandLine'
import { checkDrawingHealth, type DrawingHealthResult } from '@/domain/validation/drawingHealth'
import { acquireCheckout, releaseCheckout, type DrawingCheckout } from '@/domain/revisions/checkout'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'
import { measureArea, measureDistance } from '@/domain/geometry/measure'
import type { AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import {
  DEFAULT_CLOUD_DRAFT_SESSION,
  type CloudDraftSession,
} from './cloudDraftSession'

export type { CloudDraftSession } from './cloudDraftSession'
import {
  createCivilDraftApiClient,
  type CloudContent,
  type CloudLoadRevisionResult,
  type CloudQuantitySnapshot,
  type CloudSaveDraftInput,
  type CloudSaveDraftResult,
  type CloudUpdateRevisionInput,
} from '@/infrastructure/cloud/civilDraftApiClient'
import type { Result, ValidationIssue } from '@/shared/types'
import type {
  DrawingId,
  DrawingLayer,
  Geometry,
  GeometryStyle,
  HatchPattern,
  LayerId,
  LineGeometry,
  Point,
  RevisionId,
} from '@/shared/types'
import { ghostButtonStyle, monoStyle, pageRootStyle, primaryButtonStyle, statusBadgeStyle } from './pageStyles'
import { GeometryFields, NumInput } from './cadEditor/geometryFields'
import { GEOMETRY_TYPE_LABELS, LINE_TYPE_LABELS } from './cadEditor/labels'
import { withUpdatedAt } from './cadEditor/geometryUpdate'
import { ParamInputControl } from './cadEditor/paramInputControl'
import { editParamInputStyle, fieldInputStyle, fieldLabelStyle, fieldRowStyle } from './cadEditor/styles'
import { formatLengthMm } from '@/domain/units'

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
  /** 既存改訂の内容・数量を読み込む（実図面の初期ロード・改訂更新配線）。 */
  loadRevisionDraft?(
    revisionId: string,
  ): Promise<Result<CloudLoadRevisionResult, ValidationIssue>>
  /** 既存改訂の内容・数量を更新する（実図面の改訂更新・楽観ロック）。 */
  updateRevisionDraft?(
    input: CloudUpdateRevisionInput,
  ): Promise<Result<{ readonly content: CloudContent; readonly quantities: CloudQuantitySnapshot }, ValidationIssue>>
  /** 図面チェックイン/アウト（migration 0007）。未実装クライアントではローカルモードへフォールバック。 */
  updateCheckout?(
    drawingId: string,
    action: 'checkout' | 'checkin',
    revisionId?: string,
  ): Promise<Result<{ readonly status: string; readonly checkedOutBy: string }, ValidationIssue>>
}

const REAL_TOOLS: readonly { readonly tool: ToolType; readonly icon: string; readonly label: string }[] = [
  { tool: 'select', icon: '↖', label: '選択' },
  { tool: 'line', icon: '╱', label: '線分' },
  { tool: 'rectangle', icon: '▭', label: '矩形' },
  { tool: 'circle', icon: '○', label: '円' },
  { tool: 'arc', icon: '⌒', label: '円弧' },
  { tool: 'ellipse', icon: '⬭', label: '楕円' },
  { tool: 'polyline', icon: '⌇', label: 'ポリライン' },
  { tool: 'spline', icon: '∿', label: 'スプライン' },
  { tool: 'cloud', icon: '☁', label: '改訂雲' },
  { tool: 'mline', icon: '≣', label: '平行2線' },
  { tool: 'text', icon: 'A', label: '文字' },
  { tool: 'leader', icon: '↳', label: '引出線' },
  { tool: 'dimension', icon: '⟺', label: '寸法' },
  { tool: 'hatch', icon: '⧉', label: 'ハッチング' },
  { tool: 'measure', icon: '📏', label: '測距・面積' },
]

const commaFmt = new Intl.NumberFormat('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

/** activeLayerId に対応するレイヤーを解決する（見つからなければ先頭、無ければ既定レイヤー）。 */
function resolveActiveLayer(layers: readonly DrawingLayer[], activeLayerId: LayerId): DrawingLayer {
  return layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? createDefaultLayer()
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
  const editingArrayRows = useEditorStore((s) => s.editingArrayRows)
  const editingArrayCols = useEditorStore((s) => s.editingArrayCols)
  const editingArrayRowSpacing = useEditorStore((s) => s.editingArrayRowSpacing)
  const editingArrayColSpacing = useEditorStore((s) => s.editingArrayColSpacing)
  const editingScaleFactor = useEditorStore((s) => s.editingScaleFactor)
  const snapEnabled = useEditorStore((s) => s.snapEnabled)
  const snapTolerancePx = useEditorStore((s) => s.snapTolerancePx)
  const snapEndpoint = useEditorStore((s) => s.snapEndpoint)
  const snapMidpoint = useEditorStore((s) => s.snapMidpoint)
  const snapCenter = useEditorStore((s) => s.snapCenter)
  const snapIntersection = useEditorStore((s) => s.snapIntersection)
  const snapGrid = useEditorStore((s) => s.snapGrid)
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
  const [lastCloudDrawingId, setLastCloudDrawingId] = useState<string | null>(null)
  const [cloudConflict, setCloudConflict] = useState(false)
  const [loadedContentVersion, setLoadedContentVersion] = useState<number | undefined>(undefined)
  const [loadedQuantityVersion, setLoadedQuantityVersion] = useState<number | undefined>(undefined)
  const loadedRevisionRef = useRef<string | null>(null)
  const checkoutKey = `cd:checkout:${cloudDraftSession.drawingNumber}`
  /** 実案件未選択のローカル編集セッション（共有保存は無効化して誤作成を防ぐ）。 */
  const isLocalCloudSession = cloudDraftSession.projectNumber === 'LOCAL'
  /** 既存改訂を開いている（改訂更新モード）。 */
  const isExistingRevision = cloudDraftSession.revisionId !== undefined

  // 実図面（既存改訂）を開いた場合は、内容と数量をサーバから読み込む（改訂更新の前提）。
  useEffect(() => {
    const targetRevisionId = cloudDraftSession.revisionId
    if (targetRevisionId === undefined || apiClient.loadRevisionDraft === undefined) return
    if (loadedRevisionRef.current === targetRevisionId) return
    let cancelled = false
    setCloudSaving(true)
    setCloudSaveStatus({ ok: true, text: '既存図面を読み込み中...' })
    void apiClient
      .loadRevisionDraft(targetRevisionId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setCloudSaveStatus({ ok: false, text: `既存図面の読み込み失敗: ${result.error.message}` })
          return
        }
        if (!isDocumentContent(result.value.content)) {
          setCloudSaveStatus({ ok: false, text: '既存図面の読み込み失敗: 図面内容の形式が不正です' })
          return
        }
        storeApi.getState().replaceDocument(result.value.content.geometries, result.value.content.layers)
        storeApi.getState().recalculateQuantities()
        setLoadedContentVersion(result.value.contentVersion)
        setLoadedQuantityVersion(result.value.quantityVersion)
        loadedRevisionRef.current = targetRevisionId
        setCloudSaveStatus({
          ok: true,
          text: `既存図面を読み込みました（図形${result.value.content.geometries.length}件）`,
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCloudSaveStatus({ ok: false, text: `既存図面の読み込み失敗: ${String(error)}` })
        }
      })
      .finally(() => {
        if (!cancelled) setCloudSaving(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiClient, cloudDraftSession.revisionId, storeApi])
  const [checkout, setCheckout] = useState<DrawingCheckout | null>(() => {
    try {
      const raw = localStorage.getItem(checkoutKey)
      return raw === null ? null : (JSON.parse(raw) as DrawingCheckout)
    } catch {
      return null
    }
  })
  useEffect(() => {
    try {
      if (checkout === null) {
        localStorage.removeItem(checkoutKey)
      } else {
        localStorage.setItem(checkoutKey, JSON.stringify(checkout))
      }
    } catch {
      // localStorage 不可の環境では永続化せずメモリ上のみ
    }
  }, [checkout, checkoutKey])
  const checkoutActor = cloudDraftSession.clientName ?? 'local-user'
  const handleCheckoutToggle = () => {
    const now = new Date().toISOString()
    if (checkout?.status === 'checkedOut') {
      // 共有版（Worker API）が利用可能ならサーバー側でチェックインする。
      if (cloudApiClient?.updateCheckout && lastCloudDrawingId !== null) {
        void (async () => {
          const result = await cloudApiClient.updateCheckout?.(lastCloudDrawingId, 'checkin')
          if (result?.ok) {
            const released = releaseCheckout(checkout, { actorId: checkoutActor, now })
            if (released.ok) {
              setCheckout(released.value)
              setEditNotice(null)
            }
          } else {
            setEditNotice(result?.error.message ?? 'チェックインに失敗しました（サーバー状態を確認してください）')
          }
        })()
        return
      }
      const result = releaseCheckout(checkout, { actorId: checkoutActor, now })
      if (result.ok) {
        setCheckout(result.value)
        setEditNotice(null)
      } else {
        setEditNotice(result.error.message)
      }
      return
    }
    // 共有版が利用可能ならサーバー側でチェックアウトする（オフライン時はローカル専用）。
    if (cloudApiClient?.updateCheckout && lastCloudDrawingId !== null && lastCloudRevisionId !== null) {
      void (async () => {
        const result = await cloudApiClient.updateCheckout?.(
          lastCloudDrawingId,
          'checkout',
          lastCloudRevisionId,
        )
        if (result?.ok) {
          const acquired = acquireCheckout(null, {
            drawingId: lastCloudDrawingId,
            revisionId: lastCloudRevisionId,
            actorId: result.value.checkedOutBy,
            revisionStatus: 'draft',
            now,
          })
          if (acquired.ok) {
            setCheckout(acquired.value)
            setEditNotice(null)
          }
        } else {
          setEditNotice(result?.error.message ?? 'チェックアウトに失敗しました（共有保存後に再試行してください）')
        }
      })()
      return
    }
    const result = acquireCheckout(checkout, {
      drawingId: 'local-drawing' as DrawingId,
      revisionId: 'local-revision' as RevisionId,
      actorId: checkoutActor,
      revisionStatus: 'draft',
      now,
    })
    if (result.ok) {
      setCheckout(result.value)
      setEditNotice(null)
    } else {
      setEditNotice(result.error.message)
    }
  }
  const [editNotice, setEditNotice] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(LAYER_TEMPLATES[0]?.id ?? '')
  const [healthOpen, setHealthOpen] = useState(false)
  const [healthResult, setHealthResult] = useState<DrawingHealthResult | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [commandLineValue, setCommandLineValue] = useState('')
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null)
  const [migrationIssues, setMigrationIssues] = useState<readonly ValidationIssue[]>([])

  const [textInputValue, setTextInputValue] = useState('')
  const [textFontSize, setTextFontSize] = useState(14)
  const [hatchPattern, setHatchPattern] = useState<HatchPattern>('parallel')
  const [hatchAngle, setHatchAngle] = useState(0)
  const [hatchSpacing, setHatchSpacing] = useState(20)
  const dxfInputRef = useRef<HTMLInputElement | null>(null)

  /** DXF取込（Issue #118）: ファイル選択 → パース → 1操作のUndo可能コマンドとして図面置換。 */
  const handleImportDxf = async (file: File | undefined) => {
    if (file === undefined) return
    setEditNotice(null)
    const classification = classifyMigrationFile(file.name)
    if (!classification.supported) {
      setMigrationNotice(classification.message)
      setMigrationIssues([])
      return
    }
    setMigrationNotice(null)
    try {
      const content = await file.text()
      const result = importDxf(content, defaultCreationContext)
      if (!result.ok) {
        setMigrationNotice(`DXF取込に失敗: ${result.error.message}`)
        setMigrationIssues([])
        return
      }
      const { geometries, layers, issues } = result.value
      if (geometries.length === 0) {
        setMigrationNotice('DXF取込: 図形が見つかりませんでした')
        setMigrationIssues(issues)
        return
      }
      const state = storeApi.getState()
      state.dispatchCommand(
        createImportDocumentCommand(
          { geometries: state.geometries, layers: state.layers },
          geometries,
          layers,
          defaultCreationContext,
        ),
      )
      const issueSummary =
        issues.length > 0
          ? `（警告・情報 ${issues.length} 件: ${issues.map((i) => i.code).join(', ')}）`
          : ''
      setEditNotice(
        `DXF取込完了: 図形 ${geometries.length} 件・レイヤー ${layers.length} 件${issueSummary}`,
      )
      setMigrationIssues(issues)
    } catch (e) {
      setMigrationNotice(`DXF取込に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
      setMigrationIssues([])
    } finally {
      if (dxfInputRef.current !== null) dxfInputRef.current.value = ''
    }
  }

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

  // キーボードショートカット（#47 / アクセシビリティ）:
  // Ctrl/Cmd+Z=Undo、Ctrl/Cmd+Y・Ctrl/Cmd+Shift+Z=Redo、Ctrl/Cmd+K=コマンドパレット、
  // Delete/Backspace=選択削除（Undo可能）、1-8=作図ツール切替、Esc=ドラフト取消/選択解除。
  // 入力欄フォーカス中は奪わない（コマンドパレット入力中の誤発火も防ぐ）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const state = storeApi.getState()
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          if (state.redoStack.length > 0) state.redo()
        } else if (state.undoStack.length > 0) {
          state.undo()
        }
        return
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        if (state.redoStack.length > 0) state.redo()
        return
      }
      if (event.key === '?') {
        event.preventDefault()
        setShortcutHelpOpen(true)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.length > 0) {
        event.preventDefault()
        state.dispatchCommand(
          createDeleteGeometriesCommand(
            { geometries: state.geometries, layers: state.layers },
            state.selectedIds,
          ),
        )
        return
      }
      const numIndex = Number.parseInt(event.key, 10)
      // テンキー/数字 1〜9 で先頭9ツールを切替（2桁数字と誤爆しないよう9まで）。
      if (numIndex >= 1 && numIndex <= Math.min(9, REAL_TOOLS.length)) {
        event.preventDefault()
        storeApi.getState().activateTool(REAL_TOOLS[numIndex - 1]!.tool)
        return
      }
      if (event.key === 'Escape') {
        if (state.draftPoints.length > 0) {
          state.cancelDraft()
        } else {
          state.clearSelection()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [storeApi])

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

  /** 複数選択図形への一括スタイル適用（Issue #39）。ロックレイヤーは除外し1 undo で反映。 */
  const bulkApplyStyle = (patch: Partial<GeometryStyle>) => {
    const pairs = selectedGeometries
      .filter((g) => !layers.find((l) => l.id === g.layerId)?.locked)
      .map((g) => ({ before: g, after: withUpdatedAt(g, { style: { ...g.style, ...patch } }) }))
    if (pairs.length === 0) {
      setEditNotice('ロックされたレイヤーの図形は変更できません')
      return
    }
    if (pairs.length < selectedGeometries.length) {
      setEditNotice(`ロック済みレイヤーの ${selectedGeometries.length - pairs.length} 件は変更しませんでした`)
    } else {
      setEditNotice(null)
    }
    storeApi.getState().dispatchCommand(createBulkUpdateGeometriesCommand(pairs))
  }

  /** 複数選択図形の一括レイヤー移動（Issue #39）。 */
  const bulkApplyLayer = (layerId: LayerId) => {
    if (layerId === '') return
    const pairs = selectedGeometries
      .filter((g) => g.layerId !== layerId && !layers.find((l) => l.id === g.layerId)?.locked)
      .map((g) => ({ before: g, after: withUpdatedAt(g, { layerId }) }))
    if (pairs.length === 0) {
      setEditNotice('ロックされたレイヤーの図形は変更できません')
      return
    }
    setEditNotice(null)
    storeApi.getState().dispatchCommand(createBulkUpdateGeometriesCommand(pairs))
  }

  /** 選択図形の分解（ポリライン→線分・矩形→4辺・Issue #39残）。 */
  const handleExplodeSelected = () => {
    const state = storeApi.getState()
    const target = selectedGeometries.find((g) => g.type === 'polyline' || g.type === 'rectangle')
    if (target === undefined) {
      setEditNotice('分解できる図形（ポリライン・矩形）を選択してください')
      return
    }
    if (layers.find((l) => l.id === target.layerId)?.locked) {
      setEditNotice('ロックされたレイヤーの図形は分解できません')
      return
    }
    const command = createExplodeGeometryCommand(
      { geometries: state.geometries, layers: state.layers },
      target,
    )
    if (command !== null) {
      state.dispatchCommand(command)
      setEditNotice(null)
    }
  }

  /** 選択線分の結合（同一線上・端点接続の2本を1本に・Issue #39残）。 */
  const handleJoinSelected = () => {
    const state = storeApi.getState()
    const lines = selectedGeometries.filter(
      (g): g is LineGeometry => g.type === 'line' && !layers.find((l) => l.id === g.layerId)?.locked,
    )
    if (lines.length < 2) {
      setEditNotice('結合する線分を2本以上選択してください（ロックレイヤーは除外）')
      return
    }
    for (let i = 0; i < lines.length; i += 1) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const command = createJoinLinesCommand(
          { geometries: state.geometries, layers: state.layers },
          lines[i]!,
          lines[j]!,
        )
        if (command !== null) {
          state.dispatchCommand(command)
          setEditNotice(null)
          return
        }
      }
    }
    setEditNotice('同一線上で端点が接する線分が見つかりません')
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
    if (isLocalCloudSession) {
      setCloudSaveStatus({
        ok: false,
        text: '共有保存するにはホーム/案件詳細から実案件・図面を選択してください（ローカル編集は保存されません）',
      })
      return
    }
    setCloudSaving(true)
    setCloudConflict(false)
    setCloudSaveStatus({ ok: true, text: '共有保存中...' })
    try {
      const targetRevisionId = cloudDraftSession.revisionId
      const result =
        targetRevisionId !== undefined && apiClient.updateRevisionDraft !== undefined
          ? await apiClient.updateRevisionDraft({
              revisionId: targetRevisionId,
              document: { geometries: s.geometries, layers: s.layers },
              quantityItems: s.quantityItems,
              expectedContentVersion: loadedContentVersion,
              expectedQuantityVersion: loadedQuantityVersion,
            })
          : await apiClient.saveDraft(buildCloudSaveInput(cloudDraftSession, s.geometries, s.layers))
      if (result.ok) {
        const isNewDraft = 'revision' in result.value
        const savedRevisionId =
          isNewDraft ? result.value.revision.id : (targetRevisionId ?? null)
        setLastCloudRevisionId(savedRevisionId)
        setLastCloudDrawingId(
          isNewDraft ? result.value.drawing.id : (cloudDraftSession.drawingId ?? null),
        )
        setLoadedContentVersion(
          isNewDraft ? loadedContentVersion : result.value.content.contentVersion,
        )
        setLoadedQuantityVersion(
          isNewDraft ? loadedQuantityVersion : result.value.quantities.quantityVersion,
        )
        const savedText = isNewDraft
          ? `共有保存済み: ${result.value.project.projectNumber} / ${result.value.drawing.drawingNumber}`
          : `既存図面を更新しました（Rev.${cloudDraftSession.revisionNumber}）`
        setCloudSaveStatus({
          ok: true,
          text: savedText,
        })
      } else {
        const isConflict =
          result.error.apiErrorCode === 'CD-CONFLICT-001' ||
          result.error.apiErrorCode === 'CD-CONFLICT-002'
        setCloudConflict(isConflict)
        setCloudSaveStatus({
          ok: false,
          text: isConflict
            ? '共有保存失敗: サーバ上の図面が更新されています。最新版を再読込してください'
            : `共有保存失敗: ${result.error.message}`,
        })
      }
    } catch (err) {
      setCloudSaveStatus({ ok: false, text: `共有保存失敗: ${String(err)}` })
    } finally {
      setCloudSaving(false)
    }
  }

  /**
   * 図面健全性チェックを実行して結果パネルを開く（Issue #59）。
   * quantities は editor store が保持する state を参照する（Issue #116 Phase 3）。
   * 図形削除で sources が残った明細は unlinked-quantity、幾何変更で stale 化された
   * 明細は stale-quantity として検出される。
   */
  const runHealthCheck = () => {
    const state = storeApi.getState()
    setHealthResult(
      checkDrawingHealth(
        { geometries: state.geometries, layers: state.layers },
        {},
        { quantities: state.quantityItems },
      ),
    )
    setHealthOpen(true)
  }

  /** 数量明細を現在の図面から再計算し、チェック結果を更新する（§17.3 再計算要求）。 */
  const handleRecalculateQuantities = () => {
    storeApi.getState().recalculateQuantities()
    runHealthCheck()
  }

  /** CADコマンドラインの実行（Issue #47）。 */
  const runCommandLine = (raw: string) => {
    const result = parseCadCommand(raw)
    if (!result.ok) {
      setEditNotice(result.message)
      return
    }
    const state = storeApi.getState()
    const command = result.command
    switch (command.kind) {
      case 'undo':
        state.undo()
        break
      case 'redo':
        state.redo()
        break
      case 'grid':
        state.setGridVisible(command.visible)
        break
      case 'snap':
        state.setSnapEnabled(command.enabled)
        break
      case 'selectAll':
        state.select(state.geometries.map((g) => g.id))
        break
      case 'clearSelection':
        state.clearSelection()
        break
      case 'layer': {
        const existing = state.layers.find((l) => l.name === command.name)
        if (existing) {
          state.setActiveLayer(existing.id)
        } else {
          state.setActiveLayer(state.addLayer(command.name))
        }
        break
      }
      case 'help':
        setShortcutHelpOpen(true)
        break
    }
    setEditNotice(null)
    setCommandLineValue('')
  }

  const healthSeverityColor = (severity: 'error' | 'warning' | 'info') =>
    severity === 'error' ? '#B3261E' : severity === 'warning' ? '#A15C00' : 'var(--muted)'

  const runCloudReload = async () => {
    if (lastCloudRevisionId === null) {
      setCloudSaveStatus({ ok: false, text: '共有保存後に再読込できます' })
      return
    }
    setCloudSaving(true)
    setCloudConflict(false)
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

  /** コマンドパレット候補（#47）。実在する操作だけを列挙し、状態に応じて無効化する。 */
  const paletteState = storeApi.getState()
  const paletteItems: readonly CommandPaletteItem[] = [
    ...REAL_TOOLS.map(({ tool, icon, label }, index) => ({
      id: `tool-${tool}`,
      label: `ツール: ${label}`,
      keywords: [tool],
      icon,
      shortcut: index < 9 ? String(index + 1) : undefined,
      run: () => storeApi.getState().activateTool(tool),
    })),
    ...EDITING_TOOLS.map(({ tool, icon, label }) => ({
      id: `edit-${tool}`,
      label: `編集: ${label}`,
      keywords: [tool],
      icon,
      disabled: SELECTION_REQUIRED_TOOLS.has(tool) && paletteState.selectedIds.length === 0,
      run: () => storeApi.getState().activateEditingTool(tool),
    })),
    {
      id: 'undo',
      label: '元に戻す',
      keywords: ['undo'],
      icon: '↩',
      shortcut: 'Ctrl+Z',
      disabled: paletteState.undoStack.length === 0,
      run: () => storeApi.getState().undo(),
    },
    {
      id: 'redo',
      label: 'やり直す',
      keywords: ['redo'],
      icon: '↪',
      shortcut: 'Ctrl+Y',
      disabled: paletteState.redoStack.length === 0,
      run: () => storeApi.getState().redo(),
    },
    {
      id: 'clear-selection',
      label: '選択を解除',
      keywords: ['selection', 'clear', 'deselect'],
      icon: '◇',
      disabled: paletteState.selectedIds.length === 0,
      run: () => storeApi.getState().clearSelection(),
    },
    {
      id: 'delete-selection',
      label: '選択を削除',
      keywords: ['delete', 'remove'],
      icon: '🗑',
      shortcut: 'Delete',
      disabled: paletteState.selectedIds.length === 0,
      run: () => {
        const s = storeApi.getState()
        s.dispatchCommand(
          createDeleteGeometriesCommand(
            { geometries: s.geometries, layers: s.layers },
            s.selectedIds,
          ),
        )
      },
    },
    {
      id: 'toggle-grid',
      label: paletteState.gridVisible ? 'グリッドを非表示' : 'グリッドを表示',
      keywords: ['grid', 'gridVisible'],
      icon: '▦',
      run: () => storeApi.getState().setGridVisible(!storeApi.getState().gridVisible),
    },
    {
      id: 'health-check',
      label: '図面健全性チェック',
      keywords: ['health', 'check', 'audit'],
      icon: '🩺',
      run: () => {
        const s = storeApi.getState()
        setHealthResult(
          checkDrawingHealth(
            { geometries: s.geometries, layers: s.layers },
            {},
            { quantities: s.quantityItems },
          ),
        )
        setHealthOpen(true)
      },
    },
    {
      id: 'cloud-save',
      label: '共有保存',
      keywords: ['save', 'cloud', 'upload'],
      icon: '☁',
      disabled: paletteState.geometries.length === 0 || isLocalCloudSession,
      run: () => {
        void runCloudSave()
      },
    },
    {
      id: 'cloud-reload',
      label: '共有再読込',
      keywords: ['reload', 'load', 'download'],
      icon: '⟲',
      disabled: lastCloudRevisionId === null,
      run: () => {
        void runCloudReload()
      },
    },
  ]

  return (
    <div style={pageRootStyle}>
      {/* スクリーンリーダー向けライブリージョン（Issue #120）: 選択状態の変化を通知 */}
      <div
        aria-live="polite"
        role="status"
        style={{
          position: 'fixed',
          left: -10000,
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {selectedGeometries.length > 0
          ? `図形を${selectedGeometries.length}件選択中`
          : '選択なし'}
      </div>
      <header style={headerBarStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cloudDraftSession.projectName}</span>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{cloudDraftSession.drawingName}</span>
        </div>
        <span style={{ ...monoStyle, fontSize: 12, color: 'var(--muted)' }}>{cloudDraftSession.revisionNumber}</span>
        {checkout?.status === 'checkedOut' && (
          <span
            style={statusBadgeStyle(
              checkout.checkedOutBy === checkoutActor ? '#1F8255' : '#C5392F',
              checkout.checkedOutBy === checkoutActor ? '#E4F3EC' : '#FCE9E7',
            )}
          >
            {checkout.checkedOutBy === checkoutActor
              ? `チェックアウト中（${checkout.checkedOutBy}）`
              : `別ユーザーがチェックアウト中（${checkout.checkedOutBy}）・編集は共有保存時 409 で拒否されます`}
          </span>
        )}
        {checkout?.status === 'checkedIn' && (
          <span style={statusBadgeStyle('#5A6678', 'var(--subtle)')}>チェックイン済み</span>
        )}
        <button type="button" style={ghostButtonStyle} onClick={handleCheckoutToggle}>
          {checkout?.status === 'checkedOut' ? 'チェックイン' : 'チェックアウト'}
        </button>
        <span style={statusBadgeStyle(autosaveStatus.ok ? '#1F8255' : '#C5392F', autosaveStatus.ok ? '#E4F3EC' : '#FCE9E7')}>
          {autosaveStatus.text}
        </span>
        {cloudSaveStatus !== null && (
          <span style={statusBadgeStyle(cloudSaveStatus.ok ? '#1F8255' : '#C5392F', cloudSaveStatus.ok ? '#E4F3EC' : '#FCE9E7')}>
            {cloudSaveStatus.text}
          </span>
        )}
        {cloudConflict && (
          <button
            type="button"
            style={ghostButtonStyle}
            aria-label="サーバの最新版を再読込"
            onClick={() => {
              void runCloudReload()
            }}
          >
            ⚠️ 最新版を再読込
          </button>
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
        <button
          title="コマンドパレット（Ctrl+K）"
          aria-label="コマンドパレットを開く"
          style={ghostButtonStyle}
          onClick={() => setCommandPaletteOpen(true)}
        >
          ⌘K
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
          disabled={cloudSaving || isLocalCloudSession}
          title={
            isLocalCloudSession
              ? '実案件を選択すると共有保存できます（現在はローカル編集）'
              : isExistingRevision
                ? '既存改訂へ内容・数量を保存します（楽観ロック）'
                : undefined
          }
          onClick={() => {
            void runCloudSave()
          }}
        >
          {cloudSaving ? '保存中' : isExistingRevision ? '共有更新' : '共有保存'}
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
        <button style={ghostButtonStyle} onClick={runHealthCheck}>
          図面健全性
        </button>
        <button
          type="button"
          style={ghostButtonStyle}
          aria-label="DXF取込"
          title="DXF取込（.dxf）"
          onClick={() => dxfInputRef.current?.click()}
        >
          📥 取込
        </button>
        <input
          ref={dxfInputRef}
          type="file"
          accept=".dxf,application/dxf,.dwg,.jww,.jwf,.sxf,.sima,.landxml,.pdf,.csv"
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            void handleImportDxf(e.target.files?.[0])
          }}
        />
        <button
          type="button"
          style={ghostButtonStyle}
          aria-label="現場説明モード"
          title="現場説明モード（閲覧特化）"
          onClick={() => onNavigate('field')}
        >
          📢 説明
        </button>
        <button style={primaryButtonStyle} onClick={() => onNavigate('print')}>
          出力
        </button>
      </header>

      {healthOpen && (
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--line2)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>図面健全性チェック</span>
            {healthResult !== null && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                図形 {healthResult.geometryCount} 件・レイヤー {healthResult.layerCount} 件
              </span>
            )}
            <button style={ghostButtonStyle} onClick={runHealthCheck}>
              再チェック
            </button>
            <button style={ghostButtonStyle} onClick={handleRecalculateQuantities}>
              数量を再計算
            </button>
            <button style={ghostButtonStyle} onClick={() => setHealthOpen(false)}>
              閉じる
            </button>
          </div>
          {healthResult === null ? (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              「再チェック」を押すと図面の問題（用紙外図形・不明レイヤー等）を検出します。
            </div>
          ) : healthResult.healthy ? (
            <div role="status" style={{ fontSize: 12.5, color: '#1F8255', fontWeight: 600 }}>
              ✅ 問題なし
            </div>
          ) : (
            healthResult.issues.map((issue) => (
              <div
                key={issue.code}
                role="status"
                style={{ fontSize: 12.5, color: healthSeverityColor(issue.severity) }}
              >
                {issue.severity === 'error' ? '🚨' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'} {issue.message}
                {issue.geometryIds.length > 0 && (
                  <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
                      対象図形 ID: {issue.geometryIds.join(', ')}
                    </span>
                    <button
                      type="button"
                      style={{ ...ghostButtonStyle, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => storeApi.getState().select(issue.geometryIds)}
                    >
                      対象を選択
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {(migrationNotice !== null || migrationIssues.length > 0) && (
        <div
          role="status"
          style={{
            margin: '0 18px',
            padding: '10px 14px',
            borderRadius: 8,
            background: migrationNotice !== null && migrationIssues.length === 0 ? '#FDECEA' : '#FFF7E8',
            border: migrationNotice !== null && migrationIssues.length === 0 ? '1px solid #F2B8B5' : '1px solid #F0D9B0',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
              {migrationNotice !== null && migrationIssues.length === 0 ? '📋 移行アシスタント' : '📋 移行レポート（DXF取込）'}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={ghostButtonStyle}
              onClick={() => {
                setMigrationNotice(null)
                setMigrationIssues([])
              }}
            >
              閉じる
            </button>
          </div>
          {migrationNotice !== null && (
            <div style={{ fontSize: 12.5, color: migrationIssues.length === 0 ? '#B3261E' : '#8A5A00' }}>
              {migrationNotice}
            </div>
          )}
          {migrationIssues.map((issue) => (
            <div key={issue.code} style={{ fontSize: 12, color: 'var(--ink2)' }}>
              <span style={{ fontWeight: 600, color: issue.severity === 'error' ? '#B3261E' : issue.severity === 'warning' ? '#A15C00' : 'var(--muted)' }}>
                {issue.severity === 'error' ? '🚨' : issue.severity === 'warning' ? '⚠️' : 'ℹ️'} {issue.code}
              </span>
              ：{issue.message}
              <div style={{ marginTop: 2, color: 'var(--muted)' }}>💡 {migrationAdvice(issue)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={bodyRowStyle}>
        <aside style={toolPanelStyle}>
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabelStyle}>作図・編集</div>
            <div
              role="toolbar"
              aria-label="作図ツール"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}
            >
              {REAL_TOOLS.map(({ tool, icon, label }) => (
                <button
                  key={tool}
                  title={label}
                  aria-label={label}
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
            <div
              role="toolbar"
              aria-label="編集ツール"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}
            >
              {EDITING_TOOLS.map(({ tool, icon, label }) => {
                const isActive = activeEditingTool === tool
                const needsSelection = SELECTION_REQUIRED_TOOLS.has(tool)
                const disabled = needsSelection && selectedIds.length === 0
                return (
                  <button
                    key={tool}
                    title={label}
                    aria-label={label}
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
                {activeEditingTool === 'array' && (
                  <>
                    <ParamInputControl
                      label="行数"
                      value={editingArrayRows}
                      onChange={(v) => storeApi.getState().setEditingArrayRows(v)}
                    />
                    <ParamInputControl
                      label="列数"
                      value={editingArrayCols}
                      onChange={(v) => storeApi.getState().setEditingArrayCols(v)}
                    />
                    <ParamInputControl
                      label="行間隔 (mm)"
                      value={editingArrayRowSpacing}
                      onChange={(v) => storeApi.getState().setEditingArrayRowSpacing(v)}
                    />
                    <ParamInputControl
                      label="列間隔 (mm)"
                      value={editingArrayColSpacing}
                      onChange={(v) => storeApi.getState().setEditingArrayColSpacing(v)}
                    />
                  </>
                )}
                {activeEditingTool === 'scale' && (
                  <ParamInputControl
                    label="倍率"
                    value={editingScaleFactor}
                    onChange={(v) => storeApi.getState().setEditingScaleFactor(v)}
                  />
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={sectionLabelStyle}>スナップ</div>
              <button
                type="button"
                aria-label="スナップ有効"
                aria-pressed={snapEnabled}
                style={snapEnabled ? toolButtonActiveStyle : toolButtonStyle}
                onClick={() => storeApi.getState().setSnapEnabled(!snapEnabled)}
              >
                {snapEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>許容差</span>
              <input
                type="number"
                aria-label="スナップ許容差px"
                value={snapTolerancePx}
                min={1}
                max={40}
                style={{ ...editParamInputStyle, width: 56 }}
                onChange={(e) => storeApi.getState().setSnapTolerancePx(Number(e.target.value) || 10)}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>px</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(
                [
                  ['snapEndpoint', '端点'],
                  ['snapMidpoint', '中点'],
                  ['snapCenter', '中心'],
                  ['snapIntersection', '交点'],
                  ['snapGrid', 'グリッド'],
                ] as const
              ).map(([key, label]) => {
                const active = key === 'snapEndpoint' ? snapEndpoint
                  : key === 'snapMidpoint' ? snapMidpoint
                  : key === 'snapCenter' ? snapCenter
                  : key === 'snapIntersection' ? snapIntersection
                  : snapGrid
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`スナップ: ${label}`}
                    aria-pressed={active}
                    disabled={!snapEnabled}
                    style={{
                      ...miniButtonStyle,
                      background: active ? 'var(--hover)' : 'var(--surface)',
                      color: active ? 'var(--ink)' : 'var(--muted)',
                      opacity: snapEnabled ? 1 : 0.5,
                    }}
                    onClick={() => storeApi.getState().toggleSnapType(key === 'snapEndpoint' ? 'endpoint' : key === 'snapMidpoint' ? 'midpoint' : key === 'snapCenter' ? 'center' : key === 'snapIntersection' ? 'intersection' : 'grid')}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabelStyle}>コマンドライン</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                aria-label="CADコマンドライン"
                placeholder="例: layer 施工ヤード / undo / grid on"
                value={commandLineValue}
                style={{ ...fieldInputStyle, flex: 1, textAlign: 'left' }}
                onChange={(e) => setCommandLineValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runCommandLine(commandLineValue)
                  if (e.key === 'Escape') setCommandLineValue('')
                }}
              />
              <button
                type="button"
                style={ghostButtonStyle}
                aria-label="コマンド一覧を表示"
                title="コマンド一覧（?）"
                onClick={() => setShortcutHelpOpen(true)}
              >
                ?
              </button>
            </div>
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
            {activeTool === 'measure' && (
              <span style={{ color: 'var(--ink2)' }}>
                {draftPoints.length === 0
                  ? '測距: 1点目をクリック'
                  : draftPoints.length === 1
                    ? '測距: 2点目をクリック（続けて点を追加すると面積も算出）'
                    : (() => {
                        const dist = measureDistance(draftPoints)
                        const area = measureArea(draftPoints, true)
                        const parts: string[] = []
                        if (dist !== null) parts.push(`距離 ${formatLengthMm(dist.distanceMm)}`)
                        if (area !== null) {
                          parts.push(`面積 ${(area.areaMm2 / 1e6).toFixed(3)} m²`)
                          parts.push(`周長 ${formatLengthMm(area.perimeterMm)}`)
                        }
                        return `測距: ${parts.join(' / ')}`
                      })()}
              </span>
            )}
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
          {selectedGeometries.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button type="button" style={ghostButtonStyle} onClick={handleExplodeSelected}>
                分解
              </button>
              <button type="button" style={ghostButtonStyle} onClick={handleJoinSelected}>
                結合
              </button>
            </div>
          )}
          {selectedGeometries.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>図形を選択すると詳細が表示されます。</div>
          )}
          {selectedGeometries.length > 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ color: 'var(--ink2)', fontSize: 12.5 }}>
                {selectedGeometries.length}件選択中（一括編集）
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>線色</span>
                <input
                  type="color"
                  aria-label="一括: 線色"
                  defaultValue="#000000"
                  onChange={(e) => bulkApplyStyle({ strokeColor: e.target.value })}
                />
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>線幅</span>
                <input
                  type="number"
                  aria-label="一括: 線幅"
                  defaultValue={1}
                  min={0.1}
                  step={0.5}
                  style={editParamInputStyle}
                  onChange={(e) => bulkApplyStyle({ strokeWidth: Math.max(0.1, Number(e.target.value) || 1) })}
                />
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>線種</span>
                <select
                  aria-label="一括: 線種"
                  defaultValue="continuous"
                  style={miniSelectStyle}
                  onChange={(e) => bulkApplyStyle({ lineType: e.target.value as GeometryStyle['lineType'] })}
                >
                  <option value="continuous">実線</option>
                  <option value="dashed">破線</option>
                  <option value="dashDot">一点鎖線</option>
                  <option value="dotted">点線</option>
                </select>
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>印刷</span>
                <input
                  type="checkbox"
                  aria-label="一括: 印刷"
                  defaultChecked
                  onChange={(e) => bulkApplyStyle({ printable: e.target.checked })}
                />
              </div>
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>レイヤー</span>
                <select
                  aria-label="一括: レイヤー移動"
                  defaultValue=""
                  style={miniSelectStyle}
                  onChange={(e) => bulkApplyLayer(e.target.value as LayerId)}
                >
                  <option value="">移動先を選択</option>
                  {layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
      {commandPaletteOpen && (
        <CommandPalette open onClose={() => setCommandPaletteOpen(false)} items={paletteItems} />
      )}
      {shortcutHelpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ショートカットとコマンド一覧"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShortcutHelpOpen(false)}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              boxShadow: 'var(--shadow)',
              padding: '18px 22px',
              width: 520,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>ショートカットとコマンド一覧</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {[
                  ['Ctrl/Cmd+Z', '元に戻す'],
                  ['Ctrl/Cmd+Y / Ctrl+Shift+Z', 'やり直す'],
                  ['Ctrl/Cmd+K', 'コマンドパレット'],
                  ['Delete / Backspace', '選択図形を削除'],
                  ['1〜8', '作図ツール切替'],
                  ['Esc', '作図取消 / 選択解除'],
                  ['Arrow（キャンバスfocus時）', 'パン'],
                  ['Space（押下中）', 'パンモード'],
                  ['?', 'この一覧を表示'],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td style={{ padding: '4px 8px', color: 'var(--ink)', whiteSpace: 'nowrap', fontWeight: 600 }}>{key}</td>
                    <td style={{ padding: '4px 8px', color: 'var(--ink2)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, fontWeight: 600, margin: '12px 0 4px' }}>CADコマンドライン</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <tbody>
                {CAD_COMMAND_HELP.map((item) => (
                  <tr key={item.command}>
                    <td style={{ padding: '3px 8px', color: 'var(--ink)', whiteSpace: 'nowrap', fontWeight: 600 }}>{item.command}</td>
                    <td style={{ padding: '3px 8px', color: 'var(--ink2)' }}>{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" style={{ ...primaryButtonStyle, marginTop: 12 }} onClick={() => setShortcutHelpOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
