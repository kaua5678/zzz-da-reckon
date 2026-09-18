/**
 * 面板 + 机制编排簇（自 `resourceCalc/helpers.ts` 整段迁出 —— R22 熵批 1 / T67-a1 刀 A，**纯搬迁**）。
 *
 * 职责：
 *   ① 面板两阶段 `computePanelPhases`（局外 → 局内；applyPanel 与队伍级面板效果的派发点）
 *   ② 队伍级机制钩子的三个派发器：`applyTeamMechanics`（相位写入）· `collectNextRoundFeedback`
 *      （本轮结果取回下一轮线程）· `collectAxisWindowOverlays`（轴窗口取值）
 *   ③ 额外能力门控登记表 `ADDITIONAL_GATE_BUFFS` + `evalAdditionalAbilityBuffGates`
 *
 * 迁移纪律：逐字节剪切，算式/常量值/条件/求值顺序零改动。
 * 上游单一入口仍是 `./helpers`（该文件保留 re-export 壳）⇒ 51 个消费者与 66 个测试的 import 零改动。
 *
 * ⚠ 落点必须是 `resourceCalc/` **目录直属**的 `.ts`：子目录会整类逃出
 * `listAgentBranchFiles()` 的 agentId 棘轮度量面（`scripts/check-guards.mjs`；R22 分诊 §3 闸门 4 实测）。
 * ⚠ 与 `./helpers` 是**双向 import**（本文件取 `isPctStat` / `getTeamAnomalyDurationBonus` /
 * `findSlotByIdentity`，那边取本文件的 re-export）——两边全是函数声明（提升）且模块初始化期
 * 零互读，故无 TDZ 风险；D 簇后续再拆时把这三个符号一并迁走即可解环。
 */
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { calcPanel, panelAt } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import type { CalcRoundThreads } from './roundThreads'
import {
  getAgentMechanic,
  getRegisteredMechanicSettings,
  type AgentAxisContext,
  type AgentInteractionContext,
  type AgentTeamPhase,
  type AxisScalarOverlays,
  type MechanicTeamMember,
} from '@/mechanics'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import type {
  CharacterOperationConfig,
  TeamResourceResult,
  AnomalyPoolResult,
  StunAxis,
} from '@/types/resource'
import type { PanelValues, TeammateBuff, Agent, DriveDiscConfig } from '@/types/catalog'
// 留在 helpers.ts 的本批反向依赖（B 簇只经这三个符号出边）
import { isPctStat, getTeamAnomalyDurationBonus, findSlotByIdentity } from './helpers'

export function buildMechanicTeamMembers(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): MechanicTeamMember[] {
  return configStore.team.map((char, slot) => ({
    slot,
    agentId: char.agentId,
    agent: char.agentId ? catalogStore.getAgent(char.agentId) ?? null : null,
    cinemaLevel: char.cinemaLevel ?? 0,
    potentialLevel: char.potentialLevel ?? 6,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
  }))
}

/** 角色 combatBuffs 是否已自带 3/5 命技能等级提升（避免通用规则重复叠加） */
function agentHasCinemaSkillLevelBuff(agent: any): boolean {
  return (agent?.combatBuffs?.cinemaBuffs ?? []).some((cinema: any) =>
    (cinema.buff?.effects ?? []).some((e: any) => e.stat === 'skillLevelBonus'),
  )
}

/**
 * 蕾米埃尔「额外能力三档失衡提升」的算式**已迁进** `src/mechanics/agents/remielle.ts`
 * （`remielleDazeBonusPct` / `applyRemiellePanel` / `buildRemielleCharConfig`，2026-09-17 round 21 夜间批 C）。
 *
 * 原先这里有一个 `resolveRemielleDazeBonus` 导出（唯一调用点就是本条迁移的两个站点）；迁移后全仓
 * 零调用点 ⇒ 删除，避免规则 16① 的「死口径」。两处调用点各自的语义**逐位保留**：
 * 面板阶段那条是 `applyPanel`（同槽自面板块），cfg 阶段那条是 `buildCharConfig`（双出口）。
 * ⚠ 不要再在本文件重建同形函数——「唯一写者 = 角色模块」正是本批要建立的判据（同 T6）。
 */

/** 计算单个角色的局内面板（复用 TeamConfigPage 同逻辑） */export function computePanel(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  return computePanelPhases(slot, configStore, catalogStore)?.inCombat ?? null
}

/**
 * 把全部已注册机制滑块解析成 `id → 当前值`（用户值优先，缺省回落 setting.default）。
 *
 * 供 `applyPanel` 钩子读覆盖率类滑块用（AgentPanelInput.settings）——在此之前 applyPanel
 * 拿不到 configStore，只能靠「computePanelPhases 硬编码块」或「经 panel 字段走私」两种绕法，
 * 后者曾静默失效（般岳 rageGainCoverage）。见 mechanics/types.ts 的 AgentPanelInput 注释。
 */
export function resolveMechanicSettings(
  configStore: ReturnType<typeof useConfigStore>,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const setting of getRegisteredMechanicSettings()) {
    out[setting.id] = configStore.getMechanicSetting(setting.id, setting.default)
  }
  return out
}

/**
 * 派发队伍级机制钩子（`applyTeamConfig`）。
 *
 * 顺序 = 槽位 0→1→2（确定、可复现；不用 registry 插入顺序，避免注册顺序影响数值）。
 * 编排层只需在三个阶段各调一次本函数，不再 import 具体角色的 applyXxxTeamFlags：
 *   build（cfg 刚建好）→ converge（带上一轮次数）→ postRound（为下一轮注入派生量）。
 */
