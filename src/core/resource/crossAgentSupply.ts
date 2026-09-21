/**
 * 跨槽位供给的**通用执行器**（规则 6 在引擎层的落点，2026-09-13 架构收口）。
 *
 * 为什么单列一个文件：`core/resource.ts` 与 `core/resource/helpers.ts` 都要用它，而前者 import
 * 后者（单向）——执行器若住在前者会形成环。本文件只依赖类型 + 注册表，两个消费者都能安全 import。
 *
 * 取代原先散在两个文件里的角色专属数学（`resource.ts` 的 `normaGiftChainInfo` /
 * `liuyinGiftChainInfo` / `liuyinGiftTime` 三函数 135 行，`helpers.ts` 里同一份赠链计算的第二副本）。
 * 它们的共同形状是「按 `agentId === '<id>'` 找槽位，再算某角色特有的赠送量」：
 *   · 新角色接赠链**必须改引擎**；
 *   · 且**不被 agentId 棘轮计数**（它们不写 id 字面量，只 import 那个角色的模块）
 *     —— 这正是规则 6 的真实漏网面，故另立判据 12（`core role-import ratchet`）盯住它。
 *
 * 现在引擎只按**能力类别**查询（`crossAgentSupply.kind`），数量与落点由模块自报：
 *   · `supply()`         —— 送多少（纯函数，引擎每 pass 调）
 *   · `targetSlot()`     —— 送给谁（缺省 = 上一位队友，环绕）
 *   · `secondsPerUnit()` —— 每个单位占落点槽多少秒（缺省 = 落点 ultimateActionTime）
 *   · `decibelPerUnit()` —— 每个单位给提供者自己多少喧响（缺省 0）
 *   · `axisSuppressed`   —— 该类别在轴模式下不出数（琉音赠大：轴内次数由轴预设决定，见 docs 坑19①）
 */
import type { CharacterOperationConfig, IterationState } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'

export interface CrossAgentSupplyInfo {
  /** 提供者槽位（未提供 = -1） */
  providerSlot: number
  /** 落点槽位（无效 = -1） */
  targetIdx: number
  /** 供给单位数（次数） */
  count: number
  /** 占用落点槽的秒数 = count × secondsPerUnit */
  time: number
}

export interface CrossAgentSupplyQuery {
  /** 战斗总时长（秒） */
  totalTime: number
  /** 失衡次数（计划值；部分类别按它折算窗口数） */
  stunCount: number
  /** 轴模式：`axisSuppressed` 的提供者在此跳过 */
  axisMode?: boolean
  /** 槽位数（编排层注入，与 `configStore.team.length` 同源；缺省 `configs.length`） */
  teamSize?: number
}

const NO_SUPPLY: CrossAgentSupplyInfo = { providerSlot: -1, targetIdx: -1, count: 0, time: 0 }

/**
 * 某类别的**全部**供给者槽位（按槽位序）。
 *
 * 为什么是列表而不是「找一个」：同一类别可以有多名提供者且**同时生效**——例如同队两个
 * 赠连携角色各自送自己的那一份。引擎不假设唯一性，也不静默求和（调用方按需合并，
 * 避免把「两个提供者」误当重复注册）。
 */
export function findCrossAgentSupplySlots(configs: CharacterOperationConfig[], kind: string): number[] {
  const out: number[] = []
  for (let i = 0; i < configs.length; i++) {
    if (getAgentMechanic(configs[i].agentId)?.crossAgentSupply?.kind === kind) out.push(i)
  }
  return out
}

