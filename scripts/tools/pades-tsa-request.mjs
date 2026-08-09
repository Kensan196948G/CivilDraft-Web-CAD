#!/usr/bin/env node
/* global console, process */
/**
 * PAdES タイムスタンプ要求 CLI（RFC 3161）。
 *
 * 使い方:
 *   node scripts/tools/pades-tsa-request.mjs --file <input> --tsa <url> --out <output.tsr>
 *   node scripts/tools/pades-tsa-request.mjs --help
 *
 * 入力ファイルの SHA-256 ダイジェストを MessageImprint とする TimeStampReq を生成し、
 * TSA へ送信して TSR（DER）を保存する。TSA のポリシー・証明書チェーンは別途人間確認。
 */
import { createHash, readFileSync, writeFileSync } from 'node:fs'
import { buildTsaRequest, requestTsaToken } from './tsa-request.mjs'

function usage() {
  console.log(`usage:
  pades-tsa-request.mjs --file <input> --tsa <url> [--out <output.tsr>] [--nonce <hex>] [--timeout-ms <ms>]
  pades-tsa-request.mjs --help`)
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key === '--help' || key === '-h') {
      args.help = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) {
      throw new Error(`引数 ${key} に値が必要です`)
    }
    args[key.slice(2)] = value
    index += 1
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }
  if (!args.file || !args.tsa) {
    usage()
    process.exit(2)
  }

  const input = readFileSync(args.file)
  const digest = new Uint8Array(createHash('sha256').update(input).digest())
  const request = buildTsaRequest(digest, {
    certReq: true,
    ...(args.nonce !== undefined ? { nonceHex: args.nonce } : {}),
  })
  const result = await requestTsaToken(args.tsa, request, {
    timeoutMs: args.timeoutMs !== undefined ? Number(args.timeoutMs) : 15000,
  })
  if (result.status < 200 || result.status >= 300) {
    console.error(`TSA エラー: HTTP ${result.status}（content-type: ${result.contentType}）`)
    process.exit(1)
  }
  const out = args.out ?? 'timestamp.tsr'
  writeFileSync(out, result.bytes)
  console.log(`TSR を保存しました: ${out}（${result.bytes.length} バイト・HTTP ${result.status}）`)
  console.log('注意: TSA ポリシー・証明書チェーン・トークン検証は人間確認が必要です。')
}

main().catch((error) => {
  console.error(`[pades-tsa-request] ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
