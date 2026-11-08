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
 * ## 分配（两条路，别混）
 *
 * **单槽**（单锋御队）：`allocateBossGashPool` 按 `priority` 扣需求，结果恒等于
 * `min(floor(points/600), demand)` —— 与改造前逐位相同（构造性保证，见下节）。
 *
 * **多槽**（双锋御队，2026-11-08 接线）：`resolveTeamGashPool` —— 池合并后**按各槽贡献点数比例**
 * 分份额，以各自**申报需求**封顶，被 cap 掉的回流给「接管剩余层」的槽（克拉蕾的自动补足葬血强袭）。
 * 为什么不是「主C 优先逐个扣」：实测 1601+1611 里挽昼申报 48 层而池只有 21 层 ⇒ 槽 0 独吞全部，
 * 克拉蕾的 27 次毁伤整条归零；而挽昼自己只贡献 ≈10 层，等于把她没攒出来的层也拿走了
 * （单锋御 11 层、双锋御反而 21 层，"共享"退化成"先到先得多占"）。比例分配让份额跟着功劳走。
 *
 * 轴内**两条路都不走**——轴内必须按**执行先后**逐条推演（积累块加分、消耗块先判够不够再扣），
 * 单源 = `agents/claret.ts#simulateAxisGashTimeline`；两者的分工见该函数头注释「与自动补足的分工」。
 *
 * ## 单槽 = 逐位不变（构造性保证）
 *
 * 单锋御队只有一条贡献 + 一条需求 ⇒ `allocateBossGashPool` 的结果恒等于
 * `min(floor(points / 600), demand)`，与改造前两个模块各自手写的 `Math.min(gashLayers, demand)`
 * 逐位相同（`gashMaimTeam.test.ts` 有专条锁这条恒等式）。
 *
 * ## 多锋御接线（2026-11-08 已落地）
 *
 * 通道：各模块 `buildResourceResult` 暴露本槽申报（`points` / 声明需求 / `drainsLeftover`）→
 * `collectSharpenGashClaims` 收全队 → 两模块各自的 `nextRoundFeedback` 写 `ModuleFeedback.gashPoolClaims`
 * → 下一轮 `applyTeamConfig({phase:'converge'})` 调 `resolveTeamGashPool` 写回各槽
 * `cfg.gashPoolGrantedLayers`。跨轮而非同轮：每槽贡献点依赖**它自己**那轮的 `state.basicAttackTime`
 * （折叠环产物），同轮内另一槽解算时本槽还没跑。外层不动点负责收敛。
 *
 * debt: **轴内**仍是单槽各跑一条轨迹 —— 跨槽合并序列需要「同一时刻哪一槽在消耗」的先后信息，
 * 引擎当前没有逐事件时间通道。升级路径：把各槽 sequence 按时间合并后喂 `simulateAxisGashTimeline`
 * （轨迹结构不变，只需多一个 slot 字段）。非轴侧已按比例分配（见上节），不受此限。
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
 * 池分配结果（`allocateBossGashPool` 与 `resolveTeamGashPool` 共用同一形状）。
 * - `layers`：合并后的总层数（= floor(Σ点数/600)）
 * - `bySlot`：各槽实际拿到的层数（只含 > 0 的槽）
 * - `unspent`：分配后池里剩的层
 */
