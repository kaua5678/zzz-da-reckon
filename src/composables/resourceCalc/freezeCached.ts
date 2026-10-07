/**
 * **缓存对象运行期只读护栏**（2026-09-24）。
 *
 * `panels` / `calcOutput` 是跨轮、跨重算、跨消费者**共享**的缓存值（computed + calcOutput LRU 记忆化）。
 * 任何下游（模块钩子、伤害池、视图）原地改它们，都会让结果依赖「谁先读过、读过几次」——
 * 橘福福冲击 +50 就是这样：transform 里 `panel.impact +=` 靠 `__applied` 标记防重入，
 * 面板页的冲击取决于资源计算有没有先跑过。这类 bug 按角色逐个打补丁永远补不完。
 *
 * 本护栏把「不许改」从约定变成机制：**测试环境**下对这两类缓存值深冻结，任何写入立刻抛
 * `TypeError: Cannot assign to read only property …`，栈直指肇事行；新角色/新字段零声明自动覆盖。
 * 生产构建里 `import.meta.env.MODE !== 'test'` ⇒ 整段被 tree-shake，零开销。
 *
 * 跳过：Vue 代理（冻结代理背后的 target 会破坏 Proxy get 不变式，实测 68 例误报）、
 * Map/Set（`Object.freeze` 挡不住 `.set()`，冻了也是假安全）。
 *
 * 类型侧的同一契约：`AgentSkillTransformInput.panel/charResult` 为 `DeepReadonly`（编译期）。
 */
import { isProxy } from 'vue'

const enabled = import.meta.env.MODE === 'test'

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  if (Object.isFrozen(value) || isProxy(value)) return
  if (value instanceof Map || value instanceof Set) return
  Object.freeze(value)
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
}

/** 测试环境下深冻结并原样返回；其余环境直接返回（生产零开销）。 */
export function freezeCached<T>(value: T): T {
  if (enabled) deepFreeze(value)
  return value
}
