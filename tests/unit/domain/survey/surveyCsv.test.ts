import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SURVEY_CSV_MAPPING,
  exportSurveyCsv,
  parseSurveyCsv,
  type SurveyCsvParseResult,
  type SurveyPointIdContext,
} from '@/domain/survey/surveyCsv'
import type { Result, SurveyPoint, SurveyPointId, ValidationIssue } from '@/shared/types'

/** テスト用の決定的ID発番（連番）。 */
function counterIdContext(): SurveyPointIdContext {
  let n = 0
  return { newId: () => `sp-${++n}` as SurveyPointId }
}

function ok(result: Result<SurveyCsvParseResult, ValidationIssue>): SurveyCsvParseResult {
  if (!result.ok) throw new Error(`期待した成功が失敗した: ${result.error.message}`)
  return result.value
}

const HEADER = 'pointNumber,x,y,elevation,note'

describe('parseSurveyCsv / 正常系', () => {
  it('複数行を取り込み測点へ正規化する', () => {
    const csv = `${HEADER}\nP1,100.5,200.25,12.3,起点\nP2,150,250,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toEqual({
      id: 'sp-1',
      pointNumber: 'P1',
      x: 100.5,
      y: 200.25,
      elevation: 12.3,
      note: '起点',
    })
    // 空セルの elevation / note はフィールド自体を持たない
    expect(result.points[1]).toEqual({ id: 'sp-2', pointNumber: 'P2', x: 150, y: 250 })
    expect(result.issues).toHaveLength(0)
  })

  it('全角の数値・空白を半角へ正規化する', () => {
    // ï¼U+3000ï¼ は全角スペース。lint(no-irregular-whitespace)回避のためエスケープ表記で埋め込む。
    const csv = `${HEADER}\nＰ３,\u3000１２３．５\u3000,-０．２５,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points[0]?.pointNumber).toBe('P3')
    expect(result.points[0]?.x).toBeCloseTo(123.5, 9)
    expect(result.points[0]?.y).toBeCloseTo(-0.25, 9)
  })

  it('引用符付きフィールド（カンマ・改行）を解析する', () => {
    const csv = `${HEADER}\nP4,1,2,,"備考, 改行\nあり"`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points[0]?.note).toBe('備考, 改行\nあり')
  })

  it('桁区切りカンマを含む数値（引用符付き）を解釈する', () => {
    const csv = `${HEADER}\nP5,"1,234.5",0,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points[0]?.x).toBeCloseTo(1234.5, 9)
  })
})

describe('parseSurveyCsv / 構造的失敗（Result.error）', () => {
  it('空入力は survey_csv_empty で拒否する', () => {
    const result = parseSurveyCsv('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('survey_csv_empty')
  })

  it('必須列(x)の欠落は survey_csv_missing_column で拒否する', () => {
    const result = parseSurveyCsv('pointNumber,y\nP1,10')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('survey_csv_missing_column')
  })
})

describe('parseSurveyCsv / 行単位の検証（graceful）', () => {
  it('欠損（x空）の行は除外し、他の行は取り込む', () => {
    const csv = `${HEADER}\nP1,,200,,\nP2,10,20,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points.map((p) => p.pointNumber)).toEqual(['P2'])
    expect(result.issues.some((i) => i.severity === 'error' && i.field === 'x')).toBe(true)
    expect(result.rows[0]?.normalized).toBeUndefined()
    expect(result.rows[0]?.rowNumber).toBe(2)
  })

  it('非数値の座標はエラーとして行を除外する', () => {
    const csv = `${HEADER}\nP1,abc,10,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(0)
    expect(result.issues.some((i) => i.message.includes('数値ではありません'))).toBe(true)
  })

  it('測点番号の欠損はエラーとして行を除外する', () => {
    const csv = `${HEADER}\n,10,20,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(0)
    expect(result.issues.some((i) => i.field === 'pointNumber')).toBe(true)
  })

  it('測点番号の重複は警告し、両行とも取り込む', () => {
    const csv = `${HEADER}\nP1,10,20,,\nP1,30,40,,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(2)
    const dup = result.issues.find((i) => i.message.includes('重複'))
    expect(dup?.severity).toBe('warning')
  })

  it('非数値の標高は警告し、標高なしで取り込む', () => {
    const csv = `${HEADER}\nP1,10,20,xx,`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(1)
    expect(result.points[0]?.elevation).toBeUndefined()
    expect(result.issues.some((i) => i.severity === 'warning' && i.field === 'elevation')).toBe(true)
  })

  it('CSVインジェクション文字始まりの測点番号は警告するが取り込む', () => {
    const csv = `${HEADER}\n=1+2,10,20,,@SUM(A1)`
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points).toHaveLength(1)
    expect(result.points[0]?.pointNumber).toBe('=1+2')
    const injections = result.issues.filter((i) => i.message.includes('インジェクション'))
    expect(injections.length).toBeGreaterThanOrEqual(2) // pointNumber と note
  })

  it('ヘッダーのみ（データ行なし）は空の測点で成功する', () => {
    const result = ok(parseSurveyCsv(HEADER))
    expect(result.points).toHaveLength(0)
    expect(result.issues).toHaveLength(0)
  })
})

describe('exportSurveyCsv / 出力とインジェクション無害化（§24.2）', () => {
  const point = (over: Partial<SurveyPoint>): SurveyPoint => ({
    id: 'sp-x' as SurveyPointId,
    pointNumber: 'P1',
    x: 10,
    y: 20,
    ...over,
  })

  it('先頭が数式トリガーのテキスト列にアポストロフィを付与する', () => {
    const csv = exportSurveyCsv([point({ pointNumber: '=cmd', note: '+1' })])
    const lines = csv.split('\r\n')
    expect(lines[1]?.startsWith("'=cmd,")).toBe(true)
    expect(lines[1]?.endsWith("'+1")).toBe(true)
  })

  it('負の座標値はエスケープしない（正当な数値）', () => {
    const csv = exportSurveyCsv([point({ x: -5, y: -10 })])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('-5,-10')
    expect(lines[1]).not.toContain("'-5")
  })

  it('カンマ・引用符を含む値は二重引用符で囲む', () => {
    const csv = exportSurveyCsv([point({ note: 'a,"b"' })])
    const lines = csv.split('\r\n')
    expect(lines[1]).toContain('"a,""b"""')
  })

  it('export→parse で測点が往復する', () => {
    const points = [point({ pointNumber: 'P1', x: 100.5, y: 200.25, elevation: 3.5, note: 'ok' })]
    const csv = exportSurveyCsv(points, DEFAULT_SURVEY_CSV_MAPPING)
    const result = ok(parseSurveyCsv(csv, { idContext: counterIdContext() }))
    expect(result.points[0]).toMatchObject({
      pointNumber: 'P1',
      x: 100.5,
      y: 200.25,
      elevation: 3.5,
      note: 'ok',
    })
  })
})
