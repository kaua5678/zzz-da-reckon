/**
 * `getImageUrl` 判据测试（用户 2026-09-10：「选占用性能较低的显示方法」）。
 *
 * 钉住三条口径 + 一条**接线护栏**：
 *  ① **本地有文件 → 用本地**（0 网络；即使同时给了远程 `source` 也不许去下载）；
 *  ② 本地没有 + `source` 是直图 → 用远程（唯一能看到图的路径）；
 *  ③ 本地没有 + `source` 不是直图 → **`null`**（调用方渲染占位）——**绝不返回不存在的本地路径**
 *     （原实现会发一次注定 404 的空请求：实测 `fanged_metal.png` / `nanoka_14158.png`）；
 *  ④ **接线护栏**：`__LOCAL_ASSET_URLS__` 由 `vite.config.ts` 现扫 `public/assets` 注入——若接线断了，
 *     ① 会退化（本地清单为空 ⇒ 有远程的改走远程、没远程的变 null），本测试即红。
 */
import { describe, it, expect } from 'vitest'
import { getImageUrl, isDirectImageUrl, localAssetExists } from './image'

/** 仓库里真实存在的本地图（`public/assets/bosses/*.webp`，见 vite.config.ts 扫描） */
const EXISTING_LOCAL = '/assets/bosses/notorious-pompey.webp'
/** catalog 里引用、但 `public/` 里并不存在的路径（2026-09-10 实测 103 条里 100 条如此） */
const MISSING_LOCAL = '/assets/w-engines/fanged_metal.png'
const REMOTE_DIRECT = 'https://cdn.wikiwiki.jp/to/w/zenless/画像/::ref/xxx.webp?rev=abc&t=20260101'
const REMOTE_PAGE = 'https://wikiwiki.jp/zenless/%E3%82%A8%E3%83%8D%E3%83%9F%E3%83%BC'

describe('utils/image：图片来源选择（本地优先 + 不发注定 404 的请求）', () => {
  it('接线护栏：构建期本地清单非空，且能认出真实存在的本地图', () => {
    expect(localAssetExists(EXISTING_LOCAL), 'vite.config.ts 的 __LOCAL_ASSET_URLS__ 注入断了').toBe(true)
    expect(localAssetExists(MISSING_LOCAL)).toBe(false)
  })

  it('① 本地有文件 → 用本地（即使有远程直图，也不去下载）', () => {
    expect(getImageUrl({ icon: EXISTING_LOCAL, source: REMOTE_DIRECT })).toBe(EXISTING_LOCAL)
  })

  it('② 本地没有 + source 是直图 → 用远程', () => {
    expect(getImageUrl({ icon: MISSING_LOCAL, source: REMOTE_DIRECT })).toBe(REMOTE_DIRECT)
  })

  it('③ 本地没有 + source 不是直图 → null（不返回注定 404 的本地路径）', () => {
    expect(getImageUrl({ icon: MISSING_LOCAL, source: REMOTE_PAGE })).toBeNull()
    expect(getImageUrl({ icon: MISSING_LOCAL })).toBeNull()
    expect(getImageUrl({})).toBeNull()
    expect(getImageUrl()).toBeNull()
  })

  it('portrait 与 icon 同等对待（本地存在才用）', () => {
    expect(getImageUrl({ portrait: EXISTING_LOCAL })).toBe(EXISTING_LOCAL)
    expect(getImageUrl({ portrait: MISSING_LOCAL, source: REMOTE_PAGE })).toBeNull()
  })

  it('isDirectImageUrl：只认带图片扩展名的直链（去 query）', () => {
    expect(isDirectImageUrl(REMOTE_DIRECT)).toBe(true)
    expect(isDirectImageUrl('/assets/a/b.PNG')).toBe(true)
    expect(isDirectImageUrl(REMOTE_PAGE)).toBe(false)
    expect(isDirectImageUrl('')).toBe(false)
  })
})
