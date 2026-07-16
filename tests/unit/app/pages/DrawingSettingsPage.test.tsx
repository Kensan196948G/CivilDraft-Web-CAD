import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DrawingSettingsPage } from '@/app/pages/DrawingSettingsPage'

describe('DrawingSettingsPage', () => {
  it('指定された図面設定、用紙プレビュー、設定履歴、警告を表示する', () => {
    render(<DrawingSettingsPage />)

    expect(screen.getByText('図面設定')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図 Rev.3 ・ 用紙、縮尺、単位、原点、座標系、表題欄')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A1（横）')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1:500')).toBeInTheDocument()
    expect(screen.getByDisplayValue('m（メートル）')).toBeInTheDocument()
    expect(screen.getByDisplayValue('78400.000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('-12920.000')).toBeInTheDocument()
    expect(screen.getByDisplayValue('平面直角座標系 第Ⅵ系')).toBeInTheDocument()
    expect(screen.getByDisplayValue('施工ヤード計画図')).toBeInTheDocument()
    expect(screen.getByDisplayValue('DWG-014')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Rev.3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('山田 太郎')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-07-14')).toBeInTheDocument()
    expect(screen.getByText('縮尺を1:1000→1:500に変更')).toBeInTheDocument()
    expect(screen.getByText('図面外に配置された図形があります。用紙プレビューで位置を確認してください。')).toBeInTheDocument()
  })

  it('設定を保存するとヘッダーに反映し、キャンセルで保存済み設定へ戻す', async () => {
    render(<DrawingSettingsPage />)

    const drawingName = screen.getByDisplayValue('施工ヤード計画図')
    await userEvent.clear(drawingName)
    await userEvent.type(drawingName, '施工ヤード計画図 改')
    await userEvent.click(screen.getByRole('button', { name: '設定を保存' }))

    expect(screen.getByText('設定を保存しました')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図 改 Rev.3 ・ 用紙、縮尺、単位、原点、座標系、表題欄')).toBeInTheDocument()

    const drawingNo = screen.getByDisplayValue('DWG-014')
    await userEvent.clear(drawingNo)
    await userEvent.type(drawingNo, 'DWG-999')
    await userEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.getByText('変更をキャンセルしました')).toBeInTheDocument()
    expect(screen.getByDisplayValue('DWG-014')).toBeInTheDocument()
  })
})
