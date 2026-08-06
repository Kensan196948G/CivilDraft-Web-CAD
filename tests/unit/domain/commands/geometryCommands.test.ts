import { describe, expect, it } from 'vitest'
import {
  COMMAND_TYPES,
  createAddGeometryCommand,
  createDeleteGeometriesCommand,
  createTransformGeometriesCommand,
  createUpdateGeometryCommand,
  createUpdateLayerCommand,
  createMoveGeometriesCommand,
  createCopyGeometriesCommand,
  createFilletGeometriesCommand,
  createChamferGeometriesCommand,
  createTrimGeometryCommand,
  createImportDocumentCommand,
  createBulkUpdateGeometriesCommand,
  createExplodeGeometryCommand,
  createJoinLinesCommand,
  joinCollinearLines,
} from '@/domain/commands/geometryCommands'
import type { DocumentState } from '@/domain/commands/editorCommand'
import type { GeometryCreationContext } from '@/domain/geometry/geometryFactory'
import type {
  DrawingLayer,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'

const style: GeometryStyle = {
  strokeColor: '#000000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base: Omit<GeometryBase, 'id' | 'type'> = {
  layerId: 'layer-1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

const GEN_TIME = '2026-07-15T12:00:00.000Z'

function id(v: string): GeometryId {
  return v as GeometryId
}

/** 決定的コンテキスト: 連番ID（gen-1, gen-2, ...）と固定タイムスタンプ。 */
function seqContext(): GeometryCreationContext {
  let n = 0
  return {
    newId: () => `gen-${++n}` as GeometryId,
    now: () => GEN_TIME,
  }
}

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  return { ...base, id: id(gid), type: 'circle', center: { x: cx, y: cy }, radius: r }
}

function line(gid: string, start: Point, end: Point): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end }
}

function parametric(gid: string): Geometry {
  return {
    ...base,
    id: id(gid),
    type: 'parametricObject',
    definitionId: 'heavy-machine-radius',
    definitionVersion: 1,
    parameters: {},
    generatedGeometryIds: [],
  }
}

function layer(lid: string, name: string, order = 0): DrawingLayer {
  return { id: lid as LayerId, name, order, visible: true, locked: false, printable: true, defaultStyle: style }
}

function doc(geometries: Geometry[], layers: DrawingLayer[] = [layer('layer-1', 'L1')]): DocumentState {
  return { geometries, layers }
}

/** payload 中の Geometry 形状オブジェクトを再帰カウントする（保持図形数の定量用）。 */
function countGeometries(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countGeometries(v), 0)
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.id === 'string' && typeof o.type === 'string' && 'layerId' in o) return 1
    return Object.values(o).reduce((n: number, v) => n + countGeometries(v), 0)
  }
  return 0
}

describe('createAddGeometryCommand', () => {
  it('execute で末尾追加、undo で除去し往復で完全復元する', () => {
    const before = doc([circle('a', 0, 0, 5)])
    const cmd = createAddGeometryCommand(circle('b', 10, 10, 5), seqContext())
    const added = cmd.execute(before)
    expect(added.geometries.map((g) => g.id)).toEqual(['a', 'b'])
    expect(cmd.undo(added)).toEqual(before)
  })

  it('id/occurredAt を注入コンテキストから発番し、type は ADD_GEOMETRY', () => {
    const cmd = createAddGeometryCommand(circle('b', 0, 0, 5), seqContext())
    expect(cmd.id).toBe('gen-1')
    expect(cmd.occurredAt).toBe(GEN_TIME)
    expect(cmd.type).toBe(COMMAND_TYPES.ADD_GEOMETRY)
  })
})

describe('createUpdateGeometryCommand', () => {
  it('before→after 差し替えと undo 復元が往復で一致する', () => {
    const start = doc([circle('a', 0, 0, 5), circle('b', 50, 50, 5)])
    const before = circle('a', 0, 0, 5)
    const after = circle('a', 0, 0, 99)
    const cmd = createUpdateGeometryCommand(before, after, seqContext())
    const updated = cmd.execute(start)
    const ga = updated.geometries[0]
    expect(ga?.type === 'circle' && ga.radius).toBe(99)
    expect(cmd.undo(updated)).toEqual(start)
  })

  it('execute は入力 document を破壊しない（純粋関数）', () => {
    const start = doc([circle('a', 0, 0, 5)])
    const snapshot = doc([circle('a', 0, 0, 5)])
    createUpdateGeometryCommand(circle('a', 0, 0, 5), circle('a', 0, 0, 42), seqContext()).execute(start)
    expect(start).toEqual(snapshot)
  })
})