export function applyTeamMechanics(params: {
  characters: CharacterOperationConfig[]
  configStore: ReturnType<typeof useConfigStore>
  catalogStore: ReturnType<typeof useCatalogStore>
  phase: AgentTeamPhase
  combatTime?: number
  exCounts?: number[]
  ultimateCounts?: number[]
  stunCount?: number
  /**
   * **计数投影版**失衡次数（只读）。**只有 converge 相位该传**——语义/理由/门控见
   * `AgentTeamConfigInput.countStun` 头注释（`stunCount` 是实数计划值、本字段是计数通道的整数投影，
   * 难度阶梯 G4 投影打开时二者**不等价**）。
   * 消费先例：莱卡恩 1141 的 `lycaonC2Energy` 非轴臂（round 20 C-γ，原为 convergence.ts 的 agentId 分支）。
   */
  countStun?: number
  teamEnergyConsumed?: number
  /** 全队强击触发次数（上一轮异常池收敛值；爱丽丝剑仪 `alice_team_assault_gain` 用） */
  aliceTeamAssaultCount?: number
  /** 全队紊乱次数（上一轮异常池收敛值；爱丽丝剑仪 `alice_disorder_gain` 用） */
  aliceDisorderCount?: number
  /** 上一轮收敛线程快照（跨轮反馈通用通道；模块按需读并写进自己那份 cfg，规则 6） */
  threads?: Readonly<CalcRoundThreads>
  /**
   * 本轮失衡轴上下文（只读快照）。**只有 converge 相位该传**——build 相位轴还没解析、
   * postRound 相位语义是「为下一轮」；传了就等于给模块一个错的相位信号。
   * 消费先例：朱鸢 1241 / 悠真 1201 的轴内块计数（round 11 批次 1，原为 convergence.ts 的 agentId 分支）。
   */
  axis?: Readonly<AgentAxisContext>
  /**
   * 全队**未缩放**交互次数快照（只读）。**只有 converge 相位该传**——语义与理由见
   * `AgentInteractionContext` 头注释（`characters` 上那份已被 interactionScale/parrySplit 改过）。
   * 消费先例：仪玄 1371 的 `yixuanExtremeAssistCap` + 莱卡恩 1141 的 `lycaonBackstageDodgeCount`
   * （round 14，原为 convergence.ts 的 agentId 分支）。
   */
  interactions?: Readonly<AgentInteractionContext>
  /**
   * 配装页「保底目标」三开关（只读快照）。**只有 converge 相位该传**——语义/理由/门控见
   * `AgentTeamConfigInput.guarantee` 头注释（`guarantee.*` 刻意**不**注册 `MechanicSetting`）。
   * 消费先例：般岳 1471 的 `autoTopUp`（round 21 夜D，原为 convergence.ts 的 agentId 分支）。
   */
  guarantee?: Readonly<{ stun: boolean; fury: boolean; ultimate: boolean }>
  /**
   * 本局 Boss 预设参与弹刀反推的三项（只读快照）。**只有 converge 相位该传**——语义/理由见
   * `AgentTeamConfigInput.boss` 头注释。消费先例：般岳 1471 的 `autoTopUp`（round 21 夜D）。
   */
  boss?: Readonly<{ parryTotal: number; parryNoFollowUpTotal: number; parryDecibelOnlyTotal: number }>
}): void {
  const { characters, configStore, catalogStore, phase } = params
  if (characters.length === 0) return
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const settings = resolveMechanicSettings(configStore)
  const combatTime = params.combatTime ?? 180
  const exCounts = params.exCounts ?? characters.map(() => 0)
  const ultimateCounts = params.ultimateCounts ?? characters.map(() => 0)
  const stunCount = params.stunCount ?? 0
  // 计数投影版失衡次数：**不做 `?? 0` 兜底**——`0` 是合法失衡次数，用它冒充断路会让
  // 「接口没接上」与「这局真的 0 次失衡」不可分辨（与 axis/interactions 同款纪律）。
  const countStun = params.countStun
  const teamEnergyConsumed = params.teamEnergyConsumed ?? 0
  const aliceTeamAssaultCount = params.aliceTeamAssaultCount ?? 0
  const aliceDisorderCount = params.aliceDisorderCount ?? 0
  const threads = params.threads
  // 轴上下文：**不做 `?? {}` 兜底**——缺省即 undefined 递给模块，模块用
  // `phase !== 'converge' || !axis` 双判据门控（缺了就是缺了，不许静默降级成空快照）。
  const axis = params.axis
  // 未缩放交互次数：同样**不做 `?? {}` 兜底**（理由同上）。
  const interactions = params.interactions
  // 保底目标三开关 / Boss 弹刀三项：同样**不做 `?? {…}` 兜底**——伪造一份全 false 快照会让
  // 「契约没接上」与「用户没勾保底」不可分辨（模块侧双判据门控，见类型头注释）。
  const guarantee = params.guarantee
  const boss = params.boss


  // 各槽位「异常积储主元素」（2026-09-02）：优先模块声明（雅模块把积蓄归并为 frostfire；
  // 见 AgentMechanicModule.anomalyBuildupElement），否则按倍率表 anomaly_buildup 之和最大的
  // move.damageElement。供跨角色转积蓄机制（柚叶十人十色）定位目标——agent.damageElement
  // 常与招式级元素不一致（星见雅 agent=ice / 招式=烈霜），此前用 agent 级元素导致转进错池。
  const anomalyBuildupElementBySlot: Record<number, string | undefined> = {}
  for (const cfg of characters) {
    const declared = getAgentMechanic(cfg.agentId)?.anomalyBuildupElement
    if (declared) { anomalyBuildupElementBySlot[cfg.slot] = declared; continue }
    const skills = catalogStore.getAgentSkills(cfg.agentId)
    const sums = new Map<string, number>()
    for (const cat of skills?.categories ?? []) {
      for (const mv of cat.moves) {
        const bu = mv.rows?.find(r => r.id === 'anomaly_buildup')?.values[0]
        const el = mv.damageElement ?? ''
        if (bu && bu > 0 && el) sums.set(el, (sums.get(el) ?? 0) + bu)
      }
    }
    let best: string | undefined
    let bestSum = 0
    for (const [el, s] of sums) if (s > bestSum) { bestSum = s; best = el }
    anomalyBuildupElementBySlot[cfg.slot] = best
  }

  for (const cfg of [...characters].sort((a, b) => a.slot - b.slot)) {
    const hook = getAgentMechanic(cfg.agentId)?.applyTeamConfig
    if (!hook) continue
    hook({
      slot: cfg.slot,
      // 本模块自己那份 cfg：派发器正在遍历它，直接递进去。压缩数组（空槽被跳过）下
      // `characters[slot]` 在「前导/中间空槽」时会取到 undefined 或别人那份（规则见类型注释）。
      cfg,
      agent: catalogStore.getAgent(cfg.agentId) ?? null,
      cinemaLevel: configStore.team[cfg.slot]?.cinemaLevel ?? 0,
      potentialLevel: configStore.team[cfg.slot]?.potentialLevel ?? 6,
      characters,
      team,
      settings,
      anomalyBuildupElementBySlot,
      phase,
      combatTime,
      exCounts,
      ultimateCounts,
      stunCount,
      countStun,
      teamEnergyConsumed,
      aliceTeamAssaultCount,
      aliceDisorderCount,
      threads,
      axis,
      interactions,
      // 保底目标三开关 + Boss 弹刀三项（round 21 夜D）：**原样透传，不兜底**——
      // 缺省就是 undefined，模块用 `phase !== 'converge' || !guarantee` 双判据分辨断路。
      guarantee,
      boss,
      // 倍率表访问（round 21 夜D）：雨果 1291 的轴内窗口终结时长反推要查动作 actionTime。
      // 与 `collectNextRoundFeedback` 的同名入参同款（那里也是从 catalogStore 现场构造）。
      getAgentSkills: (agentId: string) => catalogStore.getAgentSkills(agentId),
    })
  }
}

