import { describe, expect, it } from 'vitest'
import { checkDrawingHealth } from '@/domain/validation/drawingHealth'
import type { DocumentState } from '@/domain/commands/editorCommand'
import type {
  DrawingLayer,
  Geometry,
  GeometryBase,
  GeometryId,
  GeometryStyle,
  LayerId,
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
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
}

function id(value: string): GeometryId {
  return value as GeometryId
}

function layer(lid: string, visible = true): DrawingLayer {
  return {
    id: lid as LayerId,
    name: lid,
    order: 0,
    visible,
    locked: false,
    printable: true,
    defaultStyle: style,
  }
}

function line(gid: string, lid: string, x1: number, x2: number): Geometry {
  return {
    ...base,
    id: id(gid),
    layerId: lid as LayerId,
    type: 'line',
    start: { x: x1, y: 0 },
    end: { x: x2, y: 10 },
  }
}

function doc(geometries: Geometry[], layers: DrawingLayer[]): DocumentState {
  return { geometries, layers }
}

describe('checkDrawingHealth（図面健全性チェック / Issue #59）', () => {
  it('問題のない図面は healthy=true・issues 0 件', () => {
    const result = checkDrawingHealth(
      doc([line('g-1', 'layer-1', 0, 100)], [layer('layer-1')]),
      { paperSize: 'A3', paperOrientation: 'landscape' },
    )
    expect(result.healthy).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.geometryCount).toBe(1)
  })

  it('存在しないレイヤー参照を error で検出する', () => {
    const result = checkDrawingHealth(doc([line('g-1', 'missing', 0, 100)], [layer('layer-1')]))
    expect(result.healthy).toBe(false)
    const issue = result.issues.find((i) => i.code === 'unknown-layer')
    expect(issue?.severity).toBe('error')
    expect(issue?.count).toBe(1)
    expect(issue?.geometryIds).toEqual([id('g-1')])
  })

  it('用紙の外に完全に配置された図形を warning で検出する', () => {
    // A3 landscape = 420×297mm。x=100000 は完全に外側。
    const result = checkDrawingHealth(
      doc([line('g-1', 'layer-1', 100000, 100100)], [layer('layer-1')]),
      { paperSize: 'A3', paperOrientation: 'landscape' },
    )
    const issue = result.issues.find((i) => i.code === 'off-paper')
    expect(issue?.severity).toBe('warning')
    expect(issue?.count).toBe(1)
    expect(issue?.message).toContain('A3')
  })

  it('回転した矩形は回転後の AABB で用紙外判定する（CodeRabbit #104）', () => {
    const rotatedRectangle: Geometry = {
      ...base,
      id: id('g-rot'),
      layerId: 'layer-1' as LayerId,
      type: 'rectangle',
      // 回転前 bbox（y=300〜400）は A3 landscape（420×297）の外に見えるが、
      // 270°回転後は y=200〜300 に収まり、実際には用紙に一部重なる。
      origin: { x: 0, y: 300 },
      width: 100,
      height: 50,
      rotationDeg: 270,
    }
    const result = checkDrawingHealth(
      doc([rotatedRectangle], [layer('layer-1')]),
      { paperSize: 'A3', paperOrientation: 'landscape' },
    )
    // 回転考慮なし（shapeBBox）なら誤検出することを確認
    const unrotated = checkDrawingHealth(
      doc([{ ...rotatedRectangle, rotationDeg: 0 }], [layer('layer-1')]),
      { paperSize: 'A3', paperOrientation: 'landscape' },
    )
    expect(unrotated.healthy).toBe(false)
    expect(result.healthy).toBe(true)
  })

  it('回転していない矩形は従来どおり shapeBBox で判定する', () => {
    const plainRectangle: Geometry = {
      ...base,
      id: id('g-rect'),
      layerId: 'layer-1' as LayerId,
      type: 'rectangle',
      origin: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotationDeg: 0,
    }
    const result = checkDrawingHealth(
      doc([plainRectangle], [layer('layer-1')]),
      { paperSize: 'A3', paperOrientation: 'landscape' },
    )
    expect(result.healthy).toBe(true)
  })

  it('非表示レイヤー上の図形を info で検出する', () => {
    const result = checkDrawingHealth(
      doc([line('g-1', 'layer-hidden', 0, 100)], [layer('layer-hidden', false)]),
    )
    const issue = result.issues.find((i) => i.code === 'hidden-layer')
    expect(issue?.severity).toBe('info')
    expect(issue?.count).toBe(1)
  })

  it('空の図面は healthy=true', () => {
    const result = checkDrawingHealth(doc([], [layer('layer-1')]))
    expect(result.healthy).toBe(true)
  })
})
