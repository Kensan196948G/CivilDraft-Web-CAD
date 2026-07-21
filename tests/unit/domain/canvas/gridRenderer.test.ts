import { describe, expect, it } from 'vitest'
import {
  computeGridLines,
  resolveAdaptiveGridInterval,
  type GridConfig,
  type GridLine,
} from '@/domain/canvas/gridRenderer'

function cfg(over: Partial<GridConfig>): GridConfig {
  return { width: 100, height: 100, gridSize: 10, zoom: 1, panX: 0, panY: 0, ...over }
}

const verticals = (lines: readonly GridLine[]) => lines.filter((l) => l.orientation === 'vertical')
const horizontals = (lines: readonly GridLine[]) => lines.filter((l) => l.orientation === 'horizontal')
const xOf = (l: GridLine) => l.points[0]

describe('computeGridLines', () => {
  it('minor grid をワールド整列位置に生成する（gridSize*zoom>=4）', () => {
    const lines = computeGridLines(cfg({}))
    // 縦横それぞれ 0,10,...,100 の11本ずつ。
    expect(lines.length).toBe(22)
    expect(lines.every((l) => l.kind === 'minor')).toBe(true)
    expect(verticals(lines).map(xOf)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(verticals(lines)[0]?.points).toEqual([0, 0, 0, 100])
  })

  it('LOD: gridSize*zoom<4 では minor を描かない', () => {
    // gridSize=1, zoom=1 → 1<4 → 何も描かない（majorInterval未指定）。
    expect(computeGridLines(cfg({ gridSize: 1 }))).toEqual([])
  })

  it('major grid を閾値越え時に生成し、minor の後ろに格納する', () => {
    const lines = computeGridLines(cfg({ width: 200, height: 200, majorInterval: 50 }))
    const minor = lines.filter((l) => l.kind === 'minor')
    const major = lines.filter((l) => l.kind === 'major')
    // minor: 0..200 step10 の21本×2、major: 0..200 step50 の5本×2。
    expect(minor.length).toBe(42)
    expect(major.length).toBe(10)
    // 順序: 全minorが全majorより前に並ぶ（重なり位置でmajorが上書き描画される描画順）。
    expect(lines.slice(0, 42).every((l) => l.kind === 'minor')).toBe(true)
    expect(lines.slice(42).every((l) => l.kind === 'major')).toBe(true)
  })

  it('majorInterval*zoom<8 では major を描かない', () => {
    // majorInterval=5, zoom=1 → 5<8 → majorなし。minorは残る。
    const lines = computeGridLines(cfg({ majorInterval: 5 }))
    expect(lines.every((l) => l.kind === 'minor')).toBe(true)
  })

  it('minCanvasX/minCanvasY はルーラー領域内の線を省き、線の開始点を境界に寄せる', () => {
    const lines = computeGridLines(cfg({ minCanvasX: 25, minCanvasY: 25 }))
    // 縦線: x<25 の 0/10/20 は省かれ、30..100 の8本。始点yは minY=25。
    const v = verticals(lines)
    expect(v.map(xOf)).toEqual([30, 40, 50, 60, 70, 80, 90, 100])
    expect(v.every((l) => l.points[0] >= 25)).toBe(true)
    expect(v[0]?.points).toEqual([30, 25, 30, 100])
    // 横線: 始点xは minX=25。
    expect(horizontals(lines)[0]?.points).toEqual([25, 30, 100, 30])
  })

  it('pan オフセットで world→screen 位置が対応する', () => {
    // panX=25 → screen sx = world*1 + 25。world 0 は sx=25 に写る。
    const v = verticals(computeGridLines(cfg({ panX: 25 })))
    expect(v.map(xOf)).toEqual([5, 15, 25, 35, 45, 55, 65, 75, 85, 95])
    expect(v.map(xOf)).toContain(25)
  })
})

describe('resolveAdaptiveGridInterval', () => {
  it('初期表示（基準1000mm・zoom=1）で画面間隔100pxの間隔を返す（グリッド既定表示の根拠）', () => {
    // 1000mm*1=1000px は広すぎ → 100mm（100px）へ細分化。20〜200pxの範囲内。
    expect(resolveAdaptiveGridInterval(1000, 1)).toBe(100)
  })

  it('縮小時は10倍単位で粗くする（zoom=0.01 → 10000mm=100px間隔）', () => {
    expect(resolveAdaptiveGridInterval(1000, 0.01)).toBe(10000)
  })

  it('拡大時は10倍単位で細かくする（zoom=50 → 1mm=50px間隔）', () => {
    expect(resolveAdaptiveGridInterval(1000, 50)).toBe(1)
  })

  it('どの zoom でも画面間隔が [minSpacingPx, minSpacingPx*10) に収まる', () => {
    // clampZoom の範囲（0.001〜50）を対数スイープで検査する。
    for (let e = -3; e <= Math.log10(50); e += 0.25) {
      const zoom = 10 ** e
      const interval = resolveAdaptiveGridInterval(1000, zoom)
      const spacingPx = interval * zoom
      expect(spacingPx, `zoom=${zoom}`).toBeGreaterThanOrEqual(20)
      expect(spacingPx, `zoom=${zoom}`).toBeLessThan(200)
    }
  })

  it('選ばれた間隔は computeGridLines の LOD 閾値（minor≥4px・major≥8px）を常に満たす', () => {
    for (const zoom of [0.001, 0.01, 0.1, 1, 10, 50]) {
      const interval = resolveAdaptiveGridInterval(1000, zoom)
      const lines = computeGridLines(cfg({ width: 400, height: 400, gridSize: interval, zoom, majorInterval: interval * 5 }))
      expect(lines.some((l) => l.kind === 'minor'), `zoom=${zoom}`).toBe(true)
      expect(lines.some((l) => l.kind === 'major'), `zoom=${zoom}`).toBe(true)
    }
  })

  it('10進スケーリングにより目盛り値がきりの良い値を保つ', () => {
    expect(resolveAdaptiveGridInterval(1000, 0.05)).toBe(1000) // 50px間隔
    expect(resolveAdaptiveGridInterval(1000, 0.3)).toBe(100) // 30px間隔
  })

  it('不正入力（非有限・0以下）は基準値をそのまま返す', () => {
    expect(resolveAdaptiveGridInterval(0, 1)).toBe(0)
    expect(resolveAdaptiveGridInterval(-5, 1)).toBe(-5)
    expect(resolveAdaptiveGridInterval(Number.NaN, 1)).toBeNaN()
    expect(resolveAdaptiveGridInterval(1000, 0)).toBe(1000)
    expect(resolveAdaptiveGridInterval(1000, Number.POSITIVE_INFINITY)).toBe(1000)
  })
})