/**
 * 派发「下一轮反馈」钩子（`nextRoundFeedback`，规则 6 在编排层的落点，2026-09-16）。
 *
 * 与 `applyTeamMechanics` 的区别：那个按**相位**派发、入参是次数类标量、只写 cfg；
 * 本函数在**本轮结果已出**之后派发一次，入参是本轮结果快照（资源结果 + 异常池 + 上一轮线程），
 * **取回**各模块算出的下一轮线程值并 merge 成 `Partial<CalcRoundThreads>`，交给编排层统一
 * 写进 `threadsNext`（单一 owner，模块不写 threads——见 `roundThreads.ts` 头注释）。
 *
 * 为什么是「按槽位序逐模块派发」而不是「按 agentId 找函数」：后者正是本钩子要消灭的形状——
 * 迁移前 `convergence.ts` 里有 5 个 `compute*NextRoundFeedback` 纯函数 + 13 处 `agentId` 判断。
 * 现在编排层只知道「遍历本队 cfg，问每个模块要不要反馈」，认人的责任回到模块自己。
 *
 * 顺序 = 槽位 0→1→2（确定、可复现；与 `applyTeamMechanics` 同口径）。**只一队一个同名角色时
 * 才有意义**——同队重复角色在 UI 侧已被 `usedAgentIds` 过滤，此处不再防御（与既有钩子一致）。
 */
export function collectNextRoundFeedback(params: {
  characters: CharacterOperationConfig[]
  /** 本轮装配后的全队资源结果 */
  teamResult: TeamResourceResult
  /** 展示口径结果（缺省 = teamResult） */
  displayResult?: TeamResourceResult
  /** 调整后结果（诺姆赠链 / 琉音转大落地后）；null/缺省 = 本轮无调整 */
  adjustedResult?: TeamResourceResult | null
  anomalyPool: AnomalyPoolResult | null
  /** 上一轮收敛线程快照（首轮守卫与自身反馈输入） */
  prevThreads: Readonly<CalcRoundThreads>
  catalogStore: ReturnType<typeof useCatalogStore>
  combatTime?: number
}): Partial<CalcRoundThreads> {
  const { characters, teamResult, displayResult, adjustedResult, anomalyPool, prevThreads, catalogStore } = params
  const out: Partial<CalcRoundThreads> = {}
  if (characters.length === 0) return out
  const combatTime = params.combatTime ?? 180
  const getAgentSkills = (agentId: string) => catalogStore.getAgentSkills(agentId)
  for (const cfg of [...characters].sort((a, b) => a.slot - b.slot)) {
    const hook = getAgentMechanic(cfg.agentId)?.nextRoundFeedback
    if (!hook) continue
    const res = hook({
      slot: cfg.slot,
      cfg,
      characters,
      teamResult,
      displayResult,
      adjustedResult,
      anomalyPool,
      prevThreads,
      combatTime,
      getAgentSkills,
    })
    if (res) Object.assign(out, res)
  }
  return out
}

