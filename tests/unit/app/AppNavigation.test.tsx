/**
 * App全体のナビゲーション統合テスト。
 * サイドバーの各項目クリックで対応する画面コンテンツが右側に表示されることを検証する
 * （2026-07-15 ユーザー報告「クリックしても右側が表示されない」の再発防止）。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

// CanvasStage は Konva 依存のためスタブ化（ナビゲーションの検証に描画実体は不要）
vi.mock('@/app/canvas/CanvasStage', () => ({
  CanvasStage: () => <div data-testid="canvas-stage">CANVAS</div>,
}))
vi.mock('react-konva', () => ({
  Stage: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Layer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => null,
  Rect: () => null,
  Circle: () => null,
  Arc: () => null,
  Text: () => null,
  Arrow: () => null,
  Ellipse: () => null,
  Group: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { App } from '@/app/App'

/** サイドバー項目ラベル → クリック後に表示されるべき見出し・内容 */
const NAV_EXPECTATIONS: readonly {
  readonly nav: string
  readonly expectText: string | RegExp
  readonly section: string
}[] = [
  { nav: '案件詳細', expectText: /図面一覧|案件情報/, section: '案件' },
  { nav: '図面設定', expectText: /用紙・縮尺|表題欄/, section: '作図' },
  { nav: '測点・座標一覧', expectText: /座標系設定|CSV取込|測点/, section: '作図' },
  { nav: '土木部材パレット', expectText: /記号|テンプレート|パラメトリック/, section: '作図' },
  { nav: '数量集計', expectText: /数量を算出|数量集計/, section: '集計・照査' },
  { nav: '縦横断管理', expectText: /断面|土量/, section: '集計・照査' },
  { nav: '施工ステップ', expectText: /全表示|施工前/, section: '集計・照査' },
  { nav: '図面比較', expectText: /差分|比較対象/, section: '集計・照査' },
  { nav: '照査・承認', expectText: /改訂|照査/, section: '集計・照査' },
  { nav: '印刷・出力', expectText: /出力プレビュー|出力形式/, section: '出力・管理' },
  { nav: '監査ログ', expectText: /保存、承認、出力、認証イベントの記録/, section: '出力・管理' },
  { nav: 'システム設定', expectText: /工種・規格マスター|監査ログ/, section: '出力・管理' },
]

describe('App ナビゲーション統合', () => {
  it('初期表示はホーム（案件一覧）', () => {
    render(<App />)
    // 「ホーム・案件一覧」はサイドバーとページ見出しの両方に出る（=ホーム表示中）
    expect(screen.getAllByText('ホーム・案件一覧').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()
  })

  it.each(NAV_EXPECTATIONS)(
    'サイドバー「$nav」クリックで対応コンテンツが右側に表示される',
    async ({ nav, expectText, section }) => {
      render(<App />)
      if (section !== '案件') {
        await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${section}›?$`) }))
      }
      await userEvent.click(screen.getByRole('button', { name: new RegExp(nav) }))
      // Issue #26: 業務ページは遅延読み込み（React.lazy）のため非同期に表示される
      // 並列実行時の遅延ロードに耐えるため 5 秒まで待つ（デフォルトは 1 秒で flaky）。
      expect((await screen.findAllByText(expectText, {}, { timeout: 5000 })).length).toBeGreaterThanOrEqual(1)
    },
  )

  it('CAD編集クリックでエディタへ遷移し、サイドバーのホームで戻れる', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /^作図›?$/ }))
    await userEvent.click(screen.getByRole('button', { name: /CAD編集/ }))
    expect(await screen.findByTestId('canvas-stage', {}, { timeout: 5000 })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /ホーム・案件一覧/ }))
    expect(screen.getByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()
  })

  it('案件詳細の図面行クリックで図面詳細を開き、「CAD編集で開く」で図面コンテキストをCAD編集へ渡す', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /案件詳細/ }))
    await userEvent.click(screen.getByText('DWG-011'))
    expect(screen.getByText(/図面詳細: DWG-011/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'CAD編集で開く' }))
    expect(await screen.findByTestId('canvas-stage', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('みらい台地区 市道拡幅工事')).toBeInTheDocument()
    expect(screen.getByText('仮設計画図（矢板・切梁）')).toBeInTheDocument()
    expect(screen.getByText('Rev.2')).toBeInTheDocument()
    // URL ハッシュにセッション（案件番号・図面番号・改訂番号）が記録され、共有・ブックマーク可能になる
    expect(window.location.hash).toContain('#/editor')
    expect(window.location.hash).toContain('projectNumber=')
    expect(window.location.hash).toContain('drawingNumber=')
    expect(window.location.hash).toContain('revisionNumber=')
    expect(window.location.hash).toContain('DWG-011')
  })

  it('URL ハッシュの初期値（deep link）で直接該当ビューを表示する', async () => {
    window.location.hash = '#/audit'
    render(<App />)
    expect(
      await screen.findByText(/保存、承認、出力、認証イベントの記録/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    window.location.hash = ''
  })

  it('ハッシュ変更（戻る/進む相当）でビューが同期する', async () => {
    render(<App />)
    window.location.hash = '#/settings'
    window.dispatchEvent(new Event('hashchange'))
    expect(
      await screen.findByText(/監査ログ設定/, {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    window.location.hash = '#/home'
    window.dispatchEvent(new Event('hashchange'))
    expect(
      await screen.findByPlaceholderText('案件名・図面番号で検索', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
    window.location.hash = ''
  })

  it('モバイル: メニューを開くと最初の項目へフォーカスし、Escape で閉じてメニューへ復帰する', async () => {
    render(<App />)
    const menuButton = screen.getByRole('button', { name: 'メニューを開く' })
    await userEvent.click(menuButton)
    const firstNav = screen.getByRole('button', { name: /^案件(›|⌄)?$/ })
    expect(firstNav).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(menuButton).toHaveFocus()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('モバイル: 背面オーバーレイのクリックでサイドバーを閉じる', async () => {
    render(<App />)
    const menuButton = screen.getByRole('button', { name: 'メニューを開く' })
    await userEvent.click(menuButton)
    const backdrop = document.querySelector('.cd-mobile-backdrop')
    expect(backdrop).not.toBeNull()
    await userEvent.click(backdrop as HTMLElement)
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('.cd-mobile-backdrop')).toBeNull()
  })
})
