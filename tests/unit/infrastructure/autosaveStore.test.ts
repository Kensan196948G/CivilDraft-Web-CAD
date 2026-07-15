import { describe, expect, it } from 'vitest'
import {
  AUTOSAVE_DB_NAME,
  IndexedDbAutosaveStore,
  MemoryAutosaveStore,
  createAutosaveStore,
  parseSnapshot,
} from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveSnapshot } from '@/infrastructure/autosave/autosaveStore'
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
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
}

function line(gid: string, x1: number, y1: number, x2: number, y2: number): Geometry {
  return { ...base, id: gid as GeometryId, type: 'line', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } }
}

const layer: DrawingLayer = {
  id: 'layer-1' as LayerId,
  name: 'レイヤー1',
  order: 0,
  visible: true,
  locked: false,
  printable: true,
  defaultStyle: style,
}

function snapshot(geometries: readonly Geometry[] = [line('l1', 0, 0, 10, 20)]): AutosaveSnapshot {
  return { savedAt: '2026-07-15T12:00:00.000Z', geometries, layers: [layer] }
}

describe('MemoryAutosaveStore', () => {
  it('save→load 往復で同一スナップショットを復元する', async () => {
    const store = new MemoryAutosaveStore()
    const snap = snapshot()
    const saved = await store.save(snap)
    expect(saved.ok).toBe(true)

    const loaded = await store.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.value).toEqual(snap)
      // 図形の中身（座標）まで往復すること
      expect(loaded.value?.geometries[0]).toMatchObject({ type: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 20 } })
    }
  })

  it('未保存状態の load は ok:true / value:null を返す', async () => {
    const store = new MemoryAutosaveStore()
    const loaded = await store.load()
    expect(loaded).toEqual({ ok: true, value: null })
  })

  it('clear 後の load は null になる', async () => {
    const store = new MemoryAutosaveStore()
    await store.save(snapshot())
    const cleared = await store.clear()
    expect(cleared.ok).toBe(true)

    const loaded = await store.load()
    expect(loaded).toEqual({ ok: true, value: null })
  })

  it('容量超過時は AUTOSAVE_QUOTA_EXCEEDED の error Result を返す（握り潰さない）', async () => {
    const store = new MemoryAutosaveStore({ maxBytes: 10 })
    const result = await store.save(snapshot())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('AUTOSAVE_QUOTA_EXCEEDED')
      expect(result.error.severity).toBe('error')
      expect(result.error.message).toMatch(/上限/)
    }
  })

  it('容量超過の save は throw せず Promise を resolve する（例外を投げない契約）', async () => {
    const store = new MemoryAutosaveStore({ maxBytes: 1 })
    await expect(store.save(snapshot())).resolves.toMatchObject({ ok: false })
  })

  it('容量超過で保存に失敗しても、直前の保存内容は破壊されない', async () => {
    const store = new MemoryAutosaveStore({ maxBytes: 100_000 })
    const first = snapshot([line('l1', 1, 2, 3, 4)])
    await store.save(first)

    // 上限を跨ぐ巨大スナップショット（多数図形）で失敗させる
    const many = Array.from({ length: 5000 }, (_, i) => line(`g${i}`, i, i, i + 1, i + 1))
    const failed = await store.save(snapshot(many))
    expect(failed.ok).toBe(false)

    const loaded = await store.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.value).toEqual(first)
  })
})

describe('IndexedDbAutosaveStore (IndexedDB 非対応環境 = jsdom)', () => {
  it('jsdom には indexedDB が存在しない（前提確認）', () => {
    expect(globalThis.indexedDB).toBeUndefined()
  })

  it('save は AUTOSAVE_DB_UNAVAILABLE の error Result を返す（throw しない）', async () => {
    const store = new IndexedDbAutosaveStore(AUTOSAVE_DB_NAME, undefined)
    const result = await store.save(snapshot())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUTOSAVE_DB_UNAVAILABLE')
  })

  it('load は AUTOSAVE_DB_UNAVAILABLE の error Result を返す（throw しない）', async () => {
    const store = new IndexedDbAutosaveStore(AUTOSAVE_DB_NAME, undefined)
    const result = await store.load()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUTOSAVE_DB_UNAVAILABLE')
  })

  it('clear は AUTOSAVE_DB_UNAVAILABLE の error Result を返す（throw しない）', async () => {
    const store = new IndexedDbAutosaveStore(AUTOSAVE_DB_NAME, undefined)
    const result = await store.clear()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUTOSAVE_DB_UNAVAILABLE')
  })

  it('factory 省略（既定 globalThis.indexedDB）でも jsdom では DB_UNAVAILABLE になる', async () => {
    const store = new IndexedDbAutosaveStore()
    await expect(store.save(snapshot())).resolves.toMatchObject({ ok: false })
  })
})

describe('createAutosaveStore', () => {
  it('factory 未指定（jsdom）では MemoryAutosaveStore にフォールバックする', () => {
    const store = createAutosaveStore()
    expect(store).toBeInstanceOf(MemoryAutosaveStore)
  })

  it('factory を渡すと IndexedDbAutosaveStore を生成する', () => {
    // 実際に open はしない。型がある最小のダミー factory で分岐のみ確認する。
    const fakeFactory = { open: () => ({}) } as unknown as IDBFactory
    const store = createAutosaveStore(fakeFactory)
    expect(store).toBeInstanceOf(IndexedDbAutosaveStore)
  })
})

describe('parseSnapshot（壊れた保存データの伝播）', () => {
  it('null/undefined は「保存なし」として ok:true / value:null を返す', () => {
    expect(parseSnapshot(null)).toEqual({ ok: true, value: null })
    expect(parseSnapshot(undefined)).toEqual({ ok: true, value: null })
  })

  it('JSON として壊れた文字列は AUTOSAVE_READ_FAILED を返す（null に握り潰さない）', () => {
    const result = parseSnapshot('{ not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUTOSAVE_READ_FAILED')
  })

  it('geometries/layers が配列でない構造は AUTOSAVE_READ_FAILED を返す', () => {
    const result = parseSnapshot(JSON.stringify({ savedAt: 'x', geometries: {}, layers: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('AUTOSAVE_READ_FAILED')
  })

  it('正しい JSON 文字列は復元される', () => {
    const snap = snapshot()
    const result = parseSnapshot(JSON.stringify(snap))
    expect(result).toEqual({ ok: true, value: snap })
  })
})
