import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleAutosave } from '@/infrastructure/autosave/autosaveScheduler'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { AutosaveSnapshot, AutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { Result, ValidationIssue } from '@/shared/types'

function snapshotAt(savedAt: string): AutosaveSnapshot {
  return { savedAt, geometries: [], layers: [] }
}

/** 保存呼び出しを記録するテスト用ストア。 */
function recordingStore(): { store: AutosaveStore; saves: AutosaveSnapshot[] } {
  const saves: AutosaveSnapshot[] = []
  const store: AutosaveStore = {
    save: (snap) => {
      saves.push(snap)
      return Promise.resolve({ ok: true, value: undefined })
    },
    load: () => Promise.resolve({ ok: true, value: null }),
    clear: () => Promise.resolve({ ok: true, value: undefined }),
  }
  return { store, saves }
}

/** 常に error を返すストア（失敗伝播テスト用）。 */
function failingStore(error: ValidationIssue): AutosaveStore {
  return {
    save: () => Promise.resolve({ ok: false, error }),
    load: () => Promise.resolve({ ok: true, value: null }),
    clear: () => Promise.resolve({ ok: false, error }),
  }
}

describe('scheduleAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('連続 trigger をデバウンスし、保存は1回だけ実行される', async () => {
    const { store, saves } = recordingStore()
    const scheduler = scheduleAutosave(() => snapshotAt('final'), store, { debounceMs: 3000 })

    scheduler.trigger()
    scheduler.trigger()
    scheduler.trigger()
    expect(saves).toHaveLength(0) // まだ flush されない

    await vi.advanceTimersByTimeAsync(3000)
    expect(saves).toHaveLength(1)
  })

  it('snapshotFn は flush 時に評価され、最新状態が保存される', async () => {
    const { store, saves } = recordingStore()
    let current = snapshotAt('v1')
    const scheduler = scheduleAutosave(() => current, store, { debounceMs: 1000 })

    scheduler.trigger()
    current = snapshotAt('v2')
    scheduler.trigger()
    current = snapshotAt('v3')

    await vi.advanceTimersByTimeAsync(1000)
    expect(saves).toHaveLength(1)
    expect(saves[0]?.savedAt).toBe('v3')
  })

  it('デバウンス窓の途中で dispose すると保存されない', async () => {
    const { store, saves } = recordingStore()
    const scheduler = scheduleAutosave(() => snapshotAt('x'), store, { debounceMs: 2000 })

    scheduler.trigger()
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(saves).toHaveLength(0)
  })

  it('dispose 後の trigger は無効（保存されない）', async () => {
    const { store, saves } = recordingStore()
    const scheduler = scheduleAutosave(() => snapshotAt('x'), store, { debounceMs: 1000 })

    scheduler.dispose()
    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(2000)
    expect(saves).toHaveLength(0)
  })

  it('保存成功が onResult コールバックへ伝播する', async () => {
    const { store } = recordingStore()
    const results: Result<void, ValidationIssue>[] = []
    const scheduler = scheduleAutosave(() => snapshotAt('ok'), store, {
      debounceMs: 500,
      onResult: (r) => results.push(r),
    })

    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(500)
    expect(results).toEqual([{ ok: true, value: undefined }])
  })

  it('保存失敗（QUOTA等）が onResult コールバックへ伝播する（握り潰さない）', async () => {
    const err: ValidationIssue = {
      code: 'AUTOSAVE_QUOTA_EXCEEDED',
      severity: 'error',
      message: '容量超過',
    }
    const results: Result<void, ValidationIssue>[] = []
    const scheduler = scheduleAutosave(() => snapshotAt('fail'), failingStore(err), {
      debounceMs: 500,
      onResult: (r) => results.push(r),
    })

    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(500)
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({ ok: false, error: err })
  })

  it('trigger→flush→trigger→flush の別サイクルで2回保存される', async () => {
    const { store, saves } = recordingStore()
    const scheduler = scheduleAutosave(() => snapshotAt('cycle'), store, { debounceMs: 1000 })

    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(1000)
    expect(saves).toHaveLength(2)
  })

  it('注入した setTimeout/clearTimeout（DI）が使用される', async () => {
    const { store, saves } = recordingStore()
    const setSpy = vi.fn((handler: () => void, ms: number) => globalThis.setTimeout(handler, ms))
    const clearSpy = vi.fn((handle: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(handle))

    const scheduler = scheduleAutosave(() => snapshotAt('di'), store, {
      debounceMs: 1000,
      setTimeoutFn: setSpy,
      clearTimeoutFn: clearSpy,
    })

    scheduler.trigger() // set
    scheduler.trigger() // clear + set
    expect(setSpy).toHaveBeenCalledTimes(2)
    expect(clearSpy).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(saves).toHaveLength(1)
  })

  it('実ストア（MemoryAutosaveStore）と結線してデバウンス保存できる', async () => {
    const memory = new MemoryAutosaveStore()
    const scheduler = scheduleAutosave(() => snapshotAt('2026-07-15T12:00:00.000Z'), memory, {
      debounceMs: 1000,
    })
    scheduler.trigger()
    await vi.advanceTimersByTimeAsync(1000)

    const loaded = await memory.load()
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(loaded.value?.savedAt).toBe('2026-07-15T12:00:00.000Z')
  })
})
