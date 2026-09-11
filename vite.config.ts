import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readdirSync } from 'fs'

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

export default defineConfig({
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
    // 重负载集成用例（全库 pass / 权重分配搜索 / 难度变体）在本机满套件并发下 30~80s：
    // 默认 30s 会让它们随机超时（测的是机器负载，不是断言）。**真正的性能判据**已改为
    // 「同进程参照量归一化」的比值（见 `charIncrementInt.test.ts`），这里只放开基础设施超时。
    testTimeout: 180_000,
  },
})
