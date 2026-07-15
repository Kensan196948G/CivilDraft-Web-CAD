/**
 * 施工ステップ画面（詳細設計仕様書 §18）。
 * ステップの切替と、現在図面の図形の段階表示（ステップ別フィルタ結果の可視化）を担う。
 *
 * データ結線の方針:
 * - ステップ定義は施工ステップドメインの既定カタログ（DEFAULT_CONSTRUCTION_STEPS）を正本とする。
 * - 図形は useEditorStore の geometries を購読し、filterGeometriesByStep / isGeometryInStep で
 *   ステップ別の表示件数を算出する（ドメインの判定サービスを UI 側で再実装しない）。
 * - 選択中ステップは EditorStore の StepSlice（currentStepId / setCurrentStep）を購読・更新する。
 *   store 連動済み: ここでのステップ切替は CanvasStage の描画（filterGeometriesByStep による
 *   段階表示）へ即反映される。currentStepId=null は全表示。本画面は集計・可視化と選択更新のみを
 *   担い、図形そのものへは書き込まない。
 *
 * スタイルは pageStyles.ts の共通トークンのみを再利用する（独自の色・トークンは定義しない）。
 * mermaid 的なタイムラインは用いず、選択リスト＋テーブル（バッジ付き）で段階を表現する。
 */
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import {
  DEFAULT_CONSTRUCTION_STEPS,
  filterGeometriesByStep,
  getStepById,
  isGeometryInStep,
} from '@/domain/construction-steps'
import { useEditorStore } from '@/app/store/useEditorStore'
import {
  ghostButtonStyle,
  monoStyle,
  pageHeaderStyle,
  pageMainStyle,
  pageRootStyle,
  pageSubtitleStyle,
  pageTitleStyle,
  panelHeaderStyle,
  panelStyle,
  primaryButtonStyle,
  statCardStyle,
  statValueStyle,
  statusBadgeStyle,
  tdStyle,
  thStyle,
} from '@/app/pages/pageStyles'

/** ステップ選択ボタンのスタイル（アクティブは primaryButtonStyle、非アクティブは ghostButtonStyle を流用）。 */
function stepButtonStyle(active: boolean): CSSProperties {
  return {
    ...(active ? primaryButtonStyle : ghostButtonStyle),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    textAlign: 'left',
  }
}

export function ConstructionStepsPage() {
  const geometries = useEditorStore((s) => s.geometries)
  // 選択中ステップ（null = 全表示）は EditorStore の StepSlice を購読・更新する（store 連動、上部 NOTE 参照）。
  const currentStepId = useEditorStore((s) => s.currentStepId)
  const setCurrentStep = useEditorStore((s) => s.setCurrentStep)

  const visible = useMemo(
    () => filterGeometriesByStep(geometries, currentStepId),
    [geometries, currentStepId],
  )

  const unassignedCount = useMemo(
    () => geometries.filter((g) => g.constructionStepIds.length === 0).length,
    [geometries],
  )

  const perStepCounts = useMemo(
    () =>
      DEFAULT_CONSTRUCTION_STEPS.map((step) => ({
        step,
        count: geometries.filter((g) => isGeometryInStep(g, step.id)).length,
      })),
    [geometries],
  )

  const selectedStep =
    currentStepId === null ? undefined : getStepById(DEFAULT_CONSTRUCTION_STEPS, currentStepId)
  const selectionLabel = selectedStep?.name ?? '全表示'
  const totalCount = geometries.length

  return (
    <div style={pageRootStyle}>
      <header style={pageHeaderStyle}>
        <div>
          <div style={pageTitleStyle}>施工ステップ</div>
          <div style={pageSubtitleStyle}>ステップ切替・図形の段階表示</div>
        </div>
      </header>

      <main style={pageMainStyle}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {/* ステップ一覧パネル（選択） */}
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>ステップ一覧</div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                type="button"
                aria-pressed={currentStepId === null}
                style={stepButtonStyle(currentStepId === null)}
                onClick={() => setCurrentStep(null)}
              >
                <span>全表示</span>
                <span style={monoStyle}>{totalCount}</span>
              </button>
              {DEFAULT_CONSTRUCTION_STEPS.map((step) => {
                const active = step.id === currentStepId
                const count = perStepCounts.find((r) => r.step.id === step.id)?.count ?? 0
                return (
                  <button
                    key={step.id}
                    type="button"
                    aria-pressed={active}
                    style={stepButtonStyle(active)}
                    onClick={() => setCurrentStep(step.id)}
                  >
                    <span>{step.name}</span>
                    <span style={monoStyle}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 選択ステップの情報パネル */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>表示図形の集計</div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
                  選択中: <strong style={{ color: 'var(--ink)' }}>{selectionLabel}</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
                    gap: 14,
                  }}
                >
                  <div style={statCardStyle}>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>
                      表示される図形
                    </div>
                    <div style={statValueStyle}>{visible.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>全 {totalCount} 件中</div>
                  </div>
                  <div style={statCardStyle}>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>
                      ステップ未割当図形
                    </div>
                    <div style={statValueStyle}>{unassignedCount}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>全ステップ共通で表示</div>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
                  このステップで表示される図形: {visible.length}件 / 全{totalCount}件
                </div>
              </div>
            </div>

            {/* ステップ別の内訳テーブル（タイムラインをテーブル＋バッジで表現） */}
            <div style={panelStyle}>
              <div style={panelHeaderStyle}>ステップ別の内訳</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>順序</th>
                    <th style={thStyle}>ステップ</th>
                    <th style={thStyle}>区分</th>
                    <th style={thStyle}>表示図形数</th>
                  </tr>
                </thead>
                <tbody>
                  {perStepCounts.map(({ step, count }) => (
                    <tr key={step.id}>
                      <td style={{ ...tdStyle, ...monoStyle, color: 'var(--ink2)' }}>{step.order}</td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{step.name}</td>
                      <td style={tdStyle}>
                        <span style={statusBadgeStyle('#B5701A', '#FDEFE0')}>
                          {step.standard ? '標準' : 'カスタム'}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, ...monoStyle }}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
