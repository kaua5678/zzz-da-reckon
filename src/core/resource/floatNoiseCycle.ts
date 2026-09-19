import type { IterationState } from '@/types/resource'

/**
 * 内层不动点「浮点噪声环」容差：相对 1e-9（绝对地板同值）。
 *
 * 为什么需要它（R37-J5 ④ 暴露，2026-09-19）：`runInnerLoop` 判稳是**严格相等**（见其 `@fact engine:判稳含平A时间`），
 * 环检测按全状态 JSON 签名精确重复。当模块把一条**连续**反馈边放进内层（叶瞬光估计/行单源后
 * 「平A→局外剑势→明心境轮数→必要时间→平A」，ρ≈0.17 的几何收缩），浮点复合映射可以**没有精确不动点**：
 * 实测 1431/1341/1031 第 14 轮起 9 位小数已不动，第 21 轮起 bat 在 `25.94937036135673 ↔ …728`（1 ulp）之间
 * 精确交替、nec 差 2 ulp——签名重复触发环检测，但按旧口径它是「环」⇒ `clean=false` ⇒ `converged=false`，
 * 停点还是那个成员、数值一位不差，只有收敛标志在撒谎。
 *
 * 口径：环内全部成员逐字段在本容差内（数值相对 1e-9、非数值严格相等、结构一致）= 浮点噪声环 = **已收敛**，
 * 规范停点仍取 JSON 字典序最小成员（与种子无关，冷/热逐位一致的性质不变）。真整数环（丽娜 ex 6↔7、
 * stun 3↔4 这类 Δ≥1）任一字段就超容差 ⇒ 仍按原样报 clean=false。
 * 容差 1e-9 比任何可观测量（留白 toFixed(3)、伤害取整）低 6 个数量级、比 ulp 噪声（~1e-16 相对）高 6 个数量级；
 * 判稳本身不改成 ε 判据——ε 判稳会让不同种子在到达同一浮点不动点**之前**各自停下，破坏 1051/1531 队
 * 「零种子 vs 高种子逐位同一收敛态」（seedInvariance 逐位档）。
 */
const FLOAT_NOISE_CYCLE_TOLERANCE = 1e-9

function nearlyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) return Object.is(a, b)
    return Math.abs(a - b) <= FLOAT_NOISE_CYCLE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => nearlyEqual(v, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    const ka = Object.keys(ra)
    return ka.length === Object.keys(rb).length && ka.every(k => k in rb && nearlyEqual(ra[k], rb[k]))
  }
  return a === b
}

/**
 * 极限环成员（每个成员 = 全队 `IterationState[]` 快照）是否只差浮点噪声（全部成员与首成员逐槽逐字段在容差内）。
 * 空环 / 单成员环按「是」处理（单成员签名重复只可能是精确不动点，判稳会先一步 clean，这里只是兜底）。
 */
export function isFloatNoiseCycle(members: readonly (readonly IterationState[])[]): boolean {
  for (let i = 1; i < members.length; i++) {
    if (!nearlyEqual(members[0], members[i])) return false
  }
  return true
}
