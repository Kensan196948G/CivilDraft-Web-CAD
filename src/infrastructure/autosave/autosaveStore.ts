/**
 * 自動保存の永続化層（ストレージ抽象 + IndexedDB実装 + インメモリ実装）。
 *
 * 継承元: Civil-Draw src/utils/autosave.ts（継承台帳 modify、
 *   自動保存永続化を localStorage 同期直書きから IndexedDB 非同期へ刷新）。
 * 継承元との差分（Issue #9 / リスク台帳 R-006）:
 * - localStorage（同期・容量小・try/catch握り潰し）→ IndexedDB（非同期・大容量・構造化格納）。
 * - **全失敗を握り潰さず Result<_, ValidationIssue> で伝播する**（R-006 再発防止の核心）。
 *   継承元は QuotaExceededError を `catch {}` で無言破棄していたが、本実装は
 *   AUTOSAVE_QUOTA_EXCEEDED として明示的な error Result で返す。
 * - version/savedAt(number) の独自ヘッダ → savedAt(ISO文字列) に簡素化。
 *   図形/レイヤーの型は継承元 Shape/Layer → 本プロジェクトの Geometry/DrawingLayer。
 * - デバウンス（継承元 debounce）は autosaveScheduler.ts へ分離（本ファイルは永続化のみ）。
 * - テスト用 + IndexedDB 非対応環境フォールバックの MemoryAutosaveStore を追加。
 * - シリアライズ方式は継承元同様 JSON（Geometry は JSON 安全な構造）。IndexedDB へは
 *   JSON 文字列として格納し、structured clone のエッジケースを避けつつ往復を決定的にする。
 *
 * このモジュールは infrastructure 層に属する（詳細設計仕様書 §2.1）。domain 層は
 * ブラウザAPI非依存を保つため、IndexedDB 依存の本コードは domain には置かない。
 */
import type { Geometry, DrawingLayer, Result, ValidationIssue } from '@/shared/types'

/** 自動保存スナップショット（図形・レイヤーと保存時刻）。 */
export interface AutosaveSnapshot {
  /** 保存時刻（ISO 8601 文字列, ADR 準拠の文字列時刻表現）。 */
  readonly savedAt: string
  readonly geometries: readonly Geometry[]
  readonly layers: readonly DrawingLayer[]
}

/**
 * 自動保存ストレージ抽象。全操作は Promise<Result> を返し、
 * **例外を throw / reject しない**（想定内の失敗は Result.error で伝播）。
 */
export interface AutosaveStore {
  /** 最新スナップショットを保存する。容量超過等は error Result で返す。 */
  save(snapshot: AutosaveSnapshot): Promise<Result<void, ValidationIssue>>
  /** 保存済みスナップショットを読み込む。未保存時は ok:true / value:null。 */
  load(): Promise<Result<AutosaveSnapshot | null, ValidationIssue>>
  /** 保存済みスナップショットを削除する。 */
  clear(): Promise<Result<void, ValidationIssue>>
}

/** IndexedDB データベース名（本アプリの自動保存専用）。 */
export const AUTOSAVE_DB_NAME = 'civildraft-autosave'
/** objectStore 名。 */
export const AUTOSAVE_STORE_NAME = 'drafts'
/** 単一スナップショットの固定キー。 */
export const AUTOSAVE_LATEST_KEY = 'latest'
const AUTOSAVE_DB_VERSION = 1

/** ValidationIssue（severity:'error'）を組み立てる小ヘルパ。message は日本語。 */
function issue(code: string, message: string): ValidationIssue {
  return { code, severity: 'error', message }
}

/** 例外種別から末尾注記（原因名）を作る。 */
function errSuffix(err: unknown): string {
  if (err instanceof DOMException || err instanceof Error) return `（${err.name}）`
  return ''
}

/** QuotaExceededError（容量超過）判定。ブラウザは DOMException.name で表現する。 */
function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError'
}

/** 書き込み失敗を専用コードへ振り分ける（容量超過は握り潰さず個別コード化）。 */
function mapWriteError(err: unknown): ValidationIssue {
  if (isQuotaError(err)) {
    return issue(
      'AUTOSAVE_QUOTA_EXCEEDED',
      'ストレージ容量の上限に達したため自動保存できませんでした。不要な図面や履歴を削除してください。',
    )
  }
  return issue('AUTOSAVE_WRITE_FAILED', `自動保存の書き込みに失敗しました${errSuffix(err)}。`)
}

