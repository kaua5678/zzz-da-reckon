/**
 * S1 内层不动点 —— 自 `core/resource.ts` 迁出（CC-3，2026-09-24）。
 *
 * 职责：把单次迭代映射 `iterate`（`./helpers`）跑成不动点——判稳（强特/终结次数 + `basicAttackTime`
 * 严格相等）→ 精确环检测（全状态 JSON 签名重复）→ 规范停点（环内 JSON 字典序最小成员；浮点噪声环
 * 视为已收敛）→ 收敛尝试失败时回落到第 `oscillatorStop` 轮瞬态。**纯函数**：只读 `ctx`，不写任何
 * 闭包/模块级状态，返回 `{ end, clean, iterations }`。`core/resource.ts#calcTeamResources` 内以一行
 * `runInnerLoop` 包装注入只读上下文；两个调用点（折叠环 `runFoldLoop`、欠打回填试探 `convergeCounts`）
 * 行为逐位不变。
 *
 * 依赖方向：本文件**不得** import `core/resource.ts`（防循环依赖）；只依赖类型、`./helpers#iterate`
 * 与 `./floatNoiseCycle#isFloatNoiseCycle`。
 */
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig } from '@/types/resource'
import { iterate } from './helpers'
import { isFloatNoiseCycle } from './floatNoiseCycle'

/** 内层不动点的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface InnerLoopContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  maxIter: number
  oscillatorStop: number
}

/**
 * 内层环检测的**预键**：各槽「强特/终结次数 + 平A时间」按 JSON 的数值编码拼接（非有限数与 null 同记、
 * −0 与 0 同记、缺失与 undefined 同记）⇒ 两份状态 JSON 相等必然预键相等（必要条件），用来跳过绝大多数轮的全量序列化。
 */
function cycleProbeKey(states: IterationState[]): string {
  const part = (x: unknown): string =>
    typeof x === 'number' ? (Number.isFinite(x) ? String(x) : 'n') : x == null ? (x === null ? 'n' : 'u') : JSON.stringify(x)
  let s = String(states.length)
  for (const st of states) s += `|${part(st.exSpecialCount)},${part(st.ultimateCount)},${part(st.basicAttackTime)}`
  return s
}

/**
 * 内层次数收敛 + 停点规范化（环检测 + 字典序规范停点）。
 * 提升到函数级（2026-09-08 重构）：折叠循环与「② 规范重跑」共用。
 */
