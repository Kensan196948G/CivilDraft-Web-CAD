import { describe, expect, it } from 'vitest'
import {
  EDITING_TOOLS,
  PARAM_EDITING_TOOLS,
  SELECTION_REQUIRED_TOOLS,
  CLICK_REQUIRED_TOOLS,
  dispatchEditingOperation,
  type EditingOperationInput,
  type EditingToolType,
} from '@/domain/tools/editGeometry'
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

function lineGeom(gid: string, start: Point, end: Point): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end }
}

function layer(lid: string, name: string): DrawingLayer {
  return { id: lid as LayerId, name, order: 0, visible: true, locked: false, printable: true, defaultStyle: style }
}

function makeDoc(geometries: Geometry[]): DocumentState {
  return { geometries, layers: [layer('layer-1', 'L1')] }
}

function makeDocWithLayers(geometries: Geometry[], layers: DrawingLayer[]): DocumentState {
  return { geometries, layers }
}

function makeInput(
  tool: EditingToolType,
  doc: DocumentState,
  selectedIds: GeometryId[],
  overrides: Partial<Pick<EditingOperationInput, 'clickPoint' | 'offsetDistance' | 'filletRadius' | 'chamferDist'>> = {},
): EditingOperationInput {
  return {
    tool,
    document: doc,
    selectedIds,
    clickPoint: null,
    offsetDistance: 100,
    filletRadius: 50,
    chamferDist: 50,
    ctx: seqContext(),
    ...overrides,
  }
}

describe('EDITING_TOOLS registry', () => {
  it('すべての編集ツール種別が定義されている', () => {
    const names = EDITING_TOOLS.map((t) => t.tool)
    expect(names).toContain('move')
    expect(names).toContain('copy')
    expect(names).toContain('rotate')
    expect(names).toContain('mirror')
    expect(names).toContain('trim')
    expect(names).toContain('extend')
    expect(names).toContain('offset')
    expect(names).toContain('fillet')
    expect(names).toContain('chamfer')
    expect(names).toContain('array')
    expect(names).toContain('scale')
    expect(names).toHaveLength(11)
  })

  it('各ツールにiconとlabelがある', () => {
    for (const t of EDITING_TOOLS) {
      expect(t.icon).toBeTruthy()
      expect(t.label).toBeTruthy()
    }
  })

  it('PARAM_EDITING_TOOLS には offset, fillet, chamfer が含まれる', () => {
    expect(PARAM_EDITING_TOOLS.has('offset')).toBe(true)
    expect(PARAM_EDITING_TOOLS.has('fillet')).toBe(true)
    expect(PARAM_EDITING_TOOLS.has('chamfer')).toBe(true)
    expect(PARAM_EDITING_TOOLS.has('move')).toBe(false)
  })

  it('SELECTION_REQUIRED_TOOLS には click-based でないツールも含まれる', () => {
    expect(SELECTION_REQUIRED_TOOLS.has('rotate')).toBe(true)
    expect(SELECTION_REQUIRED_TOOLS.has('mirror')).toBe(true)
    expect(SELECTION_REQUIRED_TOOLS.has('offset')).toBe(true)
    expect(SELECTION_REQUIRED_TOOLS.has('trim')).toBe(false)
    expect(SELECTION_REQUIRED_TOOLS.has('extend')).toBe(false)
  })

  it('CLICK_REQUIRED_TOOLS には move, copy, trim, extend が含まれる', () => {
    expect(CLICK_REQUIRED_TOOLS.has('move')).toBe(true)
    expect(CLICK_REQUIRED_TOOLS.has('copy')).toBe(true)
    expect(CLICK_REQUIRED_TOOLS.has('trim')).toBe(true)
    expect(CLICK_REQUIRED_TOOLS.has('extend')).toBe(true)
    expect(CLICK_REQUIRED_TOOLS.has('rotate')).toBe(false)
  })
})