/** 解析**单个**槽位的跨槽位供给（`providerSlot` 无声明或槽位无效时返回空）。 */
export function crossAgentSupplyAt(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  providerSlot: number,
  query: CrossAgentSupplyQuery,
): CrossAgentSupplyInfo {
  const cfg = configs[providerSlot]
  const spec = cfg ? getAgentMechanic(cfg.agentId)?.crossAgentSupply : undefined
  if (!cfg || !spec) return NO_SUPPLY
  const empty = { ...NO_SUPPLY, providerSlot }
  if (spec.axisSuppressed && query.axisMode) return empty
  const state = states[providerSlot]
  if (!state) return empty
  const teamSize = query.teamSize ?? configs.length
  const targetIdx = spec.targetSlot
    ? spec.targetSlot({ ownSlot: providerSlot, teamSize, cfg })
    // 缺省落点 = 上一位队友（环绕）——与 `resolveUltimateTargetSlot` 的自动口径一致，
    // 但引擎不 import 角色模块：需要该语义的模块用 targetSlot() 显式声明。
    : (providerSlot - 1 + teamSize) % teamSize
  const targetCfg = configs[targetIdx]
  if (!targetCfg) return empty
  const count = Math.max(0, Math.floor(spec.supply({
    cfg,
    state,
    targetCfg,
    targetState: states[targetIdx],
    stunCount: query.stunCount,
    totalTime: query.totalTime,
    teamSize,
  }) || 0))
  if (count <= 0) return { ...empty, targetIdx }
  const perUnit = spec.secondsPerUnit
    ? spec.secondsPerUnit({ targetCfg, ownCfg: cfg })
    : (targetCfg.ultimateActionTime ?? 0)
  return { providerSlot, targetIdx, count, time: count * perUnit }
}

/**
 * 「琉音赠大」（`gift-chain:ultimate`）的**轴感知**解析 —— 该量的**单一事实源**。
 *
 * 为什么必须单列一个入口（2026-09-20 R67 实测，规则 11）：这个量被**四处**消费，轴模式下
 * 模块供给被 `axisSuppressed` 跳过 ⇒ 四处若各自决定「轴模式怎么办」，就会漂成两派：
 *
 * | 消费点 | 用途 | 轴分支 |
 * |---|---|---|
 * | `iterate` 必要时间预留 | 账本要给赠行留秒数 | **必须**用轴计数 |
 * | S2 折叠环 `rowTime` | 量「这一槽真占了多少前台」 | **必须**用轴计数 |
 * | `frontlineRowsOf` 试探测量 | 判「试探装不装得下」 | **必须**用轴计数 |
 * | `giftTimeOfSlot` 截断上限 | 从可截断额度里扣掉赠行 | **必须**用轴计数 |
 *
 * 实测漂移形态（雨果 0 命轴 `hugo-c0-e`，2026-09-20）：前三处若漏掉轴分支，账本/折叠都看不见
 * 赠行的 8.732s，而截断上限扣了它 ⇒ **双重计费**，决算行被整数装包砍掉一整次（5→4）。
 * 反之（只补账本不补折叠测量）预留会被折叠环读成 idle 再 refund 掉，净额仍是 0。
 * ⇒ 四处**同源**才守恒：`Σ(非赠行) + 赠行 ≡ 账本`。
 *
 * @param query.axisPromote 编排层按「轴声明 promoteVariant 块 + **剩余好评默认 90**」算好的计数
 *   （用户口径 2026-09-20；`axisMode` 为假时忽略）。缺省/未注入时回落模块供给（非轴口径）。
 */
export function ultimateGiftOf(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  query: CrossAgentSupplyQuery & { axisPromote?: { targetSlot: number; count: number } },
): CrossAgentSupplyInfo {
  const providerSlot = findCrossAgentSupplySlots(configs, 'gift-chain:ultimate')[0] ?? -1
  const ov = query.axisPromote
  if (query.axisMode && ov && ov.count > 0 && configs[ov.targetSlot]) {
    return {
      providerSlot,
      targetIdx: ov.targetSlot,
      count: ov.count,
      // 单位耗时 = 落点槽的终结技时长（与模块 `secondsPerUnit` 同口径）
      time: ov.count * (configs[ov.targetSlot].ultimateActionTime ?? 0),
    }
  }
  return crossAgentSupplyAt(configs, states, providerSlot, query)
}

/** 解析某类别的**全部**供给（按槽位序，仅含有量的）。 */
export function crossAgentSuppliesOf(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  kind: string,
  query: CrossAgentSupplyQuery,
): CrossAgentSupplyInfo[] {
  const out: CrossAgentSupplyInfo[] = []
  for (const providerSlot of findCrossAgentSupplySlots(configs, kind)) {
    const info = crossAgentSupplyAt(configs, states, providerSlot, query)
    if (info.count > 0) out.push(info)
  }
  return out
}

