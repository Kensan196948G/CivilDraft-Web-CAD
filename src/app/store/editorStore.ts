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
import type { DrawingLayer, Geometry, GeometryId, GeometryStyle, LayerId } from '@/shared/types'

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

export type EditorState = DocumentSlice & ViewportSlice & LayerSlice & SelectionSlice & HistorySlice

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

export function createEditorStore() {
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
  }))

  return {
    ...store,
    /** 空間索引（R-tree）。document系アクションと常に同期している。 */
    getIndex: () => index,
  }
}
