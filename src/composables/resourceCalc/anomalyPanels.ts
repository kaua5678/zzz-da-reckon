/**
 * 异常面板簇（自 `resourceCalc/helpers.ts` 整段迁出 —— R22 熵批 2 / R22-S2 刀 C，**纯搬迁**）。
 *
 * 职责（一个域：**异常积蓄 → 虚拟面板 → 结算触发者**）：
 *   ① 队伍身份谓词 `teamHasAgent` / `findSlotByIdentity`（按角色身份找槽位，单一事实源）
 *   ② 异常持续时间加成 `getTeamAnomalyDurationBonus`（火 3s / 电 3s / 以太 3s / 物理 5s）
 *   ③ 风化浸染目标选择与覆盖率 `getWindInfectionTargetSlot` / `getWindInfectionElement` /
 *      `getWindInfectionCoverage`
 *   ④ 异常虚拟面板 `buildAnomalyVirtualPanel`（属性加权 + 招式限定增伤按积蓄占比）与
 *      结算触发者分摊 `buildAnomalySettlementEntries`
 *   ⑤ 蕾米埃尔专属：`getRemielleLevelValue` / `remielleSpecialVoidflareCount` / `calcVoidflareDamage`
 *      已于 CC-19c-1（2026-09-26）迁 `@/mechanics/agents/remielle`；运行时 re-export 壳已于 CC-34d
 *      （2026-09-27）删除，调用方直接从模块导入。本文件只留类型 `VoidflareDamageInput` 的壳（见下）
 *
 * 迁移纪律：逐字节剪切，算式/常量值/条件/求值顺序零改动。
 * 上游单一入口仍是 `./helpers`（该文件保留 re-export 壳）⇒ 目录外既有消费者（`damagePool.ts` 等）
 * 与既有测试的 import 零改动。
 *
 * ⚠ 落点必须是 `resourceCalc/` **目录直属**的 `.ts`：子目录会整类逃出
 * `listAgentBranchFiles()` 的 agentId 棘轮度量面（`scripts/check-guards.mjs`；R22 分诊 §3 闸门 4 实测）。
 * ⚠ 本刀把 `findSlotByIdentity` 一并迁来 ⇒ 它与 `panelPhases.ts` 之间的**双向边解环**
 * （刀 A 头注释里点名的「D 簇后续再拆时把这几个符号一并迁走即可解环」即本刀）：
 * `panelPhases.ts` 与 `./helpers` 都改为从本文件 import 它，本文件对二者**零出边**。
 */
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { emptyPanel, panelAt } from '@/core/panel'
import { getAgentMechanic } from '@/mechanics'
import type { AnomalyProgress } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块直接指真实现
import { ELEMENT_DMG_KEYS, ELEMENT_RES_REDUCTION_KEYS } from './skillRows'
// 面板/机制编排簇（B 簇）已迁 `./panelPhases`（R22 熵批 1 刀 A）——同目录兄弟模块直接指真实现。
// ⚠ 本 import 让 `panelPhases ↔ anomalyPanels` 成环（那边也取本文件的
// `getTeamAnomalyDurationBonus` / `findSlotByIdentity`）：**两边全是函数声明（提升）且模块初始化期
// 零互读**——本文件没有任何顶层 `const`，`panelPhases` 的顶层 const（跨来源门控字面量表 + 派生表 WeakMap 缓存，CC-203）
// 都是字面量、本文件不引用 ⇒ **无 TDZ 风险**（刀 A 头注释点名的双向边至此解环）。
import { buildMechanicTeamMembers } from './panelPhases'

export function teamHasAgent(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  agentIds: string[],
): boolean {
  return configStore.team.some(char => {
    const agent = char.agentId ? catalogStore.agentsMap.get(char.agentId) : null
    return agentIds.includes(char.agentId) || agentIds.includes(agent?.teammateBuffId ?? '')
  })
}

