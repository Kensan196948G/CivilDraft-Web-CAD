import { describe, expect, it } from 'vitest'
import {
  SYMBOL_CATALOG,
  getCategories,
  getSymbolById,
} from '@/domain/catalog/symbolCatalog'
import type { SymbolDef } from '@/domain/catalog/symbolCatalog'

const VALID_CATEGORIES: readonly SymbolDef['category'][] = [
  '仮設',
  '土工',
  '測量',
  '車両',
  '構造物',
]

describe('SYMBOL_CATALOG / データ整合性', () => {
  it('全エントリのidが一意である', () => {
    const ids = SYMBOL_CATALOG.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('全エントリがname/category/size/pathsを備え、pathsが空でない', () => {
    for (const def of SYMBOL_CATALOG) {
      expect(def.name.length).toBeGreaterThan(0)
      expect(VALID_CATEGORIES).toContain(def.category)
      expect(def.size).toBeGreaterThan(0)
      expect(def.paths.length).toBeGreaterThan(0)
    }
  })

  it('各pathのdata長が種別ごとに妥当である（line=4/circle=3/polyline=偶数かつ4以上）', () => {
    for (const def of SYMBOL_CATALOG) {
      for (const path of def.paths) {
        switch (path.type) {
          case 'line':
            expect(path.data.length).toBe(4)
            break
          case 'circle':
            expect(path.data.length).toBe(3)
            break
          case 'polyline':
            expect(path.data.length).toBeGreaterThanOrEqual(4)
            expect(path.data.length % 2).toBe(0)
            break
          default: {
            const exhaustive: never = path.type
            throw new Error(`未知のpath種別: ${JSON.stringify(exhaustive)}`)
          }
        }
      }
    }
  })

  it('全data要素が有限数値である', () => {
    for (const def of SYMBOL_CATALOG) {
      for (const path of def.paths) {
        for (const n of path.data) {
          expect(Number.isFinite(n)).toBe(true)
        }
      }
    }
  })
})

describe('getSymbolById', () => {
  it('既存のidに一致する定義を返す', () => {
    const cone = getSymbolById('cone')
    expect(cone).toBeDefined()
    expect(cone?.id).toBe('cone')
    expect(cone?.name).toBe('カラーコーン')
    expect(cone?.category).toBe('仮設')
  })

  it('カタログ内の全idが取得できる', () => {
    for (const def of SYMBOL_CATALOG) {
      expect(getSymbolById(def.id)).toBe(def)
    }
  })

  it('未知のidにはundefinedを返す', () => {
    expect(getSymbolById('does-not-exist')).toBeUndefined()
    expect(getSymbolById('')).toBeUndefined()
  })
})

describe('getCategories', () => {
  it('重複なくカテゴリを返す', () => {
    const categories = getCategories()
    expect(new Set(categories).size).toBe(categories.length)
  })

  it('カタログに出現する全カテゴリを網羅する', () => {
    const categories = getCategories()
    const expected = new Set(SYMBOL_CATALOG.map((s) => s.category))
    expect(new Set(categories)).toEqual(expected)
  })

  it('返り値は定義済みカテゴリ集合の部分集合である', () => {
    for (const c of getCategories()) {
      expect(VALID_CATEGORIES).toContain(c)
    }
  })
})
