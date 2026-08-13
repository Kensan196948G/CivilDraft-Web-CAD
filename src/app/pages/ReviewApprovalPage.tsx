/**
 * 照査・承認画面。
 * 正本: 詳細設計仕様書 §19 改訂・ワークフロー（状態遷移表 §19.1 / 不変条件 §19.2）。
 *
 * 本画面は §19 のワークフロー状態機械（src/domain/revisions）を UI 化する。
 * 状態遷移・履歴生成・不変条件はすべて domain 層の純関数へ委譲し、本コンポーネントは
 * 表示・入力・結果メッセージのみを担う（詳細設計仕様書 §2.1 の責務分離）。
 *
 * デザインは HomePage / pageStyles.ts のトークンを再利用して視覚一貫性を保つ
 * （正本: Claude Design「CivilDraft Web CAD」・テーマ変数 src/app/home.css）。
 *
 * ロール取得について:
 * - 本画面ではデモ目的でロールをボタン切替する。permissionsFor(role) の戻り値
 *   （RolePermissions）を WorkflowActor として遷移関数へ渡す（構造的に代入可能）。
 * - 実運用では role はここで切替せず、Cloudflare Access の identity（accessIdentity /
 *   roleFromIdentity）から解決する。切替 UI は開発・デモ用の足場である。
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  applyRevisionAction,
  availableActions,
  canModifyRevisionContent,
  transition,
} from '@/domain/revisions'
import { isDemoMode } from '@/app/mode'
import type {
  DrawingRevision,
  RevisionAction,
  RevisionHistoryEntry,
  RevisionStatus,
  TransitionContext,
  WorkflowActor,
  WorkflowRole,
} from '@/domain/revisions'
import { permissionsFor } from '@/infrastructure/auth/roles'
import type { CivilDraftRole } from '@/infrastructure/auth/roles'
import {
  createCivilDraftApiClient,
  type CivilDraftApiClient,
  type CloudRevision,
  type CloudWorkflowAction,
  type CloudWorkflowActionBody,
} from '@/infrastructure/cloud/civilDraftApiClient'
import type { DrawingId, RevisionId } from '@/shared/types'
import {
  ghostButtonStyle,
  monoStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  statusBadgeStyle,
  tdStyle,
  thStyle,
} from './pageStyles'

/** 状態ごとの表示メタ（バッジ配色は Home のステータス配色に準拠）。 */
const STATUS_META: Record<RevisionStatus, { readonly label: string; readonly color: string; readonly bg: string }> = {
  draft: { label: '編集中（draft）', color: '#2E5AAC', bg: '#E9F0FB' },
  inReview: { label: '照査中（inReview）', color: '#B5701A', bg: '#FDEFE0' },
  returned: { label: '差戻し（returned）', color: '#C5392F', bg: '#FBEAE9' },
  pendingApproval: { label: '承認待ち（pendingApproval）', color: '#6B45B0', bg: '#EFEAF8' },
  approved: { label: '承認済み（approved）', color: '#1F8255', bg: '#E4F3EC' },
  obsolete: { label: '廃止（obsolete）', color: 'var(--muted)', bg: 'var(--hover)' },
}

/** アクションの日本語ラベル（§19.1 状態遷移表の「操作」列）。 */
const ACTION_LABEL: Record<RevisionAction, string> = {
  submitReview: '照査依頼',
  resumeEditing: '編集再開',
  return: '差戻し',
  completeReview: '照査',
  approve: '承認',
  createRevision: '新規改訂',
  obsolete: '廃止',
}

const WORKFLOW_STEPS: readonly { readonly status: RevisionStatus; readonly label: string }[] = [
  { status: 'draft', label: '作成' },
  { status: 'inReview', label: '照査依頼' },
  { status: 'pendingApproval', label: '照査' },
  { status: 'approved', label: '承認' },
  { status: 'returned', label: '差戻し' },
  { status: 'obsolete', label: '廃止' },
]