/**
 * 派发「失衡轴窗口覆盖」钩子（`axisWindowOverlays`，规则 6 的第四个落点）。
 *
 * 与 `applyTeamMechanics` 的区别：那个是**写入式**（模块改 cfg 字段），本函数是**取值式**
 * （模块算逐 moveId 覆盖量，编排层合并后交给伤害池）。原本这四块（般岳明王/仪玄凝神/佩洛伊斯
 * 阳炎/可琳扫除帮手）是 useResourceCalc 里四个各自按角色 id 找槽位的 computed
 * ——编排层替角色找槽位，每加一个轴覆盖角色就要再改一次编排层。
 *
 * 派发顺序 = 注册表顺序（取值式无写入，顺序不影响结果；与 applyTeamMechanics 的槽位序不同不需要）。
 * 返回扁平化后的四桶（与 `DamagePoolContext` 同名，调用方直接展开）+ 按槽位索引的标量表。
 *
 * ⚠ **这里没有「`axes.length === 0` 就早退」**（2026-09-16 round 16 删）。原来那行早退让
 * 「非轴折算臂」**物理不可达**（钩子根本不被调用）——非轴模式没有轴可扫描，但**有覆盖率滑块**，
 * 折算值正是要在非轴时算的。删掉后每个模块自己按 `isAxis` 分臂（轴 → 扫描桶 / 非轴 → 折算标量），
 * 与 `damagePool.ts` 原来的 `if (isAxis) {…} else {…}` 两臂一一对应。
 * 早退的另一半（模块内的 `if (axes.length === 0) return null`）同样已被 `isAxis` 取代
 * ——**别把任何一方加回来**：留任一个都会让非轴支静默死掉（数值偏小、无测试会红）。
 *
 * 门控值（`additionalAbilityActive` / `windInfectionRate`）与伤害池 `execPanel` **同源同值**：
 * 两者都取自 `damagePanels` 的同一槽（`panelAt` 按身份取），故迁移前后逐位一致。
 * ⚠ `windInfectionRate` **不在 `cfg.panel` 上**（`computePanelPhases` 只写 `infectionZoneBonus`）
 * ——2026-09-16 round 16 实测 `cfg.panel.windInfectionRate === undefined`，所以只能从 `damagePanels` 递。
 */
export function collectAxisWindowOverlays(
  axes: StunAxis[],
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  isAxis: boolean,
  damagePanels: readonly PanelValues[],
): {
  banyueMingwangStacks: Map<string, number>
  yixuanNingshenMap: Map<string, { critDmg: number; sheerDmg: number }>
  peiluoKagerouMap: Map<string, number>
  corinStunBonusMap: Map<string, number>
  scalarBySlot: Map<number, AxisScalarOverlays>
} {
  const out = {
    banyueMingwangStacks: new Map<string, number>(),
    yixuanNingshenMap: new Map<string, { critDmg: number; sheerDmg: number }>(),
    peiluoKagerouMap: new Map<string, number>(),
    corinStunBonusMap: new Map<string, number>(),
    scalarBySlot: new Map<number, AxisScalarOverlays>(),
  }
  const getAgentSkills = (agentId: string) => catalogStore.getAgentSkills(agentId) as
    { categories: { id: string; moves: { id: string }[] }[] } | undefined
  // 滑块：与 `AgentPanelInput.settings` 同源（模块的非轴折算臂读它，缺省由模块回落注册 default）
  const settings = resolveMechanicSettings(configStore)
  for (const member of buildMechanicTeamMembers(configStore, catalogStore)) {
    const hook = getAgentMechanic(member.agentId)?.axisWindowOverlays
    if (!hook) continue
    // 门控值按身份取本槽面板（槽位号 ≠ 下标 ⇒ 走 panelAt，禁 `damagePanels[slot]`）。
    // 缺面板时 `additionalAbilityActive` 为 false、`windInfectionRate` 为 0——与伤害池原来的
    // `?? 0` 兜底同义（那时 `execPanel` 缺省同样落 0）。
    const memberPanel = panelAt(damagePanels as PanelValues[], member.slot)
    const res = hook({
      slot: member.slot,
      axes,
      cinemaLevel: member.cinemaLevel,
      getAgentSkills,
      isAxis,
      additionalAbilityActive: (memberPanel?.additionalAbilityActive ?? 0) > 0,
      windInfectionRate: Number(memberPanel?.windInfectionRate ?? 0),
      settings,
    })
    if (!res) continue
    if (res.banyueMingwangStacks) out.banyueMingwangStacks = res.banyueMingwangStacks
    if (res.yixuanNingshenMap) out.yixuanNingshenMap = res.yixuanNingshenMap
    if (res.peiluoKagerouMap) out.peiluoKagerouMap = res.peiluoKagerouMap
    if (res.corinStunBonusMap) out.corinStunBonusMap = res.corinStunBonusMap
    if (res.scalarBySlot) {
      for (const [slot, scalar] of res.scalarBySlot) out.scalarBySlot.set(slot, scalar)
    }
  }
  return out
}

/**
 * 计算最终面板的局外/局内两阶段（供最终面板展示：局外 = calcPanel.outOfCombat，
 * 局内 = 在局外基础上叠队友/全局 buff 与角色机制 applyPanel 修正后的权威面板，与计算完全一致）。
 */
/**
 * 额外能力门控簇登记表（规则 6：SOP §6.2 第 3 步「按 buff id 过滤」的唯一登记处）。
 *
 * agentId → 受该角色「额外能力」门控的 teammate-buff id 列表。新增来源为「额外能力」的 buff
 * 必须在此登记（并把求值接进 `evalAdditionalAbilityBuffGates`），否则门控静默失效——
 * 护栏：`src/composables/__tests__/additionalGate.test.ts` 断言本表与 catalog `teammate-buffs.json`
 * 的 `source === '额外能力'` buff、spec `teamBuffs` 的 `source === '额外能力'` 条目一一对应。
 *
 * ⚠ 三条不可机械等同的登记（2026-09-13 自散落注释收敛，语义逐位保留）：
 * - 1071 凯撒：同阵营之外「其他可招架支援角色」以「有任意队友」近似满足（见 evalAdditionalAbilityBuffGates）。
 * - 1461 席德：两条 buff 来源是核心被动/影画二（非「额外能力」），但与 spec additionalAbility
 *   同条件（spec 注明「核心被动与影画2 同条件，两条 buff 一并门控」）。
 * - 1421 潘引壶 cinema_1（影画一）随额外能力同条件门控；1281 派派与 1641 菲欧妮的 buff
 *   不在 catalog `teammate-buffs.json` 而在各自 spec 的 `teamBuffs`（结构不同：catalog 侧
 *   `sourceLabel.zhCN`、spec 侧 `source` 字符串）；菲欧妮 tier3 另需队伍 [异常] 角色数 ≥3。
 */
