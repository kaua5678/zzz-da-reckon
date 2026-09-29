/**
 * S1 内层不动点 —— 自 `core/resource.ts` 迁出（CC-3，2026-09-24）。
 *
 * 职责：把单次迭代映射 `iterate`（`./helpers`）跑成不动点——判稳（强特/终结次数 + `basicAttackTime`
 * 严格相等）→ 精确环检测（全状态 JSON 签名重复）→ 环停点（真整数环 = 不透支成员中次数最多者，见
 * `integerCycleStop`，不论第几轮检出；浮点噪声环视为已收敛，取 JSON 字典序最小成员）→ 预算耗尽则返回末轮
 * 状态（414 例探针面 0 例）。**纯函数**：只读 `ctx`，不写任何
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

/** 环成员里全状态 JSON 字典序最小者（纯确定性兜底：与进入环的相位无关）。 */
function jsonMinMember(members: IterationState[][]): IterationState[] {
  let best = members[0]
  let bestSig = JSON.stringify(best)
  for (const m of members) {
    const ms = JSON.stringify(m)
    if (ms < bestSig) { best = m; bestSig = ms }
  }
  return best
}

const CYCLE_STOP_EPS = 1e-9

/**
 * **真整数环的停点 = 不透支的成员里次数最多者**（CC-326，arena-C 第 344 轮；旧口径 = 全状态 JSON 字典序最小）。
 *
 * 环成员按出现顺序 m0 → m1 → … → m(n−1) → m0，`iterate(m_i) = m_(i+1)`。`iterate` 的含义是「按 m_i 的时间分配
 * （平A池等）挣到的能量 / 喧响 → 撑得起的强特 / 终结次数」，所以 **m_(i+1) 的次数就是 m_i 自己撑得起的次数**：
 *
 *     透支量 over(m_i) = Σ槽 [ max(0, ex_i − ex_(i+1)) + max(0, ult_i − ult_(i+1)) ]
 *
 * over = 0 ⇔ m_i 声称的次数不超过它自身资源撑得起的次数（可行）；over > 0 ⇔ 它的行比它的平A池挣到的资源多放了动作
 * （终局行重放「花的 > 挣的」，账本与行不自洽）。映射「次数↑ → 平A↓ → 资源↓ → 撑得起的次数↓」是反序的，真解是
 * 两个整数之间的实数 x*；整数行模型下，可行成员中次数最多者就是 ⌊x*⌋（单量 2-循环 n ↔ n+1：n 可行、n+1 透支）。
 *
 * 选取键（字典序）：① over 最小（有可行成员时 = 0）② Σ(强特 + 终结) 最大（可行里做得最多）③ JSON 字典序最小
 * （纯确定性兜底）。三项都只依赖环本身（成员集合 + 后继关系），与进入环的相位 / 种子无关（冷热逐位一致不变）。
 * 适用于**任何轮次**检出的真整数环（CC-327 起。此前第 20 轮之后检出的环回落到「第 20 轮瞬态」
 * `oscillatorStopStates`，那是旧上限 20 的逐位兼容层；414 例实测：该路径 74 次停点，改后全部终局结果逐字段零差）。
 *
 * 实测依据（第 344 轮，timeGolden 同面 414 例）：内层真整数环停点 1815 次，旧规则取中透支成员 944 次（52%）；
 * 终局非收敛的 18 例（全是单人用例）旧停点**全部**透支 1–2 次、改后 0 例透支；结果共变 36 例（这 18 例 + 18 例折叠路径改变）。
 * 分析与 delta 表：`docs/mcp-integer-cycle-stop.md`。
 */
function integerCycleStop(members: IterationState[][]): IterationState[] {
  const n = members.length
  const over = members.map((m, i) => {
    const next = members[(i + 1) % n]
    let o = 0
    for (let s = 0; s < m.length; s++) {
      o += Math.max(0, m[s].exSpecialCount - next[s].exSpecialCount)
        + Math.max(0, m[s].ultimateCount - next[s].ultimateCount)
    }
    return o
  })
  const total = members.map(m => m.reduce((sum, st) => sum + st.exSpecialCount + st.ultimateCount, 0))
  const minOver = Math.min(...over)
  const leastOver = members.map((_, i) => i).filter(i => over[i] <= minOver + CYCLE_STOP_EPS)
  const maxTotal = Math.max(...leastOver.map(i => total[i]))
  return jsonMinMember(leastOver.filter(i => total[i] >= maxTotal - CYCLE_STOP_EPS).map(i => members[i]))
}

/**
 * 内层次数收敛 + 停点规范化（环检测 + 环停点：真整数环 `integerCycleStop`，浮点噪声环 `jsonMinMember`）。
 * 提升到函数级（2026-09-08 重构）：折叠循环与「② 规范重跑」共用。
 */
export function runInnerLoop(
  from: IterationState[],
  ctx: InnerLoopContext,
): { end: IterationState[]; clean: boolean; iterations: number } {
  const { configs, config, maxIter } = ctx
  // 环检测：预键 → 同预键的快照下标（升序）。全状态 JSON 只在预键撞上时才算（见下方循环注释）
  const cycleBuckets = new Map<string, number[]>()
  const cycleSigCache: (string | undefined)[] = []
  const sigAt = (idx: number): string => (cycleSigCache[idx] ??= JSON.stringify(cycleSnapshots[idx]))
  const cycleSnapshots: IterationState[][] = []
  let cur = from
  let k = 0
  for (; k < maxIter; k++) {
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
      // 环成员按出现顺序排列：members[i] 的后继是 members[i + 1]，末成员的后继是 cur（= members[0]）。
      const members = cycleSnapshots.slice(firstSeen)
      // 浮点噪声环（成员逐字段相对 1e-9 内，典型 = 连续收缩到 ulp 级后 1 ulp 交替的 2-循环）= 已收敛：
      // 停点取 JSON 字典序最小成员、数值一位不差，只是不再把收敛标志报成 false（口径与实测见 floatNoiseCycle.ts）。
      // 真整数环（Δ≥1）照旧 clean=false，不论第几轮检出都取「不透支成员中次数最多者」（`integerCycleStop`，CC-326/327）。
      if (isFloatNoiseCycle(members)) return { end: structuredClone(jsonMinMember(members)), clean: true, iterations: k }
      return { end: structuredClone(integerCycleStop(members)), clean: false, iterations: k }
    }
    if (bucket) bucket.push(cycleSnapshots.length)
    else cycleBuckets.set(probe, [cycleSnapshots.length])
    // 快照存**引用**（2026-09-23 mcp-engine-r2，原为逐轮 structuredClone，实测自耗时 ~0.9s/18s）：
    // `cur` 是 iterate 新建的数组，之后只作下一轮 iterate 的只读入参（纯度探针实测 85,779 次调用 0 次改写入参）；
    // 快照只在本函数内比较，出口处的规范成员仍 structuredClone 后返回 ⇒ 调用方拿到的对象与旧版同为独立副本。
    cycleSnapshots.push(cur)
  }
  // 预算耗尽（既没判稳也没进精确环）：返回末轮状态，clean=false。起点确定则停点确定。
  // 探针面 414 例（104 预设 + 62 角色 × c0/c3–c6）0 次走到这里（第 345 轮）；1051 连续松弛队历来就是这个出口。
  return { end: cur, clean: false, iterations: k }
}
