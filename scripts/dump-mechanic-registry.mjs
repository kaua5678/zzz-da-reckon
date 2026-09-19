/**
 * 运行时机制注册表 dump（判据 4 的**真值来源**；2026-09-20 round 49 架构裁决的落地）。
 *
 * ## 为什么需要它（R47-J2 / R48 分诊的收口）
 *
 * 判据 4「滑块生效测试」原来的扫描面是 `src/mechanics/agents/*.ts` 里的
 * `settings: [ … ]` **块起始正则**。实测（R48 `evidence/reconcile.mjs` + 本任复算）：
 *
 * | 面 | 模块 | id |
 * |---|---|---|
 * | 运行时注册表（真值） | 55 | **180** |
 * | 块起始正则（现状扫描面） | 35 | 84 |
 * | **漏扫** | — | **96** |
 *
 * 漏扫有 5 种声明形态，其中 3 种**正则方向收不全**：
 *   A `settings: [ … ]` 对象属性内联（唯一认得，84 id）
 *   B `const settings: T[] = [` + `settings,` 简写（R47 已发现）
 *   C `settings: <identifier>,` 引用外部变量（跨变量解析）
 *   D `<mod>.settings = [ … ]` 注册后挂载（跨语句追踪）
 *   E `specs/agents/*.json` 的 `adjustable`（**id 根本不在 `.ts` 里**，经
 *     `registry.ts` 的 spec 合并注入）
 * ⇒ 正则是**代理**，`getRegisteredMechanicSettings()` 才是真值：它同时喂
 * `resolveMechanicSettings()` → `AgentPanelInput.settings` 与资源利用率页的
 * `v-for` 渲染面 = 「用户能拖的滑块」的唯一权威定义。
 *
 * ## 为什么是**独立进程** + stdout JSON（而不是 in-process `import('vite')`）
 *
 * 判据 4 跑在 `scripts/check-guards.mjs` 里，而 `runAllChecks()` 是**同步**函数、
 * 有 6 个调用点（`check-guards.mjs` 的 CLI + 两个 vitest 测试文件）。走 in-process
 * `import('vite')` 会把整条链传染成 async。故：本脚本作为**子进程**被 `execFileSync`
 * 调用，父进程侧保持同步，接口零改动。
 *
 * ⚠ **刻意不做缓存文件**：R45 实测过「改了代码却测到旧 dist」的假绿 —— 缓存会带来
 * 「dump 过期」这一整类静默失效，而每次现跑只要 ~1.3s（check-guards 全程 ~6s）。
 * 现跑 = **构造性新鲜**，不需要任何失效检测。
 *
 * ## 口径
 *
 * `MODULES` = 有 settings 的**模块数**（`getRegisteredAgentMechanics()` 过滤空声明）——
 * 与判据 4 反空洞下限 `SETTINGS_COVERAGE_MIN_MODULES` 同口径。
 * `SETTINGS` = 注册 id 总数（含重复 id 会抛错，见 `registry.ts` 的去重纪律 ⇒ 天然唯一）。
 *
 * 输出：单行 JSON（stdout 只许有它 —— 父进程按 JSON.parse 解析，多余输出即解析失败即红）。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 载入运行时注册表快照。
 *
 * 用 **vite 自己的 `ssrLoadModule`**（而不是自己搭 esbuild + `import.meta.glob` 垫片）：
 * 本仓 `src/specs/registry.ts:3` 用了 `import.meta.glob('./agents/*.json', { eager: true })`，
 * vite 原生认得；垫片是重复实现（规则 11 的反面）且会随 vite 语义漂移。
 */
export async function loadRegistrySnapshot(root) {
  const viteEntry = join(root, 'node_modules/vite/dist/node/index.js')
  if (!existsSync(viteEntry)) {
    throw new Error(`vite 未安装（找的是 ${viteEntry}）⇒ 无法 dump 运行时注册表`)
  }
  const { createServer } = await import(pathToFileURL(viteEntry).href)
  const server = await createServer({
    root,
    configFile: existsSync(join(root, 'vite.config.ts')) ? join(root, 'vite.config.ts') : undefined,
    // watch/hmr 全关：本进程只做一次性 dump，不起任何监听（否则子进程不退出）
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const mech = await server.ssrLoadModule('/src/mechanics/index.ts')
    const modules = mech.getRegisteredAgentMechanics()
      .map(m => ({ moduleId: m.id, agentIds: m.agentIds, ids: (m.settings ?? []).map(s => s.id) }))
      .filter(m => m.ids.length > 0)
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
    return {
      modules: modules.length,
      ids: modules.reduce((n, m) => n + m.ids.length, 0),
      byModule: modules,
    }
  } finally {
    await server.close()
  }
}

// ---- CLI：stdout 打一行 JSON ----
const invokedAsCli = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsCli) {
  const root = process.argv[2] || join(HERE, '..')
  try {
    const snapshot = await loadRegistrySnapshot(root)
    process.stdout.write(JSON.stringify(snapshot))
  } catch (err) {
    process.stderr.write(`dump-mechanic-registry: ${err?.stack ?? err}\n`)
    process.exit(1)
  }
}