/** UTF-8 バイト長（容量上限判定用）。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 保存文字列の形状検査（継承元同様 geometries/layers が配列であることを最低限確認する）。 */
function isSnapshotShape(value: unknown): value is AutosaveSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.savedAt === 'string' && Array.isArray(obj.geometries) && Array.isArray(obj.layers)
}

/**
 * 保存された生値（JSON文字列）をスナップショットへ復元する。
 * 継承元は JSON.parse 失敗や形状不一致で null（＝自動保存なし扱い）を返し握り潰していたが、
 * 本実装は「壊れた保存データ」を AUTOSAVE_READ_FAILED の error Result として明示的に伝播する
 * （R-006: 失敗を握り潰さない。呼び出し側が破棄/通知を選択できる）。
 */
export function parseSnapshot(raw: unknown): Result<AutosaveSnapshot | null, ValidationIssue> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, error: issue('AUTOSAVE_READ_FAILED', '自動保存データの形式が不正です。') }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      error: issue('AUTOSAVE_READ_FAILED', '自動保存データを読み込めませんでした（JSON解析に失敗）。'),
    }
  }
  if (!isSnapshotShape(parsed)) {
    return { ok: false, error: issue('AUTOSAVE_READ_FAILED', '自動保存データの構造が不正です。') }
  }
  return { ok: true, value: parsed }
}

/**
 * IndexedDB 実装。素の indexedDB API のみ使用（新規依存導入なし）。
 * factory を注入可能にし、既定は globalThis.indexedDB。IndexedDB 非対応環境
 * （factory が undefined、例: jsdom）では全操作で AUTOSAVE_DB_UNAVAILABLE を返す。
 */
export class IndexedDbAutosaveStore implements AutosaveStore {
  private readonly dbName: string
  private readonly factory: IDBFactory | undefined

  constructor(dbName: string = AUTOSAVE_DB_NAME, factory: IDBFactory | undefined = globalThis.indexedDB) {
    this.dbName = dbName
    this.factory = factory
  }

  async save(snapshot: AutosaveSnapshot): Promise<Result<void, ValidationIssue>> {
    const opened = await this.openDb()
    if (!opened.ok) return opened
    const db = opened.value
    try {
      const serialized = JSON.stringify(snapshot)
      return await new Promise<Result<void, ValidationIssue>>((resolve) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite')
        } catch (err) {
          resolve({ ok: false, error: mapWriteError(err) })
          return
        }
        let request: IDBRequest
        try {
          request = tx.objectStore(AUTOSAVE_STORE_NAME).put(serialized, AUTOSAVE_LATEST_KEY)
        } catch (err) {
          resolve({ ok: false, error: mapWriteError(err) })
          return
        }
        request.onerror = () => resolve({ ok: false, error: mapWriteError(request.error) })
        tx.oncomplete = () => resolve({ ok: true, value: undefined })
        tx.onerror = () => resolve({ ok: false, error: mapWriteError(tx.error) })
        tx.onabort = () => resolve({ ok: false, error: mapWriteError(tx.error) })
      })
    } finally {
      db.close()
    }
  }

  async load(): Promise<Result<AutosaveSnapshot | null, ValidationIssue>> {
    const opened = await this.openDb()
    if (!opened.ok) return opened
    const db = opened.value
    try {
      return await new Promise<Result<AutosaveSnapshot | null, ValidationIssue>>((resolve) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(AUTOSAVE_STORE_NAME, 'readonly')
        } catch (err) {
          resolve({ ok: false, error: issue('AUTOSAVE_READ_FAILED', `自動保存の読み込みに失敗しました${errSuffix(err)}。`) })
          return
        }
        const request = tx.objectStore(AUTOSAVE_STORE_NAME).get(AUTOSAVE_LATEST_KEY)
        request.onsuccess = () => resolve(parseSnapshot(request.result))
        request.onerror = () =>
          resolve({ ok: false, error: issue('AUTOSAVE_READ_FAILED', `自動保存の読み込みに失敗しました${errSuffix(request.error)}。`) })
        tx.onerror = () =>
          resolve({ ok: false, error: issue('AUTOSAVE_READ_FAILED', `自動保存の読み込みに失敗しました${errSuffix(tx.error)}。`) })
      })
    } finally {
      db.close()
    }
  }

  async clear(): Promise<Result<void, ValidationIssue>> {
    const opened = await this.openDb()
    if (!opened.ok) return opened
    const db = opened.value
    try {
      return await new Promise<Result<void, ValidationIssue>>((resolve) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(AUTOSAVE_STORE_NAME, 'readwrite')
        } catch (err) {
          resolve({ ok: false, error: issue('AUTOSAVE_CLEAR_FAILED', `自動保存の削除に失敗しました${errSuffix(err)}。`) })
          return
        }
        tx.objectStore(AUTOSAVE_STORE_NAME).delete(AUTOSAVE_LATEST_KEY)
        tx.oncomplete = () => resolve({ ok: true, value: undefined })
        tx.onerror = () =>
          resolve({ ok: false, error: issue('AUTOSAVE_CLEAR_FAILED', `自動保存の削除に失敗しました${errSuffix(tx.error)}。`) })
        tx.onabort = () =>
          resolve({ ok: false, error: issue('AUTOSAVE_CLEAR_FAILED', `自動保存の削除に失敗しました${errSuffix(tx.error)}。`) })
      })
    } finally {
      db.close()
    }
  }

  /** DB を開く。非対応環境や open 失敗は error Result（例外を投げない）。 */
  private openDb(): Promise<Result<IDBDatabase, ValidationIssue>> {
    const factory = this.factory
    if (!factory) {
      return Promise.resolve({
        ok: false,
        error: issue('AUTOSAVE_DB_UNAVAILABLE', 'この環境ではIndexedDBが利用できないため自動保存を実行できません。'),
      })
    }
    return new Promise<Result<IDBDatabase, ValidationIssue>>((resolve) => {
      let request: IDBOpenDBRequest
      try {
        request = factory.open(this.dbName, AUTOSAVE_DB_VERSION)
      } catch (err) {
        resolve({ ok: false, error: issue('AUTOSAVE_DB_UNAVAILABLE', `IndexedDBを開けませんでした${errSuffix(err)}。`) })
        return
      }
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
          db.createObjectStore(AUTOSAVE_STORE_NAME)
        }
      }
      request.onsuccess = () => resolve({ ok: true, value: request.result })
      request.onerror = () =>
        resolve({ ok: false, error: issue('AUTOSAVE_DB_UNAVAILABLE', `IndexedDBを開けませんでした${errSuffix(request.error)}。`) })
      request.onblocked = () =>
        resolve({ ok: false, error: issue('AUTOSAVE_DB_UNAVAILABLE', 'IndexedDBが他タブによりブロックされています。') })
    })
  }
}