export const ADDITIONAL_GATE_BUFFS: Record<string, readonly string[]> = {
  // 丽娜：额外能力——队伍有[异常]或同阵营角色时，感电伤害提升
  '1211': ['rina.additional_electric_damage'],
  // 莱特：额外能力——士气高昂时，队中[冰]/[火]角色伤害提升
  '1161': ['lighter.additional_morale_ice_fire_dmg'],
  // 妮可：额外能力——队伍有[强攻]/[异常]角色时，以太伤害提升
  '1031': ['nicole.additional_ether_damage'],
  // 苍角：额外能力——旗势状态下，队中角色冰伤提升
  '1131': ['soukaku.additional_ice_damage'],
  // 凯撒：额外能力——「战意」状态下伤害提升（触发条件见表头 ⚠ 第 1 条）
  '1071': ['caesar.additional_battle_spirit_dmg'],
  // 本：额外能力——有护盾角色暴击率提升
  '1121': ['ben.additional_shield_crit_rate'],
  // 千夏额外能力·白日梦对位法：队伍存在[强攻]或与自身阵营（妄想天使）相同的角色时触发（帷幕失衡易伤+30%）
  '1491': ['buff_23620b7000'],
  // 照额外能力·凝聚力：队伍存在[强攻]或[异常]或[支援]角色时触发（全队增伤10%~40%按初始生命公式）
  '1341': ['zhao.additional_ability.dmg_bonus'],
  // 派派额外能力·同步疾驰：同属性、同阵营或其他异常队友在队，动力20层按稳态覆盖近似（buff 在 spec teamBuffs）
  '1281': ['piper_extra_team_damage'],
  // 潘引壶额外能力·食铁纳金：队伍存在[命破]或同阵营（云岿山）角色时触发（[气绝]增伤+20%，影画1再+10%）
  '1421': ['pan_yinhu.additional_stupefaction_dmg', 'pan_yinhu.cinema_1_stupefaction_dmg'],
  // 希希芙额外能力·毒素发酵：队伍存在[击破]或同属性（电）角色时触发（全队暴伤+40%、自身额外+10%）
  '1521': ['xixifu.additional_toxin_crit_dmg'],
  // 奥菲丝额外能力·熔炉所铸：队伍存在[击破]或[支援]角色时触发（准星聚焦追加攻击无视25%防御）
  '1301': ['orphie.additional_def_ignore'],
  // 席德核心被动/额外能力·花链协议/奇兵轰临：队伍存在其他[强攻]角色时触发（正兵明攻/围杀拐与影画2 无视防御）
  '1461': ['seed.core_vanguard_bright_attack', 'seed.cinema_2_encirclement_def_ignore'],
  // 菲欧妮（1641，⚠️3.3 测试服临时录入）额外能力：队伍存在其他[异常]/同阵营角色时触发
  // ——脆弱暴伤档位（spec teamBuffs，SOP §6.2 接线）；tier3 附加条件见 evalAdditionalAbilityBuffGates
  '1641': ['phoenix.weakness_anomaly_crit_dmg_tier2', 'phoenix.weakness_anomaly_crit_dmg_tier3'],
}

/**
 * 求 ADDITIONAL_GATE_BUFFS 登记的全部门控：buffId → 是否放行（未登记的 buff 不在 Map 中 = 不受门控，
 * 消费方判据为 `gates.get(buff.id) !== false`）。求值时机与迁移前逐位一致：面板阶段（calcPanel 之前）一次求值。
 */
export function evalAdditionalAbilityBuffGates(
  team: MechanicTeamMember[],
  getCatalogAgent: (agentId: string) => Agent | null,
): Map<string, boolean> {
  // 第一步：每角色按 spec additionalAbility 声明求值（不在队 = false）；slot 查找走索引表，零 agentId 特判
  const slotByAgentId = new Map<string, number>(team.map(member => [member.agentId, member.slot]))
  const activeByAgent = new Map<string, boolean>()
  for (const agentId of Object.keys(ADDITIONAL_GATE_BUFFS)) {
    const slot = slotByAgentId.get(agentId) ?? -1
    activeByAgent.set(agentId, slot >= 0
      && evalAdditionalAbility(team, slot, getCatalogAgent(agentId), getAgentSpec(agentId)?.additionalAbility) === true)
  }
  // 凯撒 1071 修正：同阵营（上式）之外，「其他可招架支援角色」以「有任意队友」近似满足
  {
    const slot = slotByAgentId.get('1071') ?? -1
    if (slot >= 0 && team.some(m => m.slot !== slot && !!m.agentId)) activeByAgent.set('1071', true)
  }
  // 第二步：展平为 buffId → active
  const gates = new Map<string, boolean>()
  for (const [agentId, buffIds] of Object.entries(ADDITIONAL_GATE_BUFFS)) {
    for (const buffId of buffIds) gates.set(buffId, activeByAgent.get(agentId) === true)
  }
  // 菲欧妮 1641 修正：tier3 另需队伍 [异常] 角色数 ≥3（含她自己；影画6 需求-1 = 有效数+1，2026-09-12 组队对账落地）
  {
    const slot = slotByAgentId.get('1641') ?? -1
    const cinemaLevel = slot >= 0 ? (team[slot]?.cinemaLevel ?? 0) : 0
    const anomalyCount = team.filter(m => m.agent?.specialty === 'anomaly').length + (cinemaLevel >= 6 ? 1 : 0)
    const tier3 = 'phoenix.weakness_anomaly_crit_dmg_tier3'
    gates.set(tier3, gates.get(tier3) === true && anomalyCount >= 3)
  }
  return gates
}

