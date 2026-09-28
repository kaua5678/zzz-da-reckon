/**
 * mechanics 卫星类型：直伤 / 异常附加行相关钩子的输入输出（directRow*、extraDirectRows、extraAnomalyRows）。
 * CC-83（2026-09-27，census §5.90）自 `mechanics/types.ts` 逐字拆出；types.ts 原样转出，导入方不用改。
 */
// 纯类型导入（判据 19 豁免 import type，运行时擦除）：CC-19a 异常附加行返回类型；CC-19b `anomalyPool` 字段类型从 DamagePoolContext 推导。
import type { Agent, AgentSkills, PanelValues } from '@/types/catalog'
import type { AnomalyProgress, CharacterResourceResult, SkillExecution } from '@/types/resource'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'
import type { DamagePoolContext } from '@/composables/resourceCalc/damagePool'
import type { calcPoolAnomalyDamage as calcPoolAnomalyDamageFn, calcPoolDirectDamage as calcPoolDirectDamageFn, PoolAnomalyRow, PoolDirectRow } from '@/composables/resourceCalc/poolDamage'
import type { buildAnomalyVirtualPanel as buildAnomalyVirtualPanelFn, buildAnomalySettlementEntries as buildAnomalySettlementEntriesFn } from '@/composables/resourceCalc/anomalyPanels'
import type { AgentAxisOverlays, AxisScalarOverlays } from './typesHooks'

/**
 * `directRowBonus` 钩子输入（CC-17 2026-09-26，设计稿 `docs/mcp-cc17-axis-overlay-consume.md` §3）。
 *
 * 契约：`buckets` / `scalar` 都是**本行所属槽位**的 overlay（`bucketsBySlot.get(slot)` /
 * `scalarBySlot.get(slot)`），故模块读到的永远是「自己这个角色的」覆盖量——这是 CC-17 修
 * 可琳 `basic_attack` 泄漏的关键（旧实现把四个桶跨模块合并成全局表，见 `AgentAxisOverlays` 头注释）。
 */
/**
 * `directRowAxisSplit` 钩子入参（CC-33b 2026-09-27）：轴模式下，某些直伤行的「轴内（吃失衡易伤）占比」
 * 不能按该行自己的轴内块数算（如希希芙蚀骨：伤害来自毒素消耗，失衡内攒的毒素才在失衡内爆发）。
 * 由**行所属角色**的模块给占比；伤害池只在 `isAxis && axisSlots.has(slot)` 时询问，且排在
 * 赠链 / CD 自动行分支之后、伴随事件分支之前（与原希希芙专属分支同位）。
 */
export interface DirectRowAxisSplitInput {
  /** 当前行（模块按 `moveId` 认领；不认领返回 null） */
  exec: SkillExecution
  /** 行所属槽位 */
  slot: number
  /** 本槽资源结果（希希芙读 `specResources.xixifu_toxin` 与各类次数） */
  charResult: CharacterResourceResult
  /** 本槽某 moveId 的轴内块数（= 伤害池 `axisAllocation["${slot}:${moveId}"]?.inAxisUnits ?? 0`） */
  axisInUnits: (moveId: string) => number
}

/** `directRowAxisSplit` 返回：轴内占比（伤害池再夹到 [0,1]）与两段 note 片段（含前导「 · 」） */
export interface DirectRowAxisSplit {
  inFraction: number
  inNote: string
  outNote: string
}

export interface DirectRowBonusInput {
  /** 当前行（读 `moveId`；佩洛读 `peiluoKagerouPairRatio`） */
  exec: SkillExecution
  /** 真·轴模式布尔（口径同 `AgentAxisOverlayInput.isAxis`） */
  isAxis: boolean
  /** 本段是否轴内（>0 = 敌人失衡）；可琳的**段级**门控用 */
  stunOverride: number
  /** = `bucketsBySlot.get(本行 slot)`，即本槽模块 `axisWindowOverlays` 的原始返回 */
  buckets: AgentAxisOverlays | undefined
  /** = `scalarBySlot.get(本行 slot)`（与原 `overlayScalar` 同一个值） */
  scalar: AxisScalarOverlays | undefined
}

/**
 * `directRowBonus` 钩子返回类型（CC-17 2026-09-26）。
 *
 * 各字段语义与伤害池 `pushDirect` 的对应入参相同；`note` 是**已拼好的片段、含前导「 · 」**，
 * 顺序与原伤害池模板一致（明王 / 可琳 / 希格莉德 / 仪玄暴伤 / 仪玄贯穿；悠真片段由消费端
 * 放在 `rb.note` 之后，见设计稿 §3 第 3 条）。
 */