export function getTeamAnomalyDurationBonus(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  element: string,
): number {
  // CC-35c（2026-09-27）：通用规则臂改由在队模块能力 `teamAnomalyDurationBonus` 提供（原按 1171 / 1211 / 1261 写死：
  // 柏妮思 火 +3、丽娜 电 +3（额外能力激活）、简 物理 +5）。多个提供者取最大值，现状每种属性至多一个，与原先的提前返回等价。
  // 队伍快照只在确有提供者时才构建（本函数每次面板计算要调 4 次）。本库 teammateBuffId 全部等于自身 id（2026-09-27 实查），
  // 所以按 agentId 派发模块与原 `teamHasAgent`（agentId 或 teammateBuffId 命中）等价。
  let bonus = 0
  let team: ReturnType<typeof buildMechanicTeamMembers> | null = null
  // ⚠ 按下标对应 `team[i]`（`buildMechanicTeamMembers` 就是 `configStore.team.map`），**不要**写 agentId 比较——
  // agentId 棘轮（规则 6）按 AST 把 `x.agentId === y.agentId` 计为编排层身份判定（2026-09-27 实测 3→4 红）。
  for (let i = 0; i < configStore.team.length; i++) {
    const agentId = configStore.team[i]?.agentId
    const mod = agentId ? getAgentMechanic(agentId) : undefined
    if (!mod?.teamAnomalyDurationBonus) continue
    team ??= buildMechanicTeamMembers(configStore, catalogStore)
    const member = team[i]
    bonus = Math.max(bonus, mod.teamAnomalyDurationBonus({ element, slot: member.slot, agent: member.agent, team }))
  }
  // ★ 以太臂**已删除**（R63，2026-09-20 round 63）：原先写作
  // `element === 'ether' && teamHasAgent(..., ['aria'])`，但 `'aria'` 在本库**没有任何**命中 ——
  // `teamHasAgent` 只比对 `char.agentId` 与 `agent?.teammateBuffId`，而爱芮的
  // `agentId === '1501'`、`teammateBuffId === undefined`（实测：全库 `agentId`/`teammateBuffId`
  // 无一等于 `'aria'`）⇒ **死臂**（恒不命中，`getTeamAnomalyDurationBonus(·,'ether')` 永远 0）。
  // 该效果的**唯一写者**是 spec `1501.json` 的 `teamBuffs[].aire_extra_erosion_duration`
  // → `etherAnomalyDurationBonusSeconds` +3，走 `calcPanel` 的 buff 通道（与 1171/1211/1261
  // 三臂「写在通用规则里」的口径不同）。⚠ 若要把它并回本函数，必须先删 spec 那条，否则**双计**。
  return bonus
}

/**
 * **按角色身份找槽位**（单一事实源，规则 11）。
 *
 * 为什么需要（2026-09-17 round 20 侦察）：`findIndex(char => { const a = …; return a?.id === 'X'
 * || a?.teammateBuffId === 'Y' })` 这一形状在全仓编排层**重复 18 次**（`damagePool.ts` 5 /
 * `helpers.ts` 5 / `useResourceCalc.ts` 3 / `convergence.ts` 3 / `normaHatChain.ts` 1 /
 * `ultimatePromote.ts` 1），且每一处都是角色判定棘轮的计数站点。
 * ⚠ **调用点若同时还要「查表/读该成员的其它字段」，请用本函数拿槽位后再按槽位取**（判据 17：
 * 槽位号 ≠ 下标，`team` 数组索引即槽位号但 `characters`/`panels` 是按位置压缩的）。
 *
 * ⚠ **必须查两个字段**：`agent.id`（角色自己的 id）与 `agent.teammateBuffId`（队友 buff 归属别名，
 * 如蕾米埃尔 `1581` 的别名 `'remielle'`）。漏查后者会让「按 buff 别名引用该角色」的配置找不到人
 * ——旧正则口径漏计这两种形态正是换尺的理由（见 `check-guards.mjs` 的 2026-09-17 换尺沿革）。
 *
 * @param ids 任一匹配即算命中（如 `['1581', 'remielle']`）
 * @returns 槽位号；找不到返回 **-1**（调用方按 `< 0` 判空，勿用 `?? ` 兜底）
 */
export function findSlotByIdentity(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  ids: readonly string[],
): number {
  return configStore.team.findIndex(char => {
    const a = char.agentId ? catalogStore.agentsMap.get(char.agentId) : null
    if (!a) return false
    return ids.some(id => a.id === id || a.teammateBuffId === id)
  })
}

/**
 * 风化浸染默认选择：优先非支援/防护、非蕾米埃尔的非风队友属性。
 *
 * 排除谁由模块能力 `excludeFromWindInfectionPick` 声明（CC-42，2026-09-27，census §5.45）：按槽位 agentId 派发，
 * 本文件不再值导入任何角色模块。原先调 `remielle.ts#isRemielleAgent`（其 `teammateBuffId === 'remielle'` 别名臂在
 * 数据面恒 false，`helpersNightC.test.ts` 组2-E 锁定），故按 agentId 派发与原判定逐位等价。
 *
 * ⚠ **与 UI 口径的分裂仍在（未修，如实挂账）**：`ResourceUtilizationPage.vue:417-423` 的
 * `janePassionSlot` 用的是 `agent?.id === '1261' || agent?.teammateBuffId === '1261'`——两臂同值
 * ⇒ **不是分裂**；真正未裁决的是本函数的排除名单与 UI 之间**没有**对应用户可见开关（分诊 §3.4）。
 */