export function runInnerLoop(
  from: IterationState[],
  ctx: InnerLoopContext,
): { end: IterationState[]; clean: boolean; iterations: number } {
  const { configs, config, maxIter, oscillatorStop } = ctx
  // 环检测：预键 → 同预键的快照下标（升序）。全状态 JSON 只在预键撞上时才算（见下方循环注释）
  const cycleBuckets = new Map<string, number[]>()
  const cycleSigCache: (string | undefined)[] = []
  const sigAt = (idx: number): string => (cycleSigCache[idx] ??= JSON.stringify(cycleSnapshots[idx]))
  const cycleSnapshots: IterationState[][] = []
  let cur = from
  /** 第 oscillatorStop 轮状态快照 = 收敛尝试失败时的停点（与历史上限 20 的「上限处瞬态」逐位一致） */
  let oscillatorStopStates: IterationState[] | undefined
  let k = 0
  for (; k < maxIter; k++) {
    if (k === oscillatorStop) oscillatorStopStates = structuredClone(cur)
    const newStates = iterate(configs, cur, config)
    // 检查收敛：强特次数、大招次数与**平A时间**是否稳定。伊德海莉连续松弛（阻尼实数次数）同样按
    // 严格相等判稳——阻尼映射收敛到浮点不动点后逐位复现（热启动透明的前提）；ε 判据会留下
    // ~1e-12 残差，热启动会话与冷启动会话不再逐位一致（determinism.test 的失败机制）。
    // bat 必须进判稳（2026-09-09，能量行级 Σ 暴露）：折叠边界的路径里预算收紧会让 bat 跳变而
    // 次数暂时不动（实测雅 C2：input bat≈127 → output bat=50.1、ex 恒 22 → 旧判稳提前 clean，
    // 停点的 energySource 快照仍是压缩前 bat 算的 585.8，终局行重放只有 307.5——驱动≠终局态的
    // 伪不动点，把 C2 撑在高吸引子、C4 落自洽低吸引子 → 命座伤害非单调）。bat 是预算与次数的
    // 确定性函数（次数+预算不变 ⇒ bat 逐位不变），进判稳只多跑折叠边界后的诚实重收敛，不引入浮点残差。
    // 口径 `engine:判稳含平A时间` 的 `@fact` 声明按既有惯例留在 re-export 壳处
    // （`src/core/resource.ts`，锚已随实现改指 `src/core/resource/innerLoop.ts#runInnerLoop`）。
    let changed = false
    for (let i = 0; i < cur.length; i++) {
      if (newStates[i].exSpecialCount !== cur[i].exSpecialCount ||
          newStates[i].ultimateCount !== cur[i].ultimateCount ||
          newStates[i].basicAttackTime !== cur[i].basicAttackTime) {
        changed = true
        break
      }
    }

    cur = newStates
    if (!changed) return { end: cur, clean: true, iterations: k }
    // 环检测：签名 = 全状态 JSON（含 energySource 快照——iterate 消费的一切）；快照/恢复用
    // structuredClone 而非 JSON roundtrip——JSON 会把 NaN 物化成 null 写回状态（毒路径）
    // 全状态 JSON 按需算（2026-09-23，原为逐轮必算、占 runInnerLoop 自耗时大头）：先比「次数 + 平A时间」预键——
    // JSON 相等 ⇒ 预键相等（`cycleProbeKey` 按 JSON 的数值编码取值），只在预键撞上时才算两边 JSON 逐字比较，
    // 取最早的相等者 = 旧 `Map<sig, 首见下标>` 的语义；快照是不被改写的引用，晚算 JSON 与当轮算逐字相同。
    const probe = cycleProbeKey(cur)
    const bucket = cycleBuckets.get(probe)
    let firstSeen: number | undefined
    if (bucket) {
      const sig = JSON.stringify(cur)
      cycleSigCache[cycleSnapshots.length] = sig
      for (const idx of bucket) if (sigAt(idx) === sig) { firstSeen = idx; break }
    }
    if (firstSeen !== undefined) {
      const members = cycleSnapshots.slice(firstSeen)
      let canonical = members[0]
      let canonicalSig = JSON.stringify(canonical)
      for (const m of members) {
        const ms = JSON.stringify(m)
        if (ms < canonicalSig) { canonical = m; canonicalSig = ms }
      }
      // 浮点噪声环（成员逐字段相对 1e-9 内，典型 = 连续收缩到 ulp 级后 1 ulp 交替的 2-循环）= 已收敛：
      // 停点仍是规范成员、数值一位不差，只是不再把收敛标志报成 false（口径与实测见 floatNoiseCycle.ts）。
      // 真整数环（Δ≥1）照旧 clean=false：历史上限内检出的取字典序规范成员（旧口径），上限后检出的 = 收敛尝试失败，
      // 回到第 oscillatorStop 轮状态（见 INNER_LOOP_MAX_ITERATIONS 两层语义）。
      if (isFloatNoiseCycle(members)) return { end: structuredClone(canonical), clean: true, iterations: k }
      if (oscillatorStopStates) return { end: oscillatorStopStates, clean: false, iterations: oscillatorStop }
      return { end: structuredClone(canonical), clean: false, iterations: k }
    }
    if (bucket) bucket.push(cycleSnapshots.length)
    else cycleBuckets.set(probe, [cycleSnapshots.length])
    // 快照存**引用**（2026-09-23 mcp-engine-r2，原为逐轮 structuredClone，实测自耗时 ~0.9s/18s）：
    // `cur` 是 iterate 新建的数组，之后只作下一轮 iterate 的只读入参（纯度探针实测 85,779 次调用 0 次改写入参）；
    // 快照只在本函数内比较，出口处的规范成员仍 structuredClone 后返回 ⇒ 调用方拿到的对象与旧版同为独立副本。
    cycleSnapshots.push(cur)
  }
  // 预算耗尽：停点 = 第 oscillatorStop 轮瞬态（起点确定则停点确定；与历史上限 20 逐位一致）
  return oscillatorStopStates
    ? { end: oscillatorStopStates, clean: false, iterations: oscillatorStop }
    : { end: cur, clean: false, iterations: k }
}
