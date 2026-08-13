import { describe, expect, it } from 'vitest'
import {
  DEMO_PROJECTS,
  demoStaleReviewCount,
  findDemoProject,
  recentDrawingsFromProjects,
  relativeDemoWhen,
} from '@/app/demoProjects'

describe('demoProjects（MVP用詳細ダミーデータ）', () => {
  it('詳細ダミー案件が10件あり、ID・案件番号が重複しない', () => {
    expect(DEMO_PROJECTS).toHaveLength(10)
    const ids = DEMO_PROJECTS.map((project) => project.id)
    const projectNumbers = DEMO_PROJECTS.map((project) => project.projectNumber)
    expect(new Set(ids).size).toBe(10)
    expect(new Set(projectNumbers).size).toBe(10)
  })

  it('5つのステータスをすべて含み、内訳がKPI表示と一致する', () => {
    const count = (status: string) => DEMO_PROJECTS.filter((p) => p.status === status).length
    expect(count('進行中')).toBe(3)
    expect(count('照査待ち')).toBe(2)
    expect(count('承認待ち')).toBe(2)
    expect(count('承認済み')).toBe(2)
    expect(count('差戻し')).toBe(1)
  })

  it('図面の種別・改訂・状態・更新者が有効で、更新者は必ずメンバーに含まれる', () => {
    const drawingTypes = new Set(['施工ヤード図', '仮設計画図', '土工・断面図', '数量根拠図'])
    const drawingStatuses = new Set(['作成中', '照査待ち', '承認済み', '差戻し'])
    for (const project of DEMO_PROJECTS) {
      const memberNames = new Set(project.members.map((member) => member.name))
      for (const item of project.drawings) {
        expect(drawingTypes.has(item.type)).toBe(true)
        expect(drawingStatuses.has(item.status)).toBe(true)
        expect(item.rev).toMatch(/^Rev\.\d+$/)
        expect(memberNames.has(item.by)).toBe(true)
      }
    }
  })

  it('メールは予約ドメインのみ、住所・電話は架空値の注記付き', () => {
    for (const project of DEMO_PROJECTS) {
      for (const member of project.members) {
        expect(member.email).toMatch(/^[a-z0-9.]+@example\.jp$/)
      }
      expect(project.address).toContain('架空・デモ用')
      expect(project.tel).toContain('00-0000-0000（デモ用）')
    }
  })

  it('空図面・差戻し・照査滞留・非公開金額の境界/異常系を確認できる', () => {
    expect(DEMO_PROJECTS.some((project) => project.drawings.length === 0)).toBe(true)
    expect(DEMO_PROJECTS.some((project) => project.status === '差戻し')).toBe(true)
    expect(DEMO_PROJECTS.some((project) => project.contractAmount.startsWith('非公開'))).toBe(true)
    expect(demoStaleReviewCount(DEMO_PROJECTS)).toBe(2)
  })

  it('最近開いた図面は更新日時の降順で5件返り、相対時刻ラベルがつく', () => {
    const recent = recentDrawingsFromProjects(DEMO_PROJECTS, 5)
    expect(recent).toHaveLength(5)
    const times = recent.map((item) => item.when)
    expect(times).toEqual(['10分前', '2時間前', '昨日', '2日前', '3日前'])
    for (const item of recent) {
      expect(DEMO_PROJECTS.some((project) => project.name === item.project)).toBe(true)
      expect(item.icon).not.toBe('')
    }
  })

  it('findDemoProject はID一致を返し、不明IDは undefined を返す', () => {
    expect(findDemoProject('demo-p01')?.name).toBe('みらい台地区 市道拡幅工事')
    expect(findDemoProject('unknown')).toBeUndefined()
    expect(findDemoProject(undefined)).toBeUndefined()
  })

  it('relativeDemoWhen はデモ固定時刻からの相対ラベルを返す', () => {
    expect(relativeDemoWhen('2026-07-16T11:50:00+09:00')).toBe('10分前')
    expect(relativeDemoWhen('2026-07-16T10:00:00+09:00')).toBe('2時間前')
    expect(relativeDemoWhen('2026-07-15T10:00:00+09:00')).toBe('昨日')
    expect(relativeDemoWhen('2026-07-14T09:00:00+09:00')).toBe('2日前')
  })
})
