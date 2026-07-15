/**
 * エディタ全体フローの結合テスト（モジュール横断）。
 *
 * 狙い: 単体テストでは検出できない「モジュール境界の契約のズレ」を突く。
 * store（EditorStore）・command（Undo/Redo）・空間索引（GeometryIndex）・
 * DXF入出力・autosave・変換エンジンを**実物のまま結合**し（モックなし）、
 * 一連の編集フローが破綻しないことと、境界で失われる情報を明示的に文書化する。
 *
 * 決定的 ctx（連番ID・固定タイムスタンプ）を注入し、ID/監査情報を再現可能にする。
 *
 * 本テストで文書化した既知の齟齬（いずれも「許容仕様」。修正はしない）:
 * - DXF往復は意味論的に非可逆。合成図形（hatch/dimension/leader/symbol）は
 *   プリミティブ列（line/text/polyline）へ分解され、rectangle/spline は polyline へ
 *   型変化する。parametricObject は出力対象外で消失する（シナリオ2）。
 * - scaleShape はクローン意味論で新IDを採番するため、同一ID差し替え前提の
 *   UpdateGeometryCommand へ渡すには元IDへの再バインドが要る（シナリオ5）。
 */
import { describe, expect, it } from 'vitest'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import {
  createAddGeometryCommand,
  createDeleteGeometriesCommand,
  createTransformGeometriesCommand,
  createUpdateGeometryCommand,
} from '@/domain/commands/geometryCommands'
import type { DocumentState } from '@/domain/commands/editorCommand'
import { TEMPLATE_CATALOG, getTemplateById, instantiateTemplate } from '@/domain/catalog/templateCatalog'
import { exportDxf } from '@/domain/dxf/dxfExporter'
import { importDxf } from '@/domain/dxf/dxfImporter'
import { MemoryAutosaveStore, type AutosaveSnapshot } from '@/infrastructure/autosave/autosaveStore'
import { scaleShape } from '@/domain/geometry/scaleEngine'
import { transformShape } from '@/domain/geometry/shapeTransform'
import { unionBBox } from '@/domain/geometry/shapeBBox'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  CircleGeometry,
  DrawingLayer,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  LineGeometry,
} from '@/shared/types'

// --- 決定的コンテキスト・共通フィクスチャ -----------------------------------

/** 連番ID・固定タイムスタンプの GeometryCreationContext（テスト再現性のため）。 */
function deterministicCtx(prefix: string): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `${prefix}-${n++}` as GeometryId,
    now: () => '2026-07-15T00:00:00.000Z',
  }
}