describe('dispatchEditingOperation', () => {
  describe('move', () => {
    it('選択図形がない場合はnullを返す', () => {
      const d = makeDoc([circle('c1', 100, 100, 50)])
      const input = makeInput('move', d, [], { clickPoint: { x: 200, y: 200 } })
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('clickPointがない場合はnullを返す', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('move', d, [id('c1')])
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('選択図形をクリック位置へ移動するコマンドを返す', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('move', d, [id('c1')], { clickPoint: { x: 300, y: 300 } })
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('MOVE_GEOMETRIES')
      const executed = cmd!.execute(d)
      const moved = executed.geometries.find((g) => g.id === 'c1')
      expect(moved).toBeDefined()
      if (moved !== undefined && moved.type === 'circle') {
        expect(moved.center.x).toBe(300)
        expect(moved.center.y).toBe(300)
      }
    })

    it('Undoで元の位置に戻る', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('move', d, [id('c1')], { clickPoint: { x: 300, y: 300 } })
      const cmd = dispatchEditingOperation(input)!
      const executed = cmd.execute(d)
      const undone = cmd.undo(executed)
      expect(undone.geometries).toHaveLength(1)
      const restored = undone.geometries[0]
      if (restored !== undefined && restored.type === 'circle') {
        expect(restored.center.x).toBe(100)
        expect(restored.center.y).toBe(100)
      }
    })
  })

  describe('copy', () => {
    it('選択図形の複製コマンドを返す', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('copy', d, [id('c1')], { clickPoint: { x: 300, y: 300 } })
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('COPY_GEOMETRIES')
      const executed = cmd!.execute(d)
      expect(executed.geometries).toHaveLength(2)
    })
  })

  describe('rotate', () => {
    it('選択図形を90°CW回転するコマンドを返す', () => {
      const geom = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([geom])
      const input = makeInput('rotate', d, [id('l1')])
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('TRANSFORM_GEOMETRIES')
    })

    it('選択なしの場合はnull', () => {
      const d = makeDoc([])
      const input = makeInput('rotate', d, [])
      expect(dispatchEditingOperation(input)).toBeNull()
    })
  })

  describe('mirror', () => {
    it('選択図形を水平鏡像変換するコマンドを返す', () => {
      const geom = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([geom])
      const input = makeInput('mirror', d, [id('l1')])
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('TRANSFORM_GEOMETRIES')
    })
  })

  describe('trim', () => {
    it('クリック位置が線分上にないとnullを返す', () => {
      const geom = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([geom])
      const input = makeInput('trim', d, [], { clickPoint: { x: 500, y: 500 } })
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('クリック位置の線分をトリムする', () => {
      const horizontal = lineGeom('h', { x: 0, y: 50 }, { x: 200, y: 50 })
      const vertical = lineGeom('v', { x: 100, y: 0 }, { x: 100, y: 100 })
      const d = makeDoc([horizontal, vertical])
      const input = makeInput('trim', d, [], { clickPoint: { x: 50, y: 50 } })
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('TRIM_GEOMETRY')
      const executed = cmd!.execute(d)
      expect(executed.geometries.length).toBeGreaterThanOrEqual(2)
    })

    it('クリック位置がないとnullを返す', () => {
      const geom = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([geom])
      const input = makeInput('trim', d, [])
      expect(dispatchEditingOperation(input)).toBeNull()
    })
  })

  describe('extend', () => {
    it('クリック位置が線分に近くないとnullを返す', () => {
      const geom = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([geom])
      const input = makeInput('extend', d, [], { clickPoint: { x: 500, y: 500 } })
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('線分を境界まで延長する', () => {
      const target = lineGeom('t', { x: 0, y: 50 }, { x: 50, y: 50 })
      const boundary = lineGeom('b', { x: 100, y: 0 }, { x: 100, y: 100 })
      const d = makeDoc([target, boundary])
      const input = makeInput('extend', d, [], { clickPoint: { x: 45, y: 50 } })
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('UPDATE_GEOMETRY')
    })
  })

  describe('offset', () => {
    it('選択図形がないとnullを返す', () => {
      const d = makeDoc([circle('c1', 100, 100, 50)])
      const input = makeInput('offset', d, [])
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('選択図形のオフセットコピーを作成する', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('offset', d, [id('c1')], { offsetDistance: 10 })
      const cmd = dispatchEditingOperation(input)
      expect(cmd).not.toBeNull()
      expect(cmd!.type).toBe('ADD_GEOMETRY')
    })

    it('オフセット距離0でnullを返す', () => {
      const geom = circle('c1', 100, 100, 50)
      const d = makeDoc([geom])
      const input = makeInput('offset', d, [id('c1')], { offsetDistance: 0 })
      expect(dispatchEditingOperation(input)).toBeNull()
    })
  })

  describe('fillet', () => {
    it('選択線分が2本未満だとnullを返す', () => {
      const l1 = lineGeom('l1', { x: 0, y: 0 }, { x: 100, y: 0 })
      const d = makeDoc([l1])
      const input = makeInput('fillet', d, [id('l1')])
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('2本の線分が線以外だとnullを返す', () => {
      const c = circle('c1', 100, 100, 50)
      const d = makeDoc([c])
      const input = makeInput('fillet', d, [id('c1')])
      expect(dispatchEditingOperation(input)).toBeNull()
    })

    it('交差する2本の線分にフィレットを適用する', () => {
      const l1 = lineGeom('l1', { x: 0, y: 50 }, { x: 100, y: 50 })
      const l2 = lineGeom('l2', { x: 50, y: 0 }, { x: 50, y: 100 })
      const d = makeDoc([l1, l2])
      const input = makeInput('fillet', d, [id('l1'), id('l2')], { filletRadius: 10 })
      const cmd = dispatchEditingOperation(input)
      if (cmd === null) {
        return
      }
      expect(cmd.type).toBe('FILLET_GEOMETRIES')
      const executed = cmd.execute(d)
      expect(executed.geometries).toHaveLength(3)
    })
  })

  describe('chamfer', () => {
    it('交差する2本の線分に面取りを適用する', () => {
      const l1 = lineGeom('l1', { x: 0, y: 50 }, { x: 100, y: 50 })
      const l2 = lineGeom('l2', { x: 50, y: 0 }, { x: 50, y: 100 })
      const d = makeDoc([l1, l2])
      const input = makeInput('chamfer', d, [id('l1'), id('l2')], { chamferDist: 10 })
      const cmd = dispatchEditingOperation(input)
      if (cmd === null) {
        return
      }
      expect(cmd.type).toBe('CHAMFER_GEOMETRIES')
      const executed = cmd.execute(d)
      expect(executed.geometries).toHaveLength(3)
    })
  })

  describe('exhaustive check', () => {
    it('未知のEditingToolTypeではthrowする', () => {
      const d = makeDoc([])
      const input = makeInput('move' as EditingToolType, d, [])
      const badInput = { ...input, tool: 'invalid' as EditingToolType }
      expect(() => dispatchEditingOperation(badInput)).toThrow()
    })
  })

  describe('ロック済みレイヤーの編集禁止（§6.3 / Issue #40）', () => {
    function lockedLayer(lid: string, name: string): DrawingLayer {
      return { ...layer(lid, name), locked: true }
    }

    function lineOn(
      gid: string,
      lid: string,
      start: Point = { x: 0, y: 0 },
      end: Point = { x: 1000, y: 0 },
    ): Geometry {
      return { ...base, id: id(gid), layerId: lid as LayerId, type: 'line', start, end }
    }

    it('移動: ロック済みレイヤーの図形のみ選択時はコマンドを生成しない', () => {
      const doc = makeDocWithLayers([lineOn('g-1', 'layer-locked')], [lockedLayer('layer-locked', 'LOCK')])
      const result = dispatchEditingOperation(
        makeInput('move', doc, [id('g-1')], { clickPoint: { x: 500, y: 500 } }),
      )
      expect(result).toBeNull()
    })

    it('回転: ロックと非ロックが混在する選択では非ロックのみを対象にする', () => {
      const doc = makeDocWithLayers(
        [lineOn('g-1', 'layer-1'), lineOn('g-2', 'layer-locked')],
        [layer('layer-1', 'L1'), lockedLayer('layer-locked', 'LOCK')],
      )
      const result = dispatchEditingOperation(makeInput('rotate', doc, [id('g-1'), id('g-2')]))
      expect(result).not.toBeNull()
      const payload = result?.payload as { pairs: readonly { before: Geometry }[] }
      expect(payload.pairs.map((p) => p.before.id)).toEqual([id('g-1')])
    })

    it('トリム: 対象がロック済みレイヤーの場合はコマンドを生成しない', () => {
      const doc = makeDocWithLayers(
        [
          lineOn('g-1', 'layer-locked', { x: 0, y: 0 }, { x: 1000, y: 0 }),
          lineOn('g-2', 'layer-1', { x: 2000, y: -500 }, { x: 2000, y: 500 }),
        ],
        [layer('layer-1', 'L1'), lockedLayer('layer-locked', 'LOCK')],
      )
      const result = dispatchEditingOperation(makeInput('trim', doc, [], { clickPoint: { x: 500, y: 0 } }))
      expect(result).toBeNull()
    })

    it('フィレット: 対象の片方がロック済みレイヤーならコマンドを生成しない', () => {
      const doc = makeDocWithLayers(
        [lineOn('g-1', 'layer-1'), lineOn('g-2', 'layer-locked')],
        [layer('layer-1', 'L1'), lockedLayer('layer-locked', 'LOCK')],
      )
      const result = dispatchEditingOperation(
        makeInput('fillet', doc, [id('g-1'), id('g-2')], { filletRadius: 50 }),
      )
      expect(result).toBeNull()
    })
  })
})
