/**
 * GeometryRenderer の描画マッピング検証。
 * 継承元: Civil-Draw src/components/Canvas/ShapeRenderer.test.tsx（テスト手法の正本）。
 * jsdom で Konva 実体を起動せず、react-konva を vi.mock でスタブ化して
 * 「例外なく描画される」「Konva プリミティブへ渡る props が期待どおり」を検査する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  ArcGeometry,
  CircleGeometry,
  DimensionGeometry,
  EllipseGeometry,
  GeometryId,
  GeometryStyle,
  HatchGeometry,
  LayerId,
  LeaderGeometry,
  LineGeometry,
  ParametricGeometry,
  PolylineGeometry,
  RectangleGeometry,
  SplineGeometry,
  SymbolGeometry,
  TextGeometry,
} from '@/shared/types'

vi.mock('react-konva', () => ({
  Line: vi.fn(() => null),
  Rect: vi.fn(() => null),
  Circle: vi.fn(() => null),
  Arc: vi.fn(() => null),
  Text: vi.fn(() => null),
  Arrow: vi.fn(() => null),
  Ellipse: vi.fn(() => null),
  Group: vi.fn(({ children }: { children: ReactNode }) => <>{children}</>),
}))

const { mockGenerateHatchLines } = vi.hoisted(() => ({
  mockGenerateHatchLines: vi.fn(() => [{ start: { x: 0, y: 0 }, end: { x: 10, y: 10 } }]),
}))
vi.mock('@/domain/geometry/hatchGenerator', () => ({
  generateHatchLines: mockGenerateHatchLines,
}))

import { GeometryRenderer } from '@/app/canvas/GeometryRenderer'
import * as reactKonva from 'react-konva'

const style: GeometryStyle = {
  strokeColor: '#FF0000',
  strokeWidth: 1,
  lineType: 'continuous',
  opacity: 1,
  printable: true,
}

const base = {
  id: 'geom-1' as GeometryId,
  layerId: 'layer-1' as LayerId,
  style,
  constructionStepIds: [],
  locked: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as const

/** Konva プリミティブの直近呼び出しに渡った props を取り出す。 */
function lastProps(mockFn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const { calls } = mockFn.mock
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]?.[0] as Record<string, unknown>
}

