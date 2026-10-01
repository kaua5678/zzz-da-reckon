/**
 * arena-D 第 366 轮：boss-presets.json 唯一加载入口 `catalog#loadBossPresets`（原 9 处各自 fetch）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'

const bossCalls = () => vi.mocked(fetch).mock.calls.filter(c => String(c[0]).includes('/static/boss-presets.json')).length

describe('catalog#loadBossPresets', () => {
  it('并发调用只请求一次，之后命中缓存、各调用方拿到同一份', async () => {
    newPinia()
    mockStaticFetch()
    const store = useCatalogStore()
    const [a, b] = await Promise.all([store.loadBossPresets(), store.loadBossPresets()])
    const c = await store.loadBossPresets()
    expect(bossCalls()).toBe(1)
    expect(a).toBe(b)
    expect(c).toBe(a)
    expect(store.bossPresetFile).toBe(a)
    expect(a.bosses.length).toBeGreaterThan(0)
  })

  it('失败抛错且不缓存失败：下一次调用重新请求', async () => {
    newPinia()
    mockStaticFetch()
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
    const store = useCatalogStore()
    await expect(store.loadBossPresets()).rejects.toThrow('HTTP 503')
    expect(store.bossPresetFile).toBeNull()
    expect((await store.loadBossPresets()).bosses.length).toBeGreaterThan(0)
    expect(bossCalls()).toBe(2)
  })

  it('源码锁：boss-presets.json 只由 stores/catalog.ts 请求', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'test') walk(p); continue }
        if (!/\.(ts|vue)$/.test(f)) continue
        if (/fetch\(\s*['"`]\/static\/boss-presets\.json/.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['stores/catalog.ts'])
  })
})
