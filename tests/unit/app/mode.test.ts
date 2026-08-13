import { describe, expect, it } from 'vitest'
import {
  DEMO_DEFAULT_HOSTNAMES,
  isDemoHostnameByDefault,
  isDemoMode,
  isDemoRequested,
} from '@/app/mode'

describe('mode（デモ表示判定）', () => {
  it('?demo=1 はどのホストでもデモ表示になる', () => {
    expect(isDemoRequested('?demo=1', 'civildraft-web-cad.mirai-dx-platform.com')).toBe(true)
    expect(isDemoRequested('?demo=1', 'localhost')).toBe(true)
  })

  it('MVP ホストと workers.dev はクエリ無しでもデモ表示になる', () => {
    expect(isDemoRequested('', 'civildraft-web-cad-mvp.mirai-dx-platform.com')).toBe(true)
    expect(isDemoRequested('', 'civildraft-web-cad.kensan1969.workers.dev')).toBe(true)
  })

  it('本番ホストはクエリ無しではデモ表示にならない', () => {
    expect(isDemoRequested('', 'civildraft-web-cad.mirai-dx-platform.com')).toBe(false)
    expect(isDemoHostnameByDefault('civildraft-web-cad.mirai-dx-platform.com')).toBe(false)
  })

  it('DEMO_DEFAULT_HOSTNAMES に MVP サブドメインが含まれる', () => {
    expect(DEMO_DEFAULT_HOSTNAMES).toContain('civildraft-web-cad-mvp.mirai-dx-platform.com')
  })

  it('isDemoMode は jsdom（localhost・クエリ無し）では false を返す', () => {
    expect(isDemoMode()).toBe(false)
  })
})
