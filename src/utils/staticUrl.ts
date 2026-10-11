/**
 * 静态资源 URL 前缀（子路径部署的唯一拼接点）。
 *
 * 为什么需要（2026-10-11，用户裁决「走 GitHub Pages 项目站」）：
 * 本仓库原先所有静态数据请求都写死根路径（`fetch('/static/catalog.json')`），
 * 这只在**域名根路径**部署时成立。GitHub Pages 项目站的地址是
 * `https://<user>.github.io/<repo>/` —— **子路径**，写死的 `/static/...` 会打到
 * `https://<user>.github.io/static/...` ⇒ 必然 404（实测：模拟子路径部署时
 * `/assets/index-*.js` 与 `/static/catalog.json` 全部 404）。
 *
 * 口径：**一切随包发布的静态资源引用都要经 `withBase()`**，不得再写裸的 `/xxx` 字面量。
 * 前缀来自 Vite 的 `import.meta.env.BASE_URL`（由 `vite.config.ts` 的 `base` 决定，
 * 构建期替换成字面量、零运行时开销）：
 *   · 默认 `base: '/'` ⇒ `BASE_URL === '/'` ⇒ `withBase('/static/x.json') === '/static/x.json'`
 *     （**现有部署行为逐位不变**，本地 dev / 测试 / CF / EdgeOne 均不受影响）
 *   · 部署到子路径时 `VITE_BASE=/<repo>/ npm run build` ⇒ 自动带上前缀
 *
 * ⚠ `import.meta.env.BASE_URL` 在 vitest 里恒为 `'/'`（MODE=test，无 base 配置），
 * 所以既有测试里写死的 `/static/...` 断言不受本改动影响。
 *
 * 判据：`src/utils/__tests__/staticUrl.test.ts`（含非根 base 用例）。
 */

/** 规范化后的 base 前缀：始终以 `/` 开头且以 `/` 结尾（'' 与 '/' 都归一为 '/'）。 */
const BASE: string = (() => {
  const raw = import.meta.env.BASE_URL || '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
})()

// @fact ui:deploy/静态资源前缀 口径: 随包发布的静态资源引用一律经 withBase() 拼 import.meta.env.BASE_URL；默认 base='/' 时是恒等变换（现有根路径部署行为不变），子路径部署（GitHub Pages 项目站）用 VITE_BASE=/<repo>/ 构建 | 据 用户@2026-10-11 | 验 src/utils/__tests__/staticUrl.test.ts | 锚 src/utils/staticUrl.ts#withBase + vite.config.ts#deployBase | 信 确认

/**
 * 把「以 `/` 开头的站点绝对路径」拼上部署 base 前缀。
 *
 * @param path 以 `/` 开头的站点内路径，如 `/static/catalog.json`
 * @returns 带 base 前缀的可直接请求路径
 *
 * 已是绝对 URL（`http(s)://`、`data:`、`//cdn...`）的输入原样返回——调用方无需先判断，
 * 这样 `getImageUrl` 这类「本地路径 / 远程直图」二选一的场景可以统一过一道。
 */
export function withBase(path: string): string {
  if (!path) return path
  // 绝对 URL（含协议相对 `//host`）不属于站点内路径，不拼前缀
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path
  return `${BASE}${path.replace(/^\/+/, '')}`
}
