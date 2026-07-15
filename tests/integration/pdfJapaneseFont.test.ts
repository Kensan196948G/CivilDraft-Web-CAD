/**
 * 同梱Noto Sans JPサブセットの実グリフ埋込テスト（DD-TBD-006確定の検証）。
 * public/fonts の実フォントバイトを読み、日本語テキストが PDF_FONT_FALLBACK
 * 警告なしでベクター埋込されることを実物結合で確認する。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportPdf } from '@/domain/pdf/pdfExporter'
import { createDefaultLayer } from '@/app/store/editorStore'
import type { Geometry, GeometryCreationContext, GeometryId } from '@/shared/types'
import { defaultCreationContext } from '@/domain/geometry/geometryFactory'

const FONT_PATH = resolve(__dirname, '../../public/fonts/NotoSansJP-Regular-subset.otf')

const fixedCtx: GeometryCreationContext = {
  newId: defaultCreationContext.newId,
  now: () => '2026-07-15T12:00:00.000Z',
}

function textGeometry(text: string): Geometry {
  const layer = createDefaultLayer()
  return {
    id: 'jp-text-1' as GeometryId,
    layerId: layer.id,
    type: 'text',
    style: layer.defaultStyle,
    constructionStepIds: [],
    locked: false,
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    anchor: { x: 100, y: 100 },
    text,
    height: 25,
    rotationDeg: 0,
    horizontalAlign: 'left',
  }
}

describe('PDF日本語フォント埋込（実フォント・実物結合）', () => {
  it('同梱サブセット注入で日本語テキストがPDF_FONT_FALLBACKなしで出力される', async () => {
    const fontBytes = new Uint8Array(readFileSync(FONT_PATH))
    const layer = createDefaultLayer()
    const result = await exportPdf(
      [textGeometry('施工ヤード計画図 函渠工 切盛土 25.5㎡')],
      [layer],
      {
        paperSize: 'A3',
        orientation: 'landscape',
        scale: 100,
        titleBlock: { projectName: '国道245号 道路拡幅工事', drawingNumber: 'DRW-001' },
        japaneseFontBytes: fontBytes,
      },
      fixedCtx,
    )
    // 対照実験: フォント未注入では同一入力がPDF_FONT_FALLBACK警告になる
    const withoutFont = await exportPdf(
      [textGeometry('施工ヤード計画図 函渠工 切盛土 25.5㎡')],
      [layer],
      {
        paperSize: 'A3',
        orientation: 'landscape',
        scale: 100,
        titleBlock: { projectName: '国道245号 道路拡幅工事', drawingNumber: 'DRW-001' },
      },
      fixedCtx,
    )
    expect(result.ok && withoutFont.ok).toBe(true)
    if (result.ok && withoutFont.ok) {
      const fallback = result.value.issues.filter((i) => i.code === 'PDF_FONT_FALLBACK')
      expect(fallback).toEqual([])
      const embedFailed = result.value.issues.filter((i) => i.code === 'PDF_FONT_EMBED_FAILED')
      expect(embedFailed).toEqual([])
      expect(
        withoutFont.value.issues.some((i) => i.code === 'PDF_FONT_FALLBACK'),
      ).toBe(true)
      // PDFマジック + グリフ埋込によりフォント有り出力の方が大きい
      // （pdf-libはsubset:trueで使用グリフのみ埋込。BaseFont名はObjectStream圧縮で
      // 平文比較できないため、対照PDFとのサイズ差で埋込を検証する）
      expect(String.fromCharCode(...result.value.bytes.slice(0, 5))).toBe('%PDF-')
      expect(result.value.bytes.length).toBeGreaterThan(withoutFont.value.bytes.length)
    }
  })

  it('同一入力・固定ctxでbytesが決定的（フォント埋込込みでも再現可能）', async () => {
    const fontBytes = new Uint8Array(readFileSync(FONT_PATH))
    const layer = createDefaultLayer()
    const run = () =>
      exportPdf([textGeometry('寸法線 2,500')], [layer], {
        paperSize: 'A4',
        orientation: 'portrait',
        scale: 50,
        japaneseFontBytes: fontBytes,
      }, fixedCtx)
    const [a, b] = await Promise.all([run(), run()])
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.value.bytes.length).toBe(b.value.bytes.length)
      expect(Buffer.compare(Buffer.from(a.value.bytes), Buffer.from(b.value.bytes))).toBe(0)
    }
  })
})
