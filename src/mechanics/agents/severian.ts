/**
 * 赛维里安（1631，风属性·强攻，治安局）—— nanoka 3.3.12+19629936（v12 正式数值）。
 * 原文来源：data/raw/nanoka_missing/full/1631.json（证据契约 data/recordings/1631.json）。
 *
 * - 核心被动·风回无终：暴击伤害 +60%；**造成的伤害 +25%**，若队伍中存在**其他风属性角色**再 +30%
 *   （v12 新增乘区，旧 3.3.2 beta 无此句）。
 * - 额外能力·最优编配（[支援]/[击破]/同阵营，spec 声明式门控）：**每拥有 1% 暴击率 → 攻击力 +8.5 点，
 *   最多计入 100% 暴击率**（v12 由旧的固定 +700 攻击改为暴击率转模，面板阶段直加 atk）。
 * - 流息：疾锋四段命中 +20 / 烈旋 +35（发动15+命中20）/ 极限闪避 +15 / 连携 +35（影画1 → 50）/
 *   终结 +100；上限 150（影画6 → 180）；达 100 消耗发动苍风影猎（buildExecutions 产行，定点迭代含影画6[风起]反馈）。
 * - 影画1 双份浓缩：连携流息 35→50；登场技入场替换为连携技（60s 一次）；每次苍风影猎 +1 层[凭风]；
 *   **攻击命中无视目标 15% 风属性抗性**。
 * - 影画2 理性的缰绳：进入战场回复 150 点[流息]；极限闪避/苍风影猎时**穿透率 +20%，25 秒**。
 * - 影画4 光与影的界限：进入战斗或换入前场**攻击力 +10%，30 秒**；烈旋/苍风影猎时**喧响值获取效率 +10%，15 秒**。
 * - 影画6 在一颗小星星下：流息上限 180 且入场回复提升至 180；苍风影猎最后一击 **+350%**（旧 900%）；
 *   [风起] 每秒 5 点 × 5 秒 = 每次 +25 流息（旧 10×3=30）。
 * - [凭风]（入场技/连携/终结最后一击固定倍率 +60%/300%，层数滑块）与影画6 苍风影猎最后击 +350
 *   走 damageMultiplierOverride 同区加算。
 * - 长按风刃段（1631009）：每次强特长按持续耗能（满充 40 点），倍率/耗能/时间按满充比例滑块缩放。
 *
 * 未建模（spec notes 在册）：烁影层数状态机（只按「入场两层」的操作向量近似）、疾锋四段闪避强化
 * （1631020 无计数来源）、影画1「登场技替换为连携技」的招式替换本体（次数口径并入连携/终结收入）、
 * 影画6 流息上限截断（总量口径：来多少打多少）。
 */
