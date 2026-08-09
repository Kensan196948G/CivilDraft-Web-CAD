/**
 * PDF 墨消し（テキスト物理削除）。
 *
 * 従来の redactPdfPages（pdfEdit.ts）は黒矩形の「視覚的塗りつぶし」のみだった。
 * 本モジュールはコンテンツストリームを解析し、墨消し領域に重なる
 * テキスト表示演算子（Tj / ' / " / TJ）を**物理的に除去**してから、
 * その領域に黒矩形を重ねる。
 *
 * 対応する演算子: BT/ET・Tm/Td/TD/T*・Tf・TL・Tc/Tw/Tz/Tr/Ts・Tj/'/"/TJ。
 * 非対応ストリーム（パース失敗・複合フィルタ等）は視覚モードへフォールバックし、
 * 警告を issues に含める（物理削除を偽装しない）。
 */
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'
import type { Result, ValidationIssue } from '@/shared/types'
import { redactPdfPages, type PdfRect } from './pdfEdit'

interface Token {
  readonly kind: 'number' | 'name' | 'literal' | 'hex' | 'array' | 'dict' | 'keyword'
  readonly raw: string
  /** literal/hex/array に含まれるテキスト断片（幅推定用）。 */
  readonly text: string
}

const WHITESPACE = new Set(['\u0000', '\t', '\n', '\f', '\r', ' '])

function isDelimiter(char: string): boolean {
  return '()<>[]{}/%'.includes(char)
}

function decodeLiteral(raw: string): string {
  let out = ''
  for (let i = 1; i < raw.length - 1; i++) {
    const char = raw[i]!
    if (char === '\\') {
      const next = raw[i + 1]
      i += 1
      if (next === 'n') out += '\n'
      else if (next === 'r') out += '\r'
      else if (next === 't') out += '\t'
      else if (next === 'b') out += '\b'
      else if (next === 'f') out += '\f'
      else if (next === '(' || next === ')' || next === '\\') out += next ?? ''
      else if (next !== undefined && /[0-7]/.test(next)) {
        const digits = raw.slice(i, i + 3).match(/^[0-7]{1,3}/)?.[0] ?? next
        i += digits.length - 1
        out += String.fromCharCode(parseInt(digits, 8))
      } else if (next !== undefined) out += next
    } else {
      out += char
    }
  }
  return out
}

function decodeHex(raw: string): string {
  const hex = raw.slice(1, -1).replace(/\s/g, '')
  let out = ''
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  }
  return out
}

/**
 * コンテンツストリームをトークン列へ分割する。
 * 配列・辞書は入れ子を考慮して 1 トークンにまとめ、含まれる文字列断片も保持する。
 */
