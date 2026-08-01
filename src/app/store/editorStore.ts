/**
 * エディタ状態管理。詳細設計仕様書 §8 の EditorStore（Slice合成）を実装する。
 *
 * 継承元: Civil-Draw src/store/canvasStore.ts / layerStore.ts / toolStore.ts（継承台帳 modify）。
 * 継承元との差分（Issue #7: グローバルシングルトン解消）:
 * - 継承元は3分割store（canvasStore/layerStore/toolStore）を各モジュールレベルで
 *   create() したシングルトンだった。本実装は仕様書§8.1の単一EditorStoreへ統合し、
 *   createEditorStore() ファクトリで生成する（複数図面インスタンス・テスト分離が可能）。
 * - 空間索引（GeometryIndex、R-tree）を store インスタンスに同梱し、document系
 *   アクションが常に索引を同期する。描画層・ヒットテストは getIndex() を参照する。
 * - zoom範囲 0.001〜50 は継承元の値を踏襲（km規模の地形DXFと詳細編集の両対応）。
 *
 * Phase 1 スコープ: DocumentSlice / ViewportSlice / LayerSlice / SelectionSlice。
 * HistorySlice（Undo/Redo Commandパターン、Issue #8）・ToolSlice・SaveStatusSlice等は
 * 後続Issueで追加する。DocumentSlice の applyCommand も HistorySlice 導入時に実装し、
 * それまでは直接変更アクション（add/update/remove）を公開する。
 */
