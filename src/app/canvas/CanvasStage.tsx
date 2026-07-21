/**
 * 図面キャンバス本体。詳細設計仕様書 §9.1 のレイヤー構成を実装する。
 * 継承元: Civil-Draw src/components/Canvas/CanvasArea.tsx（継承台帳 modify、Canvas描画パイプライン）。
 *
 * 継承元との差分:
 * - useCanvasStore/useLayerStore シングルトン → EditorStore（Provider注入、Issue #7）
 * - 座標変換は CoordinateTransformer 経由に統一（§9.2、独自変換式の散在を排除）
 * - 作図ツール・クリップボード・キーボードショートカット群は ToolSlice/Command
 *   パターン（Issue #8）導入後に移植するため本コンポーネントは未搭載。
 *   Phase 1 スコープ: 描画・パン・ズーム・クリック/Shiftクリック選択のみ
 * - ヒットテストは Konva ではなく空間索引（GeometryIndex、§9.3）で行う
 *
 * レイヤー構成（§9.1、下から順）:
 * 1. BackgroundLayer（用紙=world座標系 / グリッド=screen座標系の2 Konva Layerで構成）
 * 2. GeometryLayer（図形。500図形以上でビューポートカリング適用、§9.4）
 * 3. SelectionLayer（選択強調 + 選択BBox枠）
 * 4. GuideLayer（スナップ候補・作図途中。ツール未実装のためプレースホルダ）
 * 5. OverlayLayer（ルーラー等のscreen座標系オーバーレイ）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Line, Rect, Stage } from 'react-konva'
import type Konva from 'konva'
import { CoordinateTransformer } from '@/domain/canvas/coordinateTransformer'
import { computeGridLines, resolveAdaptiveGridInterval } from '@/domain/canvas/gridRenderer'
import type { PaperOrientation, PaperSize } from '@/domain/canvas/paperSize'
import { filterGeometriesByStep } from '@/domain/construction-steps'
import { shapeBBox } from '@/domain/geometry/shapeBBox'
import { getVisibleIds, shouldCull } from '@/domain/geometry/viewportCulling'
import { draftPreviewGeometry } from '@/app/store/editorStore'
import { useEditorStore, useEditorStoreApi } from '@/app/store/useEditorStore'
import { GeometryRenderer } from './GeometryRenderer'
import { PaperBoundary } from './PaperBoundary'
import { Ruler } from './Ruler'

export interface CanvasStageProps {
  readonly paperSize?: PaperSize
  readonly paperOrientation?: PaperOrientation
}

/** ホイール1ノッチあたりのズーム倍率（継承元CanvasAreaと同等の操作感）。 */
const WHEEL_ZOOM_FACTOR = 1.1
/** クリック選択の許容ピクセル（§9.3: screen px をドメイン距離へ換算して判定）。 */
const HIT_TOLERANCE_PX = 8

/** グリッド線色（minor/major）。 */
const GRID_MINOR_COLOR = '#e2e8f0'
const GRID_MAJOR_COLOR = '#cbd5e1'
/** 選択BBox枠の色。 */
const SELECTION_BBOX_COLOR = '#3b82f6'