export function getWindInfectionTargetSlot(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): number {
  const windSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.agentsMap.get(char.agentId) : null
    return agent?.damageElement === 'wind'
  })
  if (windSlot < 0) return -1

  const candidates = configStore.team.map((char, slot) => {
    const agent = char.agentId ? catalogStore.agentsMap.get(char.agentId) : null
    return {
      slot,
      agentId: char.agentId ?? '',
      element: agent?.damageElement ?? '',
      specialty: agent?.specialty ?? '',
      excludedFromPick: !!(char.agentId && getAgentMechanic(char.agentId)?.excludeFromWindInfectionPick),
    }
  }).filter(x => !!x.agentId)

  const userSlot = Math.floor(configStore.getMechanicSetting('wind.infectionTargetSlot', -1))
  const userValid = userSlot >= 0 && userSlot !== windSlot && candidates.some(x => x.slot === userSlot)
  if (userValid) return userSlot

  return candidates.find(x =>
    x.slot !== windSlot && x.element && x.element !== 'wind'
    && x.specialty !== 'support' && x.specialty !== 'defense' && !x.excludedFromPick,
  )?.slot
    ?? candidates.find(x => x.slot !== windSlot && x.element && x.element !== 'wind')?.slot
    ?? windSlot
}

export function getWindInfectionElement(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): string {
  const slot = getWindInfectionTargetSlot(configStore, catalogStore)
  const char = configStore.team[slot]
  const agent = char?.agentId ? catalogStore.agentsMap.get(char.agentId) : null
  return agent?.damageElement || 'wind'
}

/** 风化浸染覆盖率：默认风化覆盖时间/全局时间，用户可手动覆盖 */
export function getWindInfectionCoverage(
  configStore: ReturnType<typeof useConfigStore>,
  autoRate: number,
): number {
  return Math.max(0, Math.min(1, configStore.getMechanicSetting('wind.infectionCoverage', autoRate)))
}

export interface AnomalyVirtualPanelRow {
  slot: number
  name: string
  buildup: number
  /** 展示权重 = buildup / totalBuildUp（含所有贡献者，异属性赠送也计入） */
  weight: number
  /** 是否可以结算该元素（同属性角色才可结算） */
  settlementEligible: boolean
  atk: number
  anomalyProficiency: number
  dmgBonus: number
  anomalyDmgBonus: number
  anomalyCritRate: number
  anomalyCritDmg: number
  assaultCritRate: number
  assaultCritDmg: number
  enemyAssaultDefReduction: number
  enemyAnomalyDefReduction: number
  enemyDefFlatReduction: number
  enemyResReduction: number
  elementResReduction: number
  penRatio: number
  penFlat: number
  /** 异化度（蕾米异化系数之和，基础区属性） */
  refringe: number
}

export interface AnomalyVirtualPanelBuild {
  element: string
  totalBuildUp: number
  rows: AnomalyVirtualPanelRow[]
  virtual: AnomalyVirtualPanelRow
  panel: PanelValues
}

