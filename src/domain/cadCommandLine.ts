/**
 * CADコマンドラインの入力解析（Issue #47）。
 * 純粋なパーサーとしてUIから分離し、コマンドの正規化・検証を domain で行う。
 */

export type CadCommand =
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'grid'; readonly visible: boolean }
  | { readonly kind: 'snap'; readonly enabled: boolean }
  | { readonly kind: 'selectAll' }
  | { readonly kind: 'clearSelection' }
  | { readonly kind: 'layer'; readonly name: string }
  | { readonly kind: 'help' }

export type CadCommandResult =
  | { readonly ok: true; readonly command: CadCommand }
  | { readonly ok: false; readonly message: string }

/** 全角・半角空白を正規化し、先頭/末尾の空白を除去する。 */
function normalize(input: string): string {
  return input.replace(/[\s\u3000]+/g, ' ').trim()
}

export function parseCadCommand(input: string): CadCommandResult {
  const text = normalize(input)
  if (text === '') return { ok: false, message: 'コマンドを入力してください' }

  const lower = text.toLowerCase()
  if (lower === 'undo' || lower === 'u') return { ok: true, command: { kind: 'undo' } }
  if (lower === 'redo') return { ok: true, command: { kind: 'redo' } }
  if (lower === 'grid on') return { ok: true, command: { kind: 'grid', visible: true } }
  if (lower === 'grid off') return { ok: true, command: { kind: 'grid', visible: false } }
  if (lower === 'snap on') return { ok: true, command: { kind: 'snap', enabled: true } }
  if (lower === 'snap off') return { ok: true, command: { kind: 'snap', enabled: false } }
  if (lower === 'selectall') return { ok: true, command: { kind: 'selectAll' } }
  if (lower === 'clearsel' || lower === 'clear') return { ok: true, command: { kind: 'clearSelection' } }
  if (lower === 'help' || lower === '?') return { ok: true, command: { kind: 'help' } }

  if (lower.startsWith('layer ')) {
    const name = text.slice('layer '.length).trim()
    if (name === '') return { ok: false, message: 'レイヤー名を指定してください（例: layer 施工ヤード）' }
    return { ok: true, command: { kind: 'layer', name } }
  }

  return { ok: false, message: `不明なコマンド: ${text}（help で一覧を表示）` }
}

export const CAD_COMMAND_HELP: readonly { readonly command: string; readonly description: string }[] = [
  { command: 'undo / u', description: '1操作戻す' },
  { command: 'redo', description: '1操作やり直す' },
  { command: 'grid on / off', description: 'グリッド表示切替' },
  { command: 'snap on / off', description: 'スナップ有効切替' },
  { command: 'selectall', description: '全図形を選択' },
  { command: 'clearsel / clear', description: '選択解除' },
  { command: 'layer <名前>', description: 'レイヤーを選択（なければ作成）' },
  { command: 'help / ?', description: 'この一覧を表示' },
]