import { clampRatio, whole } from '@/utils/finiteClamp'
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterOperationConfig, CharacterResourceResult, MechanicSetting } from '@/types/resource'
import { mechanicSettingPanelReader, mechanicSettingReader, capOfAuto } from '@/utils/mechanicSettingCfg'
import { getRowValue } from '@/data/moveTableQueries'
import { moduleExecRow } from '@/mechanics/moduleExecRow'
import { chargeLockComboAlignRatio } from '@/mechanics/chargeLock'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const setting = mechanicSettingReader(() => settings)
const settingOf = mechanicSettingPanelReader(() => settings)
export const SEVERIAN_ID = '1631'
/** 核心被动：暴击伤害 +60% */
export const SEVERIAN_CORE_CRIT_DMG = 60
/** 核心被动（v12）：造成的伤害 +25% */
export const SEVERIAN_CORE_DMG_BONUS = 25
/** 核心被动（v12）：队伍中存在其他风属性角色时，伤害额外 +30% */
export const SEVERIAN_CORE_DMG_BONUS_WIND_TEAM = 30
/** 额外能力（v12）：每 1% 暴击率 → 攻击力 +8.5 点 */
export const SEVERIAN_ADDITIONAL_ATK_PER_CRIT = 8.5
/** 额外能力（v12）：最多计入 100% 暴击率 */
export const SEVERIAN_ADDITIONAL_CRIT_CAP = 100
/** 影画1：连携技累积流息提升至 50 点 */
export const SEVERIAN_C1_CHAIN_FLOW = 50
/** 影画1：攻击命中无视目标 15% 风属性抗性 */
export const SEVERIAN_C1_WIND_RES_IGNORE = 15
/** 影画2：进入战场回复 150 点[流息] */
export const SEVERIAN_C2_ENTRY_FLOW = 150
/** 影画2：极限闪避/苍风影猎时穿透率 +20%（25 秒） */
export const SEVERIAN_C2_PEN_RATIO = 20
/** 影画4：进入战斗/换入前场攻击力 +10%（30 秒） */
export const SEVERIAN_C4_ATK_PCT = 10
/** 影画4：烈旋/苍风影猎时喧响值获取效率 +10%（15 秒） */
export const SEVERIAN_C4_DECIBEL_EFFICIENCY = 10
/** 影画6：[流息]上限 180 且进入战场回复提升至 180 */
export const SEVERIAN_C6_FLOW_CAP = 180
/** 影画6：苍风影猎最后一击额外伤害倍率固定提升 350%（v12；旧 900%） */
export const SEVERIAN_C6_SHADOW_MULT = 350
/** 影画6 [风起]：苍风影猎最后一击后每秒 5 点 × 5 秒 = 每次 +25 */
export const SEVERIAN_C6_WINDRISE_FLOW = 25
/** 凭风 1/2 层：入场技·连携·终结最后一击伤害倍率固定提升（百分点，同区加算） */
export const SEVERIAN_FENGFENG_MULT = [0, 60, 300] as const
/** 流息收入（点/次）：疾锋四段命中 +20、烈旋 +35、极限闪避 +15、连携 +35（影画1 → 50）、终结 +100 */
export const SEVERIAN_FLOW_BASIC4 = 20
export const SEVERIAN_FLOW_LIEXUAN = 35
export const SEVERIAN_FLOW_DODGE = 15
export const SEVERIAN_FLOW_CHAIN = 35
export const SEVERIAN_FLOW_ULT = 100
/** 苍风影猎最后一击释放时返还 20 点[流息]（烈旋长按路线，basic/description/1 原文） */
export const SEVERIAN_FLOW_SHADOW_LASTHIT = 20
/** 苍风影猎消耗 100 流息 */
export const SEVERIAN_SHADOW_FLOW_COST = 100

/** moveId（param 空间） */
export const SEVERIAN_SHADOW_MOVE_ID = '1631006' // 普通攻击：苍风影猎
export const SEVERIAN_LIEXUAN_MOVE_ID = '1631005' // 普通攻击：烈旋
export const SEVERIAN_WIND_BLADE_MOVE_ID = '1631009' // 强化特殊技：瞬风裂毁·长按风刃最大段
/** 长按风刃满充能量消耗（原文「风刃最大能量消耗 40点」，catalog energyCost 同源） */
export const SEVERIAN_WIND_BLADE_ENERGY = 40
export const SEVERIAN_CHAIN_MOVE_ID = '1631012' // 连携技：冽刃收割
export const SEVERIAN_ULT_MOVE_ID = '1631013' // 终结技：戮灭的风灾
export const SEVERIAN_ENTRY_MOVE_ID = '1631019' // 登场技：清场时刻
/** 凭风载体（入场类型招式最后一击） */
export const SEVERIAN_FENGFENG_CARRIERS: ReadonlySet<string> = new Set([
  SEVERIAN_CHAIN_MOVE_ID,
  SEVERIAN_ULT_MOVE_ID,
  SEVERIAN_ENTRY_MOVE_ID,
])
/** 疾锋四段（平A 段循环，第四段命中 +20 流息） */
export const SEVERIAN_BASIC_SEGMENT_IDS: readonly string[] = ['1631001', '1631002', '1631003', '1631004']

export interface SeverianCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreCritDmg: number
  coreDmgBonus: number
  atkFromCrit: number
  c1ChainFlow: number
  c1WindResIgnore: number
  c2EntryFlow: number
  c2PenRatio: number
  c4AtkPct: number
  c4DecibelEfficiency: number
  c6ShadowMultBonus: number
  flowCap: number
  fengfengStacks: number
  fengfengMultBonus: number
  note: string
}

/**
 * v12 循环明细（唯一算式入口：执行行 / 资源区块 / 面板三处共用）。
 *
 * 「其他风属性角色」判定走 `otherWindTeammate`（编排层按编成数，排除自身槽位）——
 * 面板阶段与执行行阶段的输入形状不同，由调用方各自算好传入，本函数不读 team。
 */