describe('createDeleteGeometriesCommand', () => {
  it('中間を含む複数削除でも undo が元の並び順で完全復元する', () => {
    const start = doc([circle('a', 0, 0, 1), circle('b', 1, 0, 1), circle('c', 2, 0, 1), circle('d', 3, 0, 1)])
    const cmd = createDeleteGeometriesCommand(start, [id('b'), id('d')], seqContext())
    const deleted = cmd.execute(start)
    expect(deleted.geometries.map((g) => g.id)).toEqual(['a', 'c'])
    expect(cmd.undo(deleted)).toEqual(start)
  })

  it('存在しない id は無視される（execute は無変化・undo も無変化）', () => {
    const start = doc([circle('a', 0, 0, 1)])
    const cmd = createDeleteGeometriesCommand(start, [id('zzz')], seqContext())
    const after = cmd.execute(start)
    expect(after.geometries.map((g) => g.id)).toEqual(['a'])
    expect(cmd.undo(after)).toEqual(start)
  })
})

describe('createTransformGeometriesCommand', () => {
  it('選択図形を変換し、undo が変換前を復元する（往復一致）', () => {
    const start = doc([line('a', { x: 10, y: 0 }, { x: 0, y: 10 }), circle('keep', 100, 100, 5)])
    const cmd = createTransformGeometriesCommand(start, [id('a')], 0, 0, 'rotateCW', seqContext())
    const transformed = cmd.execute(start)
    // rotateCW about origin: (10,0)->(0,10), (0,10)->(-10,0)
    expect(transformed.geometries[0]).toEqual(line('a', { x: 0, y: 10 }, { x: -10, y: 0 }))
    expect(transformed.geometries[1]).toEqual(circle('keep', 100, 100, 5)) // 対象外は不変
    expect(cmd.undo(transformed)).toEqual(start)
  })

  it('parametricObject は pairs に含めず変換対象外にする', () => {
    const start = doc([parametric('p1'), line('a', { x: 1, y: 0 }, { x: 0, y: 1 })])
    const cmd = createTransformGeometriesCommand(start, [id('p1'), id('a')], 0, 0, 'rotateCW', seqContext())
    expect(cmd.payload.pairs.map((p) => p.before.id)).toEqual(['a'])
    // parametric は execute でも不変
    expect(cmd.execute(start).geometries[0]).toEqual(parametric('p1'))
  })
})

describe('createUpdateLayerCommand', () => {
  it('レイヤーの before→after 差し替えと undo 復元が往復で一致する', () => {
    const l = layer('layer-1', 'L1')
    const start = doc([circle('a', 0, 0, 5)], [l])
    const after = { ...l, name: '外形線', visible: false }
    const cmd = createUpdateLayerCommand(l, after, seqContext())
    const updated = cmd.execute(start)
    expect(updated.layers[0]?.name).toBe('外形線')
    expect(updated.layers[0]?.visible).toBe(false)
    expect(updated.geometries).toEqual(start.geometries) // 図形は不変
    expect(cmd.undo(updated)).toEqual(start)
  })
})

describe('payload の JSON シリアライズ可能性（監査ログ再利用・ADR-0009）', () => {
  it('payload は関数を含まず JSON 往復でデータが保存される', () => {
    const cmd = createUpdateGeometryCommand(circle('a', 0, 0, 5), circle('a', 0, 0, 9), seqContext())
    const roundTrip = JSON.parse(JSON.stringify(cmd.payload))
    expect(roundTrip).toEqual(cmd.payload)
    // 監査ログへ出すデータ 4 項目もシリアライズ可能
    const audit = { id: cmd.id, type: cmd.type, occurredAt: cmd.occurredAt, payload: cmd.payload }
    expect(JSON.parse(JSON.stringify(audit))).toEqual(audit)
  })
})

describe('メモリ効率（R-001: 全スナップショット方式との比較）', () => {
  it('10,000図形×100回のUpdateGeometryCommand履歴が全スナップショット方式より桁違いに小さい', () => {
    const geometries = Array.from({ length: 10_000 }, (_, i) => circle(`g${i}`, i, 0, 1))
    const ctx = seqContext()
    const commands = []
    for (let i = 0; i < 100; i++) {
      const before = geometries[i]
      if (before === undefined) continue
      const after = { ...before, radius: 2 } as Geometry
      commands.push(createUpdateGeometryCommand(before, after, ctx))
    }

    // 保持図形数: 各 Update は before/after の 2 図形のみ → 100×2 = 200
    const heldGeometries = commands.reduce((n, c) => n + countGeometries(c.payload), 0)
    expect(heldGeometries).toBe(200)
    // 全スナップショット方式（100履歴 × 10,000図形 = 1,000,000）より 1000 倍以上少ない
    expect((100 * geometries.length) / heldGeometries).toBeGreaterThan(1000)

    // JSON バイト量でも定量比較: 1スナップショット長 × 100 に対して桁違いに小さい
    const payloadLen = JSON.stringify(commands.map((c) => c.payload)).length
    const snapshotEquivalentLen = JSON.stringify(geometries).length * 100
    expect(snapshotEquivalentLen / payloadLen).toBeGreaterThan(1000)
  })
})

