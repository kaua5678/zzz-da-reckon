/**
 * 赛维里安（1631，风属性·强攻，治安局）—— ⚠️ 3.3 测试服临时录入（nanoka 3.3.2+18895034）。
 * 原文来源：data/raw/nanoka_missing/full/1631.json（双源对账 data/raw/gachabase/1631.json）。
 *
 * - 核心被动·风回无终：暴击伤害 +60%（applyPanel）。
 * - 额外能力·最优编配（[支援]/[击破]/同阵营，spec 声明式门控）：攻击力 +700（Lv60 上限，
 *   100+10/级，局内小攻击自拐，希格莉德 840 同款）；影画2 触发时额外 +15% 攻击力。
 * - 影画1：普通攻击暴击伤害 +60%（basic 组 moveId 限定 → patchExecutions critDmgBonus）。
 * - 影画4：极限闪避/苍风影猎 → 无视 16% 防御 × 覆盖率滑块（panel.enemyDefReduction）。
 * - [凭风]（入场技/连携/终结最后一击固定倍率 +60%/300%，层数滑块；**影画2 且本局有苍风影猎时自动满 2 层、
 *   滑块不参与**——T17 2026-10-04，口径见 `resolveSeverianFengfengStacks`）与
 *   影画6 苍风影猎最后一击 +900% 走 damageMultiplierOverride 同区加算。
 * - [流息]→苍风影猎：buildExecutions 产行（次数=流息收入/100，定点迭代含影画6[风起]反馈），
 *   estimateExSpecialTime 计入必要时间（青衣/希格莉德同款估时-物化同源）。
 * - 长按风刃段（1631009，818.4%）：每次强特长按持续耗能（满充 40 点），倍率/耗能/时间按
 *   满充比例滑块缩放（2026-09-12 用户纠错补录——耗能在「能量消耗」param 行 desc 文本里，
 *   强特组合技 80 点同源，catalog energyCost 已按真实值重导）。
 *
 * 未建模（spec notes 在册）：烁影状态机、疾锋四段闪避强化（1631020 无计数来源）、
 * 影画2「登场技替换为连携技」、流息上限截断（总量口径）。
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
import { execMatchesMove } from '@/types/resource'
import { mechanicSettingPanelReader, mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { getRowValue } from '@/data/moveTableQueries'
import { moduleExecRow } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const setting = mechanicSettingReader(() => settings)
const settingOf = mechanicSettingPanelReader(() => settings)
export const SEVERIAN_ID = '1631'
/** 核心被动：暴击伤害 +60% */
export const SEVERIAN_CORE_CRIT_DMG = 60
/** 额外能力：Lv60 攻击力 +700（100 + 10/级上限） */
export const SEVERIAN_ADDITIONAL_ATK_FLAT = 700
/** 影画1：普通攻击暴击伤害 +60% */
export const SEVERIAN_C1_BASIC_CRIT_DMG = 60
/** 影画2：触发最优编配时额外 +15% 攻击力 */
export const SEVERIAN_C2_ATK_PCT = 15
/** 影画4：无视 16% 防御 × 覆盖率 */
export const SEVERIAN_C4_DEF_IGNORE = 16
/** 凭风 1/2 层：入场技·连携·终结最后一击伤害倍率固定提升（百分点，同区加算） */
export const SEVERIAN_FENGFENG_MULT = [0, 60, 300] as const
/** 影画6：苍风影猎最后一击额外伤害倍率固定提升 900% */
export const SEVERIAN_C6_SHADOW_MULT = 900
/** 流息收入（点/次）：疾锋四段命中 +20、烈旋 +35、极限闪避（闪反行近似）+15、连携 +50、终结 +100 */
export const SEVERIAN_FLOW_BASIC4 = 20
export const SEVERIAN_FLOW_LIEXUAN = 35
export const SEVERIAN_FLOW_DODGE = 15
export const SEVERIAN_FLOW_CHAIN = 50
export const SEVERIAN_FLOW_ULT = 100
/** 影画1：进入战场 +100 流息（勘域 180s 一次 → 整局一次近似） */
export const SEVERIAN_C1_ENTRY_FLOW = 100
/** 影画6 [风起]：苍风影猎最后一击后每秒 10 点 ×3 秒 = 每次 +30 */
export const SEVERIAN_C6_WINDRISE_FLOW = 30
/** 苍风影猎消耗 100 流息 */
export const SEVERIAN_SHADOW_FLOW_COST = 100