export function computeSeverianCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  otherWindTeammate: boolean
  critRateForConversion: number
  fengfengStacks: number
  triggerCoverage: number
}): SeverianCycle {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  const stacks = Math.max(0, Math.min(2, whole(input.fengfengStacks)))
  const coverage = clampRatio(input.triggerCoverage)
  const countedCrit = Math.max(0, Math.min(SEVERIAN_ADDITIONAL_CRIT_CAP, Number(input.critRateForConversion) || 0))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCritDmg: SEVERIAN_CORE_CRIT_DMG,
    coreDmgBonus: SEVERIAN_CORE_DMG_BONUS + (input.otherWindTeammate ? SEVERIAN_CORE_DMG_BONUS_WIND_TEAM : 0),
    atkFromCrit: input.additionalActive ? countedCrit * SEVERIAN_ADDITIONAL_ATK_PER_CRIT : 0,
    c1ChainFlow: cinemaLevel >= 1 ? SEVERIAN_C1_CHAIN_FLOW - SEVERIAN_FLOW_CHAIN : 0,
    c1WindResIgnore: cinemaLevel >= 1 ? SEVERIAN_C1_WIND_RES_IGNORE : 0,
    c2EntryFlow: cinemaLevel >= 2 ? SEVERIAN_C2_ENTRY_FLOW : 0,
    c2PenRatio: cinemaLevel >= 2 ? SEVERIAN_C2_PEN_RATIO * coverage : 0,
    c4AtkPct: cinemaLevel >= 4 ? SEVERIAN_C4_ATK_PCT : 0,
    c4DecibelEfficiency: cinemaLevel >= 4 ? SEVERIAN_C4_DECIBEL_EFFICIENCY * coverage : 0,
    c6ShadowMultBonus: cinemaLevel >= 6 ? SEVERIAN_C6_SHADOW_MULT : 0,
    flowCap: cinemaLevel >= 6 ? SEVERIAN_C6_FLOW_CAP : 150,
    fengfengStacks: stacks,
    fengfengMultBonus: SEVERIAN_FENGFENG_MULT[stacks],
    note: '烁影层数状态机/疾锋四段闪避强化/登场技替换连携技的招式本体未建模；流息按总量口径（来多少打多少，上限只进资源卡展示）。',
  }
}

/**
 * 凭风层数的**唯一口径**：影画1「每次释放苍风影猎获得 1 层凭风」⇒ 本局只要有 ≥1 次影猎，
 * 之后每个载体入场时至少 1 层（滑块是「极限闪避攒层」的手动近似，低于 1 时被影猎抬到 1）。
 * 影画2 不再给凭风层数（v12 改为穿透率 +20%），旧「C2 自动满 2 层」口径已废弃。
 */
export function resolveSeverianFengfengStacks(input: { cinemaLevel: number; shadowHuntCount: number; sliderStacks: number }): number {
  const slider = Math.max(0, Math.min(2, whole(input.sliderStacks)))
  if (cinemaLevelOf(input.cinemaLevel) >= 1 && input.shadowHuntCount >= 1) return Math.max(1, slider)
  return slider
}

/**
 * 疾锋第四段命中次数（平A 段循环，希格莉德 countBasicFinisherHits 同构：
 * 完整循环 1-4 各 1 次 #4；尾部余量推进到 #4 再计 1 次）。
 */
export function severianBasicFinisherHits(basicTime: number, cycle: { moveId: string; actionTime: number }[]): number {
  if (cycle.length === 0 || basicTime <= 0) return 0
  const cycleTime = cycle.reduce((s, seg) => s + seg.actionTime, 0)
  if (cycleTime <= 0) return 0
  const full = Math.floor(basicTime / cycleTime)
  const tail = basicTime - full * cycleTime
  const beforeFinisher = cycle.slice(0, -1).reduce((s, seg) => s + seg.actionTime, 0)
  return full + (tail >= beforeFinisher - 1e-9 ? 1 : 0)
}

/** 连携技每次累积的流息（影画1 提升至 50） */
export function severianChainFlow(cinemaLevel: number): number {
  return cinemaLevelOf(cinemaLevel) >= 1 ? SEVERIAN_C1_CHAIN_FLOW : SEVERIAN_FLOW_CHAIN
}

/**
 * 每次[苍风影猎]的事后返还流息：最后一击 +20（烈旋长按路线，basic/description/1 原文），
 * 影画6 再叠加[风起] +25。两者都是「释放之后才到账」⇒ 都不能付本次自己的 100 点成本，
 * 必须走 `severianFlowState` 的有序级联迭代（T122 口径）。
 */
