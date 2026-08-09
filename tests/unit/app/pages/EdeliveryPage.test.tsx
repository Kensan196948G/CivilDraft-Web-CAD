import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EdeliveryPage } from '@/app/pages/EdeliveryPage'

function mockDownloads() {
  const blobs: Blob[] = []
  const urlObj = URL as unknown as {
    createObjectURL?: (blob: Blob) => string
    revokeObjectURL?: (url: string) => void
  }
  urlObj.createObjectURL = (blob) => {
    blobs.push(blob)
    return 'blob:mock'
  }
  urlObj.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return blobs
}

afterEach(() => {
  vi.restoreAllMocks()
  const urlObj = URL as unknown as {
    createObjectURL?: (blob: Blob) => string
    revokeObjectURL?: (url: string) => void
  }
  delete urlObj.createObjectURL
  delete urlObj.revokeObjectURL
})

describe('EdeliveryPage', () => {
  it('基準情報・標準フォルダ案内を表示し、チェック実行で検査結果を表示する', async () => {
    render(<EdeliveryPage />)
    expect(screen.getByText('電子納品')).toBeInTheDocument()
    expect(screen.getAllByText(/令和5年3月版/).length).toBeGreaterThan(0)
    expect(screen.getByText(/DRAWINGF（工事完成図）/)).toBeInTheDocument()

    const fileName = screen.getByLabelText('ファイル名')
    await userEvent.clear(fileName)
    await userEvent.type(fileName, '施工図.dxf')
    await userEvent.click(screen.getByRole('button', { name: 'チェック実行' }))

    expect(await screen.findByText(/検査完了:/)).toBeInTheDocument()
    expect(screen.getByText(/ファイル名は半角英数字/)).toBeInTheDocument()
    expect(screen.getByText(/DXF は要領の標準形式ではない/)).toBeInTheDocument()
  })

  it('未確認のまま管理ファイル出力はブロックされ、確認後は CSV を出力する', async () => {
    const blobs = mockDownloads()
    render(<EdeliveryPage />)

    const fileName = screen.getByLabelText('ファイル名')
    await userEvent.clear(fileName)
    await userEvent.type(fileName, '0001-001.P21')

    const outputButton = screen.getByRole('button', { name: '管理ファイル出力' }) as HTMLButtonElement
    expect(outputButton.disabled).toBe(true)

    const confirmCheckbox = screen.getByRole('checkbox', {
      name: /検査結果・フォルダ構成・命名規則を検査職員\/発注者と最終確認し/,
    })
    await userEvent.click(confirmCheckbox)
    const reviewer = screen.getByLabelText('最終確認者')
    await userEvent.type(reviewer, '検査員A')
    await userEvent.click(outputButton)

    expect(blobs.length).toBe(1)
    expect(screen.getByText(/管理ファイル（管理項目一覧 CSV）を出力しました/)).toBeInTheDocument()
  })
})
