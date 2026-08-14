import { describe, expect, it } from 'vitest'
import '@/app/canvas/registerKonvaNodes'
import Konva from 'konva/lib/Core'

describe('registerKonvaNodes', () => {
  it('使用する図形ノードがKonva Coreへ登録される', () => {
    const registry = Konva as unknown as Record<string, unknown>
    for (const name of [
      'Stage',
      'Layer',
      'Group',
      'Line',
      'Rect',
      'Circle',
      'Arc',
      'Arrow',
      'Ellipse',
      'Path',
      'Star',
      'Text',
    ]) {
      expect(registry[name], `Konva.${name}`).toBeDefined()
    }
  })
})
