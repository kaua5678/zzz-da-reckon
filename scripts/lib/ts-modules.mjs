/**
 * 从 Node 脚本载入 `src/**` 的 TS 模块（复用单一事实源，规则 11）。
 *
 * ## 为什么需要
 *
 * 数据管道脚本（`import-zzz-run-archive.mjs` / `gen-auto-presets.mjs`）需要**金数口径**
 * （`src/composables/limitedGold.ts#runLimitedGold`）。历史上 `gen-auto-presets.mjs` 自己抄了一份
 * `memberGold`（另一套 `STANDARD_S_AGENT_IDS`、且把音擎精炼无条件计金）——与 `limitedGold.ts`
 * **口径分叉**：同一份归档数据在两处算出不同的金数，而两边都不报错。
 * 按规则 11「跨文件常量只从单一来源引用」，脚本必须消费同一份实现，不能复制。
 *
 * ## 做法
 *
 * 用 **vite 自己的 `ssrLoadModule`**（同 `scripts/dump-mechanic-registry.mjs` 的既有先例）：
 * `src/**` 里 `@/` 别名、`import.meta.glob`、`.ts` 转译全部由 vite 原生处理，脚本侧零垫片。
 * 服务在进程内**复用一个实例**（每次 `createServer` ~1s，多个模块共用一次启动），
 * 用完必须 `closeTsModules()`，否则 watch/hmr 句柄会让进程不退出。
 *
 * ⚠ 本模块**不是** `dump-mechanic-registry.mjs` 的重构：那个脚本的输出被 `check-guards` 判据 4
 * 消费（真值来源），它的 vite 启动参数与其头注释里的口径说明绑定，改动风险与收益不成比例。
 * 本模块只服务数据管道。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @type {Promise<import('vite').ViteDevServer> | null} */
let serverPromise = null

/** 惰性起一个 middlewareMode 的 vite 服务（watch/hmr 全关，只做一次性 ssrLoadModule）。 */
async function getServer(root) {
  if (!serverPromise) {
    serverPromise = (async () => {
      const viteEntry = join(root, 'node_modules/vite/dist/node/index.js')
      if (!existsSync(viteEntry)) {
        throw new Error(`vite 未安装（找的是 ${viteEntry}）⇒ 无法载入 src/ 的 TS 模块`)
      }
      const { createServer } = await import(pathToFileURL(viteEntry).href)
      return createServer({
        root,
        configFile: existsSync(join(root, 'vite.config.ts')) ? join(root, 'vite.config.ts') : undefined,
        server: { middlewareMode: true, watch: null, hmr: false },
        appType: 'custom',
        logLevel: 'silent',
        optimizeDeps: { noDiscovery: true, include: [] },
      })
    })()
  }
  return serverPromise
}

/**
 * 载入一个 `src/**` 的 TS 模块（路径以 `/src/...` 给出，vite 根为仓库根）。
 * @param {string} root 仓库根绝对路径
 * @param {string} modulePath 形如 `/src/composables/limitedGold.ts`
 */
export async function loadTsModule(root, modulePath) {
  const server = await getServer(root)
  return server.ssrLoadModule(modulePath)
}

/** 关闭进程内复用的 vite 服务（脚本收尾必须调用，否则进程不退出）。 */
export async function closeTsModules() {
  if (!serverPromise) return
  const p = serverPromise
  serverPromise = null
  const server = await p
  await server.close()
}