export function buildAnomalyVirtualPanel(
  prog: AnomalyProgress,
  panels: PanelValues[],
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalyVirtualPanelBuild | null {
  const slotBuildUp = new Map<number, number>()
  for (const contrib of prog.contributions ?? []) {
    slotBuildUp.set(contrib.slot, (slotBuildUp.get(contrib.slot) ?? 0) + contrib.totalBuildUp)
  }
  const totalBuildUp = [...slotBuildUp.values()].reduce((a, b) => a + b, 0)
  if (totalBuildUp <= 0) return null

  // CC-35a（2026-09-27）：异化度展示列由在队模块能力 `anomalyRefringePct` 按行面板求和
  // （原内联读蕾米埃尔两个面板字段；这两个字段只由蕾米埃尔的 buff 写，她不在队时恒为 0，逐位等价）
  const refringeProviders = configStore.team
    .map(char => (char?.agentId ? getAgentMechanic(char.agentId) : undefined))
    .filter(mod => !!mod?.anomalyRefringePct)
  const rows: AnomalyVirtualPanelRow[] = [...slotBuildUp.entries()]
    .map(([slot, buildup]) => {
      const panel = panelAt(panels, slot) ?? emptyPanel()
      const agentId = configStore.team[slot]?.agentId ?? ''
      const agent = agentId ? catalogStore.agentsMap.get(agentId) : null
      const dmgBonus = (panel.dmgBonus ?? 0) + (panel[ELEMENT_DMG_KEYS[prog.element]] ?? 0)
      // 同属性角色才可参与结算/面板加权
      const settlementEligible = agent?.damageElement === prog.element
      return {
        slot,
        name: agent?.name?.zhCN || agentId || `槽${slot + 1}`,
        buildup,
        weight: 0,   // 展示权重 = 同属性内积蓄占比，rows 构建后统一修正（赠送积蓄不参与权重）
        settlementEligible,
        atk: panel.atk ?? 0,
        anomalyProficiency: panel.anomalyProficiency ?? 0,
        dmgBonus,
        anomalyDmgBonus: panel.anomalyDmgBonus ?? 0,
        anomalyCritRate: panel.anomalyCritRate ?? 0,
        anomalyCritDmg: panel.anomalyCritDmg ?? 0,
        assaultCritRate: panel.assaultCritRate ?? 0,
        assaultCritDmg: panel.assaultCritDmg ?? 0,
        enemyAssaultDefReduction: panel.enemyAssaultDefReduction ?? 0,
        enemyAnomalyDefReduction: panel.enemyAnomalyDefReduction ?? 0,
        enemyDefFlatReduction: panel.enemyDefFlatReduction ?? 0,
        enemyResReduction: panel.enemyResReduction ?? 0,
        elementResReduction: panel[ELEMENT_RES_REDUCTION_KEYS[prog.element]] ?? 0,
        penRatio: panel.penRatio ?? 0,
        penFlat: panel.penFlat ?? 0,
        refringe: refringeProviders.reduce((sum, mod) => sum + mod!.anomalyRefringePct!(panel), 0),
      }
    })
    .sort((a, b) => b.buildup - a.buildup)

  // 属性加权只用同属性行（异属性赠送积蓄只计入总次数，不参与面板加权）
  const eligibleRows = rows.filter(r => r.settlementEligible)
  const blendRows = eligibleRows.length > 0 ? eligibleRows : rows
  const blendTotal = blendRows.reduce((s, r) => s + r.buildup, 0) || totalBuildUp

  const weighted = (key: keyof AnomalyVirtualPanelRow): number =>
    blendRows.reduce((sum, row) => sum + (row[key] as number) * (row.buildup / blendTotal), 0)

  // 修正展示权重：同属性行 = 同属性内积蓄占比（和恒为100%），赠送行 = 0
  for (const row of rows) {
    row.weight = row.settlementEligible && blendTotal > 0 ? row.buildup / blendTotal : 0
  }

  const panel = emptyPanel()
  panel.atk = weighted('atk')
  panel.anomalyProficiency = weighted('anomalyProficiency')
  panel.dmgBonus = weighted('dmgBonus')
  panel.penRatio = weighted('penRatio')
  panel.penFlat = weighted('penFlat')

  // 招式限定增伤按积蓄占比加权进基础区增伤（通用逻辑 2026-08-27）：
  // 一整条异常全由某 100% 增伤招式积攒 → 基础区含那 100%；否则按各招式积蓄占比加权吃一部分。
  let moveDmgBonusWeighted = 0
  for (const contrib of prog.contributions ?? []) {
    const moveDmgBonus = contrib.dmgBonus ?? 0
    if (moveDmgBonus === 0 || contrib.totalBuildUp <= 0) continue
    moveDmgBonusWeighted += moveDmgBonus * (contrib.totalBuildUp / totalBuildUp)
  }
  panel.dmgBonus = (panel.dmgBonus ?? 0) + moveDmgBonusWeighted

  const virtual: AnomalyVirtualPanelRow = {
    slot: -1,
    name: '虚拟面板',
    buildup: totalBuildUp,
    weight: 1,
    settlementEligible: true,
    atk: panel.atk,
    anomalyProficiency: panel.anomalyProficiency,
    dmgBonus: panel.dmgBonus,
    anomalyDmgBonus: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    assaultCritRate: 0,
    assaultCritDmg: 0,
    enemyAssaultDefReduction: 0,
    enemyAnomalyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResReduction: 0,
    elementResReduction: 0,
    penRatio: panel.penRatio,
    penFlat: panel.penFlat,
    refringe: weighted('refringe'),
  }

  panel.refringe = (virtual.refringe ?? 0) as any

  return { element: prog.element, totalBuildUp, rows, virtual, panel }
}

/** 结算触发者条目：每人用自己的面板独立结算，触发次数按积蓄占比分摊 */
export interface AnomalySettlementEntry {
  slot: number
  /** 积蓄占比（0-1），含用户覆盖 */
  share: number
  /** 该触发者的触发次数（整数） */
  triggerCount: number
  /** 触发者自己的完整面板（结算区） */
  panel: PanelValues
  /** 显示用名称 */
  name: string
}

/**
 * 构建异常结算触发者列表。
 *
 * 改为「按触发次数分摊」：每个触发者用自己的面板独立结算，
 * 不再加权合成为一个面板。
 *
 * - 同属性角色（同色共享积蓄池）才有资格触发
 * - 触发次数 = round(share × totalTriggers)，末端补余保证总数一致
 */
export function buildAnomalySettlementEntries(
  build: AnomalyVirtualPanelBuild,
  panels: PanelValues[],
  totalTriggers: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalySettlementEntry[] {
  // 同属性角色筛选（用 virtual panel row 的 settlementEligible 字段）
  const settlementRows = build.rows.filter(row => row.settlementEligible)
  const rows = settlementRows.length > 0 ? settlementRows : build.rows

  // 份额（含用户覆盖）。单人结算时强制 100%，不受异属性赋彩贡献稀释。
  const isSingle = rows.length === 1
  const shares = rows.map(row => {
    if (isSingle) return 1
    const override = configStore.getAnomalySettlementShare(build.element, row.slot)
    return override ?? row.weight
  })
  const shareTotal = isSingle ? 1 : (shares.reduce((a, b) => a + b, 0) || 1)

  // 触发次数分摊
  const rawCounts = shares.map(s => Math.round((s / shareTotal) * totalTriggers))
  const sumRaw = rawCounts.reduce((a, b) => a + b, 0)
  const diff = totalTriggers - sumRaw
  // 余数（正或负）加到第一个参与结算的角色上
  if (diff !== 0 && rawCounts.length > 0) {
    rawCounts[0] += diff
  }

  return rows.map((row, i) => {
    const agent = catalogStore.agentsMap.get(configStore.team[row.slot]?.agentId ?? '')
    return {
      slot: row.slot,
      share: shares[i] / shareTotal,
      triggerCount: Math.max(0, rawCounts[i] ?? 0),
      panel: panelAt(panels, row.slot) ?? emptyPanel(),
      name: agent?.name?.zhCN || `槽${row.slot + 1}`,
    }
  }).filter(e => e.triggerCount > 0)
}

// ============================================================================
// 蕾米埃尔专属异常辅助函数（`getRemielleLevelValue` / `remielleSpecialVoidflareCount` /
// `VoidflareDamageInput` / `calcVoidflareDamage`）已于 CC-19c-1（2026-09-26）逐字迁至
// `@/mechanics/agents/remielle`（设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）——
// 因为 `calcVoidflareDamage` 需要 `core/elementKeys` 的三张表，而判据 19 禁止 mechanics
// 按值 import `@/composables`。本块是 **re-export 壳**：`helpers.ts` / `useResourceCalc.ts` /
// `damagePoolAnomaly.ts` / 既有测试的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**。
// ⚠ 改这几个函数请改 `mechanics/agents/remielle.ts`，不要回本文件重建同形函数。
// ============================================================================
// CC-34d（2026-09-27）：3 个运行时函数的 re-export 已删除（唯一经壳导入的调用方是 remielle.test，已改为直接导入）。
// 类型 `VoidflareDamageInput` 不带角色前缀，保留在壳里，供 helpers.ts 的类型壳使用。
export type { VoidflareDamageInput } from '@/mechanics/agents/remielle'

// ============================================================================
// 本簇 12 个公开符号（10 函数 + 4 interface 里的 2 个类型在本簇内联）在 `./helpers.ts` 保留
// **re-export 壳**（R22 熵批 2 / R22-S2 刀 C）：目录外既有消费者（`damagePool.ts` 取其中 7 个 /
// `cinemaUplift.ts` / `difficultyLadder.ts` / `views` / 测试）import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './anomalyPanels'` **不建本地绑定**。
// ⚠ 改异常面板/结算口径请改本文件，**不要回 `helpers.ts` 重建同形函数**（那会分裂单一事实源）。
// ============================================================================