describe('MoveGeometriesCommand', () => {
  it('指定図形を(dx,dy)平行移動し、undoで元に戻る', () => {
    const ctx = seqContext()
    const c = circle('c1', 100, 100, 50)
    const d = doc([c])
    const cmd = createMoveGeometriesCommand(d, [id('c1')], 50, -30, ctx)
    const executed = cmd.execute(d)
    const moved = executed.geometries.find((g) => g.id === 'c1')
    expect(moved).toBeDefined()
    if (moved !== undefined && moved.type === 'circle') {
      expect(moved.center.x).toBe(150)
      expect(moved.center.y).toBe(70)
    }
    const undone = cmd.undo(executed)
    const restored = undone.geometries.find((g) => g.id === 'c1')
    if (restored !== undefined && restored.type === 'circle') {
      expect(restored.center.x).toBe(100)
      expect(restored.center.y).toBe(100)
    }
  })

  it('存在しないidは無視される', () => {
    const ctx = seqContext()
    const c = circle('c1', 100, 100, 50)
    const d = doc([c])
    const cmd = createMoveGeometriesCommand(d, [id('nonexistent')], 10, 10, ctx)
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(1)
  })
})

describe('CopyGeometriesCommand', () => {
  it('指定図形を複写し、undoで削除される', () => {
    const ctx = seqContext()
    const c = circle('c1', 100, 100, 50)
    const d = doc([c])
    const cmd = createCopyGeometriesCommand(d, [id('c1')], 50, 0, ctx)
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(2)
    const copy = executed.geometries.find((g) => g.id !== 'c1')
    expect(copy).toBeDefined()
    if (copy !== undefined && copy.type === 'circle') {
      expect(copy.center.x).toBe(150)
      expect(copy.center.y).toBe(100)
    }
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(1)
  })
})

describe('FilletGeometriesCommand', () => {
  it('交差する2線分にフィレットを適用し、undoで元に戻る', () => {
    const ctx = seqContext()
    const l1 = line('l1', { x: 0, y: 50 }, { x: 100, y: 50 })
    const l2 = line('l2', { x: 50, y: 0 }, { x: 50, y: 100 })
    const d = doc([l1, l2])
    const cmd = createFilletGeometriesCommand(d, id('l1'), id('l2'), 10, ctx)
    if (cmd === null) return
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(3)
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(2)
  })

  it('存在しない線分idではnullを返す', () => {
    const ctx = seqContext()
    const l1 = line('l1', { x: 0, y: 50 }, { x: 100, y: 50 })
    const d = doc([l1])
    expect(createFilletGeometriesCommand(d, id('l1'), id('nonexistent'), 10, ctx)).toBeNull()
  })
})

describe('ChamferGeometriesCommand', () => {
  it('交差する2線分に面取りを適用し、undoで元に戻る', () => {
    const ctx = seqContext()
    const l1 = line('l1', { x: 0, y: 50 }, { x: 100, y: 50 })
    const l2 = line('l2', { x: 50, y: 0 }, { x: 50, y: 100 })
    const d = doc([l1, l2])
    const cmd = createChamferGeometriesCommand(d, id('l1'), id('l2'), 10, ctx)
    if (cmd === null) return
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(3)
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(2)
  })
})

describe('TrimGeometryCommand', () => {
  it('元線分を削除し分割線分を追加、undoで復元する', () => {
    const ctx = seqContext()
    const original = line('orig', { x: 0, y: 50 }, { x: 100, y: 50 })
    const r1 = line('r1', { x: 0, y: 50 }, { x: 30, y: 50 })
    const r2 = line('r2', { x: 70, y: 50 }, { x: 100, y: 50 })
    const d = doc([original])
    const cmd = createTrimGeometryCommand(d, original, [r1, r2], ctx)
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(2)
    expect(executed.geometries.find((g) => g.id === 'orig')).toBeUndefined()
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(1)
    expect(undone.geometries[0]?.id).toBe('orig')
  })
})