export function severianShadowRefundFlow(cinemaLevel: number): number {
  return SEVERIAN_FLOW_SHADOW_LASTHIT + (cinemaLevelOf(cinemaLevel) >= 6 ? SEVERIAN_C6_WINDRISE_FLOW : 0)
}

/** 流息基础收入（不含[苍风影猎]事后返还项，返还项在 severianFlowState 定点迭代里加） */
function severianFlowIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  const cinema = cinemaLevelOf(cfg.severianCinemaLevel)
  const basicCycle = cfg.severianBasicCycle ?? []
  const basicTime = Math.max(0, state?.basicAttackTime ?? 0)
  const finisher = severianBasicFinisherHits(basicTime, basicCycle)
  const liexuan = severianLiexuanCount(cfg)
  return finisher * SEVERIAN_FLOW_BASIC4
    + liexuan * SEVERIAN_FLOW_LIEXUAN
    + Math.max(0, cfg.dodgeCounterCount) * SEVERIAN_FLOW_DODGE
    + Math.max(0, Number(state?.chainCountTotal ?? 0)) * severianChainFlow(cinema)
    + Math.max(0, Number(state?.ultimateCount ?? 0)) * SEVERIAN_FLOW_ULT
    + (cinema >= 2 ? SEVERIAN_C2_ENTRY_FLOW : 0)
}

/**
 * 流息总收入与苍风影猎次数（估时、物化与资源区块三处唯一共用入口）：
 * 影画6[风起]（每次苍风影猎 +25 流息）形成自指，定点迭代解（增益比 0.25 ⇒ 2 轮内稳定）。
 */
function severianFlowState(
  cfg: AgentCharConfigInput['cfg'],
  state: AgentResourceInput['state'] | undefined,
): { flowIncome: number; shadowHuntCount: number } {
  const cinema = cinemaLevelOf(cfg.severianCinemaLevel)
  const base = severianFlowIncome(cfg, state)
  const refund = severianShadowRefundFlow(cinema)
  let flow = base
  // 有序级联：第 N 次的返还只在第 N 次**消耗之后**到账（付款前库存 = base + (N−1)·refund）
  for (let i = 0; i < 16; i++) {
    const next = base + Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST) * refund
    if (next === flow) break
    flow = next
  }
  // 次数自动 = 流息收入 / 100；滑块 = 上限（用户口径 2026-10-19），0 = 不设上限。
  // 上限生效时流息收入按**实际打出来的次数**重算（少打 N 次 ⇒ 少 N 次返还），不是只改行数。
  const autoCount = Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST)
  const shadowHuntCount = capOfAuto(autoCount, whole(setting(cfg, 'severian.shadowHuntCount')))
  return { flowIncome: base + shadowHuntCount * refund, shadowHuntCount }
}

function severianShadowHuntCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  return severianFlowState(cfg, state).shadowHuntCount
}

function severianLiexuanCount(cfg: AgentCharConfigInput['cfg']): number {
  // 自动 = 极限闪避/闪反次数（烁影与受击驱动未建模）；滑块 = 上限，0 = 不设上限
  return capOfAuto(Math.max(0, cfg.dodgeCounterCount), whole(setting(cfg, 'severian.blazingSpinCount')))
}

/** 队伍里是否有**其他**风属性角色（核心被动 +30% 的唯一判定） */
function hasOtherWindTeammate(team: AgentPanelInput['team'] | undefined, slot: number): boolean {
  if (!team) return false
  return team.some(m => m.slot !== slot && m.agent?.attribute === 'wind')
}

