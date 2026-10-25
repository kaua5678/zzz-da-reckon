/**
 * 残痕 / 毁伤：**锋御职业的通用机制**（团队级单一实现，2026-10-25 用户裁决）。
 *
 * 原话：「残痕/毁伤 = **锋御职业的通用机制**，不是克拉蕾/挽昼的专属——多个锋御同队时共用
 * **同一个 Boss 残痕池**（不是各算各的）」。
 * 此前 `GASH_PER_LAYER` / `GASH_MAX_STACKS` 在 `agents/claret.ts` 与 `agents/sunbringer.ts`
 * **各抄一份**（600 与 3 两组字面量 = 规则 11 的典型形态），池子语义也只活在克拉蕾一家。
 *
 * ## 池口径（两条）
 *
 * - **点数 → 层**：每 600 点 = 1 层（用户裁决 2026-09-03「残痕600点可以造成一次毁伤」；
 *   原文只写「残痕值满时进入[残痕]」，点数由用户口径给出）。
 * - **共用同一个 Boss 池**：`allocateBossGashPool` 把**各槽贡献的积累点合并成一个池**再折层；
 *   不是每槽各自 floor —— 那会让 480 + 480 点两个槽各自 0 层，而共用池是 960 点 = 1 层。
 *
 * ## 分配（本版只有一条规则：主C 优先）
 *
 * 非轴：池里折出的层按 `priority`（主C 在前）逐个槽扣需求，扣完即止。轴内**不走本函数**——
 * 轴内必须按**执行先后**逐条推演（积累块加分、消耗块先判够不够再扣），单源 =
 * `agents/claret.ts#simulateAxisGashTimeline`；两者的分工见该函数头注释「与自动补足的分工」。
 *
 * ## 单槽 = 逐位不变（构造性保证）
 *
 * 单锋御队只有一条贡献 + 一条需求 ⇒ `allocateBossGashPool` 的结果恒等于
 * `min(floor(points / 600), demand)`，与改造前两个模块各自手写的 `Math.min(gashLayers, demand)`
 * 逐位相同（`gashMaimTeam.test.ts` 有专条锁这条恒等式）。
 *
 * debt: 多锋御的**整队**分配未接线 —— 双锋御队目前不存在（唯一组合 1601+1611 未进任何预设队，
 * 也不在难度曲线/归档扫描面里），而真正的共用池需要「同一时刻哪一槽在消耗」的跨槽顺序信息。
 * 升级路径：由 TeamMechanic 在 `applyTeamConfig({phase:'postRound'})` 里收集各槽贡献（字段已有先例：
 * `ModuleFeedback`），一次 `allocateBossGashPool` 分配后写回各槽 cfg（写回通道 = 模块私有 cfg 字段，
 * 与 claret 的 `claretGash*` 同款），轴内则把各槽 sequence 按时间合并后喂 `simulateAxisGashTimeline`
 * （轨迹结构不变，只需多一个 slot 字段）。在那之前：轴内仍按**单槽**各跑一条轨迹，非轴按主C 优先。
 *
 * ## 消费者
 * `agents/claret.ts`（整局总量口径 + 轴内推演）、`agents/sunbringer.ts`（六条循环的残痕/毁伤段）。
 */

/** 残痕值：每 600 点 = [残痕] 1 层（= 1 次毁伤）。用户口径 2026-09-03。 */
export const GASH_PER_LAYER = 600

/**
 * **同时存量**上限 3 层（敌人身上最多挂 3 层，超出溢出浪费）。
 * ⚠ 这**不是整局毁伤次数上限**（用户口径 2026-09-12：「3层限制这个是单次，我们全局计算器怎么可能一局只有3次毁伤呢」）——
 * 整局可用层数 = floor(总残痕值 / 600) 不设 3 的钳制，真正的上限是**消耗需求**。
 * 本常量只用于「单次存量上限」类口径（进轴起手值钳制、展示文案）。
 */
export const GASH_MAX_STACKS = 3

/** 池内积累点 → 可消耗层数（整 600 点为一层；负值 / NaN 记 0） */
export function gashLayersOf(points: number): number {
  const p = Number(points)
  if (!Number.isFinite(p) || p <= 0) return 0
  return Math.floor(p / GASH_PER_LAYER)
}

/** 一槽对共享池的贡献：本局该槽攒出的残痕点数（已乘该槽的积蓄效率） */
export interface GashPoolContribution {
  slot: number
  points: number
}

/** 一槽对共享池的需求：该槽本局想消耗的层数（斩金断铁 1 / 葬血强袭 3 段 / 毁伤按层结算） */
export interface GashPoolDemand {
  slot: number
  layers: number
}

/**
 * 共用 Boss 池 + 非轴分配：**各槽贡献先合并成一层池**，再按 `priority`（主C 在前）逐槽满足需求。
 *
 * - `priority` 里没列到的槽 = 不参与分配（本版只有锋御槽会进来）；
 * - 同一槽在 `demand` / `priority` 里多次出现只认第一次（确定性）；
 * - 返回值 `bySlot` 只含 > 0 的槽（调用方自己决定怎么展示 0）；`unspent` = 分配后池里剩的层。
 *
 * ⚠ **不排序、不猜主C**：主C 判定属编排层的业务选择（时间权重 / 预设角色位），模块层不认。
 * 调用方按「主C 在前、其余按槽位序」给出顺序即可。
 */
export function allocateBossGashPool(input: {
  contributions: readonly GashPoolContribution[]
  demand: readonly GashPoolDemand[]
  priority: readonly number[]
}): { layers: number; bySlot: Record<number, number>; unspent: number } {
  let points = 0
  for (const c of input.contributions) {
    const p = Number(c.points)
    if (Number.isFinite(p) && p > 0) points += p
  }
  const layers = gashLayersOf(points)
  const demandBySlot = new Map<number, number>()
  for (const d of input.demand) {
    if (demandBySlot.has(d.slot)) continue
    demandBySlot.set(d.slot, Math.max(0, Math.floor(Number(d.layers) || 0)))
  }
  const bySlot: Record<number, number> = {}
  let remaining = layers
  for (const slot of input.priority) {
    if (remaining <= 0) break
    if (bySlot[slot] !== undefined) continue
    const demand = demandBySlot.get(slot) ?? 0
    if (demand <= 0) continue
    const granted = Math.min(remaining, demand)
    bySlot[slot] = granted
    remaining -= granted
  }
  return { layers, bySlot, unspent: remaining }
}