describe('ImportDocumentCommand（Issue #118）', () => {
  it('executeで取込後状態へ置き換え、undoで取込前状態を完全復元する', () => {
    const ctx = seqContext()
    const beforeLine = line('before', { x: 0, y: 0 }, { x: 10, y: 10 })
    const importedLine = line('imported', { x: 100, y: 100 }, { x: 200, y: 200 })
    const importedLayer = layer('dxf-layer', 'DXF-0')
    const d = doc([beforeLine])
    const cmd = createImportDocumentCommand(d, [importedLine], [importedLayer], ctx)

    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(1)
    expect(executed.geometries[0]?.id).toBe('imported')
    expect(executed.layers[0]?.id).toBe('dxf-layer')

    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(1)
    expect(undone.geometries[0]?.id).toBe('before')
    expect(undone.layers[0]?.id).toBe('layer-1')
  })

  it('取込レイヤーが空の場合は既存レイヤーを維持する', () => {
    const ctx = seqContext()
    const beforeLine = line('before', { x: 0, y: 0 }, { x: 10, y: 10 })
    const d = doc([beforeLine])
    const cmd = createImportDocumentCommand(d, [beforeLine], [], ctx)

    const executed = cmd.execute(d)
    expect(executed.layers).toHaveLength(1)
    expect(executed.layers[0]?.id).toBe('layer-1')
  })
})

describe('BulkUpdateGeometriesCommand（Issue #39）', () => {
  it('複数図形の一括更新をexecute/undoで往復できる', () => {
    const ctx = seqContext()
    const a = line('a', { x: 0, y: 0 }, { x: 10, y: 0 })
    const b = circle('b', 0, 0, 5)
    const afterA = { ...a, style: { ...a.style, strokeColor: '#ff0000' } }
    const afterB = { ...b, style: { ...b.style, strokeColor: '#ff0000' } }
    const d = doc([a, b])
    const cmd = createBulkUpdateGeometriesCommand(
      [
        { before: a, after: afterA },
        { before: b, after: afterB },
      ],
      ctx,
    )

    const executed = cmd.execute(d)
    expect(executed.geometries.every((g) => g.style.strokeColor === '#ff0000')).toBe(true)

    const undone = cmd.undo(executed)
    expect(undone.geometries[0]?.style.strokeColor).toBe('#000000')
    expect(undone.geometries[1]?.style.strokeColor).toBe('#000000')
  })
})

describe('Explode/Join（Issue #39 残）', () => {
  it('ポリラインを線分へ分解し、undoで復元する', () => {
    const ctx = seqContext()
    const poly: Geometry = {
      ...base,
      id: id('poly'),
      type: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      closed: false,
    }
    const d = doc([poly])
    const cmd = createExplodeGeometryCommand(d, poly, ctx)
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(2)
    expect(executed.geometries.every((g) => g.type === 'line')).toBe(true)
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(1)
    expect(undone.geometries[0]?.id).toBe('poly')
  })

  it('矩形を4辺の線分へ分解し、undoで復元する', () => {
    const ctx = seqContext()
    const rect: Geometry = {
      ...base,
      id: id('rect'),
      type: 'rectangle',
      origin: { x: 0, y: 0 },
      width: 100,
      height: 50,
      rotationDeg: 0,
    }
    const d = doc([rect])
    const cmd = createExplodeGeometryCommand(d, rect, ctx)
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(4)
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(1)
    expect(undone.geometries[0]?.type).toBe('rectangle')
  })

  it('同一線上で端点が接する2線分を結合し、undoで復元する', () => {
    const ctx = seqContext()
    const a = line('a', { x: 0, y: 0 }, { x: 50, y: 0 })
    const b = line('b', { x: 50, y: 0 }, { x: 120, y: 0 })
    expect(joinCollinearLines(a, b)).not.toBeNull()
    const d = doc([a, b])
    const cmd = createJoinLinesCommand(d, a, b, ctx)
    expect(cmd).not.toBeNull()
    if (cmd === null) return
    const executed = cmd.execute(d)
    expect(executed.geometries).toHaveLength(1)
    const merged = executed.geometries[0]!
    expect(merged.type).toBe('line')
    if (merged.type === 'line') {
      expect(merged.start).toEqual({ x: 0, y: 0 })
      expect(merged.end).toEqual({ x: 120, y: 0 })
    }
    const undone = cmd.undo(executed)
    expect(undone.geometries).toHaveLength(2)
  })

  it('平行だが接しない線分は結合できない', () => {
    const a = line('a', { x: 0, y: 0 }, { x: 50, y: 0 })
    const b = line('b', { x: 100, y: 0 }, { x: 150, y: 0 })
    expect(joinCollinearLines(a, b)).toBeNull()
  })
})