function buildSeverianCharConfig({ cfg, cinemaLevel, skills, team, slot }: AgentCharConfigInput): void {
  cfg.severianCinemaLevel = cinemaLevel
  cfg.severianOtherWindTeammate = hasOtherWindTeammate(team, slot)
  // 合轴抵扣必须有并行对象（用户口径 2026-10-22「合轴时间只能给队友分配」）：单人队（golden 单角色档）不记
  cfg.severianHasComboPartner = team.some(m => !!m && m.slot !== slot && !!m.agentId)
  // 强化特殊技（组合技 1631008）走通用强特通道（v12 耗能 40）
  const special = skills.categories.find(c => c.id === 'special')?.moves.find(m => m.id === '1631008')
  if (special) {
    cfg.exSpecialMoveId = '1631008'
    if (special.actionTime) cfg.exSpecialActionTime = special.actionTime
    const ec = parseFloat(special.energyCost?.['Energy Cost'] ?? '')
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  // 凭风载体/苍风影猎/烈旋 基础倍率与时间（buildExecutions 输入无 skills，单一事实源=倍率表）
  const all = skills.categories.flatMap(c => c.moves)
  // CC-242：取行值走 data getRowValue（吃逻辑编辑器行规则，作用面 §24.85 ④ / §24.88）
  const multOf = (moveId: string) => getRowValue(all.find(m => m.id === moveId), 'damage')
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return { moveId, actionTime: m?.actionTime ?? 0, damage: multOf(moveId) }
  }
  cfg.severianCarrierMeta = [SEVERIAN_CHAIN_MOVE_ID, SEVERIAN_ULT_MOVE_ID, SEVERIAN_ENTRY_MOVE_ID].map(metaOf)
  cfg.severianShadowMeta = metaOf(SEVERIAN_SHADOW_MOVE_ID)
  cfg.severianLiexuanMeta = metaOf(SEVERIAN_LIEXUAN_MOVE_ID)
  cfg.severianWindBladeMeta = metaOf(SEVERIAN_WIND_BLADE_MOVE_ID)
  cfg.severianBasicCycle = SEVERIAN_BASIC_SEGMENT_IDS.map(metaOf)
}

/** `fengfengStacks` 由调用方经 `resolveSeverianFengfengStacks` 给定（需要影猎次数，cfg 上没有） */
function cycleFromCfg(cfg: Pick<CharacterOperationConfig, 'severianCinemaLevel' | 'severianOtherWindTeammate' | 'panel'>, fengfengStacks: number, critRate: number): SeverianCycle {
  return computeSeverianCycle({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    additionalActive: additionalAbilityActiveOf(cfg.panel),
    otherWindTeammate: cfg.severianOtherWindTeammate === true,
    critRateForConversion: critRate,
    fengfengStacks,
    triggerCoverage: clampRatio(setting(cfg, 'severian.triggerCoverage')),
  })
}

/**
 * 面板层（v12）：
 * ① 暴伤 +60 ② 增伤 +25（队伍有其他风角色再 +30）③ 额外能力：暴击率转攻击（每 1% → 8.5 点，上限 100%）
 * ④ 影画1 命中无视 15% 风抗 ⑤ 影画2 穿透率 +20×覆盖率 ⑥ 影画4 攻击力 +10% / 喧响效率 +10×覆盖率。
 *
 * 转模读 **panel.critRate 当下值**（本钩子按槽位顺序派发，本人面板的常驻暴击加成已入账；
 * 影画/队伍后置加成不回溯——与诺玛 1571 暴击率转模同口径）。
 */
