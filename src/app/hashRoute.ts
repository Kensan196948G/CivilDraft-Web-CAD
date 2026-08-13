/**
 * ハッシュベースの軽量ルーティング。
 *
 * 業務画面の URL 共有・ブックマーク・ブラウザの戻る/進むを可能にする。
 * 形式: `#/<view>` または `#/<view>?<query>`（editor はセッション、project は projectId を保持）。
 * 実装は純粋関数に分離し、AppShell の状態と hashchange イベントで同期する。
 */
import type { AppView } from './layout/Sidebar'
import {
  DEFAULT_CLOUD_DRAFT_SESSION,
  type CloudDraftSession,
} from './pages/cloudDraftSession'

export const HASH_PREFIX = '#/'

export const ROUTEABLE_VIEWS: readonly AppView[] = [
  'home',
  'editor',
  'newDrawing',
  'project',
  'drawingSettings',
  'survey',
  'parts',
  'quantity',
  'section',
  'steps',
  'field',
  'compare',
  'approval',
  'print',
  'delivery',
  'audit',
  'settings',
]

export interface RouteState {
  readonly view: AppView
  readonly projectId?: string
  readonly session?: CloudDraftSession
}

const SESSION_KEYS: readonly (keyof CloudDraftSession)[] = [
  'projectId',
  'projectNumber',
  'projectName',
  'clientName',
  'drawingId',
  'drawingNumber',
  'drawingName',
  'drawingType',
  'revisionId',
  'revisionNumber',
  'changeSummary',
]

function isDefaultSessionValue(key: keyof CloudDraftSession, value: string): boolean {
  return DEFAULT_CLOUD_DRAFT_SESSION[key] === value
}

/** URL ハッシュをルート状態へ変換する。無効なハッシュは undefined。 */
export function parseRoute(hash: string): RouteState | undefined {
  if (!hash.startsWith(HASH_PREFIX)) {
    return undefined
  }
  const raw = hash.slice(HASH_PREFIX.length)
  const queryIndex = raw.indexOf('?')
  const pathPart = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw
  const queryPart = queryIndex >= 0 ? raw.slice(queryIndex + 1) : ''
  if (!ROUTEABLE_VIEWS.includes(pathPart as AppView)) {
    return undefined
  }
  const view = pathPart as AppView
  const params = new URLSearchParams(queryPart)
  const projectId = params.get('projectId') ?? undefined

  const session: CloudDraftSession | undefined =
    view === 'editor' ? sessionFromParams(params) : undefined
  return { view, projectId, session }
}

function sessionFromParams(params: URLSearchParams): CloudDraftSession | undefined {
  const entries = SESSION_KEYS.filter((key) => params.has(key))
  if (entries.length === 0) {
    return undefined
  }
  const session: CloudDraftSession = { ...DEFAULT_CLOUD_DRAFT_SESSION }
  for (const key of entries) {
    const value = params.get(key) ?? ''
    if (key === 'projectId' || key === 'drawingId' || key === 'revisionId') {
      ;(session as unknown as Record<string, string | undefined>)[key] = value || undefined
    } else {
      ;(session as unknown as Record<string, string>)[key] = value
    }
  }
  return session
}

/** ルート状態を URL ハッシュへ変換する（default 相当のセッション値は省略）。 */
export function formatRoute(
  view: AppView,
  options: { readonly projectId?: string; readonly session?: CloudDraftSession } = {},
): string {
  const params = new URLSearchParams()
  if (view === 'project' && options.projectId !== undefined) {
    params.set('projectId', options.projectId)
  }
  if (view === 'editor' && options.session !== undefined) {
    for (const key of SESSION_KEYS) {
      const value = options.session[key]
      if (value === undefined || value === '') continue
      if (isDefaultSessionValue(key, value)) continue
      params.set(key, value)
    }
  }
  const query = params.toString()
  return `${HASH_PREFIX}${view}${query === '' ? '' : `?${query}`}`
}