export interface DirectRowBonus {
  dmgBonus?: number
  critDmgBonus?: number
  sheerDmgBonus?: number
  /** 已拼好的片段，含前导「 · 」 */
  note?: string
}

/**
 * `extraDirectRows` 钩子输入（CC-18a 2026-09-26，设计稿
 * `docs/mcp-cc18-extra-direct-rows.md` §2-1）。
 *
 * 契约：`charResult` 是本槽资源结果（柏妮思读 `burniceMechanicSource`、半月扫 `executions` 上的
 * `banyueC6CrushAttach` 标记）；`panel` = `panelAt(damagePanels, slot)`（**本槽**面板，可能 undefined）；
 * `axisStunFor` 是消费端注入的伴随事件易伤查询（0/1，非轴回落全局覆盖率）。模块返回的每一行
 * 由消费端按返回顺序 `pushDirect`。
 */
export interface ExtraDirectRowsInput {
  /** 本槽资源结果 */
  charResult: CharacterResourceResult
  /** 本槽槽位号（pushDirect 行上原样透传） */
  slot: number
  /** = `panelAt(damagePanels, slot)`（本槽面板，缺 cfg 时为 undefined） */
  panel: PanelValues | undefined
  /** 真·轴模式布尔 */
  isAxis: boolean
  /** 伴随事件易伤 0/1（非轴回落全局覆盖率） */
  axisStunFor: (moveId: string) => number
  /** 按槽位查队友：panel = panelAt(damagePanels, slot)；agent = slot >= 0 ? (team[slot]?.agentId ? agentsMap.get(team[slot].agentId) : null) : null（逐字复刻原块 2 的两行） */
  teammateAt: (slot: number) => { panel: PanelValues | undefined; agent: Agent | null | undefined }
  /** = stunPoolResult?.stunCount ?? 0 */
  stunCount: number
  /** = ctx.ultPromoteCount（答案层 promote，原样透传，勿改来源） */
  promoteCount: number
  /** = configStore.getMechanicSetting */
  getMechanicSetting: (key: string, dflt: number) => number
  /** = env.ultimateInAxisFraction */
  ultimateInAxisFraction: () => number
}

/**
 * `extraAnomalyRows` 钩子返回类型（CC-19a 2026-09-26，设计稿
 * `docs/mcp-cc19-extra-anomaly-rows.md` §2.1）。
 */
export interface ExtraAnomalyRowGroup {
  /** 取 EXTRA_ANOMALY_ROW_ORDER 的值；决定跨角色的行顺序（= 原 damagePoolAnomaly 块序） */
  order: number
  rows: DamagePoolRow[]
}

/** 原 damagePoolAnomaly.ts 尾段块序（rowsnap 按行顺序求哈希，禁止改值） */
export const EXTRA_ANOMALY_ROW_ORDER = {
  burnBurstC6: 10,     // 块 1（19a）
  polarAssault: 20,    // 块 2（19b）
  assaultCritC6: 30,   // 块 3（19b）
  decisiveC6: 40,      // 块 4（19b）
  coweringDot: 50,     // 块 5（19b）
  voidflare: 60,       // 块 6（19c）
} as const

/**
 * `extraAnomalyRows` 钩子输入（CC-19a 2026-09-26，设计稿
 * `docs/mcp-cc19-extra-anomaly-rows.md` §2.2）。
 *
 * 契约：`buildVirtualPanel` / `buildSettlementEntries` 以闭包注入，是为了让 mechanics 不按值
 * import `composables/resourceCalc`（mechanics → composables 只允许 type 引用）；其类型用
 * `ReturnType<typeof …>` / `Parameters<typeof …>` 推导，勿手写结构体。`calcAnomalyDamage`
 * 由模块直接 `import { calcAnomalyDamage } from '@/core/damage'`（先例：liuyin.ts 引
 * `calcPenetrationPower`）。
 */
