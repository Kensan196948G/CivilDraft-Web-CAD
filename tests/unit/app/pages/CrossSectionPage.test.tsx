import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CrossSectionPage,
  SAMPLE_SECTIONS,
  formatCubicMeters,
  formatMeters,
  formatSquareMeters,
} from '@/app/pages/CrossSectionPage'
import { computeEarthworkVolume, computeSectionAreas, type Section } from '@/domain/sections'
import type { SurveyPointId } from '@/shared/types'
import type { CivilDraftApiClient } from '@/infrastructure/cloud/civilDraftApiClient'

/** サンプル全ペアの土量を集計する（ページ内の summarizeVolume と同じ手順をテスト側で再現）。 */
function expectedVolumes(sections: readonly Section[]): { cut: number; fill: number } {
  let cut = 0
  let fill = 0
  for (let i = 0; i < sections.length - 1; i++) {
    const result = computeEarthworkVolume(sections[i]!, sections[i + 1]!)
    if (result.ok) {
      cut += result.value.cut.volume
      fill += result.value.fill.volume
    }
  }
  return { cut, fill }
}

describe('CrossSectionPage / 空状態', () => {
  it('初期は空状態メッセージと「サンプル断面を読み込む」ボタンを表示し、断面一覧は出さない', () => {
    render(<CrossSectionPage />)
    expect(screen.getByText('断面データがありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /サンプル断面を読み込む/ })).toBeInTheDocument()
    expect(screen.queryByText('断面一覧')).not.toBeInTheDocument()
  })

  it('本番モード（enableSampleData=false）ではサンプル断面ボタンを表示せず、API未実装を明示する', () => {
    render(<CrossSectionPage enableSampleData={false} />)
    expect(screen.getByText('断面データがありません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /サンプル断面を読み込む/ })).not.toBeInTheDocument()
    expect(screen.getByText(/実断面データのAPI連携は未実装です/)).toBeInTheDocument()
  })
})

describe('CrossSectionPage / サンプル読み込み', () => {
  it('読み込むと断面一覧に No.0 / No.20 / No.40 が表示される', async () => {
    render(<CrossSectionPage />)
    await userEvent.click(screen.getByRole('button', { name: /サンプル断面を読み込む/ }))

    expect(screen.getByText('断面一覧')).toBeInTheDocument()
    for (const label of ['No.0', 'No.20', 'No.40']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('切土・盛土面積が computeSectionAreas の算出値（m²表記）と一致する', async () => {
    render(<CrossSectionPage />)
    await userEvent.click(screen.getByRole('button', { name: /サンプル断面を読み込む/ }))

    const areas = computeSectionAreas(SAMPLE_SECTIONS[0]!)
    expect(areas.ok).toBe(true)
    if (!areas.ok) return

    // No.0 行を測点ボタンから辿り、切盛面積セルの表示を検証する。
    const stationButton = screen.getByRole('button', { name: 'No.0' })
    const row = stationButton.closest('tr') as HTMLElement
    expect(within(row).getByText(`${formatSquareMeters(areas.value.cutArea)} m²`)).toBeInTheDocument()
    expect(
      within(row).getByText(`${formatSquareMeters(areas.value.fillArea)} m²`),
    ).toBeInTheDocument()
  })

  it('土量カードが computeEarthworkVolume の集計値（m³表記）と一致する', async () => {
    render(<CrossSectionPage />)
    await userEvent.click(screen.getByRole('button', { name: /サンプル断面を読み込む/ }))

    const { cut, fill } = expectedVolumes(SAMPLE_SECTIONS)
    const cutCard = screen.getByText('切土量').parentElement as HTMLElement
    const fillCard = screen.getByText('盛土量').parentElement as HTMLElement
    const netCard = screen.getByText('差引').parentElement as HTMLElement

    expect(within(cutCard).getByText(formatCubicMeters(cut))).toBeInTheDocument()
    expect(within(fillCard).getByText(formatCubicMeters(fill))).toBeInTheDocument()
    expect(within(netCard).getByText(formatCubicMeters(cut - fill))).toBeInTheDocument()
  })

  it('簡易計算である旨（平均断面法の warning）を表示する', async () => {
    render(<CrossSectionPage />)
    await userEvent.click(screen.getByRole('button', { name: /サンプル断面を読み込む/ }))

    expect(screen.getByText('簡易計算')).toBeInTheDocument()
    expect(screen.getByText(/平均断面法による簡易土量/)).toBeInTheDocument()
  })

  it('測点選択で詳細パネルに点列（offset/現況高/計画高）を表示する', async () => {
    render(<CrossSectionPage />)
    await userEvent.click(screen.getByRole('button', { name: /サンプル断面を読み込む/ }))

    // 選択前は誘導メッセージ。
    expect(screen.getByText(/測点を選択すると/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'No.0' }))
    expect(screen.getByRole('columnheader', { name: /offset/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /現況高/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /計画高/ })).toBeInTheDocument()

    // No.0 現況高 1000mm=1.000m、計画高 0mm=0.000m が点列に現れる。
    expect(screen.getAllByText(formatMeters(1000)).length).toBeGreaterThan(0)
  })
})

describe('CrossSectionPage / 断面データAPI連携（改訂ID指定時）', () => {
  it('断面を読み込み、「断面を共有保存」で PUT /sections を呼ぶ', async () => {
    const getSections = vi.fn(async () => ({
      ok: true as const,
      value: {
        revisionId: 'revision-r1',
        sections: SAMPLE_SECTIONS.slice(0, 2),
        sectionVersion: 1,
        updatedAt: '2026-08-10T00:00:00.000Z',
        updatedBy: 'engineer@example.test',
      },
    }))
    const putSections = vi.fn(async () => ({
      ok: true as const,
      value: {
        revisionId: 'revision-r1',
        sections: SAMPLE_SECTIONS.slice(0, 2),
        sectionVersion: 2,
        updatedAt: '2026-08-10T00:00:01.000Z',
        updatedBy: 'engineer@example.test',
      },
    }))
    const apiClient = {
      getRevisionSections: getSections,
      putRevisionSections: putSections,
    } as unknown as CivilDraftApiClient

    render(<CrossSectionPage revisionId="revision-r1" apiClient={apiClient} enableSampleData={false} />)

    await waitFor(() => expect(screen.getByText(/断面データを読み込みました/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'No.0' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '断面を共有保存' }))
    await waitFor(() => expect(putSections).toHaveBeenCalledTimes(1))
    expect(putSections).toHaveBeenCalledWith('revision-r1', expect.any(Array), 1)
    await waitFor(() => expect(screen.getByText(/断面データを保存しました/)).toBeInTheDocument())
  })
})

describe('CrossSectionPage / 未確定の非握り潰し（§16.2）', () => {
  it('面積未確定の断面は warning バッジと理由を表示する', () => {
    const broken: Section = {
      id: 'broken',
      surveyPointId: 'sp-x' as SurveyPointId,
      station: 60000,
      // offset 逆行 → 自己交差で面積未確定。
      existingGround: [
        { offset: 10, elevation: 0 },
        { offset: -10, elevation: 0 },
      ],
      plannedGround: [
        { offset: -10, elevation: 0 },
        { offset: 10, elevation: 0 },
      ],
    }
    render(<CrossSectionPage initialSections={[broken]} />)
    expect(screen.getByText('面積未確定')).toBeInTheDocument()
    expect(screen.getByText(/自己交差/)).toBeInTheDocument()
  })
})