export function computePanelPhases(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): { outOfCombat: PanelValues; inCombat: PanelValues } | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const { enabledTeammateBuffs, sourcePanelsByOwner } = buildTeammateBuffSourceContext(configStore.team, {
    teammateBuffGroups: catalogStore.teammateBuffGroups,
    driveDiscSetsMap: catalogStore.driveDiscSetsMap,
    statRules: catalogStore.statRules,
    getAgent: (id) => catalogStore.getAgent(id),
    getWEngine: (id) => catalogStore.getWEngine(id),
    isTeammateBuffEnabled: (id) => configStore.isTeammateBuffEnabled(id),
  })

  // 莱特：昂扬公式读局内冲击力；喷发耗士气冲击 +20% 需并入 source 面板，否则公式少算一层。
  const lighterSource = sourcePanelsByOwner['1161']
  if (lighterSource?.inCombat) {
    lighterSource.inCombat = {
      ...lighterSource.inCombat,
      impact: (lighterSource.inCombat.impact ?? 0) * 1.2,
    }
  }

  // 耀嘉音：咏叹华彩公式用 dynamicSkillLevel（s）；源面板需写入 3/5 命技能等级加成。
  {
    const yjSlot = findSlotByIdentity(configStore, catalogStore, ['1311'])
    if (yjSlot >= 0) {
      const yjCinema = configStore.team[yjSlot]?.cinemaLevel ?? 0
      const skillBonus = yjCinema >= 5 ? 4 : yjCinema >= 3 ? 2 : 0
      const yjSource = sourcePanelsByOwner['1311']
      if (yjSource?.outOfCombat) {
        yjSource.outOfCombat = {
          ...yjSource.outOfCombat,
          skillLevelBonus: Math.max(yjSource.outOfCombat.skillLevelBonus ?? 0, skillBonus),
        }
      }
      if (yjSource?.inCombat) {
        yjSource.inCombat = {
          ...yjSource.inCombat,
          skillLevelBonus: Math.max(yjSource.inCombat.skillLevelBonus ?? 0, skillBonus),
        }
      }
    }
  }

  // 全局 Buff（属性配置页手动添加）转 TeammateBuff 并入 calcPanel 同批 apply：
  // 修复架构问题——此前全局 atkPct 等 core stat 在 calcPanel finalize 后补 apply，
  // applyCoreStatBonus 会把"当前合并 atk（含模块/硬编码块直加的局内固定值）"当 base 重新乘百分比，
  // 导致局内固定加成（如诺姆 870 / 琉音 500）被局内百分比错误放大（×1.2）。
  // 并入 calcPanel 后：局内 = 局外结果 × (1 + Σ局内%) + Σ局内固定，公式正确。
  const globalAsTeammateBuffs: TeammateBuff[] = configStore.globalBuffs
    .filter(b => b.enabled)
    .map(b => ({
      id: `global-${b.id}`,
      source: { zhCN: '全局Buff' },
      description: { zhCN: b.name },
      scope: 'inCombat' as const,
      effects: [{
        id: `global-${b.id}-effect`,
        type: 'fixed' as const,
        target: { kind: 'default' as const },
        stat: b.stat as TeammateBuff['effects'][number]['stat'],
        mode: (isPctStat(b.stat) ? 'pct' : 'flat') as 'pct' | 'flat',
        value: b.value,
        ...(b.targetSkillType && b.targetSkillType !== 'all' ? { targetSkillType: b.targetSkillType } : {}),
      }],
      buffModifiers: [],
      sourceType: 'teammate' as const,
      sourceCategory: 'agent' as const,
      sourceKind: 'global' as const,
      sourceLabel: { zhCN: '全局Buff' },
      ownerId: '',
      ownerName: { zhCN: b.name },
      teammateId: '',
      teammateName: { zhCN: b.name },
    }))
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  // 额外能力门控簇（14 角色 / 17 条 buff）：slot 查找 + evalAdditionalAbility 求值 + 按 buff id 过滤
  // 已收敛为数据驱动表 ADDITIONAL_GATE_BUFFS + evalAdditionalAbilityBuffGates（规则 6 棘轮 burn-down 第 1 批，
  // 2026-09-13 逐位等价迁移；原 14 个 `xxxAdditionalActive` + 17 条逐 id `.filter`）。语义偏离与注释全部保留在表侧。
  const additionalAbilityBuffGates = evalAdditionalAbilityBuffGates(
    team, id => catalogStore.getAgent(id) ?? null)
  const allTeammateBuffs = [...enabledTeammateBuffs, ...globalAsTeammateBuffs]
    .filter(buff => additionalAbilityBuffGates.get(buff.id) !== false)

  const effectCoverageMap = configStore.getWEngineEffectCoverageMap()
  for (const buff of allTeammateBuffs) {
    const coverage = configStore.getTeammateBuffCoverage(buff.id) / 100
    for (const effect of buff.effects ?? []) effectCoverageMap.set(effect.id, coverage)
  }
  mergeTeamDiscEffectCoverages(effectCoverageMap, configStore, catalogStore, teamDiscs(configStore))

  // 计算面板
  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    allTeammateBuffs,
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel,
      wEngineModLevel: char.wEngineModLevel,
      sourcePanelsByOwner,
      effectCoverageMap,
    },
  )

  // 局内面板（全局 buff 已并入 calcPanel，不再后补）
  const panel: PanelValues = { ...result.inCombat }
  // 局外回能总计（基础 × 局外加成 + 固定），供回能转模按局外口径读取。
  panel.energyRegenOutOfCombat = (result.outOfCombat.energyRegen ?? 1.2)
    * (1 + (result.outOfCombat.energyRegenBonusPct ?? 0) / 100)
    + (result.outOfCombat.energyRegenBonusFlat ?? 0)
  // 额外能力触发条件统一判定（声明式 spec.additionalAbility）：满足才写面板标记，模块/伤害池按标记开关。
  const aaSpec = getAgentSpec(agent.id)?.additionalAbility
  if (aaSpec) {
    panel.additionalAbilityActive = evalAdditionalAbility(team, slot, agent, aaSpec) ? 1 : 0
  }
  const mechanismSettings = resolveMechanicSettings(configStore)
  getAgentMechanic(agent.id)?.applyPanel?.({
    slot,
    agent,
    cinemaLevel: char.cinemaLevel ?? 0,
    potentialLevel: char.potentialLevel ?? 6,
    team,
    outOfCombatPanel: result.outOfCombat,
    panel,
    settings: mechanismSettings,
    // boss 基础失衡易伤：叶瞬光帷幕封顶算式（veilStunMultiplier）的唯一外部输入，
    // 原住在 damagePool.ts 的 `row.agentId === '1431'` 分支（2026-09-17 round 18 / R15-d 迁入模块）。
    // 静态敌人配置、非相位量 ⇒ 每次面板重算取当时值，与原先伤害池逐行读同一份。
    enemyStunVuln: configStore.enemy.stunVuln,
  })

  // ── 队伍级面板效果（规则 6，2026-09-17 round 20 R20-h3）────────────────────────────
  // 本槽自己的 `applyPanel` 跑完后，再让**全队每个模块**有机会向本槽面板贡献加成。
  // 原先这里是两组 `agent.id === '1161' / '1311'` 跨槽硬编码块（棘轮计数的那类）；
  // 现已收进各来源角色的 `teamPanelEffects`（模块自报「我在队时给谁加什么」）。
  //
  // 顺序纪律（契约见 `AgentTeamPanelEffectInput`）：按**槽位序**遍历来源 ⇒ 确定性；
  // 但多个来源写同一字段时结果仍与顺序有关 ⇒ 本钩子只允许做**可交换的加法**。
  // 莱特写 `energyGainEfficiency`、耀嘉音写 `dmgBonus`/`critDmg`/`anomalyBuildUpEfficiency`/
  // `stunBuildUpBonus`（两组字段无交集、全为 `+=`）⇒ 与迁移前逐位等价。
  for (const src of [...team].sort((a, b) => a.slot - b.slot)) {
    // 空槽（`agentId` 为空）与 catalog 查不到的 agent 都跳过：本钩子只对**真实在场的角色**派发，
    // 契约承诺 `agent` 非 null（`AgentTeamPanelEffectInput.agent` 声明为 `Agent`）。
    if (!src.agentId || !src.agent) continue
    const srcMechanic = getAgentMechanic(src.agentId)
    srcMechanic?.teamPanelEffects?.({
      slot: src.slot,
      agent: src.agent,
      cinemaLevel: src.cinemaLevel,
      team,
      targetSlot: slot,
      targetAgent: agent,
      panel,
      settings: mechanismSettings,
    })
  }
  // 蕾米埃尔「额外能力三档失衡提升」块已迁进 `remielle.ts#applyRemiellePanel`（规则 6，
  // 2026-09-17 round 21 夜间批 C）；派发点在 `:716` 的 `applyPanel`，早于本行
  // ⇒ `panel.remielleRadiantTurnDazeBonusPct` 此刻**已写好**，此处不得再写（否则双计）。

  // ⚠ **简专属块保留在编排层（本批实测判定：迁不动，不是没做）**：
  // 它读的 `jane.passionCoverage` **未注册成 MechanicSetting**（`getRegisteredMechanicSettings()`
  // 不含它，运行时实证）⇒ **不在 `AgentPanelInput.settings` 里**（`resolveMechanicSettings` 只铺注册项）。
  // 迁进 `jane.ts#applyJanePanel` 会把用户的滑块值静默丢掉——本批逐位等价对拍实测：
  // 滑块 0.5 的队伍 `physicalAnomalyBuildUpEfficiency` 由 **47.5 掉到 0**（`?? 0.9` 读不到 → 该项恒 0）。
  // 迁它**必须先注册 setting** = 多一个用户可见 UI 滑块（该页已有手写卡片 `janePassionSlot`），
  // 属**产品级口径**、用户未裁决 ⇒ **不注册、不迁、如实挂账**（分诊 §3.3 / §6.4）。
  // @fact jane:1261/狂热面板块落点 口径: 简的狂热/精通转攻/痛点/影画1/6 面板区**保留在 panelPhases.ts#computePanelPhases**（不在 jane.ts#applyPanel），因为其唯一输入 `jane.passionCoverage` 未注册为 MechanicSetting（不进 AgentPanelInput.settings），迁移会静默丢滑块值（逐位对拍实测：滑块 0.5 队 physicalAnomalyBuildUpEfficiency 47.5→0） | 据 本批逐位等价对拍@2026-09-17 | 验 src/composables/__tests__/helpersNightC.test.ts | 锚 src/composables/resourceCalc/panelPhases.ts#computePanelPhases | 信 确认
  // ⟳复核: 用户裁决「jane.passionCoverage 是否注册成 MechanicSetting」后复核——若注册，本块即可迁进 jane.ts#applyJanePanel（届时 settings 里有值），并删 ResourceUtilizationPage.vue 的手写卡片以避双滑块 | 到期 2026-12-31
  if (agent.id === '1261' || agent.teammateBuffId === '1261') {
    const cinema = char.cinemaLevel ?? 0
    const passionCoverage = configStore.getMechanicSetting('jane.passionCoverage', 0.9)
    const anomalyProficiency = panel.anomalyProficiency ?? 0

    // 狂热：物理积蓄+25%；精通>120时每点+2攻击，最多600。
    panel.physicalAnomalyBuildUpEfficiency += 25 * passionCoverage
    if (anomalyProficiency > 120) {
      panel.atk += Math.min(600, (anomalyProficiency - 120) * 2) * passionCoverage
    }

    // 额外能力：痛点。物理积蓄+20%；敌人处于异常状态时额外+15%（按100%覆盖）。
    const team = buildMechanicTeamMembers(configStore, catalogStore)
    const additionalActive = team.some(member =>
      member.slot !== slot && member.agent && (
        member.agent.specialty === 'anomaly' || member.agent.faction === agent.faction
      ),
    )
    if (additionalActive) {
      panel.physicalAnomalyBuildUpEfficiency += 20
      panel.physicalAnomalyBuildUpEfficiency += 15
    }

    // 1命：物理积蓄+15%；每点精通增伤0.1%，最多30%，按狂热覆盖率折算。
    if (cinema >= 1) {
      panel.physicalAnomalyBuildUpEfficiency += 15 * passionCoverage
      panel.dmgBonus += Math.min(30, anomalyProficiency * 0.1) * passionCoverage
    }

    // 6命：触发强击即狂热，狂热覆盖率按100%；双暴+20/40。
    if (cinema >= 6) {
      panel.critRate += 20
      panel.critDmg += 40
    }
  }

  // 蕾米强特 Radiant Turn 的“相变时流”：全队增伤，按技能等级 12/14/16 对应 18%/21%/24%。
  // 2026-09-17 round 21 夜间批 C 迁进 `remielle.ts#applyRemielleTeamPanelEffects`
  // （走**队伍级面板效果**钩子，派发点在 `:740` 的 `teamPanelEffects` 循环——该加成**随目标槽
  // 不同而不同**，写进蕾米自己的 `applyPanel` 只会加到蕾米本人面板，即分诊 §2.1 的 P2 陷阱）。
  // 3命技能等级+2、5命+4，统一进入伤害/失衡倍率系数；角色buff已带此条的跳过通用规则
  const cinema = char.cinemaLevel ?? 0
  if (!agentHasCinemaSkillLevelBuff(agent)) {
    panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
  }

  // 入队时长加成按元素写入面板，异常池覆盖率/紊乱/乱流统一读取
  panel.physicalAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'physical')
  panel.fireAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'fire')
  panel.electricAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'electric')
  panel.etherAnomalyDurationBonusSeconds = getTeamAnomalyDurationBonus(configStore, catalogStore, 'ether')

  // 风化侵染区：10% 独立乘区，仅风属性与染色属性直伤生效
  const windCharInTeam = configStore.team.some(char => {
    const member = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return member?.damageElement === 'wind'
  })
  panel.infectionZoneBonus = windCharInTeam ? 10 : 0

  return { outOfCombat: { ...result.outOfCombat }, inCombat: panel }
}