describe('GeometryRenderer', () => {
  beforeEach(() => {
    mockGenerateHatchLines.mockClear()
    vi.mocked(reactKonva.Line).mockClear()
    vi.mocked(reactKonva.Rect).mockClear()
    vi.mocked(reactKonva.Circle).mockClear()
    vi.mocked(reactKonva.Arc).mockClear()
    vi.mocked(reactKonva.Text).mockClear()
    vi.mocked(reactKonva.Arrow).mockClear()
    vi.mocked(reactKonva.Ellipse).mockClear()
  })

  describe('13種の描画マッピング', () => {
    it('line を描画する', () => {
      const g: LineGeometry = { ...base, type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      expect(lastProps(reactKonva.Line as never).points).toEqual([0, 0, 100, 100])
    })

    it('rectangle を描画する', () => {
      const g: RectangleGeometry = {
        ...base,
        type: 'rectangle',
        origin: { x: 10, y: 20 },
        width: 50,
        height: 30,
        rotationDeg: 15,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      const p = lastProps(reactKonva.Rect as never)
      expect(p.x).toBe(10)
      expect(p.rotation).toBe(15)
    })

    it('circle を描画する', () => {
      const g: CircleGeometry = { ...base, type: 'circle', center: { x: 50, y: 50 }, radius: 25 }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      expect(lastProps(reactKonva.Circle as never).radius).toBe(25)
    })

    it('arc を描画する（rotation=startAngleDeg, angle=正規化掃引）', () => {
      const g: ArcGeometry = {
        ...base,
        type: 'arc',
        center: { x: 50, y: 50 },
        radius: 25,
        startAngleDeg: 30,
        endAngleDeg: 120,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      const p = lastProps(reactKonva.Arc as never)
      expect(p.rotation).toBe(30)
      expect(p.angle).toBe(90)
    })

    it('arc の始点=終点は全円（angle=360）とみなす', () => {
      const g: ArcGeometry = {
        ...base,
        type: 'arc',
        center: { x: 0, y: 0 },
        radius: 10,
        startAngleDeg: 45,
        endAngleDeg: 45,
      }
      render(<GeometryRenderer geometry={g} />)
      expect(lastProps(reactKonva.Arc as never).angle).toBe(360)
    })

    it('フィレット弧（start=180/end=-90）は正方向90°掃引で描画される（Issue #23）', () => {
      const g: ArcGeometry = {
        ...base,
        type: 'arc',
        center: { x: 2, y: 2 },
        radius: 2,
        startAngleDeg: 180,
        endAngleDeg: -90,
      }
      render(<GeometryRenderer geometry={g} />)
      const p = lastProps(reactKonva.Arc as never)
      expect(p.rotation).toBe(180)
      expect(p.angle).toBe(90)
    })

    it('ellipse を描画する', () => {
      const g: EllipseGeometry = {
        ...base,
        type: 'ellipse',
        center: { x: 0, y: 0 },
        radiusX: 40,
        radiusY: 20,
        rotationDeg: 10,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      const p = lastProps(reactKonva.Ellipse as never)
      expect(p.radiusX).toBe(40)
      expect(p.radiusY).toBe(20)
    })

    it('polyline（開）を描画する', () => {
      const g: PolylineGeometry = {
        ...base,
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }],
        closed: false,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      const p = lastProps(reactKonva.Line as never)
      expect(p.points).toEqual([0, 0, 50, 50, 100, 0])
      expect(p.closed).toBe(false)
      expect(p.fill).toBe('transparent')
    })

    it('polyline（閉）は stroke 由来の淡色で塗る', () => {
      const g: PolylineGeometry = {
        ...base,
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }],
        closed: true,
      }
      render(<GeometryRenderer geometry={g} />)
      const p = lastProps(reactKonva.Line as never)
      expect(p.closed).toBe(true)
      expect(p.fill).toBe('#FF000022')
    })

    it('spline を描画する（tension を渡す）', () => {
      const g: SplineGeometry = {
        ...base,
        type: 'spline',
        points: [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 0 }],
        tension: 0.5,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      expect(lastProps(reactKonva.Line as never).tension).toBe(0.5)
    })

    it('text を描画する', () => {
      const g: TextGeometry = {
        ...base,
        type: 'text',
        anchor: { x: 10, y: 10 },
        text: 'Hello',
        height: 14,
        rotationDeg: 0,
        horizontalAlign: 'center',
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      const p = lastProps(reactKonva.Text as never)
      expect(p.text).toBe('Hello')
      expect(p.fontSize).toBe(14)
      expect(p.align).toBe('center')
    })

    it('dimension（horizontal）を描画する', () => {
      const g: DimensionGeometry = {
        ...base,
        type: 'dimension',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        orientation: 'horizontal',
        offset: 20,
        textHeight: 12,
        arrowSize: 8,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      // 寸法テキストは formatLengthMm(mm) で整形される（100mm）。
      expect(lastProps(reactKonva.Text as never).text).toBe('100.0 mm')
    })

    it('dimension（vertical）を描画する', () => {
      const g: DimensionGeometry = {
        ...base,
        type: 'dimension',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 2000 },
        orientation: 'vertical',
        offset: 20,
        textHeight: 12,
        arrowSize: 8,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      // 1000mm 以上は m 表記へ切り替わる（formatLengthMm）。
      expect(lastProps(reactKonva.Text as never).text).toBe('2.000 m')
    })

    it('dimension（parallel）を描画する', () => {
      const g: DimensionGeometry = {
        ...base,
        type: 'dimension',
        start: { x: 0, y: 0 },
        end: { x: 30, y: 40 },
        orientation: 'parallel',
        offset: 20,
        textHeight: 12,
        arrowSize: 8,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      // hypot(30,40)=50mm。
      expect(lastProps(reactKonva.Text as never).text).toBe('50.0 mm')
    })

    it('長さ0の parallel dimension でも例外を投げない', () => {
      const g: DimensionGeometry = {
        ...base,
        type: 'dimension',
        start: { x: 50, y: 50 },
        end: { x: 50, y: 50 },
        orientation: 'parallel',
        offset: 20,
        textHeight: 12,
        arrowSize: 8,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
    })

    it('leader を描画する', () => {
      const g: LeaderGeometry = {
        ...base,
        type: 'leader',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 50 },
        text: '注記',
        textHeight: 12,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      expect(lastProps(reactKonva.Text as never).text).toBe('注記')
    })

    it('hatch を描画し generateHatchLines を呼ぶ', () => {
      const g: HatchGeometry = {
        ...base,
        type: 'hatch',
        boundaryPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        pattern: 'parallel',
        angleDeg: 45,
        spacing: 10,
      }
      render(<GeometryRenderer geometry={g} />)
      expect(mockGenerateHatchLines).toHaveBeenCalledOnce()
      expect(mockGenerateHatchLines).toHaveBeenCalledWith(g)
    })

    it('symbol（有効な symbolId）を描画する', () => {
      const g: SymbolGeometry = {
        ...base,
        type: 'symbol',
        symbolId: 'cone',
        position: { x: 50, y: 50 },
        rotationDeg: 0,
        scale: 1,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
    })

    it('symbol（circle パスを持つ excavator）を描画する', () => {
      const g: SymbolGeometry = {
        ...base,
        type: 'symbol',
        symbolId: 'excavator',
        position: { x: 50, y: 50 },
        rotationDeg: 0,
        scale: 1,
      }
      expect(() => render(<GeometryRenderer geometry={g} />)).not.toThrow()
      // excavator は circle パスを含むため Circle が描画される。
      expect(vi.mocked(reactKonva.Circle).mock.calls.length).toBeGreaterThan(0)
    })

    it('symbol（未知の symbolId）は null を返す', () => {
      const g: SymbolGeometry = {
        ...base,
        type: 'symbol',
        symbolId: 'nonexistent-symbol',
        position: { x: 50, y: 50 },
        rotationDeg: 0,
        scale: 1,
      }
      const { container } = render(<GeometryRenderer geometry={g} />)
      expect(container.firstChild).toBeNull()
    })

    it('parametricObject は何も描画しない（null）', () => {
      const g: ParametricGeometry = {
        ...base,
        type: 'parametricObject',
        definitionId: 'def-1',
        definitionVersion: 1,
        parameters: {},
        generatedGeometryIds: [],
      }
      const { container } = render(<GeometryRenderer geometry={g} />)
      expect(container.firstChild).toBeNull()
      expect(vi.mocked(reactKonva.Line).mock.calls.length).toBe(0)
    })
  })

  describe('選択強調・プレビュー・スタイル解決', () => {
    const lineGeom: LineGeometry = { ...base, type: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 100 } }

    it('isSelected=true で線幅が+1され青系シャドウが付く', () => {
      render(<GeometryRenderer geometry={lineGeom} isSelected />)
      const p = lastProps(reactKonva.Line as never)
      expect(p.strokeWidth).toBe(2)
      expect(p.shadowBlur).toBe(4)
    })

    it('通常時は style.strokeColor をそのまま渡す', () => {
      render(<GeometryRenderer geometry={lineGeom} />)
      expect(lastProps(reactKonva.Line as never).stroke).toBe('#FF0000')
    })

    it('isPreview=true でグレー描画（#888888）・半透明になる', () => {
      render(<GeometryRenderer geometry={lineGeom} isPreview />)
      const p = lastProps(reactKonva.Line as never)
      expect(p.stroke).toBe('#888888')
      expect(p.opacity).toBe(0.6)
    })

    it('全図形で listening=false（ヒットテストは空間索引が担う）', () => {
      render(<GeometryRenderer geometry={lineGeom} />)
      expect(lastProps(reactKonva.Line as never).listening).toBe(false)
    })
  })

  describe('lineType → dash マッピング', () => {
    it('continuous は実線（dash=[]）', () => {
      const g: LineGeometry = { ...base, type: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }
      render(<GeometryRenderer geometry={g} />)
      expect(lastProps(reactKonva.Line as never).dash).toEqual([])
    })

    it('dashed は [10,5]', () => {
      const g: LineGeometry = {
        ...base,
        type: 'line',
        style: { ...style, lineType: 'dashed' },
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      }
      render(<GeometryRenderer geometry={g} />)
      expect(lastProps(reactKonva.Line as never).dash).toEqual([10, 5])
    })

    it('dashDot は [10,5,2,5]', () => {
      const g: LineGeometry = {
        ...base,
        type: 'line',
        style: { ...style, lineType: 'dashDot' },
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      }
      render(<GeometryRenderer geometry={g} />)
      expect(lastProps(reactKonva.Line as never).dash).toEqual([10, 5, 2, 5])
    })

    it('double は実線で近似する（dash=[]）', () => {
      const g: LineGeometry = {
        ...base,
        type: 'line',
        style: { ...style, lineType: 'double' },
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      }
      render(<GeometryRenderer geometry={g} />)
      expect(lastProps(reactKonva.Line as never).dash).toEqual([])
    })
  })
})