const STYLE: GeometryStyle = {
  strokeColor: '#1f2937',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const LAYER_ID = 'layer-default' as LayerId

function base(id: string): Omit<GeometryBase, 'type'> {
  return {
    id: id as GeometryId,
    layerId: LAYER_ID,
    style: STYLE,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
  }
}

/** store の現在状態から Command が要求する DocumentState を切り出す。 */
function docStateOf(store: ReturnType<typeof createEditorStore>): DocumentState {
  const s = store.getState()
  return { geometries: s.geometries, layers: s.layers }
}

// ---------------------------------------------------------------------------
// シナリオ1: テンプレート配置 → 選択 → 削除 → Undo/Redo（store × command × 空間索引）
// ---------------------------------------------------------------------------
describe('結合: テンプレート配置→選択→削除→Undo/Redo', () => {
  it('AddGeometryCommand で配置し、空間索引ヒットテスト→DeleteGeometriesCommand→undo/redo が索引と選択に追随する', () => {
    const ctx = deterministicCtx('s1')
    const store = createEditorStore(ctx)

    // 測量基準点マーカー（円 center(0,0) r20 + 十字2本 + ラベル）を実体化。
    const template = getTemplateById('survey-control-point')
    expect(template).toBeDefined()
    const geometries = instantiateTemplate(template!, { layerId: LAYER_ID, style: STYLE }, ctx)
    expect(geometries).toHaveLength(4) // circle, line, line, text

    // 直接 addGeometries ではなく AddGeometryCommand 経由で積む（作図=履歴・監査可能な1操作）。
    for (const g of geometries) {
      store.getState().dispatchCommand(createAddGeometryCommand(g, ctx))
    }
    expect(store.getState().geometries).toHaveLength(4)
    expect(store.getState().undoStack).toHaveLength(4)

    // 空間索引が dispatchCommand の syncIndexDiff で同期されていること。
    const index = store.getIndex()
    expect(index.size).toBe(4)

    // 円の内部 (18,18) を叩くと円のみがヒットする（十字線・ラベルの BBox は届かない）。
    const circle = geometries.find((g): g is CircleGeometry => g.type === 'circle')!
    const hits = index.point(18, 18)
    expect(hits).toContain(circle.id)
    const topmost = index.topmost(hits)
    expect(topmost).toBe(circle.id)

    // 選択 → 削除コマンド。
    store.getState().select([circle.id])
    expect(store.getState().selectedIds).toEqual([circle.id])
    store.getState().dispatchCommand(createDeleteGeometriesCommand(docStateOf(store), [circle.id], ctx))

    // 削除で図形・索引・選択（reconcile）が追随する。
    expect(store.getState().geometries).toHaveLength(3)
    expect(store.getState().selectedIds).toEqual([]) // 消えた図形への選択参照は除去される
    expect(store.getIndex().point(18, 18)).not.toContain(circle.id)

    // undo で図形と索引が復元される。
    store.getState().undo()
    expect(store.getState().geometries).toHaveLength(4)
    expect(store.getIndex().point(18, 18)).toContain(circle.id)

    // redo で再削除される。
    store.getState().redo()
    expect(store.getState().geometries).toHaveLength(3)
    expect(store.getIndex().point(18, 18)).not.toContain(circle.id)
  })
})

// ---------------------------------------------------------------------------
// シナリオ2: DXF ラウンドトリップ（exportDxf → importDxf）
//   全13種を含む図面を往復させ、生き残る型・失われる型を文書化する。
// ---------------------------------------------------------------------------
describe('結合: DXF ラウンドトリップ（型・座標の保存と非可逆変換の文書化）', () => {
  const layers: readonly DrawingLayer[] = [createDefaultLayer()]

  // 全12種のDXF対応図形 + parametricObject（非対応=消失の確認用）。
  const source: readonly Geometry[] = [
    { ...base('src-line'), type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { ...base('src-circle'), type: 'circle', center: { x: 200, y: 0 }, radius: 50 },
    {
      ...base('src-arc'),
      type: 'arc',
      center: { x: 400, y: 0 },
      radius: 50,
      startAngleDeg: 0,
      endAngleDeg: 90,
    },
    {
      // radiusX >= radiusY で用意する（ELLIPSE往復は長軸>=短軸を前提に忠実復元。
      // 逆順の場合は import 側で radiusX/Y が入れ替わり rotationDeg=90 が付く既知挙動）。
      ...base('src-ellipse'),
      type: 'ellipse',
      center: { x: 600, y: 0 },
      radiusX: 80,
      radiusY: 40,
      rotationDeg: 0,
    },
    {
      ...base('src-polyline'),
      type: 'polyline',
      points: [
        { x: 0, y: 200 },
        { x: 50, y: 250 },
        { x: 100, y: 200 },
      ],
      closed: false,
    },
    {
      ...base('src-spline'),
      type: 'spline',
      points: [
        { x: 0, y: 400 },
        { x: 50, y: 450 },
        { x: 100, y: 400 },
      ],
      tension: 0.5,
    },
    {
      ...base('src-text'),
      type: 'text',
      anchor: { x: 0, y: 600 },
      text: 'ROUNDTRIP',
      height: 20,
      rotationDeg: 0,
      horizontalAlign: 'left',
    },
    {
      ...base('src-rect'),
      type: 'rectangle',
      origin: { x: 200, y: 200 },
      width: 100,
      height: 60,
      rotationDeg: 0,
    },
    {
      ...base('src-dim'),
      type: 'dimension',
      start: { x: 0, y: 800 },
      end: { x: 200, y: 800 },
      orientation: 'horizontal',
      offset: 30,
      textHeight: 12,
      arrowSize: 8,
    },
    {
      ...base('src-leader'),
      type: 'leader',
      start: { x: 400, y: 800 },
      end: { x: 500, y: 850 },
      text: 'NOTE',
      textHeight: 12,
    },
    {
      ...base('src-hatch'),
      type: 'hatch',
      boundaryPoints: [
        { x: 0, y: 1000 },
        { x: 100, y: 1000 },
        { x: 100, y: 1100 },
        { x: 0, y: 1100 },
      ],
      pattern: 'earth',
      angleDeg: 45,
      spacing: 20,
    },
    {
      ...base('src-symbol'),
      type: 'symbol',
      symbolId: 'cone',
      position: { x: 700, y: 0 },
      rotationDeg: 0,
      scale: 1,
    },
    {
      // parametricObject は exportDxf 側で skip（生成図形が別途出力される設計）。
      ...base('src-param'),
      type: 'parametricObject',
      definitionId: 'demo',
      definitionVersion: 1,
      parameters: {},
      generatedGeometryIds: [],
    },
  ]

  it('生き残る型（line/circle/arc/ellipse/polyline/text）は型と主要座標を保存する', () => {
    const dxf = exportDxf(source, layers, { unit: 'mm' })
    const result = importDxf(dxf, deterministicCtx('s2a'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const imported = result.value.geometries

    // line: (0,0)→(100,0) がそのまま残る（symbol は x≈700 帯なので座標で一意特定できる）。
    const line = imported.find(
      (g): g is LineGeometry =>
        g.type === 'line' && Math.abs(g.start.x) < 1 && Math.abs(g.end.x - 100) < 1,
    )
    expect(line).toBeDefined()
    expect(line!.start.y).toBeCloseTo(0)
    expect(line!.end.x).toBeCloseTo(100)

    // circle: center(200,0) r50。
    const circle = imported.find((g) => g.type === 'circle' && Math.abs(g.center.x - 200) < 1)
    expect(circle).toBeDefined()
    if (circle && circle.type === 'circle') {
      expect(circle.center.x).toBeCloseTo(200)
      expect(circle.radius).toBeCloseTo(50)
    }

    // arc: center(400,0) r50, 0→90°（dxf-writer は度数入力、dxf-parser はラジアン返却→度数復元）。
    const arc = imported.find((g) => g.type === 'arc' && Math.abs(g.center.x - 400) < 1)
    expect(arc).toBeDefined()
    if (arc && arc.type === 'arc') {
      expect(arc.radius).toBeCloseTo(50)
      expect(arc.startAngleDeg).toBeCloseTo(0)
      expect(arc.endAngleDeg).toBeCloseTo(90)
    }

    // ellipse: center(600,0) radiusX=80 radiusY=40（全楕円はネイティブ表現で復元）。
    const ellipse = imported.find((g) => g.type === 'ellipse')
    expect(ellipse).toBeDefined()
    if (ellipse && ellipse.type === 'ellipse') {
      expect(ellipse.center.x).toBeCloseTo(600)
      expect(ellipse.radiusX).toBeCloseTo(80)
      expect(ellipse.radiusY).toBeCloseTo(40)
    }

    // 元の開ポリライン: 先頭点(0,200)で特定。
    const poly = imported.find(
      (g) => g.type === 'polyline' && g.points.length === 3 && Math.abs(g.points[0]!.y - 200) < 1,
    )
    expect(poly).toBeDefined()
    if (poly && poly.type === 'polyline') {
      expect(poly.closed).toBe(false)
      expect(poly.points[1]!.x).toBeCloseTo(50)
      expect(poly.points[1]!.y).toBeCloseTo(250)
    }

    // text: 本文で特定（dimension/leader も TEXT を出力するため内容で判別）。
    const text = imported.find((g) => g.type === 'text' && g.text === 'ROUNDTRIP')
    expect(text).toBeDefined()
    if (text && text.type === 'text') {
      expect(text.anchor.y).toBeCloseTo(600)
      expect(text.height).toBeCloseTo(20)
      // 齟齬: DXF group 72（水平寄せ）は未マッピングのため import 側は常に 'left' に落ちる。
      expect(text.horizontalAlign).toBe('left')
    }
  })

  it('非可逆変換を文書化する: rectangle/spline→polyline、hatch/dimension/leader/symbol→プリミティブ、parametricObject→消失', () => {
    const dxf = exportDxf(source, layers, { unit: 'mm' })
    const result = importDxf(dxf, deterministicCtx('s2b'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const imported = result.value.geometries
    const countOf = (t: Geometry['type']) => imported.filter((g) => g.type === t).length

    // 型アイデンティティが失われる型: 往復後、その型名では1つも存在しない。
    expect(countOf('rectangle')).toBe(0) // → 閉じた polyline へ
    expect(countOf('spline')).toBe(0) // → 開いた polyline へ（tension は消失）
    expect(countOf('hatch')).toBe(0) // → 境界 polyline + 塗りつぶし line 群へ
    expect(countOf('dimension')).toBe(0) // → 寸法線 line 群 + 寸法値 text へ
    expect(countOf('leader')).toBe(0) // → 引出 line 群 + 注記 text へ
    expect(countOf('symbol')).toBe(0) // → symbol 定義パスの line/circle/polyline へ
    expect(countOf('parametricObject')).toBe(0) // → export で skip され消失

    // rectangle は「閉じた polyline（矩形4隅）」として生き残る（型は変わるが形状は保存）。
    const rectPoly = imported.find(
      (g) => g.type === 'polyline' && g.closed && g.points.some((p) => Math.abs(p.x - 200) < 1 && Math.abs(p.y - 200) < 1),
    )
    expect(rectPoly).toBeDefined()

    // spline は「開いた polyline（先頭点 (0,400)）」として生き残る。
    const splinePoly = imported.find(
      (g) => g.type === 'polyline' && !g.closed && g.points.some((p) => Math.abs(p.y - 400) < 1),
    )
    expect(splinePoly).toBeDefined()

    // 合成図形の分解により line/text が増える（dimension/leader の text、hatch/symbol の線群）。
    // 正確な本数はハッチ密度・symbol 定義に依存するため、下限のみを検証する。
    expect(countOf('line')).toBeGreaterThan(1) // 元の1本 + 分解で生じた線群
    // dimension の寸法値 + leader の注記 = text は元の 'ROUNDTRIP' 以外にも存在する。
    expect(countOf('text')).toBeGreaterThanOrEqual(2)
    // leader 注記 'NOTE' が text として残る。
    expect(imported.some((g) => g.type === 'text' && g.text === 'NOTE')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// シナリオ3: 単位変換の統合検証（export(m) → import で mm へ復元）
// ---------------------------------------------------------------------------
describe('結合: DXF 単位変換ラウンドトリップ（m ↔ 内部基準mm）', () => {
  const layers: readonly DrawingLayer[] = [createDefaultLayer()]
  const line: LineGeometry = {
    ...base('unit-line'),
    type: 'line',
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 }, // 内部基準 1000mm = 1m
  }

  it('exportDxf(unit:"m") は座標を m で出力し、importDxf が $INSUNITS から mm へ復元する', () => {
    const dxfM = exportDxf([line], layers, { unit: 'm' })
    const dxfMm = exportDxf([line], layers, { unit: 'mm' })
    // 単位が実際に適用されていること（同一図形でも出力文字列が異なる）。
    expect(dxfM).not.toBe(dxfMm)
    // 単位宣言は $INSUNITS コードで記録される（m=6, mm=4。文字列'Meters'ではない）。
    expect(dxfM).toMatch(/\$INSUNITS\s+70\s+6/)
    expect(dxfMm).toMatch(/\$INSUNITS\s+70\s+4/)

    const fromM = importDxf(dxfM, deterministicCtx('s3m'))
    expect(fromM.ok).toBe(true)
    if (!fromM.ok) return
    const lineM = fromM.value.geometries.find((g): g is LineGeometry => g.type === 'line')
    expect(lineM).toBeDefined()
    // 1000mm → 出力 1(m) → 再取込 1000mm へ復元される。
    expect(lineM!.end.x).toBeCloseTo(1000)

    // mm 経路（基準単位=等倍）でも 1000mm に一致する。
    const fromMm = importDxf(dxfMm, deterministicCtx('s3mm'))
    expect(fromMm.ok).toBe(true)
    if (!fromMm.ok) return
    const lineMm = fromMm.value.geometries.find((g): g is LineGeometry => g.type === 'line')
    expect(lineMm!.end.x).toBeCloseTo(1000)
  })
})

// ---------------------------------------------------------------------------
// シナリオ4: autosave ラウンドトリップ（store → snapshot → 復元 → 空間索引再構築）
// ---------------------------------------------------------------------------
describe('結合: autosave ラウンドトリップ（MemoryAutosaveStore × replaceDocument × 空間索引）', () => {
  it('store のスナップショットを save→load→replaceDocument し、空間索引が search で引ける', async () => {
    const ctxA = deterministicCtx('s4a')
    const source = createEditorStore(ctxA)
    // 複数テンプレートを配置して図面を作る。
    for (const template of TEMPLATE_CATALOG.slice(0, 3)) {
      source.getState().addGeometries(
        instantiateTemplate(template, { layerId: LAYER_ID, style: STYLE }, ctxA),
      )
    }
    const geometries = source.getState().geometries
    const savedLayers = source.getState().layers
    expect(geometries.length).toBeGreaterThan(0)

    const snapshot: AutosaveSnapshot = {
      savedAt: '2026-07-15T00:00:00.000Z',
      geometries,
      layers: savedLayers,
    }

    const memStore = new MemoryAutosaveStore()
    const saveResult = await memStore.save(snapshot)
    expect(saveResult.ok).toBe(true)

    const loadResult = await memStore.load()
    expect(loadResult.ok).toBe(true)
    if (!loadResult.ok || loadResult.value === null) throw new Error('load failed')
    // JSON往復で図形数・型が保存されること。
    expect(loadResult.value.geometries).toHaveLength(geometries.length)

    // 別の store（索引は空）へ復元する。
    const restored = createEditorStore(deterministicCtx('s4b'))
    expect(restored.getIndex().size).toBe(0)
    restored.getState().replaceDocument(loadResult.value.geometries, loadResult.value.layers)

    // replaceDocument の index.load() で空間索引が再構築されていること。
    const idx = restored.getIndex()
    expect(idx.size).toBeGreaterThan(0)

    // 全図形の外接矩形で search すると、復元図形が索引で引ける。
    const bbox = unionBBox(loadResult.value.geometries)
    expect(bbox).not.toBeNull()
    const foundIds = idx.search(bbox!)
    expect(foundIds.length).toBe(idx.size)
    // 復元図形の少なくとも1つが索引ヒットに含まれる（ID一致で確認）。
    const firstId = loadResult.value.geometries[0]!.id
    const restoredIds = new Set(restored.getState().geometries.map((g) => g.id))
    expect(restoredIds.has(firstId)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// シナリオ5: 変換エンジン統合（transformShape/scaleShape × Command × undo）
// ---------------------------------------------------------------------------
describe('結合: 変換エンジン × Command × undo', () => {
  it('transformShape(rotateCW) を TransformGeometriesCommand で適用し、undo で厳密復元される', () => {
    const ctx = deterministicCtx('s5t')
    const store = createEditorStore(ctx)
    const line: LineGeometry = {
      ...base('rot-line'),
      type: 'line',
      start: { x: 10, y: 0 },
      end: { x: 20, y: 0 },
    }
    store.getState().dispatchCommand(createAddGeometryCommand(line, ctx))

    // 原点回り rotateCW: canvas系（Y下）で (dx,dy)→(-dy,dx)。(10,0)→(0,10), (20,0)→(0,20)。
    const cmd = createTransformGeometriesCommand(docStateOf(store), [line.id], 0, 0, 'rotateCW', ctx)
    store.getState().dispatchCommand(cmd)

    const rotated = store.getState().geometries.find((g): g is LineGeometry => g.id === line.id)!
    expect(rotated.start.x).toBeCloseTo(0)
    expect(rotated.start.y).toBeCloseTo(10)
    expect(rotated.end.x).toBeCloseTo(0)
    expect(rotated.end.y).toBeCloseTo(20)

    // 境界整合の検証: コマンドの適用結果が変換エンジン transformShape の直接出力と一致すること
    // （TransformGeometriesCommand が確かに transformShape を配線している）。
    const engineDirect = transformShape(line, 0, 0, 'rotateCW') as LineGeometry
    expect(rotated.start).toEqual(engineDirect.start)
    expect(rotated.end).toEqual(engineDirect.end)

    // undo は逆変換ではなく保存済み before で復元する（変換ロジックのバグに影響されない）。
    store.getState().undo()
    const back = store.getState().geometries.find((g): g is LineGeometry => g.id === line.id)!
    expect(back.start).toEqual({ x: 10, y: 0 })
    expect(back.end).toEqual({ x: 20, y: 0 })
  })

  it('scaleShape はクローン意味論（新ID採番）: UpdateGeometryCommand には元IDへ再バインドして渡す', () => {
    const ctx = deterministicCtx('s5s')
    const store = createEditorStore(ctx)
    const circle: CircleGeometry = {
      ...base('scale-circle'),
      type: 'circle',
      center: { x: 100, y: 0 },
      radius: 10,
    }
    store.getState().dispatchCommand(createAddGeometryCommand(circle, ctx))

    // 原点固定で 2 倍（circle 半径は max(sx,sy) 倍＝継承元踏襲）。
    const scaled = scaleShape(circle, { cx: 0, cy: 0, sx: 2, sy: 2 }, ctx)
    expect(scaled).not.toBeNull()
    // 齟齬の文書化: scaleShape は新IDを採番する（in-place 編集ではなく複製として設計）。
    expect(scaled!.id).not.toBe(circle.id)

    // UpdateGeometryCommand は同一ID差し替え前提のため、元IDへ再バインドする。
    const after = { ...(scaled as Geometry), id: circle.id } as Geometry
    store.getState().dispatchCommand(createUpdateGeometryCommand(circle, after, ctx))

    const updated = store.getState().geometries.find((g): g is CircleGeometry => g.id === circle.id)!
    expect(updated.center.x).toBeCloseTo(200) // center(100,0) を原点回り2倍 → (200,0)
    expect(updated.radius).toBeCloseTo(20)

    // undo で元図形（半径10・中心(100,0)）へ戻る。
    store.getState().undo()
    const reverted = store.getState().geometries.find((g): g is CircleGeometry => g.id === circle.id)!
    expect(reverted.center.x).toBeCloseTo(100)
    expect(reverted.radius).toBeCloseTo(10)
  })
})