/** 计算蕾米特殊虚耀使用的“进场记录面板”：只吃自身被动/命座/音擎/驱动盘，不吃队友战内拐力 */
export function computeRemielleEntryPanel(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): PanelValues | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null

  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined

  const result = calcPanel(
    agent,
    wEngine,
    char.driveDisc,
    catalogStore.driveDiscSetsMap,
    [],
    catalogStore.statRules,
    {
      cinemaLevel: char.cinemaLevel ?? 0,
      wEngineModLevel: char.wEngineModLevel ?? 1,
      effectCoverageMap: (() => {
        const map = configStore.getWEngineEffectCoverageMap()
        mergeTeamDiscEffectCoverages(map, configStore, catalogStore, teamDiscs(configStore))
        return map
      })(),
    },
  )
  const panel = { ...result.inCombat }
  const cinema = char.cinemaLevel ?? 0
  if (!agentHasCinemaSkillLevelBuff(agent)) {
    panel.skillLevelBonus = (panel.skillLevelBonus ?? 0) + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
  }
  return panel
}
/** 全队各槽位的驱动盘配置（覆盖率并入用；空槽为 undefined 由 merge 侧跳过）。 */
function teamDiscs(configStore: ReturnType<typeof useConfigStore>): Array<DriveDiscConfig | undefined> {
  return (configStore.team ?? []).map(c => (c as { driveDisc?: DriveDiscConfig } | undefined)?.driveDisc)
}