import { createStore } from 'zustand'
import { GeometryIndex } from '@/domain/geometry/spatialIndex'
import { unionBBox } from '@/domain/geometry/shapeBBox'
import type { EditorCommand } from '@/domain/commands/editorCommand'
import type { DocumentState } from '@/domain/commands/editorCommand'
import { createAddGeometryCommand } from '@/domain/commands/geometryCommands'
import { defaultCreationContext, type GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import {
  AUTO_COMMIT_POINT_COUNT,
  buildDraftFields,
  buildDraftPreview,
  composeDraftGeometry,
  type DraftShapeFields,
  type ToolType,
} from '@/domain/tools/draftGeometry'
import type { EditingToolType } from '@/domain/tools/editGeometry'
const REPEAT_EDITING_TOOLS: ReadonlySet<EditingToolType> = new Set([
  'rotate',
  'mirror',
  'offset',
  'fillet',
  'chamfer',
])
import { dispatchEditingOperation } from '@/domain/tools/editGeometry'
import type {
  ConstructionStepId,
  DrawingLayer,
  Geometry,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'

export const MIN_ZOOM = 0.001
export const MAX_ZOOM = 50

/**
 * 履歴（undo/redo）保持件数の上限（Issue #8）。詳細設計仕様書 §7.2 の
 * 「件数とメモリ量の双方で制御」に対する暫定値。正式な上限（件数＋メモリ量の複合条件）は
 * 性能試験で確定する。
 */
export const HISTORY_LIMIT = 100

/** 既定レイヤーの表示属性（仕様書§6.3 defaultStyle）。 */
const DEFAULT_LAYER_STYLE: GeometryStyle = {
  strokeColor: '#1f2937',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

/** 起動直後の既定レイヤー。IDは決定的（テスト・初期描画の再現性のため）。 */
export function createDefaultLayer(): DrawingLayer {
  return {
    id: 'layer-default' as LayerId,
    name: 'レイヤー0',
    order: 0,
    visible: true,
    locked: false,
    printable: true,
    defaultStyle: DEFAULT_LAYER_STYLE,
  }
}

export interface DocumentSlice {
  readonly geometries: readonly Geometry[]
  addGeometries: (geometries: readonly Geometry[]) => void
  updateGeometry: (geometry: Geometry) => void
  removeGeometries: (ids: readonly GeometryId[]) => void
  /** 図面全体の置き換え（DXFインポート・ファイル読込）。索引も再構築する。 */
  replaceDocument: (geometries: readonly Geometry[], layers: readonly DrawingLayer[]) => void
}

export interface ViewportSlice {
  readonly zoom: number
  readonly panX: number
  readonly panY: number
  readonly gridVisible: boolean
  /** グリッド間隔（mm、ADR-0012）。継承元gridUnitの既定1000mm=1mを踏襲。 */
  readonly gridUnitMm: number
  setPan: (panX: number, panY: number) => void
  setZoom: (zoom: number) => void
  /**
   * screen上の固定点を保ったままズームする（ホイールズームの標準挙動）。
   * anchor直下のdomain点がズーム前後で同じscreen位置に留まる。
   */
  zoomAt: (anchorScreen: { readonly x: number; readonly y: number }, factor: number) => void
  /** 全図形が収まるようにzoom/panを調整する（仕様書§8.1 fitToSelection相当の全体版）。 */
  zoomFit: (viewportWidthPx: number, viewportHeightPx: number) => void
  setGridVisible: (visible: boolean) => void
  setGridUnitMm: (unitMm: number) => void
}

export interface LayerSlice {
  readonly layers: readonly DrawingLayer[]
  readonly activeLayerId: LayerId
  setActiveLayer: (id: LayerId) => void
  toggleLayerVisible: (id: LayerId) => void
  toggleLayerLock: (id: LayerId) => void
  toggleLayerPrintable: (id: LayerId) => void
  addLayer: (name: string) => LayerId
  removeLayer: (id: LayerId) => void
  updateLayerName: (id: LayerId, name: string) => void
  updateLayerLineWidth: (id: LayerId, lineWidth: number) => void
  reorderLayer: (id: LayerId, direction: 'up' | 'down') => void
}

export interface SelectionSlice {
  readonly selectedIds: readonly GeometryId[]
  readonly hoveredId: GeometryId | null
  select: (ids: readonly GeometryId[]) => void
  toggleSelect: (id: GeometryId) => void
  clearSelection: () => void
  setHovered: (id: GeometryId | null) => void
}

/**
 * 施工ステップ表示（仕様書§18 / Phase 5）。
 * currentStepId=null は全表示。CanvasStage が filterGeometriesByStep で描画対象を絞る。
 * ステップ未割当（constructionStepIds空）の図形は全ステップ共通として常に表示される。
 */
export interface StepSlice {
  readonly currentStepId: ConstructionStepId | null
  setCurrentStep: (id: ConstructionStepId | null) => void
}

/**
 * Undo/Redo（Command パターン、Issue #8 / 仕様書 §7）。
 * 履歴に積むのは差分コマンドのみ（全図形スナップショットを持たない）。
 * 履歴規則（§7.2）: 1 操作 = 1 コマンド / Undo 後の新規操作で Redo 破棄 / 件数上限で古い順に押し出す。
 */
export interface HistorySlice {
  readonly undoStack: readonly EditorCommand[]
  readonly redoStack: readonly EditorCommand[]
  /**
   * コマンドを実行して履歴へ積む。execute 適用 → 空間索引同期 → undoStack へ push →
   * redoStack 破棄。undoStack が HISTORY_LIMIT を超えたら古い順に押し出す。
   */
  dispatchCommand: (command: EditorCommand) => void
  /** 直近コマンドを取り消す（undoStack → redoStack）。空なら no-op。 */
  undo: () => void
  /** 取り消したコマンドを再実行する（redoStack → undoStack）。空なら no-op。 */
  redo: () => void
  /** 履歴を全消去する（新規作成・ファイル読込時など）。 */
  clearHistory: () => void
}

/**
 * 作図ツール状態機械（詳細設計仕様書 §8.1 / Issue #8）。
 * activate/addPoint/commit/cancel の 4 遷移で作図ドラフトを管理し、確定時に
 * AddGeometryCommand を HistorySlice.dispatchCommand へ発行する（作図＝履歴・監査可能な 1 操作）。
 * draftCursor はプレビュー専用でコマンド化しない（ドラッグ中の連続座標を履歴化しない、§7.2）。
 */
export interface ToolSlice {
  readonly activeTool: ToolType
  readonly draftPoints: readonly Point[]
  readonly draftCursor: Point | null
  readonly activeEditingTool: EditingToolType | null
  readonly editingOffsetDistance: number
  readonly editingFilletRadius: number
  readonly editingChamferDist: number
  activateTool: (tool: ToolType) => void
  addDraftPoint: (point: Point) => void
  updateDraftCursor: (point: Point | null) => void
  commitDraft: () => void
  cancelDraft: () => void
  activateEditingTool: (tool: EditingToolType | null) => void
  setEditingOffsetDistance: (dist: number) => void
  setEditingFilletRadius: (radius: number) => void
  setEditingChamferDist: (dist: number) => void
  executeEditingOperation: (clickPoint: Point | null) => void
}

export type EditorState = DocumentSlice &
  ViewportSlice &
  LayerSlice &
  SelectionSlice &
  StepSlice &
  HistorySlice &
  ToolSlice

export type EditorStore = ReturnType<typeof createEditorStore>

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * コマンド適用後、新旧 geometries 配列の id 差分から空間索引を同期する。
 * 既存の GeometryIndex.add/update/remove を流用し、コマンド側は索引を関知しない
 * （EditorCommand.execute/undo は DocumentState のみを扱う純粋関数）。
 * 注: 現状は O(N) の全走査。将来コマンドが affected id を宣言できれば差分同期に最適化できる。
 */
function syncIndexDiff(index: GeometryIndex, prev: readonly Geometry[], next: readonly Geometry[]): void {
  const prevMap = new Map<GeometryId, Geometry>(prev.map((g) => [g.id, g]))
  const nextMap = new Map<GeometryId, Geometry>(next.map((g) => [g.id, g]))
  for (const g of next) {
    const old = prevMap.get(g.id)
    if (old === undefined) index.add(g)
    else if (old !== g) index.update(g)
  }
  for (const g of prev) {
    if (!nextMap.has(g.id)) index.remove(g.id)
  }
}

/** コマンド適用後、存在しなくなった図形への選択/ホバー参照を除去する（removeGeometries と同じ整合則）。 */
function reconcileSelection(
  geometries: readonly Geometry[],
  selectedIds: readonly GeometryId[],
  hoveredId: GeometryId | null,
): { selectedIds: readonly GeometryId[]; hoveredId: GeometryId | null } {
  if (selectedIds.length === 0 && hoveredId === null) return { selectedIds, hoveredId }
  const ids = new Set<GeometryId>(geometries.map((g) => g.id))
  return {
    selectedIds: selectedIds.filter((id) => ids.has(id)),
    hoveredId: hoveredId !== null && ids.has(hoveredId) ? hoveredId : null,
  }
}

/** activeLayerId に対応するレイヤーを解決する（見つからなければ先頭、無ければ既定レイヤー）。 */
function resolveActiveLayer(layers: readonly DrawingLayer[], activeLayerId: LayerId): DrawingLayer {
  return layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? createDefaultLayer()
}

/**
 * ドラフト確定図形を GeometryBase 合成 → AddGeometryCommand として履歴へ積む。
 * geometry.id とタイムスタンプ、コマンドの id/occurredAt はいずれも注入 ctx 由来（決定的テスト可能）。
 */
function emitDraftGeometry(
  get: () => EditorState,
  ctx: GeometryCreationContext,
  fields: DraftShapeFields,
): void {
  const state = get()
  const layer = resolveActiveLayer(state.layers, state.activeLayerId)
  // Issue #40: ロック済みレイヤーへの作図は拒否する（§6.3 運用規則）。
  if (layer.locked) return
  const timestamp = ctx.now()
  const geometry = composeDraftGeometry(fields, {
    id: ctx.newId(),
    layerId: layer.id,
    style: layer.defaultStyle,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  state.dispatchCommand(createAddGeometryCommand(geometry, ctx))
}

/**
 * EditorStore を生成する。ctx（ADR-0013 の GeometryCreationContext）を注入すると作図で発番される
 * 図形 ID・タイムスタンプ・コマンド ID を決定化できる（省略時は defaultCreationContext）。
 */
export function createEditorStore(ctx: GeometryCreationContext = defaultCreationContext) {
  // 空間索引はreactiveな状態ではなく、storeインスタンスに寄り添う可変構造として保持する
  // （R-treeを毎更新でコピーするのは非現実的なため。参照はgetIndex()経由で公開）。
  const index = new GeometryIndex()
  const defaultLayer = createDefaultLayer()

  const store = createStore<EditorState>()((set, get) => ({
    // --- DocumentSlice ---
    // 注（Issue #8）: Command 経由（HistorySlice.dispatchCommand/undo/redo）が正の編集経路。
    // 以下の直接変更アクション（addGeometries/updateGeometry/removeGeometries/replaceDocument）は
    // 履歴に積まれないため、ツール未整備期間の暫定として後方互換で残す（既存呼び出し・DXF読込用）。
    geometries: [],
    addGeometries: (geometries) => {
      for (const g of geometries) index.add(g)
      set((s) => ({ geometries: [...s.geometries, ...geometries] }))
    },
    updateGeometry: (geometry) => {
      index.update(geometry)
      set((s) => ({
        geometries: s.geometries.map((g) => (g.id === geometry.id ? geometry : g)),
      }))
    },
    removeGeometries: (ids) => {
      const removed = new Set<GeometryId>(ids)
      for (const id of ids) index.remove(id)
      set((s) => ({
        geometries: s.geometries.filter((g) => !removed.has(g.id)),
        selectedIds: s.selectedIds.filter((id) => !removed.has(id)),
        hoveredId: s.hoveredId !== null && removed.has(s.hoveredId) ? null : s.hoveredId,
      }))
    },
    replaceDocument: (geometries, layers) => {
      index.load(geometries)
      const first = layers[0]
      set({
        geometries: [...geometries],
        layers: layers.length > 0 ? [...layers] : [defaultLayer],
        activeLayerId: first !== undefined ? first.id : defaultLayer.id,
        selectedIds: [],
        hoveredId: null,
      })
    },

    // --- ViewportSlice ---
    zoom: 1,
    panX: 0,
    panY: 0,
    gridVisible: true,
    gridUnitMm: 1000,
    setPan: (panX, panY) => set({ panX, panY }),
    setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
    zoomAt: (anchorScreen, factor) => {
      const { zoom, panX, panY } = get()
      const newZoom = clampZoom(zoom * factor)
      if (newZoom === zoom) return
      // anchor直下のdomain点 d = (anchor - pan) / zoom を新zoomでも同じscreen位置に置く:
      // pan' = anchor - d * zoom'
      const ratio = newZoom / zoom
      set({
        zoom: newZoom,
        panX: anchorScreen.x - (anchorScreen.x - panX) * ratio,
        panY: anchorScreen.y - (anchorScreen.y - panY) * ratio,
      })
    },
    zoomFit: (viewportWidthPx, viewportHeightPx) => {
      const bbox = unionBBox(get().geometries)
      if (bbox === null) {
        set({ zoom: 1, panX: 0, panY: 0 })
        return
      }
      const bboxW = bbox.maxX - bbox.minX || 1
      const bboxH = bbox.maxY - bbox.minY || 1
      const newZoom = clampZoom(
        Math.min(viewportWidthPx / bboxW, viewportHeightPx / bboxH) * 0.9,
      )
      set({
        zoom: newZoom,
        panX: (viewportWidthPx - bboxW * newZoom) / 2 - bbox.minX * newZoom,
        panY: (viewportHeightPx - bboxH * newZoom) / 2 - bbox.minY * newZoom,
      })
    },
    setGridVisible: (gridVisible) => set({ gridVisible }),
    setGridUnitMm: (unitMm) => set({ gridUnitMm: Math.max(1, unitMm) }),

    // --- LayerSlice ---
    layers: [defaultLayer],
    activeLayerId: defaultLayer.id,
    setActiveLayer: (id) => {
      if (get().layers.some((l) => l.id === id)) set({ activeLayerId: id })
    },
    toggleLayerVisible: (id) =>
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
      })),
    toggleLayerLock: (id) =>
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
      })),
    toggleLayerPrintable: (id) =>
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, printable: !l.printable } : l)),
      })),
    addLayer: (name) => {
      const id = crypto.randomUUID() as LayerId
      const currentLayers = get().layers
      const maxOrder = currentLayers.reduce((m, l) => Math.max(m, l.order), -1)
      const newLayer: DrawingLayer = {
        id,
        name,
        order: maxOrder + 1,
        visible: true,
        locked: false,
        printable: true,
        defaultStyle: { ...DEFAULT_LAYER_STYLE },
      }
      set({ layers: [...currentLayers, newLayer] })
      return id
    },
    removeLayer: (id) => {
      const state = get()
      if (state.layers.length <= 1) return
      const target = state.layers.find((l) => l.id === id)
      if (target === undefined) return
      const remaining = state.layers.filter((l) => l.id !== id)
      const fallback = remaining[0]
      if (fallback === undefined) return
      // geometries on removed layer → reassign to fallback layer
      const affectedIds = state.geometries
        .filter((g) => g.layerId === id)
        .map((g) => g.id)
      const nextGeometries =
        affectedIds.length > 0
          ? state.geometries.map((g) => (g.layerId === id ? { ...g, layerId: fallback.id } : g))
          : state.geometries
      // sync geometry index for reassigned geometries
      for (const gid of affectedIds) {
        const g = nextGeometries.find((x) => x.id === gid)
        if (g !== undefined) index.update(g)
      }
      set({
        layers: remaining,
        activeLayerId: state.activeLayerId === id ? fallback.id : state.activeLayerId,
        geometries: nextGeometries,
      })
    },
    updateLayerName: (id, name) =>
      set((s) => ({
        layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)),
      })),
    updateLayerLineWidth: (id, lineWidth) =>
      set((s) => ({
        layers: s.layers.map((l) =>
          l.id === id ? { ...l, defaultStyle: { ...l.defaultStyle, strokeWidth: lineWidth } } : l,
        ),
      })),
    reorderLayer: (id, direction) =>
      set((s) => {
        const sorted = [...s.layers].sort((a, b) => a.order - b.order)
        const idx = sorted.findIndex((l) => l.id === id)
        if (idx === -1) return s
        const targetIdx = direction === 'up' ? idx - 1 : idx + 1
        if (targetIdx < 0 || targetIdx >= sorted.length) return s
        const a = sorted[idx]
        const b = sorted[targetIdx]
        if (a === undefined || b === undefined) return s
        const swapped = sorted.map((l) => {
          if (l.id === a.id) return { ...l, order: b.order }
          if (l.id === b.id) return { ...l, order: a.order }
          return l
        })
        return { layers: swapped }
      }),

    // --- SelectionSlice ---
    selectedIds: [],
    hoveredId: null,
    select: (ids) => set({ selectedIds: [...ids] }),
    toggleSelect: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id],
      })),
    clearSelection: () => set({ selectedIds: [], hoveredId: null }),
    setHovered: (hoveredId) => set({ hoveredId }),

    // --- StepSlice（仕様書§18: 施工ステップ表示） ---
    currentStepId: null,
    setCurrentStep: (currentStepId) => set({ currentStepId }),

    // --- HistorySlice（Issue #8: Undo/Redo Command パターン） ---
    undoStack: [],
    redoStack: [],
    dispatchCommand: (command) => {
      const s = get()
      const next = command.execute({ geometries: s.geometries, layers: s.layers })
      syncIndexDiff(index, s.geometries, next.geometries)
      const undoStack = [...s.undoStack, command]
      set({
        geometries: next.geometries,
        layers: next.layers,
        undoStack:
          undoStack.length > HISTORY_LIMIT
            ? undoStack.slice(undoStack.length - HISTORY_LIMIT)
            : undoStack,
        redoStack: [],
        ...reconcileSelection(next.geometries, s.selectedIds, s.hoveredId),
      })
    },
    undo: () => {
      const s = get()
      const command = s.undoStack[s.undoStack.length - 1]
      if (command === undefined) return
      const next = command.undo({ geometries: s.geometries, layers: s.layers })
      syncIndexDiff(index, s.geometries, next.geometries)
      set({
        geometries: next.geometries,
        layers: next.layers,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, command],
        ...reconcileSelection(next.geometries, s.selectedIds, s.hoveredId),
      })
    },
    redo: () => {
      const s = get()
      const command = s.redoStack[s.redoStack.length - 1]
      if (command === undefined) return
      const next = command.execute({ geometries: s.geometries, layers: s.layers })
      syncIndexDiff(index, s.geometries, next.geometries)
      set({
        geometries: next.geometries,
        layers: next.layers,
        undoStack: [...s.undoStack, command],
        redoStack: s.redoStack.slice(0, -1),
        ...reconcileSelection(next.geometries, s.selectedIds, s.hoveredId),
      })
    },
    clearHistory: () => set({ undoStack: [], redoStack: [] }),

    // --- ToolSlice（Issue #8: 作図ツール状態機械, §8.1 + Issue #37: 編集ツール） ---
    activeTool: 'select',
    draftPoints: [],
    draftCursor: null,
    activeEditingTool: null,
    editingOffsetDistance: 100,
    editingFilletRadius: 50,
    editingChamferDist: 50,
    activateTool: (tool) => set({ activeTool: tool, draftPoints: [], draftCursor: null, activeEditingTool: null }),
    updateDraftCursor: (point) => set({ draftCursor: point }),
    cancelDraft: () => set({ draftPoints: [], draftCursor: null }),
    addDraftPoint: (point) => {
      const state = get()
      if (state.activeTool === 'select' || state.activeTool === 'hatch') return
      if (state.activeTool === 'text' && state.draftPoints.length >= 1) return
      const nextPoints = [...state.draftPoints, point]
      const required = AUTO_COMMIT_POINT_COUNT[state.activeTool]
      if (required === undefined || nextPoints.length < required) {
        set({ draftPoints: nextPoints })
        return
      }
      const fields = buildDraftFields(state.activeTool, nextPoints)
      if (fields !== null) emitDraftGeometry(get, ctx, fields)
      set({ draftPoints: [] })
    },
    commitDraft: () => {
      const state = get()
      if (state.activeTool !== 'polyline') return
      const fields = buildDraftFields(state.activeTool, state.draftPoints)
      if (fields !== null) emitDraftGeometry(get, ctx, fields)
      set({ draftPoints: [], draftCursor: null })
    },
    activateEditingTool: (tool) =>
      set({ activeEditingTool: tool, activeTool: 'select', draftPoints: [], draftCursor: null }),
    setEditingOffsetDistance: (dist) => set({ editingOffsetDistance: Math.max(0, dist) }),
    setEditingFilletRadius: (radius) => set({ editingFilletRadius: Math.max(0.1, radius) }),
    setEditingChamferDist: (dist) => set({ editingChamferDist: Math.max(0.1, dist) }),
    executeEditingOperation: (clickPoint) => {
      const s = get()
      if (s.activeEditingTool === null) return
      const doc: DocumentState = { geometries: s.geometries, layers: s.layers }
      const command = dispatchEditingOperation({
        tool: s.activeEditingTool,
        document: doc,
        selectedIds: s.selectedIds,
        clickPoint,
        offsetDistance: s.editingOffsetDistance,
        filletRadius: s.editingFilletRadius,
        chamferDist: s.editingChamferDist,
        ctx,
      })
      if (command !== null) {
        s.dispatchCommand(command)
        if (!REPEAT_EDITING_TOOLS.has(s.activeEditingTool)) {
          set({ activeEditingTool: null })
        }
      }
    },
  }))

  return {
    ...store,
    /** 空間索引（R-tree）。document系アクションと常に同期している。 */
    getIndex: () => index,
  }
}

/**
 * 作図途中プレビュー図形を返すセレクタ（§9.1 GuideLayer 用）。CanvasStage が isPreview 描画に使う。
 * draftPoints + draftCursor から途中図形を合成する。作図中でない・カーソル未設定なら null。
 * 固定 ID（DRAFT_PREVIEW_ID）で、履歴・空間索引には登録しない。
 */
export function draftPreviewGeometry(state: EditorState): Geometry | null {
  const layer = resolveActiveLayer(state.layers, state.activeLayerId)
  return buildDraftPreview({
    tool: state.activeTool,
    draftPoints: state.draftPoints,
    draftCursor: state.draftCursor,
    layerId: layer.id,
    style: layer.defaultStyle,
  })
}
