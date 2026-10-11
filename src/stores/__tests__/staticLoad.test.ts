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
    // 2026-10-11 换尺：fetch 的实参改为 `withBase('/static/...')`（子路径部署，见 utils/staticUrl.ts）。
    // 旧正则只认 `fetch('/static/...` 裸形态 ⇒ 匹配 0 处、hits=[]，**判据假绿**（不是"没人请求"）。
    // 这里放行可选的 withBase( 包裹，两种形态都咬得住：既覆盖现状，也仍能抓住
    // 别处新写的裸 fetch —— 别把可选组删掉，否则判据又会瞎。
    const re = new RegExp(`fetch\\(\\s*(?:withBase\\()?\\s*['"\`]/static/${file.replace('.', '\\.')}`)
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

  it('源码锁自证：换尺后的正则仍咬得住裸 fetch 形态（防判据瞎掉）', () => {
    // 负控：如果正则被改成只认 withBase 包裹，裸形态就会漏 ⇒ 本用例红。
    const re = new RegExp(`fetch\\(\\s*(?:withBase\\()?\\s*['"\`]/static/catalog\\.json`)
    expect(re.test(`const res = await fetch('/static/catalog.json')`)).toBe(true)
    expect(re.test(`const res = await fetch(withBase('/static/catalog.json'))`)).toBe(true)
    // 正控：不该咬到别的路径
    expect(re.test(`const res = await fetch(withBase('/static/other.json'))`)).toBe(false)
  })
})