/** 前進系（承認フローを進める）アクション。UI 上の主ボタン配色に使う。 */
const PRIMARY_ACTIONS: ReadonlySet<RevisionAction> = new Set<RevisionAction>([
  'submitReview',
  'completeReview',
  'approve',
  'createRevision',
])

/** ワークフロー役割（§19.1「実行可能ロール」）の日本語表示。 */
const WORKFLOW_ROLE_LABEL: Record<WorkflowRole, string> = {
  author: '作成者',
  reviewer: '照査者',
  approver: '承認者',
  admin: '管理権限',
}

/** デモ用のロール切替候補と表示ラベル。 */
const DEMO_ROLES: readonly CivilDraftRole[] = ['engineer', 'supervisor', 'viewer']
const ROLE_LABEL: Record<CivilDraftRole, string> = {
  engineer: '工種担当（engineer）',
  supervisor: '監督員（supervisor）',
  viewer: '閲覧者（viewer）',
}

/** 改訂番号を単調増加させる（デモは数値採番。非数値は末尾に "+" を付す暫定）。 */
function nextRevisionNumber(current: string): string {
  return /^\d+$/.test(current) ? String(Number(current) + 1) : `${current}+`
}

/** ページローカルの初期改訂（§19: draft・Rev.1）。 */
function createInitialRevision(): DrawingRevision {
  const now = '2026-07-15T00:00:00.000Z'
  return {
    id: 'rev-demo-1' as RevisionId,
    drawingId: 'dwg-demo' as DrawingId,
    revisionNumber: '1',
    status: 'draft',
    changeSummary: '初版ドラフト',
    contentVersion: 1,
    contentChecksum: 'demo-checksum-0001',
    createdAt: now,
    createdBy: 'engineer',
    updatedAt: now,
    updatedBy: 'engineer',
  }
}

/**
 * アクションの前提（§19.1「前提」列）を満たす TransitionContext を組み立てる。
 * デモでは必須検査・照査結果記録・checksum 一致を満たした状態を前提とし、
 * コメント/理由が必須のアクション（return / resumeEditing / obsolete）はコメント入力欄を使う。
 * コメント未入力なら precondition が失敗し、クリック時に Result error として表示される。
 */
function buildContext(action: RevisionAction, rawComment: string, currentRevisionNumber: string): TransitionContext {
  const comment = rawComment.trim() === '' ? undefined : rawComment.trim()
  switch (action) {
    case 'submitReview':
      return { mandatoryChecksPassed: true, hasStaleQuantities: false, comment }
    case 'completeReview':
      return { reviewResultRecorded: true, comment }
    case 'approve':
      return { checksumMatches: true, comment }
    case 'return':
      return { comment }
    case 'resumeEditing':
      return { returnReason: comment }
    case 'createRevision':
      return {
        currentRevisionNumber,
        newRevisionNumber: nextRevisionNumber(currentRevisionNumber),
        comment,
      }
    case 'obsolete':
      return { obsoleteReason: comment }
  }
}

/**
 * 現状態・実行者から、そのアクションを活性にすべきか判定する。
 *
 * 実 API の availableActions(current) は現状態のみで候補を返すため、実行者の能力は
 * transition(current, action, actor, {}) のドライランで判定する。能力不足
 * （REVISION_ROLE_NOT_PERMITTED）と遷移不可（REVISION_TRANSITION_NOT_ALLOWED）のみを
 * 不活性理由とし、前提未達（コメント必須など）は活性のまま残してクリック時に理由を提示する。
 * これにより capability マッピングを UI に二重定義せず、workflow.ts の遷移表を単一の真実に保つ。
 */
function isActionEnabled(status: RevisionStatus, action: RevisionAction, actor: WorkflowActor): boolean {
  const dryRun = transition(status, action, actor, {})
  if (dryRun.ok) return true
  return (
    dryRun.error.code !== 'REVISION_ROLE_NOT_PERMITTED' &&
    dryRun.error.code !== 'REVISION_TRANSITION_NOT_ALLOWED'
  )
}

const roleSwitchWrapStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' }

