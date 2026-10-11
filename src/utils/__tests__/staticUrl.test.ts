/**
 * `withBase` 判据（子路径部署的唯一拼接点，2026-10-11）。
 *
 * 背景：本仓库原先写死根路径（`fetch('/static/...')`），只有部署在域名根路径才成立；
 * GitHub Pages 项目站是 `https://<user>.github.io/<repo>/` 的**子路径**，写死的路径会 404。
 * 见 `src/utils/staticUrl.ts` 头注释与 `vite.config.ts#deployBase`。
 *
 * ⚠ 本文件在 vitest 下 `BASE_URL === '/'`（MODE=test，无 base 配置），所以
 * ①「根路径部署是恒等变换」可以直接断言；②「子路径前缀」用模块级 mock 覆盖。
 */
import { describe, it, expect, vi } from 'vitest'

describe('withBase（根路径部署 = 恒等变换，现有行为不变）', () => {
  it('BASE_URL 在测试环境为 "/"，且拼接后与输入逐字相同', async () => {
    const { withBase } = await import('@/utils/staticUrl')
    expect(withBase('/static/catalog.json')).toBe('/static/catalog.json')
    expect(withBase('/assets/bosses/notorious-pompey.webp')).toBe('/assets/bosses/notorious-pompey.webp')
  })

  it('绝对 URL 原样放行（远程直图不该被拼前缀）', async () => {
    const { withBase } = await import('@/utils/staticUrl')
    expect(withBase('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(withBase('http://example.com/a.png')).toBe('http://example.com/a.png')
    expect(withBase('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(withBase('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png')
  })

  it('空串原样返回（调用方无需先判空）', async () => {
    const { withBase } = await import('@/utils/staticUrl')
    expect(withBase('')).toBe('')
  })
})

describe('withBase（子路径部署：前缀正确拼接）', () => {
  /** 用 resetModules + stub BASE_URL 模拟「构建时配了 base」的运行时。 */
  async function loadWithBase(base: string) {
    vi.resetModules()
    vi.stubEnv('BASE_URL', base)
    const mod = await import('@/utils/staticUrl')
    return mod
  }

  it('base 带尾斜杠时，路径不以双斜杠开头', async () => {
    const { withBase } = await loadWithBase('/zzz-da-reckon/')
    expect(withBase('/static/catalog.json')).toBe('/zzz-da-reckon/static/catalog.json')
    expect(withBase('/assets/bosses/notorious-pompey.webp')).toBe('/zzz-da-reckon/assets/bosses/notorious-pompey.webp')
  })

  it('base 缺尾斜杠时自动补齐（不产生 /repo static 这类断链）', async () => {
    const { withBase } = await loadWithBase('/zzz-da-reckon')
    expect(withBase('/static/catalog.json')).toBe('/zzz-da-reckon/static/catalog.json')
  })

  it('base 缺前导斜杠时自动补齐（VITE_BASE=repo/ 这类误写不致断链）', async () => {
    const { withBase } = await loadWithBase('zzz-da-reckon/')
    expect(withBase('/static/catalog.json')).toBe('/zzz-da-reckon/static/catalog.json')
  })

  it('子路径下绝对 URL 仍原样放行', async () => {
    const { withBase } = await loadWithBase('/zzz-da-reckon/')
    expect(withBase('https://wiki.example.com/x.webp')).toBe('https://wiki.example.com/x.webp')
  })

  it('还原模块状态，避免污染同进程其它用例', () => {
    vi.unstubAllEnvs()
    vi.resetModules()
    expect(true).toBe(true)
  })
})
