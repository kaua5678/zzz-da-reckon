/**
 * 出网取 JSON 的统一入口（数据管线脚本用）。
 *
 * 为什么要有它：本机存在「node 的 fetch 出网被拦（ETIMEDOUT / ENETUNREACH）、curl 正常」的
 * 环境（沙箱只放行 curl；实测 node fetch example.com 也 ETIMEDOUT，curl 200）。
 * 数据管线是本地工具，不能因为运行时限制就整条跑不动 → node fetch 优先，失败回退 curl。
 *
 * 用法：const data = await fetchJson(url)  // 失败抛最后一个错误（不静默返回空）
 */
import { execFileSync } from 'node:child_process'
import { setDefaultResultOrder } from 'node:dns'

// IPv6 不可达时 undici 会只试 AAAA 直接 ENETUNREACH → 显式优先 IPv4
setDefaultResultOrder('ipv4first')

export async function fetchJson(url, { timeoutMs = 30000, retries = 2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
      return await res.json()
    } catch (e) {
      lastErr = e
    }
    try {
      const out = execFileSync('curl', ['-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      return JSON.parse(out)
    } catch (e) {
      lastErr = e
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
  }
  throw lastErr
}