function roleButtonStyle(active: boolean): CSSProperties {
  // border は短縮形なので、active 時も短縮形で上書きする（短縮形と borderColor の混在は避ける）。
  return active
    ? { ...ghostButtonStyle, border: '1px solid #E08A2B', color: '#B5701A', background: '#FDEFE0' }
    : ghostButtonStyle
}

function actionButtonStyle(action: RevisionAction, enabled: boolean): CSSProperties {
  if (!enabled) {
    return { ...ghostButtonStyle, opacity: 0.45, cursor: 'not-allowed' }
  }
  return PRIMARY_ACTIONS.has(action) ? primaryButtonStyle : ghostButtonStyle
}

export interface ReviewApprovalPageProps {
  /** デモ用の初期ロール（省略時 engineer）。実運用では Cloudflare Access identity から解決する。 */
  readonly initialRole?: CivilDraftRole
  /** 本番モードでは true を渡すとデモのロール切替・サンプル改訂を表示しない（?demo=1 時は表示）。 */
  readonly enableCloudData?: boolean
  /** 実改訂の ID。設定時はクラウド連携ビューで GET/POST により実データを操作する。 */
  readonly revisionId?: string
  /** テスト用の API クライアント注入（省略時は既定クライアント）。 */
  readonly apiClient?: CivilDraftApiClient
}