export interface GashPoolAllocation {
  layers: number
  bySlot: Record<number, number>
  unspent: number
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
}): GashPoolAllocation {
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

/**
 * **一槽对共享池的申报**（多锋御队通道，2026-11-08 接线）。
 *
 * 为什么需要它：`allocateBossGashPool` 要的是**全队**的（贡献, 需求），而两个锋御模块此前
 * 各自在资源解里用写死的 `slot: 0` 调用它 ⇒ 双锋御队里是**两个私有池**，池从不共享
 * （用户裁决 2026-10-25「共用**同一个** Boss 残痕池，不是各算各的」）。
 *
 * 为什么不能在同一轮内直接算：每槽的贡献点依赖**它自己**那轮的 `state.basicAttackTime`
 * （折叠环产物），另一槽解算时本槽还没跑 ⇒ 同轮内互相看不见。故走引擎既有的跨轮通道
 * （`ModuleFeedback` → `threads`）：本轮**申报**、下轮**分配并写回 cfg**，由外层不动点循环收敛。
 * 与 `sharpnessGiftFromTeam`（知更鸟给养）同一套机制。
 */
export interface GashPoolClaim {
  /** 本槽本局累积的残痕点数（已乘该槽积蓄效率；白送层见各模块头注释） */
  points: number
  /** 本槽**声明**要消耗的层数（斩金断铁 1/次 / 葬血强袭 3/段 / 挽昼 3×(强特+连携)） */
  demandLayers: number
  /**
   * 本槽是否**接管分配后的剩余层**（克拉蕾的「自动补足葬血强袭」＝按定义打光池里剩下的）。
   *
   * 为什么必须与 `demandLayers` 分开：自动补足不是「声明需求」，而是「兜底清空」。
   * 若把它的胃口（无上限）当成申报需求，按优先级先拿的槽会被它抢光；
   * 若让它在声明阶段参与，它会因无限胃口而饿死别人。两趟分配才是原文的读法：
   * 先满足各家**声明**的消耗，剩下的才由补足者打完（用户口径 2026-10-09「剩余层数一律由葬血强袭打完」）。
   */
  drainsLeftover?: boolean
}

/** 按槽位申报的池输入（`slot → 申报`），跨轮通道的载荷形状 */
export type GashPoolClaims = Record<number, GashPoolClaim>

/**
 * **团队级分配**：把各槽申报合并成一个池，再按槽位序（主C 在前）逐槽满足需求。
 *
 * 返回 `null` = **不启用团队池**（申报少于 2 槽 ⇒ 单锋御）。调用方**必须**在此情形回落
 * 各自的单槽 `allocateBossGashPool` 路径 ⇒ 单锋御队**逐位不变**（构造性保证，不是巧合）。
 *
 * ⚠ 优先级 = 槽位号升序。语义依据见本文件头「非轴：主C 在前、其余按槽位序」——
 * 模块层**不猜主C**，由槽位序承担这个业务选择（槽 0 = 主C 是本仓库预设的既有约定）。
 */
export function resolveTeamGashPool(
  claims: Readonly<GashPoolClaims>,
): GashPoolAllocation | null {
  const slots = Object.keys(claims)
    .map(s => Number(s))
    .filter(s => Number.isFinite(s))
    .sort((a, b) => a - b)
  if (slots.length < 2) return null
  // 池总层数 = floor(Σ点数 / 600)。**单一事实源**仍走 allocateBossGashPool（贡献合并口径不在这里重写）。
  const pool = allocateBossGashPool({
    contributions: slots.map(slot => ({ slot, points: Math.max(0, Number(claims[slot]!.points) || 0) })),
    demand: [],
    priority: [],
  })
  const layers = pool.layers
  if (layers <= 0) return { layers: 0, bySlot: {}, unspent: 0 }
  const totalPoints = slots.reduce((s, slot) => s + Math.max(0, Number(claims[slot]!.points) || 0), 0)
  /**
   * ## 分配规则：**按贡献点数比例**，以「申报需求」封顶，余量再补
   *
   * 为什么不用「槽位序（主C 优先）逐个扣需求」：实测双锋御队（1601+1611）里挽昼申报 48 层、
   * 池只有 21 层 ⇒ 槽 0 拿走**全部** 21 层，克拉蕾拿 0，她的 27 次毁伤整条归零。
   * 而挽昼自己只贡献 6163 点（≈10 层），等于把她没攒出来的 11 层也拿走了——
   * 单锋御时她只有 11 层，双锋御反而 21 层，"共享池"变成了"先到先得多占"。
   *
   * 比例分配的语义：**池是公共的，但份额跟着功劳走**。这样
   * - 无争抢时与「各自计算」接近（1601 独得 ≈10 层、1611 ≈11 层）；
   * - 有富余时仍按比例拿到超额的零头（480+480 那种合并收益按点数比分）；
   * - 需求不足的槽只拿自己申报的量，剩下的回流给还需要的人。
   *
   * 「接管剩余层」的槽（克拉蕾的自动补足葬血强袭）视作**需求无上限**：她的消耗按定义就是
   * 「把池里剩下的打完」，所以不设 cap（否则她的 27 次毁伤会被自己的声明滑块饿死）。
   */
  const capacityOf = (slot: number): number => {
    const c = claims[slot]!
    if (c.drainsLeftover) return Number.POSITIVE_INFINITY
    return Math.max(0, Math.floor(Number(c.demandLayers) || 0))
  }
  const base: Record<number, number> = {}
  const remainderOf: Record<number, number> = {}
  let assigned = 0
  for (const slot of slots) {
    const p = Math.max(0, Number(claims[slot]!.points) || 0)
    const exact = totalPoints > 0 ? layers * (p / totalPoints) : layers / slots.length
    const floorShare = Math.min(Math.floor(exact), capacityOf(slot))
    base[slot] = floorShare
    remainderOf[slot] = exact - Math.floor(exact)
    assigned += floorShare
  }
  /** 余量按**小数部分从大到小**补发（同余数按槽位序），每次最多 +1，且不超过各自容量。 */
  let left = layers - assigned
  const order = [...slots].sort((a, b) => (remainderOf[b]! - remainderOf[a]!) || (a - b))
  while (left > 0) {
    let progressed = false
    for (const slot of order) {
      if (left <= 0) break
      if (base[slot]! >= capacityOf(slot)) continue
      base[slot] = base[slot]! + 1
      left -= 1
      progressed = true
    }
    if (!progressed) break
  }
  const bySlot: Record<number, number> = {}
  for (const slot of slots) if (base[slot]! > 0) bySlot[slot] = base[slot]!
  return { layers, bySlot, unspent: left }
}

/**
 * **锋御槽的申报读取面**（`gashPoolClaim` 的最小结构）。
 *
 * 为什么不 import 两个模块的 Source 类型：`gashMaim` 是**职业通用层**，反向 import 角色模块会成环
 * （两个模块都已 import 本文件）。这里只声明本层要读的字段，由两个模块的结构去满足（结构子类型）。
 */
export interface SharpenGashClaimLike {
  /** 本槽本局累积的残痕点数（已乘该槽积蓄效率） */
  points: number
  /** 本槽想消耗的层数（**声明口径**：斩金断铁 1/次 + 葬血强袭 3/段；影画6 不消耗不计） */
  demandLayers: number
  /**
   * 本槽本局**实际触发的毁伤次数**（`collectTeamMaimCount` 读；仅展示/回能计数用，不参与池分配）。
   * 与 `demandLayers` 的区别：含影画6 那种「不消耗残痕」的额外毁伤（它们不耗层但**算毁伤事件**）。
   */
  maimCount?: number
}

/** 可能带申报的一槽（两模块字段名不同，任一命中即可）。 */
export interface SharpenGashClaimCarrier {
  slot: number
  /**
   * 克拉蕾 1611：`gashValuePct` 是点数；申报需求用 **`gashPoolDeclaredLayers`（与池无关）**，
   * 不用 `maimDemand`——后者含「自动补足的葬血强袭」，而自动补足按定义就是吃池里剩下的
   * ⇒ 拿它当申报需求会自我引用（拿到 0 层 ⇒ 需求 0 ⇒ 永远拿不到层，死锁；2026-11-08 实测踩到）。
   */
  claretSharpResourceSource?: {
    gashValuePct: number
    gashPoolDeclaredLayers?: number
    /** 实际触发毁伤次数（含影画6 不耗层的那些）——`collectTeamMaimCount` 读 */
    maimCount?: number
  } | undefined
  /** 挽昼 1601：`buildResourceResult` 暴露的申报 */
  sunbringerGashSource?: SharpenGashClaimLike | undefined
}

/**
 * 从**本队资源结果**收集全部锋御槽的池申报。
 *
 * 返回 `null` = 本队锋御槽少于 2 ⇒ **不启用团队池**（调用方回落各自的单槽路径）。
 * 这是双锋御与单锋御的**唯一分叉点**，也是「单锋御零回归」的构造性保证。
 *
 * ⚠ 按**字段存在性**判锋御，不按 agentId/specialty：本函数只拿得到资源结果、没有 team 快照；
 * 而「暴露了申报」本身就是模块在声明「我是锋御池的参与者」——新增锋御角色暴露字段即自动纳入。
 */
export function collectSharpenGashClaims(
  characters: readonly SharpenGashClaimCarrier[],
): GashPoolClaims | null {
  const claims: GashPoolClaims = {}
  for (const ch of characters) {
    const sun = ch.sunbringerGashSource
    if (sun) {
      claims[ch.slot] = {
        points: Math.max(0, Number(sun.points) || 0),
        demandLayers: Math.max(0, Math.floor(Number(sun.demandLayers) || 0)),
      }
      continue
    }
    const cl = ch.claretSharpResourceSource
    if (cl) {
      claims[ch.slot] = {
        points: Math.max(0, Number(cl.gashValuePct) || 0),
        // 只认**声明**的消耗（斩金断铁×1 + 葬血强袭×3），与池无关 ⇒ 不会自我引用。
        demandLayers: Math.max(0, Math.floor(Number(cl.gashPoolDeclaredLayers) || 0)),
        // 声明之外，剩余层由她的「自动补足葬血强袭」打完（用户口径 2026-10-09）。
        drainsLeftover: true,
      }
    }
  }
  return Object.keys(claims).length >= 2 ? claims : null
}

/**
 * 收集**全队毁伤触发总次数**（知更鸟「每毁伤回能」的输入，2026-11-08 接线）。
 *
 * 语义：
 * - 锋御槽贡献自己的 `maimCount`（= 消耗残痕层数 + 不耗层的额外毁伤，如克拉蕾影画6）；
 * - **单锋御队也成立**（不像 `collectSharpenGashClaims` 那样要求 ≥2 槽）——
 *   知更鸟在只有一名锋御队友时同样每毁伤回 15 点；
 * - 无锋御 ⇒ 0（本局没有任何毁伤来源）。
 *
 * ⚠ 为什么按**字段存在性**判锋御：本函数只拿得到资源结果、没有 team 快照；
 * 而「暴露了 maimCount」本身就是模块在声明「我会产生毁伤」（与 `collectSharpenGashClaims` 同款纪律）。
 */
export function collectTeamMaimCount(
  characters: readonly SharpenGashClaimCarrier[],
): number {
  let total = 0
  for (const ch of characters) {
    const sun = ch.sunbringerGashSource
    if (sun && Number.isFinite(Number(sun.maimCount))) {
      total += Math.max(0, Math.floor(Number(sun.maimCount)))
      continue
    }
    const cl = ch.claretSharpResourceSource
    if (cl && Number.isFinite(Number(cl.maimCount))) {
      total += Math.max(0, Math.floor(Number(cl.maimCount)))
    }
  }
  return total
}
