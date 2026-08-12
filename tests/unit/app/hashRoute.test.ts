import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute } from '@/app/hashRoute'

describe('hashRoute', () => {
  it('parseRoute は基本ビューを解釈する', () => {
    expect(parseRoute('#/audit')).toEqual({ view: 'audit' })
    expect(parseRoute('#/home')).toEqual({ view: 'home' })
  })

  it('parseRoute は不正なビュー・空ハッシュを undefined にする', () => {
    expect(parseRoute('')).toBeUndefined()
    expect(parseRoute('#unknown')).toBeUndefined()
    expect(parseRoute('#/not-a-view')).toBeUndefined()
  })

  it('project は projectId を復元する', () => {
    expect(parseRoute('#/project?projectId=p-123')).toEqual({
      view: 'project',
      projectId: 'p-123',
    })
  })

  it('editor はセッションを復元し、既定値は省略される', () => {
    const hash = formatRoute('editor', {
      session: {
        projectId: 'p-1',
        projectNumber: 'PJ-2026-001',
        projectName: '国道245号 道路拡幅工事',
        drawingId: 'd-2',
        drawingNumber: 'DWG-011',
        drawingName: '仮設計画図（矢板・切梁）',
        revisionId: 'r-3',
        revisionNumber: 'Rev.2',
        changeSummary: '矢板追加',
      },
    })
    const parsed = parseRoute(hash)
    expect(parsed?.view).toBe('editor')
    expect(parsed?.session).toMatchObject({
      projectId: 'p-1',
      projectNumber: 'PJ-2026-001',
      projectName: '国道245号 道路拡幅工事',
      drawingId: 'd-2',
      drawingNumber: 'DWG-011',
      drawingName: '仮設計画図（矢板・切梁）',
      revisionId: 'r-3',
      revisionNumber: 'Rev.2',
      changeSummary: '矢板追加',
    })
  })

  it('formatRoute は既定セッション値（LOCAL 等）を URL へ含めない', () => {
    const hash = formatRoute('editor', {
      session: {
        projectNumber: 'LOCAL',
        projectName: 'ローカル編集（案件未選択）',
        drawingNumber: 'LOCAL',
        drawingName: '無題の図面',
        revisionNumber: 'LOCAL',
        changeSummary: 'ローカル編集の保存',
      },
    })
    expect(hash).toBe('#/editor')
  })

  it('formatRoute → parseRoute は往復で一致する', () => {
    const session = {
      projectId: 'p-9',
      projectNumber: 'A-1',
      projectName: '橋梁補修工事',
      drawingId: 'd-8',
      drawingNumber: 'BRG-003',
      drawingName: '下部工一般図',
      revisionId: 'r-7',
      revisionNumber: 'R0',
      changeSummary: '初版',
    }
    const parsed = parseRoute(formatRoute('editor', { session }))
    expect(parsed?.session).toMatchObject(session)
    // URL に無い既定値（drawingType 等）は既定で補完される
    expect(parsed?.session?.drawingType).toBe('general')
  })

  it('special characters are encoded/decoded safely', () => {
    const session = {
      projectNumber: 'PJ/2026-001 & 第二工区',
      projectName: '説明 & 打合せ',
      drawingNumber: 'DWG-001',
      drawingName: '一般図（案）',
      revisionNumber: 'Rev.1',
      changeSummary: '&<>"%',
    }
    const parsed = parseRoute(formatRoute('editor', { session }))
    expect(parsed?.session).toMatchObject({
      projectNumber: 'PJ/2026-001 & 第二工区',
      projectName: '説明 & 打合せ',
      drawingName: '一般図（案）',
      changeSummary: '&<>"%',
    })
  })
})
