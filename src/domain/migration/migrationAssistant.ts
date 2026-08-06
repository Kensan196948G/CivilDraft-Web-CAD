/**
 * 移行アシスタント（Issue #60）。
 * 外部 CAD データの取込時に「変換可否・失われる要素・代替表現・修正候補」を
 * 提示するための分類・助言ロジック。
 */
import type { ValidationIssue } from '@/shared/types'

export type MigrationFileFormat = 'dxf' | 'pdf' | 'csv' | 'unsupported'

export interface MigrationFileClassification {
  readonly format: MigrationFileFormat
  readonly supported: boolean
  /** 取込可能な場合はこのメッセージで続行できる。 */
  readonly message: string
}

const UNSUPPORTED_FORMATS: Readonly<Record<string, string>> = {
  '.dwg': 'DWG は Autodesk 非公開形式のため直接取込できません。AutoCAD 等で DXF へ変換してから取込してください。',
  '.jww': 'JWW は Jw_cad 独自形式のため直接取込できません。DXF 書き出し（Jw_cad の「DXFで保存」）後に取込してください。',
  '.jwf': 'JWF は Jw_cad 設定形式のため取込対象外です。作図データは JWW/DXF をご利用ください。',
  '.sxf': 'SXF（P21 等）は現状未対応です。DXF への変換元としてご利用ください（対応はバックログ）。',
  '.sima': 'SIMA は現状未対応です（対応はバックログ）。DXF または測点 CSV をご利用ください。',
  '.landxml': 'LandXML は測点データとして取込可能な形へ対応を検討中です（バックログ）。',
}

export function classifyMigrationFile(fileName: string): MigrationFileClassification {
  const lower = fileName.toLowerCase()
  const extension = lower.slice(lower.lastIndexOf('.'))
  if (extension === '.dxf') {
    return { format: 'dxf', supported: true, message: 'DXF は取込可能です（対応要素外は警告として報告されます）。' }
  }
  if (extension === '.pdf') {
    return { format: 'pdf', supported: false, message: 'PDF は閲覧・印刷用のため編集データとして取込めません。元データを DXF/CSV でご用意ください。' }
  }
  if (extension === '.csv') {
    return { format: 'csv', supported: false, message: '測点 CSV は「測点・座標一覧」画面から取込できます。CAD 図面としての取込はできません。' }
  }
  const unsupportedMessage = UNSUPPORTED_FORMATS[extension]
  if (unsupportedMessage !== undefined) {
    return { format: 'unsupported', supported: false, message: unsupportedMessage }
  }
  return {
    format: 'unsupported',
    supported: false,
    message: `拡張子「${extension || 'なし'}」の形式は判別できません。DXF ファイルをご利用ください。`,
  }
}

/** DXF 取込イシューごとの対処提案。未知コードは汎用メッセージを返す。 */
export function migrationAdvice(issue: ValidationIssue): string {
  switch (issue.code) {
    case 'dxf-compat-mode':
      return '非標準 DXF は互換モードで読み込みました。図形の欠落がないか図面比較で確認してください。'
    case 'dxf-unsupported-entity':
      return '未対応エンティティはスキップされます。元 CAD でプリミティブ（線分・円弧・ポリライン等）へ分解してから再出力してください。'
    case 'dxf-ellipse-arc-approximated':
      return '楕円弧はポリライン近似で取り込みました。寸法が重要な場合は元データを確認してください。'
    case 'dxf-ellipse-insufficient':
      return '楕円データが不完全なため近似で取り込みました。元データの楕円定義を確認してください。'
    case 'dxf-spline-insufficient':
      return 'スプラインは点列が不足し近似で取り込みました。必要に応じて元データで制御点を増やしてください。'
    case 'dxf-hatch-imported':
      return 'ハッチングは独自パーサーで取り込みました。パターンが崩れる場合は元データで再確認してください。'
    case 'dxf-xdata-stripped':
      return 'AutoCAD 拡張属性（XDATA）は描画対象外として除外しました。属性情報が必要な場合は CSV 等で別途受け渡してください。'
    case 'dxf-fallback-extracted':
      return '標準パーサーが失敗したため基本図形のみ取り込みました。複雑な要素は元 CAD での修正を推奨します。'
    case 'dxf-unsupported-unit':
      return '単位の解釈が不明なため内部 mm として取り込みました。縮尺が異なる場合は図面設定で確認してください。'
    case 'dxf-empty':
      return 'ファイルが空のため取り込めません。元データを確認してください。'
    default:
      return `「${issue.message}」— 元データの修正または DXF 再出力で解消できる場合があります。`
  }
}