/** moveId（param 空间） */
export const SEVERIAN_SHADOW_MOVE_ID = '1631006' // 普通攻击：苍风影猎
export const SEVERIAN_LIEXUAN_MOVE_ID = '1631005' // 普通攻击：烈旋
export const SEVERIAN_WIND_BLADE_MOVE_ID = '1631009' // 强化特殊技：瞬风裂毁·长按风刃最大段（818.4%）
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
/** 影画1 普攻暴伤作用范围：basic 组全部招式（疾锋四段/闪避强化/烈旋/苍风影猎） */
export const SEVERIAN_BASIC_MOVE_IDS: ReadonlySet<string> = new Set([
  ...SEVERIAN_BASIC_SEGMENT_IDS,
  '1631020', // 疾锋四段闪避成功强化
  SEVERIAN_LIEXUAN_MOVE_ID,
  SEVERIAN_SHADOW_MOVE_ID,
])


export interface SeverianCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreCritDmg: number
  atkFlat: number
  c2AtkPct: number
  c1BasicCritDmg: number
  c4DefIgnore: number
  fengfengStacks: number
  fengfengMultBonus: number
  c6ShadowMultBonus: number
  note: string
}

export function computeSeverianCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  fengfengStacks: number
  c4Coverage: number
}): SeverianCycle {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  const stacks = Math.max(0, Math.min(2, whole(input.fengfengStacks)))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCritDmg: SEVERIAN_CORE_CRIT_DMG,
    atkFlat: input.additionalActive ? SEVERIAN_ADDITIONAL_ATK_FLAT : 0,
    c2AtkPct: input.additionalActive && cinemaLevel >= 2 ? SEVERIAN_C2_ATK_PCT : 0,
    c1BasicCritDmg: cinemaLevel >= 1 ? SEVERIAN_C1_BASIC_CRIT_DMG : 0,
    c4DefIgnore: cinemaLevel >= 4 ? SEVERIAN_C4_DEF_IGNORE * clampRatio(input.c4Coverage) : 0,
    fengfengStacks: stacks,
    fengfengMultBonus: SEVERIAN_FENGFENG_MULT[stacks],
    c6ShadowMultBonus: cinemaLevel >= 6 ? SEVERIAN_C6_SHADOW_MULT : 0,
    note: '烁影状态机/疾锋四段闪避强化/登场技替换连携技未建模；流息按总量口径（来多少打多少）。',
  }
}

/**
 * 凭风层数的**唯一口径**（T17 2026-10-04，队列 §3 T17）：影画2「每次苍风影猎获得 2 层凭风」且上限 2 层
 * ⇒ 只要本局有 ≥1 次苍风影猎，之后每个载体（入场技/连携/终结最后一击）入场时都是满 2 层，
 * 滑块在 C2 下**不再参与**（它是「极限闪避攒层」的手动近似，C2 后被影猎自动封顶覆盖）。
 * 非 C2、或 C2 但 0 次影猎（流息不足 100）⇒ 仍读滑块。
 *
 * ⚠ 为什么不是卡面原话「滑块显式设置时优先」：机制设置协议（`buildCharConfig` 写 `setting:<id>`，恒为数字、
 * 缺省填 default，见 `utils/mechanicSettingCfg.ts`）分不出「用户设了 1」与「默认 1」；要区分就得给协议加 unset 哨兵，
 * 为一个滑块改全局协议不值。且 C2 下低于 2 层在物理上只可能发生在首次影猎之前的那一个载体，忽略。
 * 三个读者（执行行 `patchSeverianExecutions` / 资源区块 `buildSeverianResourceResult`）都经本函数，不再各自读滑块
 * （2026-09-20 round 48 那次「两路读数不一致」的教训）。
 */
export function resolveSeverianFengfengStacks(input: { cinemaLevel: number; shadowHuntCount: number; sliderStacks: number }): number {
  if (cinemaLevelOf(input.cinemaLevel) >= 2 && input.shadowHuntCount >= 1) return 2
  return Math.max(0, Math.min(2, whole(input.sliderStacks)))
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

/** 流息基础收入（不含影画6[风起]反馈项，反馈在 severianFlowState 定点迭代里加） */
function severianFlowIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  const cinema = cinemaLevelOf(cfg.severianCinemaLevel)
  const basicCycle = cfg.severianBasicCycle ?? []
  const basicTime = Math.max(0, state?.basicAttackTime ?? 0)
  const finisher = severianBasicFinisherHits(basicTime, basicCycle)
  const liexuan = severianLiexuanCount(cfg)
  return finisher * SEVERIAN_FLOW_BASIC4
    + liexuan * SEVERIAN_FLOW_LIEXUAN
    + Math.max(0, cfg.dodgeCounterCount) * SEVERIAN_FLOW_DODGE
    + Math.max(0, Number(state?.chainCountTotal ?? 0)) * SEVERIAN_FLOW_CHAIN
    + Math.max(0, Number(state?.ultimateCount ?? 0)) * SEVERIAN_FLOW_ULT
    + (cinema >= 1 ? SEVERIAN_C1_ENTRY_FLOW : 0)
}

