/**
 * 静态大文件唯一加载入口（catalog store）：
 * - `loadBossPresets`（boss-presets.json，arena-D 第 366 轮，原 9 处各自 fetch）；
 * - `loadRunArchive`（run-archive.json 3 MB，第 367 轮，原 3 处各自 fetch + 兑现价值图模块级缓存）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'

type Store = ReturnType<typeof useCatalogStore>
const CASES = [
  { file: 'boss-presets.json', load: (s: Store) => s.loadBossPresets(), cached: (s: Store) => s.bossPresetFile, nonEmpty: (d: { bosses: unknown[] }) => d.bosses.length },
  { file: 'run-archive.json', load: (s: Store) => s.loadRunArchive(), cached: (s: Store) => s.runArchiveFile, nonEmpty: (d: { runs: unknown[] }) => d.runs.length },
] as const
const calls = (file: string) => vi.mocked(fetch).mock.calls.filter(c => String(c[0]).includes(`/static/${file}`)).length

describe.each(CASES)('catalog 加载 $file', ({ file, load, cached, nonEmpty }) => {
  it('并发调用只请求一次，之后命中缓存、各调用方拿到同一份', async () => {
    newPinia()
    mockStaticFetch()
    const store = useCatalogStore()
    const [a, b] = await Promise.all([load(store), load(store)])
    const c = await load(store)
    expect(calls(file)).toBe(1)
    expect(a).toBe(b)
    expect(c).toBe(a)
    expect(cached(store)).toBe(a)
    expect(nonEmpty(a as never)).toBeGreaterThan(0)
  }, 60000)

  it('失败抛错且不缓存失败：下一次调用重新请求', async () => {
    newPinia()
    mockStaticFetch()
    vi.mocked(fetch).mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
    const store = useCatalogStore()
    await expect(load(store)).rejects.toThrow('HTTP 503')
    expect(cached(store)).toBeNull()
    expect(nonEmpty((await load(store)) as never)).toBeGreaterThan(0)
    expect(calls(file)).toBe(2)
  }, 60000)

  it('源码锁：只由 stores/catalog.ts 请求', () => {
    const root = join(__dirname, '..', '..')
    const re = new RegExp(`fetch\\(\\s*['"\`]/static/${file.replace('.', '\\.')}`)
    const hits: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'test') walk(p); continue }
        if (!/\.(ts|vue)$/.test(f)) continue
        if (re.test(readFileSync(p, 'utf8'))) hits.push(relative(root, p).split('\\').join('/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['stores/catalog.ts'])
  })
})
