import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')

describe('PWA manifest / service worker', () => {
  it('manifest.webmanifest が PWA 要件を満たす', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8')) as {
      name: string
      short_name: string
      start_url: string
      display: string
      icons: readonly { src: string; sizes: string; type: string }[]
    }
    expect(manifest.name).toContain('CivilDraft')
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png')).toBe(true)
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png')).toBe(true)
  })

  it('アイコン PNG が実ファイルとして存在する', () => {
    const icon192 = readFileSync(resolve(root, 'public/icons/icon-192.png'))
    const icon512 = readFileSync(resolve(root, 'public/icons/icon-512.png'))
    expect(icon192.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(icon512.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  })

  it('service worker が登録可能な形式で存在する', () => {
    const sw = readFileSync(resolve(root, 'public/sw.js'), 'utf8')
    expect(sw).toContain('addEventListener(\'install\'')
    expect(sw).toContain('addEventListener(\'fetch\'')
    expect(sw).toContain('CACHE_NAME')
  })
})