/** MemoryAutosaveStore の構成。 */
export interface MemoryAutosaveStoreOptions {
  /**
   * 保存容量の上限（バイト）。超過時に AUTOSAVE_QUOTA_EXCEEDED を返す。
   * 既定は無制限。容量超過経路のテスト・意図的な制限に用いる。
   */
  readonly maxBytes?: number
}

/**
 * インメモリ実装。テスト用 + IndexedDB 非対応環境のフォールバック。
 * 注意: プロセス/リロードで揮発するため、リロード復旧の永続性は持たない
 * （フォールバック時は「復旧不可の明示」であり、握り潰しではない）。
 */
export class MemoryAutosaveStore implements AutosaveStore {
  private stored: string | null = null
  private readonly maxBytes: number

  constructor(options: MemoryAutosaveStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  }

  save(snapshot: AutosaveSnapshot): Promise<Result<void, ValidationIssue>> {
    const serialized = JSON.stringify(snapshot)
    const size = byteLength(serialized)
    if (size > this.maxBytes) {
      return Promise.resolve({
        ok: false,
        error: issue(
          'AUTOSAVE_QUOTA_EXCEEDED',
          `自動保存データ(${size}バイト)がストレージ上限(${this.maxBytes}バイト)を超えました。`,
        ),
      })
    }
    this.stored = serialized
    return Promise.resolve({ ok: true, value: undefined })
  }

  load(): Promise<Result<AutosaveSnapshot | null, ValidationIssue>> {
    return Promise.resolve(parseSnapshot(this.stored))
  }

  clear(): Promise<Result<void, ValidationIssue>> {
    this.stored = null
    return Promise.resolve({ ok: true, value: undefined })
  }
}

/**
 * 実行環境に応じた既定ストアを生成する。IndexedDB が利用可能なら永続化実装、
 * 非対応なら揮発フォールバック（MemoryAutosaveStore）。どちらも AutosaveStore 契約
 * （Result 返却・例外非throw）を満たすため呼び出し側は分岐不要。
 */
export function createAutosaveStore(factory: IDBFactory | undefined = globalThis.indexedDB): AutosaveStore {
  return factory ? new IndexedDbAutosaveStore(AUTOSAVE_DB_NAME, factory) : new MemoryAutosaveStore()
}