/**
 * 流息总收入与苍风影猎次数（CC-333：估时、物化与资源区块三处唯一共用入口）：
 * 影画6[风起]（每次苍风影猎 +30 流息）形成自指，定点迭代解（增益比 0.3 ⇒ 2 轮内稳定）。
 */
function severianFlowState(
  cfg: AgentCharConfigInput['cfg'],
  state: AgentResourceInput['state'] | undefined,
): { flowIncome: number; shadowHuntCount: number } {
  const cinema = cinemaLevelOf(cfg.severianCinemaLevel)
  const base = severianFlowIncome(cfg, state)
  const override = setting(cfg, 'severian.shadowHuntCount')
  if (override > 0) {
    const shadowHuntCount = whole(override)
    const flowIncome = base + (cinema >= 6 ? shadowHuntCount * SEVERIAN_C6_WINDRISE_FLOW : 0)
    return { flowIncome, shadowHuntCount }
  }
  let flow = base
  if (cinema >= 6) {
    for (let i = 0; i < 8; i++) {
      const next = base + Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST) * SEVERIAN_C6_WINDRISE_FLOW
      if (next === flow) break
      flow = next
    }
  }
  return { flowIncome: flow, shadowHuntCount: Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST) }
}

function severianShadowHuntCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  return severianFlowState(cfg, state).shadowHuntCount
}

function severianLiexuanCount(cfg: AgentCharConfigInput['cfg']): number {
  const override = setting(cfg, 'severian.blazingSpinCount')
  if (override > 0) return whole(override)
  return Math.max(0, cfg.dodgeCounterCount)
}

function buildSeverianCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  cfg.severianCinemaLevel = cinemaLevel
  cfg.severianAdditionalActive = additionalAbilityActiveOf(panel)
  // 强化特殊技（组合技 1631008）走通用强特通道
  const special = skills?.categories?.find(c => c.id === 'special')?.moves?.find(m => m.id === '1631008')
  if (special) {
    cfg.exSpecialMoveId = '1631008'
    if (special.actionTime) cfg.exSpecialActionTime = special.actionTime
    const ec = parseFloat(special.energyCost?.['Energy Cost'] ?? '')
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  // 凭风载体/苍风影猎/烈旋 基础倍率与时间（buildExecutions 输入无 skills，单一事实源=倍率表）
  const all = skills?.categories?.flatMap(c => c.moves) ?? []
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
  // 凭风层数 / 影画4 覆盖率：滑块 → cfg 的**唯一**通道。
  // ⚠ 历史缺陷（2026-09-20 round 48 管理员AA 分诊实测，与般岳 `rageGainCoverage`、安比
  // `c2StunCoverage` 同源）：`cycleFromCfg`（:224-225）读的是 `severianFengfengStacks` /
  // `severianC4Coverage`，而这两个字段**全仓无人写入** ⇒ 永远回落 `?? 1`
  // ⇒ `buildSeverianResourceResult` 产出的 `severianFlow` 里 `fengfengStacks` 恒 1、
  // `c4DefIgnore` 恒 = `SEVERIAN_C4_DEF_IGNORE × 1`（实测把 `severian.c4Coverage` 设为 0，
  // 资源区块仍报 `c4DefIgnore: 16`）。
  // 注意执行行路径（`patchSeverianExecutions` :333）走的是 `setting(cfg, 'severian.fengfengStacks')`
  // **正确读法** ⇒ 同一滑块在"执行行"生效、在"资源区块"失效（两路读数不一致，用户看到的区块骗人）。
  cfg.severianFengfengStacks = whole(setting(cfg, 'severian.fengfengStacks'))
  cfg.severianC4Coverage = clampRatio(setting(cfg, 'severian.c4Coverage'))
}

/** `fengfengStacks` 由调用方经 `resolveSeverianFengfengStacks` 给定（需要影猎次数，cfg 上没有） */
function cycleFromCfg(cfg: Pick<CharacterOperationConfig, 'severianCinemaLevel' | 'severianAdditionalActive' | 'severianC4Coverage'>, fengfengStacks: number): SeverianCycle {
  return computeSeverianCycle({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    additionalActive: cfg.severianAdditionalActive === true,
    fengfengStacks,
    c4Coverage: Number(cfg.severianC4Coverage ?? 1),
  })
}

function applySeverianPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const cycle = computeSeverianCycle({
    cinemaLevel,
    additionalActive: additionalAbilityActiveOf(panel),
    fengfengStacks: Math.max(0, Math.min(2, whole(settingOf(settings, 'severian.fengfengStacks')))),
    c4Coverage: clampRatio(settingOf(settings, 'severian.c4Coverage')),
  })
  panel.critDmg = panel.critDmg + cycle.coreCritDmg
  if (cycle.atkFlat > 0) panel.atk = panel.atk + cycle.atkFlat
  if (cycle.c2AtkPct > 0) panel.atk = Math.round(panel.atk * (1 + cycle.c2AtkPct / 100))
  if (cycle.c4DefIgnore > 0) panel.enemyDefReduction = panel.enemyDefReduction + cycle.c4DefIgnore
}

/** 苍风影猎/烈旋执行行（真实 moveId → enrich 从倍率表回填；倍率含影画6 +900 用 override 同区加算） */
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
      totalTime: shadowCount * shadowMeta.actionTime,
      ...(cinema >= 6
        ? { damageMultiplier: shadowMeta.damage + SEVERIAN_C6_SHADOW_MULT, damageMultiplierOverride: true }
        : {}),
      skillTableNote: `流息驱动 ×${shadowCount}（100 点/次${cinema >= 6 ? '，影画6 最后一击+900% 同区加算' : ''}）`,
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
  // 长按风刃段（1631009，收益高：满倍率 818.4%）：每次强特长按持续消耗能量（满充 40 点）发动；
  // 满充比例滑块 severian.windBladeChargeRatio——倍率/耗能/时间均按比例缩放（总量口径）。
  // 「能量消耗达最大时额外获得一层烁影」未建模（烁影为操作向量）。
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
      skillTableNote: `长按持续风刃 ×${exCount}（满充比例 ${(bladeRatio * 100).toFixed(0)}%，倍率/耗能 40/时间按比例；满充额外+1烁影未建模）`,
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
  return {
    necessaryTime: exTime + shadowTime + liexuanTime + bladeTime,
    comboAlignTime: exTime * cfg.exSpecialComboAlignRatio,
  }
}

function patchSeverianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // CC-333：执行行与资源区块共用 computeSeverianCycle（优先读 buildCharConfig 写入的字段，单测直调未跑 buildCharConfig 时回落 setting）
  const cycle = computeSeverianCycle({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    additionalActive: cfg.severianAdditionalActive === true,
    fengfengStacks: resolveSeverianFengfengStacks({
      cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
      shadowHuntCount: severianShadowHuntCount(cfg, state),
      sliderStacks: cfg.severianFengfengStacks !== undefined
        ? Number(cfg.severianFengfengStacks)
        : setting(cfg, 'severian.fengfengStacks'),
    }),
    c4Coverage: cfg.severianC4Coverage !== undefined
      ? Number(cfg.severianC4Coverage)
      : setting(cfg, 'severian.c4Coverage'),
  })
  const carrierMeta = cfg.severianCarrierMeta ?? []
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 影画1：普通攻击暴击伤害 +60%（basic 组 moveId 限定，执行级）
    if (cycle.c1BasicCritDmg > 0 && execMatchesMove(exec, SEVERIAN_BASIC_MOVE_IDS)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + cycle.c1BasicCritDmg
    }
    // 凭风：入场技/连携/终结最后一击伤害倍率固定 +60/+300（同区加算进倍率行）
    if (cycle.fengfengMultBonus > 0 && SEVERIAN_FENGFENG_CARRIERS.has(exec.moveId)) {
      const base = carrierMeta.find(m => m.moveId === exec.moveId)?.damage ?? 0
      exec.damageMultiplier = base + cycle.fengfengMultBonus
      exec.damageMultiplierOverride = true
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；凭风${cycle.fengfengStacks}层：最后一击倍率固定+${cycle.fengfengMultBonus}`
    }
  }
}

/** 塞维利安流转结果 = 循环明细 + 本轮流转收入 / 影猎次数（r407 由读者处交叉类型提为具名） */
export interface SeverianFlowResult extends SeverianCycle {
  flowIncome: number
  shadowHuntCount: number
}

function buildSeverianResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const { flowIncome, shadowHuntCount } = severianFlowState(cfg as AgentCharConfigInput['cfg'], state as AgentResourceInput['state'])
  const fengfengStacks = resolveSeverianFengfengStacks({
    cinemaLevel: cinemaLevelOf(cfg.severianCinemaLevel),
    shadowHuntCount,
    sliderStacks: Number(cfg.severianFengfengStacks ?? 1),
  })
  return {
    severianFlow: {
      ...cycleFromCfg(cfg, fengfengStacks),
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
      { label: '额外能力攻击', value: `+${cycle.atkFlat}`, detail: cycle.additionalActive ? '最优编配已触发' : '未触发' },
      { label: '影画2攻击', value: `+${cycle.c2AtkPct}%`, detail: '触发最优编配时' },
      { label: '影画1普攻暴伤', value: `+${cycle.c1BasicCritDmg}%`, detail: 'basic 组 moveId 限定' },
      { label: '影画4无视防御', value: `+${cycle.c4DefIgnore}%`, detail: '极限闪避/苍风影猎触发 ×覆盖率' },
      { label: '凭风倍率提升', value: `+${cycle.fengfengMultBonus}`, detail: '入场技/连携/终结最后一击（百分点）' },
      { label: '影画6苍风影猎', value: `+${cycle.c6ShadowMultBonus}`, detail: '最后一击倍率百分点' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'severian.fengfengStacks',
    label: '赛维里安·凭风层数',
    description: '入场技/连携技/终结技入场时消耗的[凭风]层数：1层最后一击倍率固定+60、2层+300。极限闪避获得（最多2层）。影画2 每次苍风影猎+2层 ⇒ 影画2 且本局有苍风影猎时自动按 2 层，本滑块不参与。',
    default: 1,
    min: 0,
    max: 2,
    step: 1,
    suffix: '层',
  },
  {
    id: 'severian.shadowHuntCount',
    label: '赛维里安·苍风影猎次数覆盖',
    description: '手动指定整局苍风影猎次数；0=自动（流息收入/100：疾锋四段×20+烈旋×35+极限闪避×15+连携×50+终结×100+影画1入场100，影画6[风起]定点反馈）。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'severian.blazingSpinCount',
    label: '赛维里安·烈旋次数覆盖',
    description: '[普通攻击：烈旋]整局次数；0=自动（按极限闪避/闪反次数近似——烁影与受击驱动未建模）。',
    default: 0,
    min: 0,
    max: 60,
    step: 1,
    suffix: '次',
  },
  {
    id: 'severian.windBladeChargeRatio',
    label: '赛维里安·长按风刃满充比例',
    description: '强化特殊技长按持续风刃段（1631009，满倍率818.4%）：每次强特按此比例满充（倍率/耗能40点/时间同缩放）。原文「长按可在炮击前持续消耗能量不断发动风刃，能量消耗达最大时额外获得一层烁影」。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'severian.c4Coverage',
    label: '赛维里安·影画4覆盖率',
    description: '影画4：极限闪避或苍风影猎触发时无视16%防御（15秒）的整局覆盖率。',
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
  description: '⚠️3.3 测试服临时录入：核心被动暴伤+60、额外能力攻击+700（影画2再+15%）、影画1普攻暴伤+60（moveId限定）、影画4无视防御×覆盖率；凭风（入场招式最后击倍率+60/300）与影画6苍风影猎+900 同区加算；流息→苍风影猎计数（估时-物化同源）。',
  applyPanel: applySeverianPanel,
  buildCharConfig: buildSeverianCharConfig,
  estimateExSpecialTime: severianExSpecialTime,
  buildExecutions: buildSeverianExecutions,
  patchExecutions: patchSeverianExecutions,
  buildResourceResult: buildSeverianResourceResult,
  resourceSections: buildSeverianResourceSections,
  settings,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 塞维林命座等级（buildCharConfig 写） */
    severianCinemaLevel?: number
    /** 塞维林额外能力是否生效（buildCharConfig 由 panel 写） */
    severianAdditionalActive?: boolean
    /** 塞维林连携/终结/入场载体招式元数据 */
    severianCarrierMeta?: { moveId: string; actionTime: number; damage: number }[]
    /** 塞维林影招式元数据 */
    severianShadowMeta?: { moveId: string; actionTime: number; damage: number }
    /** 塞维林裂旋招式元数据 */
    severianLiexuanMeta?: { moveId: string; actionTime: number; damage: number }
    /** 塞维林风刃招式元数据 */
    severianWindBladeMeta?: { moveId: string; actionTime: number; damage: number }
    /** 塞维林平A各段元数据 */
    severianBasicCycle?: { moveId: string; actionTime: number; damage: number }[]
    /** 塞维林锋锋层数（机制设置取整） */
    severianFengfengStacks?: number
    /** 塞维林影画4 覆盖率（机制设置 clamp 到 [0,1]） */
    severianC4Coverage?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['severian_flow']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 塞维利安流转明细 */
    severianFlow?: SeverianFlowResult
  }
}
