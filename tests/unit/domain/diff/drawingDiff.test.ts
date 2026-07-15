import { describe, expect, it } from 'vitest'
import { diffDrawings } from '@/domain/diff/drawingDiff'
import type {
  ConstructionStepId,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
  Point,
} from '@/shared/types'

// scaleEngine.test.ts のヘルパーパターンを踏襲する。
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

function id(v: string): GeometryId {
  return v as GeometryId
}

function line(gid: string, start: Point, end: Point, overrides: Partial<Geometry> = {}): Geometry {
  return { ...base, id: id(gid), type: 'line', start, end, ...overrides } as Geometry
}

describe('diffDrawings — 追加・削除（§20.1）', () => {
  it('after にのみある図形は added', () => {
    const before: Geometry[] = []
    const after = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const diff = diffDrawings(before, after)
    expect(diff.added).toEqual([id('a')])
    expect(diff.removed).toEqual([])
  })

  it('before にのみある図形は removed', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after: Geometry[] = []
    const diff = diffDrawings(before, after)
    expect(diff.removed).toEqual([id('a')])
    expect(diff.added).toEqual([])
  })

  it('両方空なら全カテゴリ空（空図面）', () => {
    const diff = diffDrawings([], [])
    expect(diff).toEqual({
      added: [],
      removed: [],
      geometryChanged: [],
      styleChanged: [],
      attributeChanged: [],
      stepChanged: [],
    })
  })
})

describe('diffDrawings — 変更検知（§20.1）', () => {
  it('座標変更は geometryChanged に分類される', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after = [line('a', { x: 0, y: 0 }, { x: 2, y: 2 })]
    const diff = diffDrawings(before, after)
    expect(diff.geometryChanged.map((c) => c.id)).toEqual([id('a')])
    expect(diff.styleChanged).toEqual([])
    // before/after が差分表示用に保持される
    expect(diff.geometryChanged[0].before).toBe(before[0])
    expect(diff.geometryChanged[0].after).toBe(after[0])
  })

  it('属性（civilAttributeId）変更は attributeChanged に分類される', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, { civilAttributeId: 'attr-1' })]
    const after = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, { civilAttributeId: 'attr-2' })]
    const diff = diffDrawings(before, after)
    expect(diff.attributeChanged.map((c) => c.id)).toEqual([id('a')])
    expect(diff.geometryChanged).toEqual([])
  })

  it('スタイル変更は styleChanged に分類される', () => {
    const changedStyle: GeometryStyle = { ...style, strokeColor: '#ff0000' }
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, { style: changedStyle })]
    const diff = diffDrawings(before, after)
    expect(diff.styleChanged.map((c) => c.id)).toEqual([id('a')])
    expect(diff.geometryChanged).toEqual([])
  })

  it('施工ステップ紐付け変更は stepChanged に分類される', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after = [
      line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, {
        constructionStepIds: ['step-1' as ConstructionStepId],
      }),
    ]
    const diff = diffDrawings(before, after)
    expect(diff.stepChanged.map((c) => c.id)).toEqual([id('a')])
  })

  it('変更なし（updatedAt のみ差）は実質比較でどのカテゴリにも入らない', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after = [
      line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, { updatedAt: '2099-01-01T00:00:00.000Z' }),
    ]
    const diff = diffDrawings(before, after)
    expect(diff.geometryChanged).toEqual([])
    expect(diff.styleChanged).toEqual([])
    expect(diff.attributeChanged).toEqual([])
    expect(diff.stepChanged).toEqual([])
  })

  it('座標変更と属性変更が同時なら両カテゴリに現れる', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 }, { civilAttributeId: 'attr-1' })]
    const after = [line('a', { x: 0, y: 0 }, { x: 9, y: 9 }, { civilAttributeId: 'attr-2' })]
    const diff = diffDrawings(before, after)
    expect(diff.geometryChanged.map((c) => c.id)).toEqual([id('a')])
    expect(diff.attributeChanged.map((c) => c.id)).toEqual([id('a')])
  })

  it('座標の微小差は coordinateTolerance 以内なら変更としない（§20 許容差）', () => {
    const before = [line('a', { x: 0, y: 0 }, { x: 1, y: 1 })]
    const after = [line('a', { x: 0, y: 0 }, { x: 1.0005, y: 1 })]
    expect(diffDrawings(before, after).geometryChanged).toHaveLength(1)
    expect(diffDrawings(before, after, { coordinateTolerance: 0.001 }).geometryChanged).toEqual([])
  })
})