export function CanvasStage({ paperSize = 'A3', paperOrientation = 'landscape' }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })

  const zoom = useEditorStore((s) => s.zoom)
  const panX = useEditorStore((s) => s.panX)
  const panY = useEditorStore((s) => s.panY)
  const gridVisible = useEditorStore((s) => s.gridVisible)
  const gridUnitMm = useEditorStore((s) => s.gridUnitMm)
  const geometries = useEditorStore((s) => s.geometries)
  const layers = useEditorStore((s) => s.layers)
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const currentStepId = useEditorStore((s) => s.currentStepId)
  const activeTool = useEditorStore((s) => s.activeTool)
  const draftPoints = useEditorStore((s) => s.draftPoints)
  const draftCursor = useEditorStore((s) => s.draftCursor)
  const storeApi = useEditorStoreApi()

  // 作図途中プレビュー。draft状態のprimitive購読を依存にして再計算する
  // （selectorで直接合成するとスナップショット毎に新オブジェクトが返り警告になるため）。
  const previewGeometry = useMemo(
    () => draftPreviewGeometry(storeApi.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTool, draftPoints, draftCursor, storeApi],
  )

  // コンテナサイズ追従。jsdom等ResizeObserver非対応環境では初期実測+window resizeのみ。
  useEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height })
      }
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Spaceキー押下中はパンモード（継承元CanvasAreaの操作を踏襲）。
  // Escape=作図キャンセル、Enter=polyline確定、Ctrl+Z/Ctrl+Y(Ctrl+Shift+Z)=Undo/Redo。
  const spacePressed = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressed.current = true
        return
      }
      const state = storeApi.getState()
      if (e.code === 'Escape') {
        state.cancelDraft()
      } else if (e.code === 'Enter') {
        state.commitDraft()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) state.redo()
        else state.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault()
        state.redo()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spacePressed.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [storeApi])

  const panning = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (!pointer) return
      const factor = e.evt.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
      storeApi.getState().zoomAt(pointer, factor)
    },
    [storeApi],
  )

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // 中ボタン or Space+左ドラッグでパン開始
    if (e.evt.button === 1 || (e.evt.button === 0 && spacePressed.current)) {
      e.evt.preventDefault()
      panning.current = true
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY }
    }
  }, [])

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (panning.current) {
        const { panX: px, panY: py, setPan } = storeApi.getState()
        setPan(px + e.evt.clientX - lastPointer.current.x, py + e.evt.clientY - lastPointer.current.y)
        lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY }
        return
      }
      const state = storeApi.getState()
      if (state.activeTool === 'select' || state.activeTool === 'hatch') return
      const pointer = e.target.getStage()?.getPointerPosition()
      if (!pointer) return
      const transformer = new CoordinateTransformer({
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
      })
      state.updateDraftCursor(transformer.screenToDomain(pointer))
    },
    [storeApi],
  )

  const handleMouseUp = useCallback(() => {
    panning.current = false
  }, [])

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button !== 0 || spacePressed.current) return
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (!pointer) return
      const state = storeApi.getState()
      const transformer = new CoordinateTransformer({
        zoom: state.zoom,
        panX: state.panX,
        panY: state.panY,
      })
      const domainPoint = transformer.screenToDomain(pointer)

      if (state.activeEditingTool !== null) {
        state.executeEditingOperation(domainPoint)
        return
      }

      if (state.activeTool !== 'select' && state.activeTool !== 'hatch') {
        state.addDraftPoint(domainPoint)
        return
      }

      const toleranceMm = transformer.screenLengthToDomain(HIT_TOLERANCE_PX)
      const index = storeApi.getIndex()
      const hits = index.point(domainPoint.x, domainPoint.y, toleranceMm)
      const topmost = index.topmost(hits)

      if (state.activeTool === 'hatch') {
        if (topmost === null) return
        const geom = state.geometries.find((g) => g.id === topmost)
        if (geom !== undefined && (geom.type === 'polyline' && geom.closed || geom.type === 'rectangle' || geom.type === 'circle')) {
          state.select([topmost])
        }
        return
      }

      if (topmost === null) {
        state.clearSelection()
      } else if (e.evt.shiftKey) {
        state.toggleSelect(topmost)
      } else {
        state.select([topmost])
      }
    },
    [storeApi],
  )

  // ダブルクリック=polylineの確定（§8.1 commit）
  const handleDblClick = useCallback(() => {
    storeApi.getState().commitDraft()
  }, [storeApi])

  // 非表示レイヤーの図形は描画対象外（§6.3）、施工ステップで絞り込み（§18）、
  // 500図形以上でビューポートカリング（§9.4）。
  const visibleLayerIds = new Set(layers.filter((l) => l.visible).map((l) => l.id))
  let renderTargets = filterGeometriesByStep(
    geometries.filter((g) => visibleLayerIds.has(g.layerId)),
    currentStepId,
  )
  if (shouldCull(renderTargets.length)) {
    const visible = getVisibleIds(storeApi.getIndex(), {
      zoom,
      panX,
      panY,
      width: size.width,
      height: size.height,
    })
    renderTargets = renderTargets.filter((g) => visible.has(g.id))
  }

  const selectedSet = new Set(selectedIds)
  // gridUnitMm は基準間隔。zoom に応じて 10 倍単位で自動調整し、画面上の
  // 線間隔を常に 20〜200px に保つ（初期表示 zoom=1 でもグリッドが見える）。
  const effectiveGridMm = resolveAdaptiveGridInterval(gridUnitMm, zoom)
  const gridLines = gridVisible
    ? computeGridLines({
        width: size.width,
        height: size.height,
        gridSize: effectiveGridMm,
        zoom,
        panX,
        panY,
        majorInterval: effectiveGridMm * 5,
      })
    : []

  const selectionBBoxes = geometries
    .filter((g) => selectedSet.has(g.id))
    .map((g) => ({ id: g.id, bbox: shapeBBox(g) }))
    .filter((entry): entry is { id: (typeof entry)['id']; bbox: NonNullable<(typeof entry)['bbox']> } => entry.bbox !== null)

  return (
    <div
      ref={containerRef}
      data-testid="canvas-stage-container"
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <Stage
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onDblClick={handleDblClick}
      >
        {/* 1. BackgroundLayer: 用紙（world座標系） */}
        <Layer x={panX} y={panY} scaleX={zoom} scaleY={zoom} listening={false}>
          <PaperBoundary paperSize={paperSize} paperOrientation={paperOrientation} />
        </Layer>
        {/* 1. BackgroundLayer: グリッド（screen座標系、gridRendererがpan/zoom織込み済み） */}
        <Layer listening={false}>
          {gridLines.map((line, i) => (
            <Line
              key={`grid-${i}`}
              points={[...line.points]}
              stroke={line.kind === 'major' ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR}
              strokeWidth={line.kind === 'major' ? 1 : 0.5}
              listening={false}
            />
          ))}
        </Layer>
        {/* 2. GeometryLayer（world座標系） */}
        <Layer x={panX} y={panY} scaleX={zoom} scaleY={zoom} listening={false}>
          {renderTargets.map((g) => (
            <GeometryRenderer key={g.id} geometry={g} isSelected={selectedSet.has(g.id)} />
          ))}
        </Layer>
        {/* 3. SelectionLayer: 選択BBox枠（world座標系） */}
        <Layer x={panX} y={panY} scaleX={zoom} scaleY={zoom} listening={false}>
          {selectionBBoxes.map(({ id, bbox }) => (
            <Rect
              key={`sel-${id}`}
              x={bbox.minX}
              y={bbox.minY}
              width={bbox.maxX - bbox.minX}
              height={bbox.maxY - bbox.minY}
              stroke={SELECTION_BBOX_COLOR}
              strokeWidth={1 / zoom}
              dash={[4 / zoom, 4 / zoom]}
              listening={false}
            />
          ))}
        </Layer>
        {/* 4. GuideLayer: 作図途中プレビュー（world座標系）。スナップ候補表示は後続対応 */}
        <Layer x={panX} y={panY} scaleX={zoom} scaleY={zoom} listening={false}>
          {previewGeometry !== null && (
            <GeometryRenderer geometry={previewGeometry} isPreview />
          )}
        </Layer>
        {/* 5. OverlayLayer: ルーラー（screen座標系） */}
        <Layer listening={false}>
          <Ruler zoom={zoom} panX={panX} panY={panY} width={size.width} height={size.height} />
        </Layer>
      </Stage>
    </div>
  )
}
