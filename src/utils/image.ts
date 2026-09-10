/**
 * 图片URL工具函数（用户 2026-09-10 裁决：「选占用性能较低的显示方法」）。
 *
 * 数据现状（2026-09-10 实测 `public/static/catalog.json`）：带 `images` 的条目里
 *  · `icon`/`portrait` 是**本地相对路径**（`/assets/...`）—— **103 条，其中只有 3 条文件真的在库**
 *    （`public/assets/bosses/*.webp`）；
 *  · `source` 有时是**可直接用的图片URL**（wiki CDN，71 条），有时只是 wiki 页面地址（29 条）。
 *
 * 性能口径（本次改动的**唯一**目标）：
 *   ① **本地存在 → 直接用本地**（0 网络请求，最便宜；原来是「source 优先」，有网就白付一次下载）；
 *   ② 本地没有、但有远程直图 → 用远程（这是唯一能看到图的路径）；
 *   ③ 两边都没有 → 返回 `null`（组件渲染占位）——**不再返回那个必然 404 的本地路径**
 *      （原实现会发一次注定失败的空请求；实测页面里就有 `fanged_metal.png` / `nanoka_14158.png` 这类 404）。
 *
 * 「本地是否真的存在」由构建期常量 `__LOCAL_ASSET_URLS__`（`vite.config.ts` 现扫 `public/assets`）
 * 回答，**零运行时请求、无清单文件、不会漂移**。判据测试：`src/utils/__tests__/image.test.ts`。
 */

/** 构建期注入的本地图清单（`vite.config.ts#define`）。缺失该常量时按「本地全无」处理（安全降级）。 */
declare const __LOCAL_ASSET_URLS__: string[] | undefined

const LOCAL_ASSETS: ReadonlySet<string> = new Set(
  typeof __LOCAL_ASSET_URLS__ === 'undefined' ? [] : __LOCAL_ASSET_URLS__,
)

/** 本地图是否真的随包发布（决定是否值得发请求） */
export function localAssetExists(url?: string | null): boolean {
  return !!url && LOCAL_ASSETS.has(url)
}

/** 判断URL是否为直接图片链接 */
export function isDirectImageUrl(url: string): boolean {
  if (!url) return false
  const lower = url.toLowerCase().split('?')[0]
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')
}

/**
 * 从 catalog 数据的 images 字段获取可用的图片URL（**本地优先**，见文件头三条口径）。
 *
 * @param images catalog中的 images 对象，如 { icon: "/assets/...", source: "https://..." }
 * @returns 可用的图片URL，或 null（调用方渲染占位；**绝不返回不存在的本地路径**）
 */
export function getImageUrl(images?: { icon?: string; source?: string; portrait?: string }): string | null {
  if (!images) return null
  const local = images.icon || images.portrait || ''
  // ① 本地有文件 → 0 网络，直接用
  if (localAssetExists(local)) return local
  // ② 远程直图（wiki CDN 等）
  if (images.source && isDirectImageUrl(images.source)) return images.source
  // ③ 两者都不可用 → 不发注定 404 的空请求
  return null
}
