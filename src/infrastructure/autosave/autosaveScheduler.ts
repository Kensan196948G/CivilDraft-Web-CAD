/**
 * 自動保存デバウンススケジューラ。連続変更を束ね、最後の1回だけ永続化する。
 *
 * 継承元: Civil-Draw src/utils/autosave.ts の debounce（継承台帳 modify、
 *   汎用デバウンスを自動保存専用スケジューラとして分離・再設計）。
 * 継承元との差分（Issue #9 / リスク台帳 R-006）:
 * - 汎用 debounce(fn, wait) → 自動保存専用スケジューラへ特化。snapshotFn を **flush 時に
 *   遅延評価** し、連続変更の「最新状態」を保存する（中間状態の取りこぼしを防ぐ）。
 * - setTimeout/clearTimeout を DI 可能にし、テストで fake timer / スタブを差し込める。
 * - 保存結果 Result を onResult コールバックで呼び出し側へ伝播する
 *   （継承元 debounce は戻り値を捨てていた。R-006: 保存失敗を握り潰さない）。
 * - dispose() で保留タイマー解除に加え、以降の trigger() を無効化する。
 *
 * infrastructure 層（詳細設計仕様書 §2.1）。domain には置かない。
 */
import type { Result, ValidationIssue } from '@/shared/types'
import type { AutosaveSnapshot, AutosaveStore } from './autosaveStore'

/** デバウンス既定間隔（ms）。継承元の保存間隔設計を踏襲した暫定値。 */
export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 3000

/** スケジューラ構成。 */
export interface AutosaveScheduleConfig {
  /** デバウンス間隔（ms）。既定 3000。 */
  readonly debounceMs?: number
  /** 各保存の完了結果（成功・失敗の両方）を受け取る。失敗の通知経路。 */
  readonly onResult?: (result: Result<void, ValidationIssue>) => void
  /** setTimeout の差し替え（DI）。既定は globalThis.setTimeout。 */
  readonly setTimeoutFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  /** clearTimeout の差し替え（DI）。既定は globalThis.clearTimeout。 */
  readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
}

/** スケジューラ操作ハンドル。 */
export interface AutosaveScheduler {
  /** 変更を通知する。デバウンス後に最新スナップショットが1回保存される。 */
  readonly trigger: () => void
  /** 保留タイマーを解除し、以降の trigger を無効化する。 */
  readonly dispose: () => void
}

/**
 * 自動保存スケジューラを生成する。
 * @param snapshotFn 保存時に呼ばれ、その時点の最新スナップショットを返す（遅延評価）。
 * @param store 永続化先の AutosaveStore。
 * @param config デバウンス間隔・結果コールバック・タイマーDI。
 */
export function scheduleAutosave(
  snapshotFn: () => AutosaveSnapshot,
  store: AutosaveStore,
  config: AutosaveScheduleConfig = {},
): AutosaveScheduler {
  const debounceMs = config.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS
  const setTimeoutFn =
    config.setTimeoutFn ?? ((handler, ms) => globalThis.setTimeout(handler, ms))
  const clearTimeoutFn = config.clearTimeoutFn ?? ((handle) => globalThis.clearTimeout(handle))

  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const runSave = async (snapshot: AutosaveSnapshot): Promise<void> => {
    try {
      const result = await store.save(snapshot)
      config.onResult?.(result)
    } catch (err) {
      // store は Result を返す契約だが、万一の reject も握り潰さず error として伝播する。
      config.onResult?.({
        ok: false,
        error: {
          code: 'AUTOSAVE_UNEXPECTED',
          severity: 'error',
          message: `自動保存中に予期しないエラーが発生しました（${String(err)}）。`,
        },
      })
    }
  }

  const flush = (): void => {
    timer = null
    void runSave(snapshotFn())
  }

  const trigger = (): void => {
    if (disposed) return
    if (timer !== null) clearTimeoutFn(timer)
    timer = setTimeoutFn(flush, debounceMs)
  }

  const dispose = (): void => {
    disposed = true
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  return { trigger, dispose }
}
