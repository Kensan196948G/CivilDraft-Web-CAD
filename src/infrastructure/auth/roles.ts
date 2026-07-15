/**
 * CivilDraft のロール設計と権限判定。
 *
 * 継承元: 無し（Cloudflare Access モデルへの刷新に伴う新規設計。継承台帳 add）。
 * 継承元の MSAL/Entra ID 統合（discard、accessIdentity.ts 冒頭参照）ではアプリ内の
 * ロール概念が未整備だった。本ファイルで CivilDraft 固有ロールと権限を一元定義する。
 *
 * ロール要件（詳細設計仕様書の利用者区分より）:
 * - engineer   : 工種担当。図面の編集ができる。
 * - supervisor : 監督員。編集に加え承認ができる。
 * - viewer     : 閲覧者。閲覧のみ。
 *
 * 権限マトリクス（暫定）:
 * | 操作 | viewer | engineer | supervisor |
 * |------|:------:|:--------:|:----------:|
 * | 閲覧 |   ○    |    ○     |     ○      |
 * | 編集 |   ×    |    ○     |     ○      |
 * | 承認 |   ×    |    ×     |     ○      |
 * 承認フローの詳細（誰が何を承認するか）は詳細設計仕様書で確定次第、canApprove の
 * 適用範囲を精緻化する。現時点では「承認操作は supervisor のみ」を暫定境界とする。
 *
 * グループ→ロール規約:
 * - Cloudflare Access の IdP グループ名を下記 ROLE_GROUP_NAMES に一致させる規約とする。
 * - この規約（グループ名と割当）は **Cloudflare Access テナント側の人間確認事項**であり、
 *   アプリはグループ名を受け取ってロールへ写像するのみ（テナント設定は本タスク対象外）。
 * - 複数グループに属する場合は**最上位権限**を採用する（supervisor > engineer > viewer）。
 * - 未知グループ / グループ無しは既定 viewer（最小権限）。
 *
 * infrastructure 層（詳細設計仕様書 §2.1）。
 */
import type { AccessIdentity } from './accessIdentity'

export type CivilDraftRole = 'engineer' | 'supervisor' | 'viewer'

/**
 * ロールに対応する Cloudflare Access グループ名（テナント側で作成・割当する規約）。
 * 単一の真実。GROUP_ROLE_MAP と権限表はこの定数から導出する。
 */
export const ROLE_GROUP_NAMES = {
  supervisor: 'civildraft-supervisor',
  engineer: 'civildraft-engineer',
  viewer: 'civildraft-viewer',
} as const

/** グループ名（小文字正規化後）→ ロール。 */
const GROUP_ROLE_MAP: Record<string, CivilDraftRole> = {
  [ROLE_GROUP_NAMES.supervisor]: 'supervisor',
  [ROLE_GROUP_NAMES.engineer]: 'engineer',
  [ROLE_GROUP_NAMES.viewer]: 'viewer',
}

/** 権限の強さ（最上位権限の選択に使う）。 */
const ROLE_RANK: Record<CivilDraftRole, number> = {
  viewer: 0,
  engineer: 1,
  supervisor: 2,
}

/** ロールごとの許可操作マトリクス（単一の真実。個別 canX 関数はここから導出）。 */
export interface RolePermissions {
  readonly canView: boolean
  readonly canEdit: boolean
  readonly canApprove: boolean
}

const PERMISSIONS: Record<CivilDraftRole, RolePermissions> = {
  viewer: { canView: true, canEdit: false, canApprove: false },
  engineer: { canView: true, canEdit: true, canApprove: false },
  supervisor: { canView: true, canEdit: true, canApprove: true },
}

/** グループ名を比較用に正規化する（前後空白除去・小文字化）。IdP 差異に寛容にする。 */
function normalizeGroup(group: string): string {
  return group.trim().toLowerCase()
}

/**
 * グループ名の配列からロールを解決する。
 * 複数該当時は最上位権限、該当無し（未知・空）は viewer を返す。
 */
export function resolveRole(groups: readonly string[]): CivilDraftRole {
  let best: CivilDraftRole = 'viewer'
  for (const group of groups) {
    const mapped = GROUP_ROLE_MAP[normalizeGroup(group)]
    if (mapped !== undefined && ROLE_RANK[mapped] > ROLE_RANK[best]) {
      best = mapped
    }
  }
  return best
}

/** identity（groups）からロールを解決する薄いショートカット。 */
export function roleFromIdentity(identity: AccessIdentity): CivilDraftRole {
  return resolveRole(identity.groups)
}

/** ロールの許可操作一式を返す。 */
export function permissionsFor(role: CivilDraftRole): RolePermissions {
  return PERMISSIONS[role]
}

/** 閲覧可否（全ロール可）。 */
export function canView(role: CivilDraftRole): boolean {
  return PERMISSIONS[role].canView
}

/** 編集可否（engineer / supervisor）。 */
export function canEdit(role: CivilDraftRole): boolean {
  return PERMISSIONS[role].canEdit
}

/** 承認可否（supervisor のみ、暫定）。 */
export function canApprove(role: CivilDraftRole): boolean {
  return PERMISSIONS[role].canApprove
}