/**
 * 驱动盘套装效果覆盖率并入 effectCoverageMap（C 类条件精化 2026-09-05）：
 * 条件类 4pc/2pc 效果的 uptime 由用户滑块折算（configStore.getDiscEffectCoverage，默认 100%），
 * 两处调用：buildCharConfig（资源/伤害管线）+ computePanelPhases（面板页）。
 * 无覆盖率记录的效果也写入（100%）→ 统一走 applyEffect 的 coverage 覆盖。
 *
 * @fact disc:覆盖率并入范围 口径: 必须并**全队三人**盘上的效果 id，不能只并本槽位的——4pc 全队段（teamBuff）由装备者供给、全队受益，覆盖率属于「效果」而非属于「受益者」；只并本槽位时装备者自己的山大王/月光骑士颂全队段滑块对队友面板是死控件（实测差值 +0） | 据 用户 2026-09-08「4件套没给属性滑块，是不是属性都没做」引发的可见性修复 | 验 src/core/__tests__/discSetEffects.test.ts | 锚 src/composables/resourceCalc/panelPhases.ts#mergeTeamDiscEffectCoverages | 信 确认
 * @param slotDiscs 全队各槽位的驱动盘配置（含空槽，自动跳过）
 */
function mergeTeamDiscEffectCoverages(
  map: Map<string, number>,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  slotDiscs: Array<DriveDiscConfig | undefined>,
): void {
  const setIds = new Set<string>()
  for (const disc of slotDiscs) {
    if (!disc) continue
    for (const id of [disc.fourPieceSetId, disc.twoPieceSetId]) if (id) setIds.add(id)
  }
  for (const setId of setIds) {
    const set = catalogStore.driveDiscSetsMap.get(setId)
    if (!set) continue
    const groups = [set.fourPiece?.selfBuff, set.fourPiece?.teamBuff, set.twoPiece]
    for (const g of groups) {
      for (const e of (g?.effects ?? []) as Array<{ id?: string }>) {
        if (!e?.id) continue
        map.set(e.id, configStore.getDiscEffectCoverage(e.id) / 100)
      }
    }
  }
}