export function ReviewApprovalPage({
  initialRole = 'engineer',
  enableCloudData = false,
  revisionId,
  apiClient: apiClientProp,
}: ReviewApprovalPageProps = {}) {
  const [role, setRole] = useState<CivilDraftRole>(initialRole)
  const [revision, setRevision] = useState<DrawingRevision>(createInitialRevision)
  const [history, setHistory] = useState<readonly RevisionHistoryEntry[]>([])
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  // permissionsFor の戻り値（RolePermissions）は WorkflowActor へ構造的に代入可能。
  const actor: WorkflowActor = useMemo(() => permissionsFor(role), [role])
  const actions = availableActions(revision.status)
  const contentMutable = canModifyRevisionContent(revision.status)
  const statusMeta = STATUS_META[revision.status]
  const useCloudOnly = enableCloudData && !isDemoMode()

  if (useCloudOnly) {
    return (
      <CloudReviewApproval
        revisionId={revisionId}
        apiClient={apiClientProp ?? createCivilDraftApiClient()}
        role={initialRole}
      />
    )
  }

  const switchRole = (next: CivilDraftRole) => {
    setRole(next)
    setError(null)
  }

  const runAction = (action: RevisionAction) => {
    const timestamp = new Date().toISOString()
    const result = applyRevisionAction({
      current: revision.status,
      action,
      actor,
      actorId: role,
      timestamp,
      context: buildContext(action, comment, revision.revisionNumber),
    })
    if (!result.ok) {
      // 遷移拒否は握り潰さず理由をそのまま提示する（§19.1 前提未達 / 権限不足）。
      setError(`⚠️ ${result.error.message}`)
      return
    }
    const { nextStatus, history: entry } = result.value
    setRevision((prev) => {
      if (action === 'createRevision') {
        const newNumber = nextRevisionNumber(prev.revisionNumber)
        return {
          ...prev,
          id: `rev-demo-${newNumber}` as RevisionId,
          basedOnRevisionId: prev.id,
          revisionNumber: newNumber,
          status: nextStatus,
          changeSummary: '新規改訂',
          contentVersion: prev.contentVersion + 1,
          updatedAt: timestamp,
          updatedBy: role,
        }
      }
      return { ...prev, status: nextStatus, updatedAt: timestamp, updatedBy: role }
    })
    setHistory((prev) => [...prev, entry])
    setComment('')
    setError(null)
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>照査・承認</div>
          <div style={pageSubtitleStyle}>改訂の照査依頼・照査・承認・差戻し・廃止（詳細設計仕様書 §19）</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={roleSwitchWrapStyle}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ロール（デモ）</span>
          {DEMO_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchRole(r)}
              aria-pressed={role === r}
              style={roleButtonStyle(role === r)}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      </header>

      <main style={pageMainStyle}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.35fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* 改訂カード + アクション */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>ワークフロー</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {WORKFLOW_STEPS.map((step) => {
                  const active = revision.status === step.status
                  const meta = STATUS_META[step.status]
                  return (
                    <span
                      key={step.status}
                      style={{
                        ...statusBadgeStyle(active ? meta.color : 'var(--muted)', active ? meta.bg : 'var(--subtle)'),
                        padding: '5px 10px',
                      }}
                    >
                      {step.label}
                    </span>
                  )
                })}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>対象改訂</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ ...monoStyle, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                    Rev.{revision.revisionNumber}
                  </span>
                  <span style={statusBadgeStyle(statusMeta.color, statusMeta.bg)}>{statusMeta.label}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{revision.changeSummary}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  内容の編集可否:{' '}
                  <span style={{ color: contentMutable ? '#1F8255' : '#C5392F', fontWeight: 600 }}>
                    {contentMutable ? '編集可' : '凍結（承認済み/廃止は内容変更不可・§19.2）'}
                  </span>
                </div>
                <div style={{ ...monoStyle, fontSize: 11, color: 'var(--muted)' }}>
                  checksum: {revision.contentChecksum} ・ v{revision.contentVersion}
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>操作</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    コメント / 理由（差戻し・廃止・編集再開は必須）
                  </span>
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    aria-label="コメント / 理由"
                    placeholder="差戻し理由・照査/承認コメントなど"
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '8px 11px',
                      font: 'inherit',
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      background: 'var(--surface)',
                      outline: 'none',
                    }}
                  />
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {actions.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      この状態（{statusMeta.label}）から実行できる操作はありません
                    </span>
                  ) : (
                    actions.map((action) => {
                      const enabled = isActionEnabled(revision.status, action, actor)
                      return (
                        <button
                          key={action}
                          type="button"
                          disabled={!enabled}
                          onClick={() => runAction(action)}
                          style={actionButtonStyle(action, enabled)}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      )
                    })
                  )}
                </div>

                {error !== null && (
                  <div
                    role="alert"
                    style={{
                      fontSize: 12,
                      color: '#C5392F',
                      background: '#FBEAE9',
                      border: '1px solid #F1C9C5',
                      borderRadius: 8,
                      padding: '9px 12px',
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 履歴テーブル */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>操作履歴（監査ログ・§19.2）</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>日時</th>
                  <th style={thStyle}>操作</th>
                  <th style={thStyle}>実行ロール</th>
                  <th style={thStyle}>コメント</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={4}>
                      履歴はまだありません
                    </td>
                  </tr>
                ) : (
                  history.map((entry, i) => (
                    <tr key={`${entry.timestamp}-${i}`}>
                      <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                        {entry.timestamp.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td style={tdStyle}>{ACTION_LABEL[entry.action]}</td>
                      <td style={tdStyle}>{WORKFLOW_ROLE_LABEL[entry.actorRole]}</td>
                      <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{entry.comment ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

/** サーバー側 status をドメインの RevisionStatus へ安全に変換する（未知値は null）。 */
function asRevisionStatus(status: string): RevisionStatus | null {
  return Object.prototype.hasOwnProperty.call(STATUS_META, status) ? (status as RevisionStatus) : null
}

/** クラウド連携ビューの共通パネル（改訂未選択・読込中・エラー表示）。 */
function CloudMessagePanel({
  title,
  body,
}: {
  readonly title: string
  readonly body: string
}) {
  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>照査・承認</div>
          <div style={pageSubtitleStyle}>改訂の照査依頼・照査・承認・差戻し・廃止（詳細設計仕様書 §19）</div>
        </div>
      </header>
      <main style={pageMainStyle}>
        <div style={panelStyle}>
          <div style={{ padding: 42, textAlign: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>{body}</div>
          </div>
        </div>
      </main>
    </div>
  )
}

/**
 * クラウド連携ビュー（本番モード・?demo=1 以外）。
 * GET /api/v1/revisions/:id で実改訂を読み込み、POST /api/v1/revisions/:id/workflow-actions で
 * 照査依頼・照査・承認・差戻し・廃止・編集再開を実行する（新規改訂の作成は対象外）。
 *
 * 実行ロールは AppShell が Cloudflare Access identity から解決した値を受け取り、ボタン活性判定と
 * 表示にのみ使う。最終的な認可はサーバー側（Access JWT の actorId）で行われる。
 */
function CloudReviewApproval({
  revisionId,
  apiClient,
  role,
}: {
  readonly revisionId?: string
  readonly apiClient: CivilDraftApiClient
  readonly role: CivilDraftRole
}) {
  const [revision, setRevision] = useState<CloudRevision | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly CloudWorkflowAction[]>([])
  const [comment, setComment] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 親が render 毎に新しい既定クライアントを渡しても再取得が走らないよう、インスタンスを固定する。
  const [stableClient] = useState(() => apiClient)
  // 改訂 ID が変わったら render 中に状態をリセットする（effect 内の同期 setState を避ける）。
  const [loadedRevisionId, setLoadedRevisionId] = useState<string | undefined>(revisionId)
  if (loadedRevisionId !== revisionId) {
    setLoadedRevisionId(revisionId)
    setRevision(null)
    setLoadError(null)
    setHistory([])
    setActionError(null)
  }

  useEffect(() => {
    if (revisionId === undefined) return
    let cancelled = false
    void stableClient.getRevision(revisionId).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error.message)
        return
      }
      setRevision(result.value)
    })
    return () => {
      cancelled = true
    }
  }, [revisionId, stableClient])

  if (revisionId === undefined) {
    return (
      <CloudMessagePanel
        title="照査・承認する改訂が選択されていません"
        body="案件の図面を CAD 編集などで開いた状態で、サイドバーから照査・承認へ移動してください。実改訂の状態が読み込まれます。"
      />
    )
  }
  if (loadError !== null) {
    return <CloudMessagePanel title="⚠️ 改訂データを取得できませんでした" body={loadError} />
  }
  if (revision === null) {
    return <CloudMessagePanel title="改訂データを読み込み中…" body="共有データ（Workers API）から改訂メタデータを取得しています。" />
  }
  const status = asRevisionStatus(revision.status)
  if (status === null) {
    return (
      <CloudMessagePanel
        title="⚠️ 未知の改訂状態です"
        body={`サーバーが返した状態（${revision.status}）は本画面の対応範囲外です。`}
      />
    )
  }

  const statusMeta = STATUS_META[status]
  const actor: WorkflowActor = permissionsFor(role)
  const actions = availableActions(status).filter((action) => action !== 'createRevision')

  const runAction = async (action: RevisionAction) => {
    const currentStatus = asRevisionStatus(revision.status)
    if (currentStatus === null) return
    if (action === 'createRevision') {
      setActionError('新規改訂の作成はクラウド連携ビューの対象外です')
      return
    }
    // コメント必須などの前提はドメイン層で事前チェックし、API は最終認可とサーバー前提を担う。
    const dryRun = transition(
      currentStatus,
      action,
      actor,
      buildContext(action, comment, revision.revisionNumber),
    )
    if (!dryRun.ok) {
      setActionError(`⚠️ ${dryRun.error.message}`)
      return
    }
    const trimmed = comment.trim() === '' ? undefined : comment.trim()
    const withComment = trimmed === undefined ? {} : { comment: trimmed }
    const body: CloudWorkflowActionBody = (() => {
      switch (action) {
        case 'submitReview':
          return { action, mandatoryChecksPassed: true, ...withComment }
        case 'completeReview':
          return { action, reviewResultRecorded: true, ...withComment }
        case 'approve':
          return { action, contentChecksum: revision.contentChecksum, ...withComment }
        case 'return':
          return { action, comment: trimmed }
        case 'resumeEditing':
          return { action, returnReason: trimmed }
        case 'obsolete':
          return { action, obsoleteReason: trimmed }
      }
    })()
    setBusy(true)
    setActionError(null)
    try {
      const result = await stableClient.submitWorkflowAction(revision.id, body)
      if (!result.ok) {
        setActionError(`⚠️ ${result.error.message}`)
        return
      }
      setRevision(result.value.revision)
      setHistory((prev) => [...prev, result.value.workflowAction])
      setComment('')
    } catch (error: unknown) {
      setActionError(`⚠️ 通信に失敗しました: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>照査・承認</div>
          <div style={pageSubtitleStyle}>改訂の照査依頼・照査・承認・差戻し・廃止（実改訂データ連携・詳細設計仕様書 §19）</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={roleSwitchWrapStyle}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>実行ロール（Access identity）</span>
          <span style={statusBadgeStyle('#2E5AAC', '#E9F0FB')}>{ROLE_LABEL[role]}</span>
        </div>
      </header>

      <main style={pageMainStyle}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.35fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>ワークフロー</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {WORKFLOW_STEPS.map((step) => {
                  const active = status === step.status
                  const meta = STATUS_META[step.status]
                  return (
                    <span
                      key={step.status}
                      style={{
                        ...statusBadgeStyle(active ? meta.color : 'var(--muted)', active ? meta.bg : 'var(--subtle)'),
                        padding: '5px 10px',
                      }}
                    >
                      {step.label}
                    </span>
                  )
                })}
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>対象改訂</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ ...monoStyle, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                    Rev.{revision.revisionNumber}
                  </span>
                  <span style={statusBadgeStyle(statusMeta.color, statusMeta.bg)}>{statusMeta.label}</span>
                </div>
                <div style={{ ...monoStyle, fontSize: 11, color: 'var(--muted)' }}>
                  checksum: {revision.contentChecksum} ・ v{revision.contentVersion}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  サーバー側でも Access identity の実行ロールで認可されます（表示上の活性判定は補助）。
                </div>
              </div>
            </div>

            <div style={panelStyle}>
              <div style={panelHeaderStyle}>操作</div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    コメント / 理由（差戻し・廃止・編集再開は必須）
                  </span>
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    aria-label="コメント / 理由"
                    placeholder="差戻し理由・照査/承認コメントなど"
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      padding: '8px 11px',
                      font: 'inherit',
                      fontSize: 12.5,
                      color: 'var(--ink)',
                      background: 'var(--surface)',
                      outline: 'none',
                    }}
                  />
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {actions.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      この状態（{statusMeta.label}）から実行できる操作はありません
                    </span>
                  ) : (
                    actions.map((action) => {
                      const enabled = isActionEnabled(status, action, actor) && !busy
                      return (
                        <button
                          key={action}
                          type="button"
                          disabled={!enabled}
                          onClick={() => void runAction(action)}
                          style={actionButtonStyle(action, enabled)}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      )
                    })
                  )}
                </div>

                {actionError !== null && (
                  <div
                    role="alert"
                    style={{
                      fontSize: 12,
                      color: '#C5392F',
                      background: '#FBEAE9',
                      border: '1px solid #F1C9C5',
                      borderRadius: 8,
                      padding: '9px 12px',
                    }}
                  >
                    {actionError}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={panelHeaderStyle}>操作履歴（サーバー記録）</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={thStyle}>日時</th>
                  <th style={thStyle}>操作</th>
                  <th style={thStyle}>実行者</th>
                  <th style={thStyle}>コメント</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td style={{ ...tdStyle, color: 'var(--muted)' }} colSpan={4}>
                      履歴はまだありません
                    </td>
                  </tr>
                ) : (
                  history.map((entry, i) => (
                    <tr key={`${entry.id}-${i}`}>
                      <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                        {entry.occurredAt.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td style={tdStyle}>{ACTION_LABEL[entry.action as RevisionAction] ?? entry.action}</td>
                      <td style={tdStyle}>{entry.actorId}</td>
                      <td style={{ ...tdStyle, color: 'var(--ink2)' }}>{entry.comment ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
