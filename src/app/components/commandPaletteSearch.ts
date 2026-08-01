/**
 * コマンドパレットのファジー検索（Issue #47）。
 *
 * ラベル/キーワードが query の部分列（順序を保ったまま）として一致するかを判定し、
 * スコア（小さいほど良い）を返す。コンポーネントと分離することで単体テスト・再利用が容易。
 */

/** ラベル/キーワードが query の部分列（順序維持）かどうかとスコアを返す。 */
export function matchCommand(query: string, label: string, keywords: readonly string[] = []): number | null {
  const q = query.trim().toLocaleLowerCase('ja-JP')
  if (q.length === 0) return 0
  const texts = [label, ...keywords]
  let best = -1
  for (const text of texts) {
    const score = subsequenceScore(text.toLocaleLowerCase('ja-JP'), q)
    if (score >= 0 && (best < 0 || score < best)) best = score
  }
  return best >= 0 ? best : null
}

/**
 * 部分列一致のスコア（小さいほど良い）。連続一致は高評価。
 * 完全一致で 0、不一致で -1。負値を返さない（呼び出し側で score >= 0 を一致と判定できる）。
 */
function subsequenceScore(text: string, query: string): number {
  let ti = 0
  let qi = 0
  let gaps = 0
  let consecutive = 0
  let bestRun = 0
  while (qi < query.length && ti < text.length) {
    if (text[ti] === query[qi]) {
      qi += 1
      consecutive += 1
      if (consecutive > bestRun) bestRun = consecutive
    } else {
      if (qi > 0) gaps += 1
      consecutive = 0
    }
    ti += 1
  }
  if (qi < query.length) return -1
  return Math.max(0, gaps * 2 + text.length - bestRun)
}
