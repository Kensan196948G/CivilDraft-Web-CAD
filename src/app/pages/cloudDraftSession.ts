/**
 * 共有保存セッション（案件・図面・改訂の識別情報）。
 *
 * CadEditorPage のモノリス化を避けるため、セッション型と既定値は
 * ページコンポーネントから分離して定義する。
 */

export interface CloudDraftSession {
  readonly projectId?: string
  readonly drawingId?: string
  readonly revisionId?: string
  readonly projectNumber: string
  readonly projectName: string
  readonly clientName?: string
  readonly drawingNumber: string
  readonly drawingName: string
  readonly drawingType?: string
  readonly revisionNumber: string
  readonly changeSummary?: string
}

export const DEFAULT_CLOUD_DRAFT_SESSION: CloudDraftSession = {
  projectNumber: 'LOCAL',
  projectName: 'ローカル編集（案件未選択）',
  drawingNumber: 'LOCAL',
  drawingName: '無題の図面',
  drawingType: 'general',
  revisionNumber: 'LOCAL',
  changeSummary: 'ローカル編集の保存',
}

/** 新規図面（空白・案件未選択）のローカル編集セッションを作成する。 */
export function createNewDraftSession(): CloudDraftSession {
  return {
    ...DEFAULT_CLOUD_DRAFT_SESSION,
    drawingNumber: `NEW-${Date.now()}`,
    drawingName: '新規図面',
    drawingType: 'blank',
    revisionNumber: 'Rev.1',
    changeSummary: '新規図面の作成',
  }
}