function applySeverianPanel({ slot, team, cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const cycle = computeSeverianCycle({
    cinemaLevel,
    additionalActive: additionalAbilityActiveOf(panel),
    otherWindTeammate: hasOtherWindTeammate(team, slot),
    critRateForConversion: panel.critRate,
    fengfengStacks: Math.max(0, Math.min(2, whole(settingOf(settings, 'severian.fengfengStacks')))),
    triggerCoverage: clampRatio(settingOf(settings, 'severian.triggerCoverage')),
  })
  panel.critDmg = panel.critDmg + cycle.coreCritDmg
  panel.dmgBonus = panel.dmgBonus + cycle.coreDmgBonus
  if (cycle.atkFromCrit > 0) panel.atk = panel.atk + cycle.atkFromCrit
  if (cycle.c1WindResIgnore > 0) panel.enemyWindResReduction = panel.enemyWindResReduction + cycle.c1WindResIgnore
  if (cycle.c2PenRatio > 0) panel.penRatio = panel.penRatio + cycle.c2PenRatio
  if (cycle.c4AtkPct > 0) panel.atk = panel.atk * (1 + cycle.c4AtkPct / 100)
  if (cycle.c4DecibelEfficiency > 0) panel.decibelGainEfficiency = panel.decibelGainEfficiency + cycle.c4DecibelEfficiency
}

/** 苍风影猎/烈旋执行行（真实 moveId → enrich 从倍率表回填；倍率含影画6 +350 用 override 同区加算） */
function buildSeverianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.severianCinemaLevel)
  const shadowMeta = cfg.severianShadowMeta
  const liexuanMeta = cfg.severianLiexuanMeta

  const shadowCount = severianShadowHuntCount(cfg, state)
  if (shadowMeta && shadowCount > 0) {
    executions.push(moduleExecRow({
      moveId: shadowMeta.moveId,
      moveName: '普通攻击：苍风影猎',
      category: 'basic',
      element: 'wind',
      count: shadowCount,
      actionTime: shadowMeta.actionTime,
      // 单人队不写 ratio（没有并行对象 ⇒ 账本也不给 credit；行上写了就必须被兑现，CC-455）
      comboAlignRatio: cfg.severianHasComboPartner ? chargeLockComboAlignRatio(shadowMeta.actionTime) : 0,
      totalTime: shadowCount * shadowMeta.actionTime,
      totalComboAlignTime: shadowCount * shadowMeta.actionTime * (cfg.severianHasComboPartner ? chargeLockComboAlignRatio(shadowMeta.actionTime) : 0),
      ...(cinema >= 6
        ? { damageMultiplier: shadowMeta.damage + SEVERIAN_C6_SHADOW_MULT, damageMultiplierOverride: true }
        : {}),
      skillTableNote: `流息驱动 ×${shadowCount}（100 点/次${cinema >= 6 ? '，影画6 最后一击+350% 同区加算' : ''}）`,
    }))
  }
  const liexuanCount = severianLiexuanCount(cfg)
  if (liexuanMeta && liexuanCount > 0) {
    executions.push(moduleExecRow({
      moveId: liexuanMeta.moveId,
      moveName: '普通攻击：烈旋',
      category: 'basic',
      element: 'wind',
      count: liexuanCount,
      actionTime: liexuanMeta.actionTime,
      totalTime: liexuanCount * liexuanMeta.actionTime,
      skillTableNote: `烁影/受击自动发动 ×${liexuanCount}（按极限闪避次数近似，滑块可覆盖）`,
    }))
  }
  // 长按风刃段（1631009）：每次强特长按持续消耗能量（满充 40 点）发动；
  // 满充比例滑块 severian.windBladeChargeRatio——倍率/耗能/时间均按比例缩放（总量口径）。
  const windBladeMeta = cfg.severianWindBladeMeta
  const exCount = Math.max(0, state.exSpecialCount)
  const bladeRatio = clampRatio(setting(cfg, 'severian.windBladeChargeRatio'))
  if (windBladeMeta && exCount > 0 && bladeRatio > 0) {
    executions.push(moduleExecRow({
      moveId: windBladeMeta.moveId,
      moveName: '强化特殊技：瞬风裂毁（长按风刃段）',
      category: 'special',
      element: 'wind',
      count: exCount,
      actionTime: windBladeMeta.actionTime,
      totalTime: exCount * bladeRatio * windBladeMeta.actionTime,
      energyConsume: SEVERIAN_WIND_BLADE_ENERGY * bladeRatio,
      totalEnergyConsume: exCount * SEVERIAN_WIND_BLADE_ENERGY * bladeRatio,
      damageMultiplier: windBladeMeta.damage * bladeRatio,
      damageMultiplierOverride: true,
      skillTableNote: `长按持续风刃 ×${exCount}（满充比例 ${(bladeRatio * 100).toFixed(0)}%，倍率/耗能 40/时间按比例）`,
    }))
  }
}

/** 必做前台时间：苍风影猎 + 烈旋 + 长按风刃段（估时与 buildExecutions 同源计数） */
function severianExSpecialTime({ cfg, exSpecialCount, state }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const exTime = Math.max(0, exSpecialCount) * cfg.exSpecialActionTime
  const shadowMeta = cfg.severianShadowMeta
  const liexuanMeta = cfg.severianLiexuanMeta
  const windBladeMeta = cfg.severianWindBladeMeta
  const shadowTime = shadowMeta ? severianShadowHuntCount(cfg, state) * shadowMeta.actionTime : 0
  const liexuanTime = liexuanMeta ? severianLiexuanCount(cfg) * liexuanMeta.actionTime : 0
  const bladeRatio = clampRatio(setting(cfg, 'severian.windBladeChargeRatio'))
  const bladeTime = windBladeMeta ? Math.max(0, exSpecialCount) * bladeRatio * windBladeMeta.actionTime : 0
  // 苍风影猎 = 蓄力 1 秒锁 + 其余时间合轴给队友（用户裁决 2026-10-22「赛维里安也有这个强化a得做一下」）。
  // GROSS 约定：necessaryTime 仍按全额 actionTime（上面已含 shadowTime），合轴率部分进 comboAlignCredit 抵扣预算。
  const shadowAlign = shadowMeta && cfg.severianHasComboPartner
    ? severianShadowHuntCount(cfg, state) * shadowMeta.actionTime * chargeLockComboAlignRatio(shadowMeta.actionTime)
    : 0
  return {
    necessaryTime: exTime + shadowTime + liexuanTime + bladeTime,
    comboAlignTime: exTime * cfg.exSpecialComboAlignRatio + shadowAlign,
  }
}

function patchSeverianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // 执行行与资源区块共用 computeSeverianCycle（两处都直接读设置）
  const cycle = computeSeverianCycle({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    additionalActive: additionalAbilityActiveOf(cfg.panel),
    otherWindTeammate: cfg.severianOtherWindTeammate === true,
    critRateForConversion: cfg.panel.critRate,
    fengfengStacks: resolveSeverianFengfengStacks({
      cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
      shadowHuntCount: severianShadowHuntCount(cfg, state),
      sliderStacks: whole(setting(cfg, 'severian.fengfengStacks')),
    }),
    triggerCoverage: clampRatio(setting(cfg, 'severian.triggerCoverage')),
  })
  const carrierMeta = cfg.severianCarrierMeta ?? []
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 凭风：入场技/连携/终结最后一击伤害倍率固定 +60/+300（同区加算进倍率行）
    if (cycle.fengfengMultBonus > 0 && SEVERIAN_FENGFENG_CARRIERS.has(exec.moveId)) {
      const base = carrierMeta.find(m => m.moveId === exec.moveId)?.damage ?? 0
      exec.damageMultiplier = base + cycle.fengfengMultBonus
      exec.damageMultiplierOverride = true
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；凭风${cycle.fengfengStacks}层：最后一击倍率固定+${cycle.fengfengMultBonus}`
    }
  }
}

/** 赛维里安流转结果 = 循环明细 + 本轮流转收入 / 影猎次数（r407 由读者处交叉类型提为具名） */
export interface SeverianFlowResult extends SeverianCycle {
  flowIncome: number
  shadowHuntCount: number
}

function buildSeverianResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const { flowIncome, shadowHuntCount } = severianFlowState(cfg, state)
  const fengfengStacks = resolveSeverianFengfengStacks({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    shadowHuntCount,
    sliderStacks: whole(setting(cfg, 'severian.fengfengStacks')),
  })
  return {
    severianFlow: {
      ...cycleFromCfg(cfg, fengfengStacks, cfg.panel.critRate),
      flowIncome: Math.round(flowIncome),
      shadowHuntCount,
    },
  }
}

function buildSeverianResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.severianFlow
  if (!cycle) return []
  return [{
    id: 'severian-flow',
    title: '赛维里安·流息与凭风',
    summary: `流息收入 ${cycle.flowIncome} → 苍风影猎 ×${cycle.shadowHuntCount} · 凭风${cycle.fengfengStacks}层`,
    rows: [
      { label: '核心被动暴伤', value: `+${cycle.coreCritDmg}%`, detail: '风回无终' },
      { label: '核心被动增伤', value: `+${cycle.coreDmgBonus}%`, detail: '25 + 队伍其他风属性角色 30' },
      { label: '额外能力攻击', value: `+${Math.round(cycle.atkFromCrit)}`, detail: cycle.additionalActive ? '每 1% 暴击率 → 8.5 点（上限 100%）' : '未触发' },
      { label: '影画1连携流息', value: `+${cycle.c1ChainFlow}`, detail: '连携 35 → 50' },
      { label: '影画1无视风抗', value: `+${cycle.c1WindResIgnore}%`, detail: '攻击命中' },
      { label: '影画2入场流息', value: `+${cycle.c2EntryFlow}`, detail: '进入战场一次' },
      { label: '影画2穿透率', value: `+${cycle.c2PenRatio}%`, detail: '极限闪避/苍风影猎 ×覆盖率' },
      { label: '影画4攻击力', value: `+${cycle.c4AtkPct}%`, detail: '进入战斗/换入前场' },
      { label: '影画4喧响效率', value: `+${cycle.c4DecibelEfficiency}%`, detail: '烈旋/苍风影猎 ×覆盖率' },
      { label: '凭风倍率提升', value: `+${cycle.fengfengMultBonus}`, detail: '入场技/连携/终结最后一击（百分点）' },
      { label: '影画6苍风影猎', value: `+${cycle.c6ShadowMultBonus}`, detail: '最后一击倍率百分点' },
      { label: '流息上限', value: `${cycle.flowCap}`, detail: '影画6 提升至 180' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'severian.fengfengStacks',
    label: '赛维里安·凭风层数',
    description: '入场技/连携技/终结技入场时消耗的[凭风]层数：1层最后一击倍率固定+60、2层+300。极限闪避获得（最多2层）。影画1 每次苍风影猎+1层 ⇒ 本局有苍风影猎时至少按 1 层。',
    default: 1,
    min: 0,
    max: 2,
    step: 1,
    suffix: '层',
  },
  {
    id: 'severian.shadowHuntCount',
    label: '赛维里安·苍风影猎次数上限',
    description: '苍风影猎次数的**上限**。次数自动 = 流息收入/100（疾锋四段×20+烈旋×35+极限闪避×15+连携×35（影画1 50）+终结×100+影画2入场150，影画6[风起]定点反馈）；调低 = 你手动吞掉一部分（少打也少返还流息）。0 = 不设上限。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'severian.blazingSpinCount',
    label: '赛维里安·烈旋次数上限',
    description: '[普通攻击：烈旋]整局次数的**上限**。次数自动 = 极限闪避/闪反次数（烁影与受击驱动未建模）；调低 = 你手动吞掉一部分。0 = 不设上限。',
    default: 0,
    min: 0,
    max: 60,
    step: 1,
    suffix: '次',
  },
  {
    id: 'severian.windBladeChargeRatio',
    label: '赛维里安·长按风刃满充比例',
    description: '强化特殊技长按持续风刃段（1631009，满倍率818.4%）：每次强特按此比例满充（倍率/耗能40点/时间同缩放）。原文「长按可在炮击前持续消耗能量不断发动风刃」。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'severian.triggerCoverage',
    label: '赛维里安·影画2/4触发覆盖率',
    description: '影画2（极限闪避/苍风影猎 → 穿透率+20% 25秒）与影画4（烈旋/苍风影猎 → 喧响效率+10% 15秒）的整局覆盖率——两者触发源同为烈旋/影猎/极限闪避，合并为一个滑块。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const severianMechanic: AgentMechanicModule = {
  id: 'agent:severian',
  agentIds: [SEVERIAN_ID],
  name: '赛维里安·风回无终',
  description: 'v12：核心被动暴伤+60、增伤+25（队伍其他风角色再+30）、额外能力每1%暴击率→攻击+8.5（上限100%）；影画1 连携流息50/影猎+1凭风/无视15%风抗、影画2 入场150流息+穿透20%、影画4 攻击+10%/喧响效率+10%、影画6 流息上限180+苍风影猎最后击+350+风起5×5；流息→苍风影猎计数（估时-物化同源）。',
  applyPanel: applySeverianPanel,
  buildCharConfig: buildSeverianCharConfig,
  estimateExSpecialTime: severianExSpecialTime,
  buildExecutions: buildSeverianExecutions,
  patchExecutions: patchSeverianExecutions,
  buildResourceResult: buildSeverianResourceResult,
  resourceSections: buildSeverianResourceSections,
  settings,
}


/** 招式元数据（buildSeverianCharConfig 写入 cfg） */
interface SeverianMoveMeta { moveId: string; actionTime: number; damage: number }

/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 塞维林命座等级（buildCharConfig 写） */
    severianCinemaLevel?: number
    /** 塞维林：队伍存在其他风属性角色（buildCharConfig 写；核心被动 +30% 的唯一判定） */
    severianOtherWindTeammate?: boolean
    /** 队里是否有其他角色（合轴抵扣需要并行对象；单人队不记合轴） */
    severianHasComboPartner?: boolean
    /** 塞维林连携/终结/入场载体招式元数据 */
    severianCarrierMeta?: SeverianMoveMeta[]
    /** 塞维林影招式元数据 */
    severianShadowMeta?: SeverianMoveMeta
    /** 塞维林裂旋招式元数据 */
    severianLiexuanMeta?: SeverianMoveMeta
    /** 塞维林风刃招式元数据 */
    severianWindBladeMeta?: SeverianMoveMeta
    /** 塞维林平A各段元数据 */
    severianBasicCycle?: SeverianMoveMeta[]
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['severian_flow']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 塞维利安流转明细 */
    severianFlow?: SeverianFlowResult
  }
}
