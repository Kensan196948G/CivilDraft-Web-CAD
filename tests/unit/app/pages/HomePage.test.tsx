import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomePage } from '@/app/pages/HomePage'
import type { CloudProject } from '@/infrastructure/cloud/civilDraftApiClient'
import { EditorStoreProvider } from '@/app/store/EditorStoreContext'
import { createEditorStore, createDefaultLayer } from '@/app/store/editorStore'
import { MemoryAutosaveStore } from '@/infrastructure/autosave/autosaveStore'
import type { Geometry, GeometryId } from '@/shared/types'

function circle(gid: string, cx: number, cy: number, r: number): Geometry {
  const layer = createDefaultLayer()
  return {
    id: gid as GeometryId,
    layerId: layer.id,
    type: 'circle',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    center: { x: cx, y: cy },
    radius: r,
  }
}

describe('HomePage', () => {
  it('復旧候補が無い場合はその旨を表示する', async () => {
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText('復旧候補はありません')).toBeInTheDocument()
    expect(screen.getByText('未確定の下書きなし')).toBeInTheDocument()
  })

  it('保存済み下書きがあると復旧候補として表示され、復元でエディタへ読み込まれる', async () => {
    const autosave = new MemoryAutosaveStore()
    await autosave.save({
      savedAt: '2026-07-15T12:00:00.000Z',
      geometries: [circle('a', 0, 0, 5)],
      layers: [createDefaultLayer()],
    })
    const store = createEditorStore()
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={autosave} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText(/図形1件/)).toBeInTheDocument()
    expect(screen.getByText('未確定の下書きあり')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '復元' }))
    expect(onOpenEditor).toHaveBeenCalled()
    expect(store.getState().geometries.map((g) => g.id)).toEqual(['a'])
    expect(store.getIndex().size).toBe(1)
  })

  it('破棄すると下書きが消去され候補なし表示になる', async () => {
    const autosave = new MemoryAutosaveStore()
    await autosave.save({
      savedAt: '2026-07-15T12:00:00.000Z',
      geometries: [circle('a', 0, 0, 5)],
      layers: [createDefaultLayer()],
    })
    const store = createEditorStore()
    render(
      <EditorStoreProvider store={store}>
        <HomePage autosaveStore={autosave} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: '破棄' }))
    await waitFor(() => expect(screen.getByText('下書きを破棄しました')).toBeInTheDocument())
    const loaded = await autosave.load()
    expect(loaded.ok && loaded.value).toBeNull()
  })

  it('新規案件・図面ボタンで専用作成画面を開き、作成後に案件詳細を表示する', async () => {
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '＋ 新規案件・図面' }))
    expect(onOpenEditor).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '案件と図面を作成' })).toBeInTheDocument()

    const projectNameInput = screen.getByDisplayValue('新規施工ヤード計画')
    await userEvent.clear(projectNameInput)
    await userEvent.type(projectNameInput, '新規排水計画')
    await userEvent.click(screen.getByRole('button', { name: '案件と図面を作成' }))

    expect(screen.getByText('案件詳細: 新規排水計画')).toBeInTheDocument()
    expect(screen.getByText('施工ヤード計画図 を初期図面として作成')).toBeInTheDocument()
    expect(onOpenEditor).not.toHaveBeenCalled()
  })

  it('空の案件名を拒否し、検索入力で案件と図面番号を絞り込む', async () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: '＋ 新規案件・図面' }))
    const projectNameInput = screen.getByDisplayValue('新規施工ヤード計画')
    await userEvent.clear(projectNameInput)
    await userEvent.click(screen.getByRole('button', { name: '案件と図面を作成' }))
    expect(screen.getByText('案件名を入力してください')).toBeInTheDocument()
    expect(screen.queryByText('案件詳細:')).not.toBeInTheDocument()

    const search = screen.getByPlaceholderText('案件名・図面番号で検索')
    await userEvent.type(search, 'DWG-018')
    expect(screen.getByRole('button', { name: '青葉橋 橋台補強工事' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '国道245号 道路拡幅工事' })).not.toBeInTheDocument()
  })

  it('案件一覧、すべて表示、最近開いた図面、お知らせ、統計カードが詳細表示に切り替わる', async () => {
    const onOpenEditor = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={onOpenEditor} />
      </EditorStoreProvider>,
    )

    await userEvent.click(screen.getAllByText('大和川 河川護岸補修工事')[0]!)
    expect(screen.getByText('案件詳細: 大和川 河川護岸補修工事')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'すべて表示 →' }))
    expect(screen.getByText('すべての案件')).toBeInTheDocument()
    expect(screen.getByText('高台地区 法面補強工事')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /施工ヤード計画図 Rev\.3/ }))
    expect(screen.getByText('最近開いた図面: 施工ヤード計画図')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'CAD編集で開く' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /定期メンテナンス予定/ }))
    expect(screen.getByText('お知らせ詳細')).toBeInTheDocument()
    expect(screen.getByText(/共有版の認証・監査ログ基盤メンテナンス予定です/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /照査待ち図面/ }))
    expect(screen.getByText('統計カード対象の案件')).toBeInTheDocument()
    expect(screen.getByText('港湾第3岸壁 排水改良')).toBeInTheDocument()
  })

  it('デザイン正本のサンプル案件・統計・お知らせが表示される（Home.dc.html 100%適用）', () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} />
      </EditorStoreProvider>,
    )
    expect(screen.getAllByText('国道245号 道路拡幅工事').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('進行中案件')).toBeInTheDocument()
    expect(screen.getByText('照査待ち図面')).toBeInTheDocument()
    expect(screen.getByText(/定期メンテナンス/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('案件名・図面番号で検索')).toBeInTheDocument()
  })

  it('本番モードではサンプルデータを表示せず、API 接続失敗時はエラー表示になる', async () => {
    const failingClient = {
      listProjects: vi.fn(async () => ({
        ok: false,
        error: { code: 'CD-AUTH-001', severity: 'error' as const, message: '認証情報がありません' },
      })),
    }
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage
          autosaveStore={new MemoryAutosaveStore()}
          onOpenEditor={() => {}}
          cloudApiClient={failingClient}
          enableCloudData
        />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText(/共有データに接続できません/)).toBeInTheDocument()
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()
  })

  it('本番モードで API から取得した実案件を表示する', async () => {
    const realProject: CloudProject = {
      id: 'p-1',
      projectNumber: 'P-REAL-001',
      name: '本番実案件',
      clientName: 'テスト発注者',
      status: 'active',
      version: 1,
    }
    const okClient = {
      listProjects: vi.fn(async () => ({ ok: true, value: [realProject] })),
    }
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage
          autosaveStore={new MemoryAutosaveStore()}
          onOpenEditor={() => {}}
          cloudApiClient={okClient}
          enableCloudData
        />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText(/共有データ接続済み/)).toBeInTheDocument()
    expect(screen.getByText('本番実案件')).toBeInTheDocument()
    expect(screen.queryByText('国道245号 道路拡幅工事')).not.toBeInTheDocument()
  })

  it('本番モードで案件クリック時に onOpenProject(id) を呼び、ローカル詳細へ遷移しない', async () => {
    const realProject: CloudProject = {
      id: 'p-1',
      projectNumber: 'P-REAL-001',
      name: '本番実案件',
      clientName: 'テスト発注者',
      status: 'active',
      version: 1,
    }
    const okClient = {
      listProjects: vi.fn(async () => ({ ok: true, value: [realProject] })),
    }
    const onOpenProject = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage
          autosaveStore={new MemoryAutosaveStore()}
          onOpenEditor={() => {}}
          onOpenProject={onOpenProject}
          cloudApiClient={okClient}
          enableCloudData
        />
      </EditorStoreProvider>,
    )
    await screen.findByText(/共有データ接続済み/)
    await userEvent.click(screen.getByRole('button', { name: '本番実案件' }))
    expect(onOpenProject).toHaveBeenCalledWith('p-1')
    expect(screen.queryByText(/案件詳細:/)).not.toBeInTheDocument()
  })

  it('本番モードの新規案件作成は API で案件と図面を作成し、実案件詳細へ遷移する', async () => {
    const createdProject: CloudProject = {
      id: 'p-new',
      projectNumber: 'P-NEW-001',
      name: '新規排水計画',
      status: 'active',
      version: 1,
    }
    const createProject = vi.fn(async () => ({ ok: true, value: createdProject }))
    const createDrawing = vi.fn(async () => ({
      ok: true,
      value: { id: 'd-new', projectId: 'p-new', drawingNumber: 'DWG-001', name: '施工ヤード計画図', version: 1 },
    }))
    const onOpenProject = vi.fn()
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage
          autosaveStore={new MemoryAutosaveStore()}
          onOpenEditor={() => {}}
          onOpenProject={onOpenProject}
          cloudApiClient={{ listProjects: vi.fn(async () => ({ ok: true, value: [] })), createProject, createDrawing }}
          enableCloudData
        />
      </EditorStoreProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '＋ 新規案件・図面' }))
    const projectNameInput = screen.getByDisplayValue('新規施工ヤード計画')
    await userEvent.clear(projectNameInput)
    await userEvent.type(projectNameInput, '新規排水計画')
    await userEvent.click(screen.getByRole('button', { name: '案件と図面を作成' }))

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('p-new'))
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新規排水計画', projectNumber: expect.stringMatching(/^P-/) }),
    )
    expect(createDrawing).toHaveBeenCalledWith(
      'p-new',
      expect.objectContaining({ drawingNumber: 'DWG-001', name: '施工ヤード計画図' }),
    )
  })

  it('本番モードではデモ下書き作成ボタンを表示しない', async () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage
          autosaveStore={new MemoryAutosaveStore()}
          onOpenEditor={() => {}}
          cloudApiClient={{ listProjects: vi.fn(async () => ({ ok: true, value: [] })) }}
          enableCloudData
        />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText('復旧候補はありません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'デモ下書きを作成' })).not.toBeInTheDocument()
  })

  it('canEdit=false（viewer）では新規案件・図面ボタンが非表示になる', () => {
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={new MemoryAutosaveStore()} onOpenEditor={() => {}} canEdit={false} />
      </EditorStoreProvider>,
    )
    expect(screen.queryByRole('button', { name: '＋ 新規案件・図面' })).not.toBeInTheDocument()
  })

  it('canEdit=false（viewer）では復旧候補の復元・破棄とデモ下書き作成が非表示になる', async () => {
    const autosave = new MemoryAutosaveStore()
    await autosave.save({
      savedAt: '2026-07-15T12:00:00.000Z',
      geometries: [circle('a', 0, 0, 5)],
      layers: [createDefaultLayer()],
    })
    render(
      <EditorStoreProvider store={createEditorStore()}>
        <HomePage autosaveStore={autosave} onOpenEditor={() => {}} canEdit={false} />
      </EditorStoreProvider>,
    )
    expect(await screen.findByText(/保存済み下書きがあります/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '復元' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '破棄' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'デモ下書きを作成' })).not.toBeInTheDocument()
  })
})