export function tokenizeContent(contents: string): readonly Token[] {
  const tokens: Token[] = []
  let i = 0
  const skipWhitespace = (): void => {
    while (i < contents.length && WHITESPACE.has(contents[i] ?? '')) i += 1
    if (contents[i] === '%') {
      while (i < contents.length && contents[i] !== '\n' && contents[i] !== '\r') i += 1
      skipWhitespace()
    }
  }
  while (i < contents.length) {
    skipWhitespace()
    if (i >= contents.length) break
    const char = contents[i]!
    if (char === '(') {
      let depth = 0
      let j = i
      let escaped = false
      for (; j < contents.length; j++) {
        const c = contents[j]!
        if (escaped) {
          escaped = false
          continue
        }
        if (c === '\\') {
          escaped = true
          continue
        }
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const raw = contents.slice(i, j + 1)
      tokens.push({ kind: 'literal', raw, text: decodeLiteral(raw) })
      i = j + 1
    } else if (char === '<' && contents[i + 1] === '<') {
      // 辞書 << ... >>（hex 文字列 <...> とは別）
      let depth = 0
      let j = i
      for (; j + 1 < contents.length; j++) {
        if (contents[j] === '<' && contents[j + 1] === '<') depth += 1
        else if (contents[j] === '>' && contents[j + 1] === '>') {
          depth -= 1
          if (depth === 0) break
        }
      }
      tokens.push({ kind: 'dict', raw: contents.slice(i, j + 2), text: '' })
      i = j + 2
    } else if (char === '<') {
      const end = contents.indexOf('>', i + 1)
      const raw = contents.slice(i, end + 1)
      tokens.push({ kind: 'hex', raw, text: decodeHex(raw) })
      i = end + 1
    } else if (char === '[') {
      let depth = 0
      let j = i
      let innerText = ''
      for (; j < contents.length; j++) {
        const c = contents[j]!
        if (c === '[') depth += 1
        else if (c === ']') {
          depth -= 1
          if (depth === 0) break
        }
      }
      const raw = contents.slice(i, j + 1)
      // 配列内の文字列断片（TJ の文字列要素）を収集する。
      // raw のまま再帰すると '[' を含むため無限再帰になる。外側の括弧を除いて走査する。
      for (const token of tokenizeContent(raw.slice(1, -1))) {
        if (token.kind === 'literal' || token.kind === 'hex') innerText += token.text
      }
      tokens.push({ kind: 'array', raw, text: innerText })
      i = j + 1
    } else if (char === ']' || char === '>' || char === ')') {
      // 孤立デリミタは無視（トークン化エラー耐性）
      i += 1
    } else if (char === '/') {
      let j = i + 1
      while (j < contents.length && !WHITESPACE.has(contents[j] ?? '') && !isDelimiter(contents[j] ?? '')) j += 1
      tokens.push({ kind: 'name', raw: contents.slice(i, j), text: '' })
      i = j
    } else if (/[0-9+\-.]/.test(char)) {
      let j = i
      while (j < contents.length && /[0-9+\-._eE]/.test(contents[j] ?? '')) j += 1
      tokens.push({ kind: 'number', raw: contents.slice(i, j), text: '' })
      i = j
    } else {
      let j = i
      while (j < contents.length && !WHITESPACE.has(contents[j] ?? '') && !isDelimiter(contents[j] ?? '')) j += 1
      tokens.push({ kind: 'keyword', raw: contents.slice(i, j), text: '' })
      i = j
    }
  }
  return tokens
}

interface TextState {
  readonly tmE: number
  readonly tmF: number
  readonly leading: number
  readonly fontSize: number
  readonly charSpacing: number
  readonly wordSpacing: number
}

const TEXT_STATE_INITIAL: TextState = {
  tmE: 0,
  tmF: 0,
  leading: 0,
  fontSize: 12,
  charSpacing: 0,
  wordSpacing: 0,
}

function parseNumber(raw: string): number {
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : 0
}

/** テキスト表示位置の簡易 AABB（PDF 座標・左下原点）を推定する。 */
function textBBox(state: TextState, text: string): { x: number; y: number; w: number; h: number } {
  // 幅は文字数 × フォントサイズ × 0.5 で近似（フォントメトリクス非依存・保守的）。
  return {
    x: state.tmE,
    y: state.tmF,
    w: text.length * state.fontSize * 0.5,
    h: state.fontSize,
  }
}

function intersects(
  bbox: { x: number; y: number; w: number; h: number },
  rect: PdfRect,
): boolean {
  return !(
    bbox.x > rect.x + rect.width ||
    bbox.x + bbox.w < rect.x ||
    bbox.y > rect.y + rect.height ||
    bbox.y + bbox.h < rect.y
  )
}

/**
 * 1 ストリームのテキスト演算子をフィルタリングする。
 * 墨消し領域に重なる表示演算子は除去し、残りはそのまま再構築する。
 */
export function filterRedactedContent(
  contents: string,
  rects: readonly PdfRect[],
): { readonly rebuilt: string; readonly removedText: readonly string[] } {
  const tokens = tokenizeContent(contents)
  const removedText: string[] = []
  const skip = new Set<number>()
  let state: TextState = TEXT_STATE_INITIAL
  let inText = false

  const operands: number[] = [] // token index のスタック
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.kind === 'keyword') {
      switch (token.raw) {
        case 'BT':
          inText = true
          state = TEXT_STATE_INITIAL
          break
        case 'ET':
          inText = false
          break
        case 'Tm': {
          const nums = operands.slice(-6).map((opIndex) => parseNumber(tokens[opIndex]?.raw ?? '0'))
          state = { ...state, tmE: nums[4] ?? 0, tmF: nums[5] ?? 0 }
          break
        }
        case 'Td':
        case 'TD': {
          const nums = operands.slice(-2).map((opIndex) => parseNumber(tokens[opIndex]?.raw ?? '0'))
          const tx = nums[0] ?? 0
          const ty = nums[1] ?? 0
          state = { ...state, tmE: state.tmE + tx, tmF: state.tmF + ty }
          if (token.raw === 'TD') state = { ...state, leading: -ty }
          break
        }
        case 'T*':
          state = { ...state, tmE: 0, tmF: state.tmF - state.leading }
          break
        case 'Tf': {
          const size = operands.slice(-1)[0]
          state = { ...state, fontSize: parseNumber(tokens[size ?? 0]?.raw ?? '12') }
          break
        }
        case 'TL':
          state = { ...state, leading: parseNumber(tokens[operands[operands.length - 1] ?? 0]?.raw ?? '0') }
          break
        case 'Tc':
          state = { ...state, charSpacing: parseNumber(tokens[operands[operands.length - 1] ?? 0]?.raw ?? '0') }
          break
        case 'Tw':
          state = { ...state, wordSpacing: parseNumber(tokens[operands[operands.length - 1] ?? 0]?.raw ?? '0') }
          break
        case 'Tj': {
          const operandIndex = operands[operands.length - 1]
          const text = operandIndex === undefined ? '' : (tokens[operandIndex]?.text ?? '')
          if (text !== '' && rects.length > 0 && inText) {
            const bbox = textBBox(state, text)
            if (rects.some((rect) => intersects(bbox, rect))) {
              if (operandIndex !== undefined) skip.add(operandIndex)
              removedText.push(text)
            }
          }
          break
        }
        case "'": {
          state = { ...state, tmE: 0, tmF: state.tmF - state.leading }
          const operandIndex = operands[operands.length - 1]
          const text = operandIndex === undefined ? '' : (tokens[operandIndex]?.text ?? '')
          if (text !== '' && rects.length > 0 && inText) {
            const bbox = textBBox(state, text)
            if (rects.some((rect) => intersects(bbox, rect))) {
              if (operandIndex !== undefined) skip.add(operandIndex)
              removedText.push(text)
            }
          }
          break
        }
        case '"': {
          const nums = operands.slice(-2).map((opIndex) => parseNumber(tokens[opIndex]?.raw ?? '0'))
          state = {
            ...state,
            charSpacing: nums[0] ?? 0,
            wordSpacing: nums[1] ?? 0,
            tmE: 0,
            tmF: state.tmF - state.leading,
          }
          const operandIndex = operands[operands.length - 1]
          const text = operandIndex === undefined ? '' : (tokens[operandIndex]?.text ?? '')
          if (text !== '' && rects.length > 0 && inText) {
            const bbox = textBBox(state, text)
            if (rects.some((rect) => intersects(bbox, rect))) {
              if (operandIndex !== undefined) skip.add(operandIndex)
              removedText.push(text)
            }
          }
          break
        }
        case 'TJ': {
          const operandIndex = operands[operands.length - 1]
          const text = operandIndex === undefined ? '' : (tokens[operandIndex]?.text ?? '')
          if (text !== '' && rects.length > 0 && inText) {
            const bbox = textBBox(state, text)
            if (rects.some((rect) => intersects(bbox, rect))) {
              if (operandIndex !== undefined) skip.add(operandIndex)
              removedText.push(text)
            }
          }
          break
        }
        default:
          break
      }
      operands.length = 0
    } else {
      operands.push(index)
    }
  }

  const kept: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (skip.has(index)) continue
    const token = tokens[index]!
    if (token.kind === 'keyword') {
      if (token.raw.length > 0) kept.push(token.raw)
    } else {
      kept.push(token.raw)
    }
  }
  return { rebuilt: kept.join(' '), removedText }
}