/**
 * 「邻位回能」类别：返回 `targetSlot` 槽从**每个**提供者分别获得的能量（按提供者槽位索引）。
 *
 * 为什么返回明细而不只返回合计：`CrossAgentEnergy` 要向 UI 暴露
 * `rinaUltEnergy` / `soukakuUltEnergy` / `lucyEnergy` 三个「来源」字段
 * （`ResourceResultCard.vue` 逐条展示），故必须能按提供者拆分；`total` 用合计值。
 *
 * 为什么单列这个类别（2026-09-15 core 棘轮批次3）：迁移前这段数学住在 `calcCrossAgentEnergy` 里，
 * 形状是「丽娜/苍角/露西 各一个 `findIndex(c => c.agentId === '<id>')` → 查它的终结技次数 →
 * 乘一个按**邻位关系**分配的系数」。三段几乎相同的代码，且新角色接入必须改引擎。
 * 关键难点（试过按 cfg 字段改写并**否决**）：`rinaEnergyPerRinaUlt` 这类字段是**写给全队**的
 * buff 值（提供者遍历全队各写一份自己的份额），因此**无法反向标识提供者槽位**——必须由模块
 * 自己声明「我是提供者」，引擎按 kind 找槽位。这正是 `crossAgentSupply` 存在的理由。
 *
 * 契约：模块用 `perTargetAmounts()` 返回「本提供者送给每个落点的**能量总量**」
 * （邻位 30/10 的分配语义、影画1 的回旋回能、乘自己终结技次数，全在模块内）。
 * 引擎只做「按 kind 找提供者 + 按落点取数」。求和而非覆盖：一个落点可同时收到多名提供者。
 */
export function neighborUltEnergyByProvider(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  targetSlot: number,
  query: CrossAgentSupplyQuery,
): { total: number; byProvider: Record<number, number>; byDisplayKey: Record<string, number> } {
  const teamSize = query.teamSize ?? configs.length
  const byProvider: Record<number, number> = {}
  const byDisplayKey: Record<string, number> = {}
  let total = 0
  for (const providerSlot of findCrossAgentSupplySlots(configs, 'neighbor-ult-energy')) {
    // ⚠ **不在引擎侧跳过提供者自己**：是否给自己回能由模块的 perTargetAmounts 决定
    // （丽娜/苍角的 assignXxx 内部已 `others = slots.filter(s => s !== ownSlot)`；
    //   露西影画1 的「回旋全队回能」**含她自己**——引擎侧一刀切 skip 会少算，实测 timeGolden 红）。
    const cfg = configs[providerSlot]
    const spec = cfg ? getAgentMechanic(cfg.agentId)?.crossAgentSupply : undefined
    const state = states[providerSlot]
    if (!cfg || !spec?.perTargetAmounts || !state) continue
    const amounts = spec.perTargetAmounts({ ownSlot: providerSlot, teamSize, cfg, state })
    const v = amounts?.[targetSlot]
    if (typeof v === 'number' && v > 0) {
      byProvider[providerSlot] = v
      total += v
      // 展示明细按模块自报的 displayKey 聚合（引擎不认识角色名）
      const key = spec.displayKey
      if (key) byDisplayKey[key] = (byDisplayKey[key] ?? 0) + v
    }
  }
  return { total, byProvider, byDisplayKey }
}

/**
 * 某 cfg 的「赠链附带喧响」折算：`decibelPerUnit(自己的 spec) × 自己的供给单位数`。
 *
 * 语义注意：`normaCinemaLevel` 这类命座字段**只写在角色自己的 cfg 上**，因此引擎在逐槽循环里
 * 对每个 cfg 调用本函数时，实际只有提供者那一槽算出非零——这正是迁移前 `hatCount * 200 * 2`
 * 的效果（在诺姆槽一次算入「诺姆 + 上一位队友」两侧的量），故 norma 模块的 `decibelPerUnit`
 * 返回 **400**（两侧合计）而不是 200。改口径前先读这条。
 */
export function giftDecibelForCfg(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  cfg: CharacterOperationConfig,
  totalTime: number,
): number {
  const slot = configs.indexOf(cfg)
  if (slot < 0) return 0
  const spec = getAgentMechanic(cfg.agentId)?.crossAgentSupply
  const state = states[slot]
  if (!spec?.decibelPerUnit || !state) return 0
  const count = Math.max(0, Math.floor(spec.supply({
    cfg, state, stunCount: 0, totalTime, teamSize: configs.length,
  }) || 0))
  return count * Math.max(0, spec.decibelPerUnit({ cfg }) || 0)
}
