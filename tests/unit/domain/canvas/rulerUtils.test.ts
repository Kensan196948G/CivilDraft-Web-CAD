import { describe, expect, it } from 'vitest'
import {
  calcHorizontalTicks,
  calcTickInterval,
  calcVerticalTicks,
  formatTickValue,
  type RulerTick,
} from '@/domain/canvas/rulerUtils'

/**
 * 符号付きゼロ（-0）を+0へ正規化する。継承元アルゴリズムはpan=0の原点目盛りで
 * value=-0を生む（worldTop=-0/zoom→Math.floor(-0)*interval=-0）。vitestのtoEqualは
 * Object.is準拠で-0と+0を区別するため、配列一致検証時に正規化する。
 * （-0自体のquirkは末尾の専用テストで明示的に検証する。）
 */
function normalizeZero(n: number): number {
  return n === 0 ? 0 : n
}

function plain(ticks: readonly RulerTick[]): { pos: number; value: number }[] {
  return ticks.map((t) => ({ pos: normalizeZero(t.pos), value: normalizeZero(t.value) }))
}

describe('calcTickInterval', () => {
  it('ズームレベルに応じて1-2-5-10系列の間隔を選ぶ（既定minPxSpacing=50）', () => {
    // rawInterval=50/zoom → 正規化値で系列を選択。
    expect(calcTickInterval(0.5)).toBe(100) // raw=100, normalized=1 → mag
    expect(calcTickInterval(1)).toBe(50) // raw=50, normalized=5 → 5*mag
    expect(calcTickInterval(2)).toBe(20) // raw=25, normalized=2.5 → 2*mag
    expect(calcTickInterval(10)).toBe(5) // raw=5, normalized=5 → 5*mag
    expect(calcTickInterval(100)).toBe(0.5) // raw=0.5, normalized=5 → 5*0.1
  })

  it('正規化値の境界（1.5/3.5/7.5）で系列が切り替わる', () => {
    // minPxSpacing=15, zoom=1 → raw=15, mag=10, normalized=1.5（<1.5ではない）→ 2*mag
    expect(calcTickInterval(1, 15)).toBe(20)
    // minPxSpacing=80, zoom=1 → raw=80, normalized=8（>=7.5）→ 10*mag
    expect(calcTickInterval(1, 80)).toBe(100)
    // minPxSpacing=35, zoom=1 → raw=35, normalized=3.5（<3.5ではない）→ 5*mag
    expect(calcTickInterval(1, 35)).toBe(50)
  })

  it('不正なzoom（0・負・NaN）はzoom=1として扱う', () => {
    expect(calcTickInterval(0)).toBe(50)
    expect(calcTickInterval(-5)).toBe(50)
    expect(calcTickInterval(Number.NaN)).toBe(50)
  })

  it('不正なminPxSpacingは既定50にフォールバックする', () => {
    expect(calcTickInterval(1, 0)).toBe(50)
    expect(calcTickInterval(1, -10)).toBe(50)
  })
})

describe('calcHorizontalTicks', () => {
  it('pan=0で画面幅内の目盛りを間隔ごとに生成する', () => {
    // interval=50、worldLeft=0、worldRight=200 → 0,50,100,150,200。
    expect(plain(calcHorizontalTicks(0, 1, 200))).toEqual([
      { pos: 0, value: 0 },
      { pos: 50, value: 50 },
      { pos: 100, value: 100 },
      { pos: 150, value: 150 },
      { pos: 200, value: 200 },
    ])
  })

  it('panオフセットに応じてワールド値と画面位置が対応する', () => {
    // panX=25 → screen=world+25。画面外(pos<0 / pos>width)は除外。
    expect(plain(calcHorizontalTicks(25, 1, 200))).toEqual([
      { pos: 25, value: 0 },
      { pos: 75, value: 50 },
      { pos: 125, value: 100 },
      { pos: 175, value: 150 },
    ])
  })
})

describe('calcVerticalTicks', () => {
  it('pan=0で画面高さ内の目盛りを生成する（Y下方向に値が増加）', () => {
    // interval=50、worldTop=0、worldBottom=100 → 0,50,100。
    expect(plain(calcVerticalTicks(0, 1, 100))).toEqual([
      { pos: 0, value: 0 },
      { pos: 50, value: 50 },
      { pos: 100, value: 100 },
    ])
  })

  it('ズーム2倍では間隔が縮み目盛りが増える', () => {
    // zoom=2 → interval=20、worldTop=0、worldBottom=50 → world 0,20,40 が画面内。
    expect(plain(calcVerticalTicks(0, 2, 100))).toEqual([
      { pos: 0, value: 0 },
      { pos: 40, value: 20 },
      { pos: 80, value: 40 },
    ])
  })
})

describe('formatTickValue', () => {
  it('1000未満は整数へ丸める', () => {
    expect(formatTickValue(500)).toBe('500')
    expect(formatTickValue(0.4)).toBe('0')
    expect(formatTickValue(12.7)).toBe('13')
    expect(formatTickValue(999)).toBe('999')
  })

  it('1000以上はk表記（小数1桁）', () => {
    expect(formatTickValue(1000)).toBe('1.0k')
    expect(formatTickValue(1500)).toBe('1.5k')
    expect(formatTickValue(-1500)).toBe('-1.5k')
  })

  it('100万以上はM表記（小数1桁）', () => {
    expect(formatTickValue(1_000_000)).toBe('1.0M')
    expect(formatTickValue(2_500_000)).toBe('2.5M')
  })
})

describe('継承元由来の符号付きゼロquirk', () => {
  it('pan=0の原点目盛りはvalue=-0を生むが、表示は"0"で実害なし', () => {
    const first = calcVerticalTicks(0, 1, 100)[0]
    expect(first).toBeDefined()
    // 継承元アルゴリズムの-0伝播をそのまま移植していることを記録する。
    expect(Object.is(first?.value, -0)).toBe(true)
    expect(formatTickValue(first?.value ?? 0)).toBe('0')
  })
})