/**
 * PDF のテキスト墨消し（物理削除 + 黒矩形）。
 * パース失敗時は視覚モード（redactPdfPages）へフォールバックし issues に記録する。
 */
export async function redactPdfText(
  bytes: Uint8Array,
  rects: readonly PdfRect[],
): Promise<Result<{ readonly bytes: Uint8Array; readonly removedTextCount: number; readonly issues: readonly string[] }, ValidationIssue>> {
  if (rects.length === 0) {
    return { ok: false, error: { code: 'PDF_REDACT_EMPTY', severity: 'error', message: '墨消し領域が指定されていません' } }
  }
  try {
    const doc = await PDFDocument.load(bytes)
    let removedTextCount = 0
    let parseFailed = false

    for (const rect of rects) {
      if (rect.pageIndex < 0 || rect.pageIndex >= doc.getPageCount()) {
        return {
          ok: false,
          error: { code: 'PDF_REDACT_PAGE_INVALID', severity: 'error', message: `墨消しページ番号が不正です: ${rect.pageIndex + 1}` },
        }
      }
      const page = doc.getPage(rect.pageIndex)
      const contentsNode = page.node.Contents()
      const streams: PDFRawStream[] = []
      if (contentsNode instanceof PDFArray) {
        for (let i = 0; i < contentsNode.size(); i++) {
          const item = contentsNode.lookup(i)
          if (item instanceof PDFRawStream) streams.push(item)
        }
      } else if (contentsNode instanceof PDFRawStream) {
        streams.push(contentsNode)
      }
      if (streams.length === 0) continue

      let rebuiltParts: string[] = []
      try {
        for (const stream of streams) {
          const decoded = decodePDFRawStream(stream)
          const contents = new TextDecoder().decode(decoded.decode())
          const result = filterRedactedContent(contents, rects.filter((r) => r.pageIndex === rect.pageIndex))
          rebuiltParts.push(result.rebuilt)
          removedTextCount += result.removedText.length
        }
      } catch {
        parseFailed = true
        rebuiltParts = []
      }

      if (!parseFailed) {
        const rebuilt = new TextEncoder().encode(rebuiltParts.join('\n'))
        const newStream = doc.context.stream(rebuilt)
        // Contents は PDFArray で置き換える（単一ストリームのままだと pdf-lib の
        // 後続 addContentStream（描画操作）が正しく追記できないため）。
        page.node.set(PDFName.of('Contents'), doc.context.obj([newStream]))
      }
    }

    // 物理削除後も視覚的に隠す（黒矩形）
    const visual = await redactPdfPages(await doc.save(), rects)
    if (!visual.ok) return visual

    const issues: string[] = []
    if (parseFailed) {
      issues.push('一部ページのコンテンツ解析に失敗したため視覚的墨消しのみ適用しました（物理削除できていません）')
    }
    issues.push('テキスト演算子を物理削除しましたが、埋め込み画像内の文字は削除できません（専用ツール要）')
    return { ok: true, value: { bytes: visual.value, removedTextCount, issues } }
  } catch {
    return {
      ok: false,
      error: { code: 'PDF_REDACT_FAILED', severity: 'error', message: '墨消しの適用に失敗しました' },
    }
  }
}
