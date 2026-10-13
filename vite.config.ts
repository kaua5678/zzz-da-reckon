import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readdirSync } from 'fs'
import { availableParallelism, totalmem } from 'os'
import { workerCap } from './scripts/lib/worker-cap.mjs'

/**
 * vitest worker 上限（自适应；CC-424 的固定 4 → 按 CPU/内存取最优）。
 *
 * 口径、实测表（4/6/8/10/12 档墙钟与峰值 RSS）与内存模型**单一事实源** =
 * `scripts/lib/worker-cap.mjs`——抽出去是为了让测试能 import 到它
 * （`vite.config.ts` 本身**不能被测试 import**，实测 `Cannot find module`）。
 * 这里只负责把宿主实际参数喂进去：
 *
 * - CPU 用 `availableParallelism()` 而非 `cpus().length`：前者尊重 cgroup / taskset 亲和性，
 *   CI 的 4 核 runner 上 = 4（`taskset -c 0-3` 实测），与固定 4 时代行为一致。
 * - 覆盖优先级：命令行 `--maxWorkers=N` > `VITEST_MAX_WORKERS=N` > 本函数。
 */
const resolvedWorkers = workerCap(availableParallelism(), totalmem() / 1024 / 1024)

/**
 * 本地图鉴图清单（构建期扫描，注入成常量给 `utils/image.ts`）。
 *
 * 为什么需要：`catalog.json` 的 `images.icon` 有 **103 条本地路径、100 条文件并不存在**
 * （2026-09-10 实测；只有 3 张 boss 立绘 `.webp` 在库）。UI 原有两条路：远程 `source`（wiki CDN，
 * 有网络开销）或本地 `icon`（多数不存在 ⇒ **必然 404 的空请求**）。用户裁决「选占用性能较低的显示方法」
 * ⇒ 本地存在就**免费命中本地**（0 网络），本地没有就**不发那个注定 404 的请求**（回落到远程直图或占位）。
 *
 * 用 `define` 而不是生成清单文件：**不会漂移**（每次构建/测试都现扫），也没有需要维护的产物文件。
 * 禁改回「import.meta.glob('/public/...')」——Vite 不允许把 public 目录当模块导入。
 */
function localAssetUrls(dir = resolve(__dirname, 'public/assets'), base = '/assets'): string[] {
  const out: string[] = []
  const walk = (d: string, url: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(resolve(d, e.name), `${url}/${e.name}`)
      else if (/\.(png|jpe?g|webp|gif|svg)$/i.test(e.name)) out.push(`${url}/${e.name}`)
    }
  }
  try { walk(dir, base) } catch { /* 目录不存在 → 空清单（全部走远程/占位） */ }
  return out.sort()
}

/**
 * 部署 base（子路径部署用，2026-10-11）。
 *
 * 默认 `'/'` = 部署在域名根路径（本地 dev / 测试 / Cloudflare Pages / EdgeOne 都走这条，
 * **现有行为逐位不变**）。GitHub Pages 项目站的地址是 `https://<user>.github.io/<repo>/`
 * ——**子路径**，此时用 `VITE_BASE=/<repo>/ npm run build` 构建，产物内所有资源引用与
 * `import.meta.env.BASE_URL` 会自动带上前缀。
 *
 * 运行时那侧由 `src/utils/staticUrl.ts#withBase` 统一消费（`fetch('/static/...')` 已全部改为
 * `withBase('/static/...')`），所以这里只需要管住构建期前缀，不必改任何调用点。
 */
function deployBase(): string {
  const raw = process.env.VITE_BASE || '/'
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

export default defineConfig({
  base: deployBase(),
  plugins: [vue()],
  define: {
    __LOCAL_ASSET_URLS__: JSON.stringify(localAssetUrls()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia'],
          'naive-ui': ['naive-ui'],
          'icons': ['@vicons/ionicons5'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // R6 C1（2026-09-27）：core 只依赖 `@/mechanics/registry`（查询接口），不再按值 import `@/mechanics`
    // 目录入口（它 import 全部角色模块 ⇒ core → index → agents/* → core 模块环）。注册副作用
    // 由应用入口 `src/main.ts` 与这里的 setupFiles 负责——测试进程与浏览器入口看到同一张注册表。
    setupFiles: ['./src/mechanics/index.ts'],
    // 重负载集成用例（全库 pass / 权重分配搜索 / 难度变体）在本机满套件并发下 30~80s：
    // 默认 30s 会让它们随机超时（测的是机器负载，不是断言）。**真正的性能判据**是
    // 「单位工作量 ÷ 同进程机器速度标尺」的比值（见 `charIncrementInt.test.ts`；
    // 2026-10-09 口径纠正——旧的「同进程参照量归一化」实测对负载敏感且对回归反向，已废），
    // 这里只放开基础设施超时。
    testTimeout: 180_000,
    // CC-424（2026-10-03 r450）：worker 上限进配置，不再靠每个人记得加 `--maxWorkers=4`。
    // 2026-10-12 由固定 4 改为自适应（口径与实测见文件头 `workerCap` / scripts/lib/worker-cap.mjs）。
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || resolvedWorkers,
  },
})