export interface ExtraAnomalyRowsInput {
  /** 本槽槽位号（派发循环的 slot） */
  slot: number
  /** = adjustedResourceResult?.characters.find(c => c.slot === slot)（原块 1 同式） */
  charResult: CharacterResourceResult | undefined
  /** = anomalyPoolResult?.coverage?.windCoverageRate ?? 0（尾段已有局部量 windRate） */
  windRate: number
  /** = (el) => anomalyPoolResult?.perElement.find(prog => prog.element === el) */
  anomalyProgress: (element: string) => AnomalyProgress | undefined
  /** = (prog) => buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore) */
  buildVirtualPanel: (
    prog: Parameters<typeof buildAnomalyVirtualPanelFn>[0],
  ) => ReturnType<typeof buildAnomalyVirtualPanelFn>
  /** = (build, count) => buildAnomalySettlementEntries(build, damagePanels, count, configStore, catalogStore) */
  buildSettlementEntries: (
    build: Parameters<typeof buildAnomalySettlementEntriesFn>[0],
    count: Parameters<typeof buildAnomalySettlementEntriesFn>[2],
  ) => ReturnType<typeof buildAnomalySettlementEntriesFn>
  axisStunFor: (moveId: string) => number
  /** = configStore.enemy（只读，块内用 defense / level / stunVuln） */
  enemy: { defense: number; level: number; stunVuln: number }
  enemyDamageRes: Record<string, number>
  /** = ctx.globalAnomalyMultiplier（全队异常伤害乘区） */
  anomalyMultiplier: number
  /** = (s) => configStore.team[s]?.agentId ?? '' */
  teamAgentId: (slot: number) => string
  /** = env.agentName */
  agentName: (agentId: string, slot: number) => string
  /** = panelAt(damagePanels, slot) */
  panel: PanelValues | undefined
  /** = configStore.team[slot]?.cinemaLevel ?? 0 */
  cinemaLevel: number
  isAxis: boolean
  /** = ctx.stunCoverage */
  stunCoverage: number
  /** = env.inWindowFraction */
  inWindowFraction: (element: string) => number
  /** = env.ultimateInAxisFraction（模块调用时传 input.slot） */
  ultimateInAxisFraction: (slot?: number) => number
  /** = (key) => allocMap[key]?.inAxisUnits ?? 0（allocMap = ctx.axisAllocation；爱丽丝 C6 读 `${slot}:1401012`） */
  axisInUnits: (key: string) => number
  /** = (k, d) => configStore.getMechanicSetting(k, d) */
  getMechanicSetting: (key: string, dflt: number) => number
  /** = ctx.anomalyPoolResult（只读整体注入，模块内读 .coweringDot；避免在 core 侧出现角色前缀字段） */
  anomalyPool: DamagePoolContext['anomalyPoolResult']
  /** = panelAt(entrySnapshotPanels, slot)（进场快照面板；ctx.entrySnapshotPanels 原样） */
  entryPanel: PanelValues | undefined
  /** = catalogStore.agentSkillsByAgentMap.get(configStore.team[slot]?.agentId ?? '') */
  skills: AgentSkills | undefined
  /** = (s) => panelAt(damagePanels, s) */
  panelOf: (slot: number) => PanelValues | undefined
  /** = (s) => catalogStore.agentsMap.get(configStore.team[s]?.agentId ?? '')?.damageElement ?? 'physical' */
  teamElement: (slot: number) => string
  /** = (k, d) => configStore.getTeamMechanicSetting(k, d) */
  getTeamMechanicSetting: (key: string, dflt: number) => number
  /** = elementLabel（单一来源 utils/agentLabelMaps#damageElementLabel，经 helpers 转出；闭包注入以绕开判据 19） */
  elementLabel: (element: string) => string
  /**
   * = (row) => calcPoolDirectDamage(poolEnv, row)（CC-176）：模块内的直伤（简 / 爱丽丝 6 命附伤）一律走它，
   * 与伤害池正路 pushDirect 同一入参拼装（面板通用减防减抗、敌人、侵染染色属性）。不要在模块里直接调 calcDirectDamage。
   */
  directDamage: (row: PoolDirectRow) => ReturnType<typeof calcPoolDirectDamageFn>
  /**
   * = (row) => calcPoolAnomalyDamage(poolEnv, row)（CC-177）：模块内的异常伤害（爱丽丝极性强击、柏妮思 6 命灼烧迸发）一律走它。
   * 只传面板之外的额外减防减抗（extraDefReduction / extraResReduction），结算面板上的由 calcAnomalyDamage 内部读。
   */
  anomalyDamage: (row: PoolAnomalyRow) => ReturnType<typeof calcPoolAnomalyDamageFn>
}
