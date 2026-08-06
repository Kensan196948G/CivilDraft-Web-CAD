/**
 * CSV セル直列化（数式インジェクション対策）。
 * Excel/Google Sheets で先頭が = + - @ またはタブ/改行のセルは数式や
 * 外部リンクとして解釈されるため、先頭にシングルクォートを付与して無害化する。
 */
export function escapeCsvCell(value: string): string {
  const sanitized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${sanitized.replace(/"/g, '""')}"`
}

