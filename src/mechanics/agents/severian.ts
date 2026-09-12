/**
 * 赛维里安（1631，风属性·强攻，治安局）—— ⚠️ 3.3 测试服临时录入（nanoka 3.3.2+18895034）。
 * 原文来源：data/raw/nanoka_missing/full/1631.json（双源对账 data/raw/gachabase/1631.json）。
 *
 * - 核心被动·风回无终：暴击伤害 +60%（applyPanel）。
 * - 额外能力·最优编配（[支援]/[击破]/同阵营，spec 声明式门控）：攻击力 +700（Lv60 上限，
 *   100+10/级，局内小攻击自拐，希格莉德 840 同款）；影画2 触发时额外 +15% 攻击力。
 * - 影画1：普通攻击暴击伤害 +60%（basic 组 moveId 限定 → patchExecutions critDmgBonus）。
 * - 影画4：极限闪避/苍风影猎 → 无视 16% 防御 × 覆盖率滑块（panel.enemyDefReduction）。
 * - [凭风]（入场技/连携/终结最后一击固定倍率 +60%/300%，层数滑块）与
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
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'

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

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const v = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(v) ? v : fallback
}
function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const v = Number(settings?.[id])
  return Number.isFinite(v) ? v : fallback
}
function whole(value: number): number { return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }

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
  const cinemaLevel = whole(input.cinemaLevel)
  const stacks = Math.max(0, Math.min(2, whole(input.fengfengStacks)))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCritDmg: SEVERIAN_CORE_CRIT_DMG,
    atkFlat: input.additionalActive ? SEVERIAN_ADDITIONAL_ATK_FLAT : 0,
    c2AtkPct: input.additionalActive && cinemaLevel >= 2 ? SEVERIAN_C2_ATK_PCT : 0,
    c1BasicCritDmg: cinemaLevel >= 1 ? SEVERIAN_C1_BASIC_CRIT_DMG : 0,
    c4DefIgnore: cinemaLevel >= 4 ? SEVERIAN_C4_DEF_IGNORE * clamp01(input.c4Coverage) : 0,
    fengfengStacks: stacks,
    fengfengMultBonus: SEVERIAN_FENGFENG_MULT[stacks],
    c6ShadowMultBonus: cinemaLevel >= 6 ? SEVERIAN_C6_SHADOW_MULT : 0,
    note: '烁影状态机/疾锋四段闪避强化/登场技替换连携技未建模；流息按总量口径（来多少打多少）。',
  }
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

/** 流息基础收入（不含影画6[风起]反馈项，反馈在 countFromFlow 定点迭代里加） */
export function severianFlowIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.severianCinemaLevel ?? 0))
  const basicCycle = (record.severianBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  const basicTime = Math.max(0, Number((state as { basicAttackTime?: number } | undefined)?.basicAttackTime ?? 0))
  const finisher = severianBasicFinisherHits(basicTime, basicCycle)
  // 烈旋次数：手动覆盖优先；自动按极限闪避（闪反行）次数近似——烁影/受击驱动未建模
  const liexuan = setting(cfg, 'severian.blazingSpinCount', 0) > 0
    ? whole(setting(cfg, 'severian.blazingSpinCount', 0))
    : Math.max(0, Number(cfg.dodgeCounterCount ?? 0))
  return finisher * SEVERIAN_FLOW_BASIC4
    + liexuan * SEVERIAN_FLOW_LIEXUAN
    + Math.max(0, Number(cfg.dodgeCounterCount ?? 0)) * SEVERIAN_FLOW_DODGE
    + Math.max(0, Number(state?.chainCountTotal ?? 0)) * SEVERIAN_FLOW_CHAIN
    + Math.max(0, Number(state?.ultimateCount ?? 0)) * SEVERIAN_FLOW_ULT
    + (cinema >= 1 ? SEVERIAN_C1_ENTRY_FLOW : 0)
}

/**
 * 苍风影猎次数（估时与物化唯一共用入口）：floor(流息收入/100)。
 * 影画6[风起]（每次苍风影猎 +30 流息）形成自指，定点迭代解（增益比 0.3 ⇒ 2 轮内稳定）。
 */
export function severianShadowHuntCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined): number {
  const override = setting(cfg, 'severian.shadowHuntCount', 0)
  if (override > 0) return whole(override)
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.severianCinemaLevel ?? 0))
  const base = severianFlowIncome(cfg, state)
  let flow = base
  if (cinema >= 6) {
    for (let i = 0; i < 8; i++) {
      const next = base + Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST) * SEVERIAN_C6_WINDRISE_FLOW
      if (next === flow) break
      flow = next
    }
  }
  return Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST)
}

function severianLiexuanCount(cfg: AgentCharConfigInput['cfg']): number {
  const override = setting(cfg, 'severian.blazingSpinCount', 0)
  if (override > 0) return whole(override)
  return Math.max(0, Number(cfg.dodgeCounterCount ?? 0))
}

function buildSeverianCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.severianCinemaLevel = cinemaLevel
  record.severianAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  // 强化特殊技（组合技 1631008）走通用强特通道
  const special = skills?.categories?.find(c => c.id === 'special')?.moves?.find(m => m.id === '1631008')
  if (special) {
    cfg.exSpecialMoveId = '1631008'
    if (special.actionTime) cfg.exSpecialActionTime = special.actionTime
    const ec = parseFloat(special.energyCost?.['Energy Cost'] ?? '')
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  // 凭风载体/苍风影猎/烈旋 基础倍率与时间（buildExecutions 输入无 skills，单一事实源=倍率表）
  const all = skills?.categories?.flatMap(c => c.moves ?? []) ?? []
  const multOf = (moveId: string) => all.find(m => m.id === moveId)?.rows?.find(r => r.id === 'damage')?.values?.[0] ?? 0
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return { moveId, actionTime: m?.actionTime ?? 0, damage: multOf(moveId) }
  }
  record.severianCarrierMeta = [SEVERIAN_CHAIN_MOVE_ID, SEVERIAN_ULT_MOVE_ID, SEVERIAN_ENTRY_MOVE_ID].map(metaOf)
  record.severianShadowMeta = metaOf(SEVERIAN_SHADOW_MOVE_ID)
  record.severianLiexuanMeta = metaOf(SEVERIAN_LIEXUAN_MOVE_ID)
  record.severianWindBladeMeta = metaOf(SEVERIAN_WIND_BLADE_MOVE_ID)
  record.severianBasicCycle = SEVERIAN_BASIC_SEGMENT_IDS.map(metaOf)
}

function cycleFromCfg(cfg: unknown): SeverianCycle {
  const record = cfg as Record<string, unknown>
  return computeSeverianCycle({
    cinemaLevel: Number(record.severianCinemaLevel ?? 0),
    additionalActive: record.severianAdditionalActive === true,
    fengfengStacks: Number(record.severianFengfengStacks ?? 1),
    c4Coverage: Number(record.severianC4Coverage ?? 1),
  })
}

function applySeverianPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const cycle = computeSeverianCycle({
    cinemaLevel,
    additionalActive: (panel.additionalAbilityActive ?? 0) > 0,
    fengfengStacks: Math.max(0, Math.min(2, whole(settingOf(settings, 'severian.fengfengStacks', 1)))),
    c4Coverage: clamp01(settingOf(settings, 'severian.c4Coverage', 1)),
  })
  panel.critDmg = (panel.critDmg ?? 0) + cycle.coreCritDmg
  if (cycle.atkFlat > 0) panel.atk = (panel.atk ?? 0) + cycle.atkFlat
  if (cycle.c2AtkPct > 0) panel.atk = Math.round((panel.atk ?? 0) * (1 + cycle.c2AtkPct / 100))
  if (cycle.c4DefIgnore > 0) panel.enemyDefReduction = (panel.enemyDefReduction ?? 0) + cycle.c4DefIgnore
}

/** 苍风影猎/烈旋执行行（真实 moveId → enrich 从倍率表回填；倍率含影画6 +900 用 override 同区加算） */
function buildSeverianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.severianCinemaLevel ?? 0))
  const shadowMeta = record.severianShadowMeta as { moveId: string; actionTime: number; damage: number } | undefined
  const liexuanMeta = record.severianLiexuanMeta as { moveId: string; actionTime: number; damage: number } | undefined

  const shadowCount = severianShadowHuntCount(cfg, state)
  if (shadowMeta && shadowCount > 0) {
    executions.push({
      moveId: shadowMeta.moveId,
      moveName: '普通攻击：苍风影猎',
      category: 'basic',
      element: 'wind',
      count: shadowCount,
      actionTime: shadowMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: shadowCount * shadowMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      ...(cinema >= 6
        ? { damageMultiplier: shadowMeta.damage + SEVERIAN_C6_SHADOW_MULT, damageMultiplierOverride: true }
        : {}),
      skillTableNote: `流息驱动 ×${shadowCount}（100 点/次${cinema >= 6 ? '，影画6 最后一击+900% 同区加算' : ''}）`,
    })
  }
  const liexuanCount = severianLiexuanCount(cfg)
  if (liexuanMeta && liexuanCount > 0) {
    executions.push({
      moveId: liexuanMeta.moveId,
      moveName: '普通攻击：烈旋',
      category: 'basic',
      element: 'wind',
      count: liexuanCount,
      actionTime: liexuanMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: liexuanCount * liexuanMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      skillTableNote: `烁影/受击自动发动 ×${liexuanCount}（按极限闪避次数近似，滑块可覆盖）`,
    })
  }
  // 长按风刃段（1631009，收益高：满倍率 818.4%）：每次强特长按持续消耗能量（满充 40 点）发动；
  // 满充比例滑块 severian.windBladeChargeRatio——倍率/耗能/时间均按比例缩放（总量口径）。
  // 「能量消耗达最大时额外获得一层烁影」未建模（烁影为操作向量）。
  const windBladeMeta = record.severianWindBladeMeta as { moveId: string; actionTime: number; damage: number } | undefined
  const exCount = Math.max(0, Number(state.exSpecialCount ?? 0))
  const bladeRatio = clamp01(setting(cfg, 'severian.windBladeChargeRatio', 1))
  if (windBladeMeta && exCount > 0 && bladeRatio > 0) {
    executions.push({
      moveId: windBladeMeta.moveId,
      moveName: '强化特殊技：瞬风裂毁（长按风刃段）',
      category: 'special',
      element: 'wind',
      count: exCount,
      actionTime: windBladeMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: exCount * bladeRatio * windBladeMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: SEVERIAN_WIND_BLADE_ENERGY * bladeRatio,
      totalEnergyConsume: exCount * SEVERIAN_WIND_BLADE_ENERGY * bladeRatio,
      damageMultiplier: windBladeMeta.damage * bladeRatio,
      damageMultiplierOverride: true,
      skillTableNote: `长按持续风刃 ×${exCount}（满充比例 ${(bladeRatio * 100).toFixed(0)}%，倍率/耗能 40/时间按比例；满充额外+1烁影未建模）`,
    })
  }
}

/** 必做前台时间：苍风影猎 + 烈旋 + 长按风刃段（估时与 buildExecutions 同源计数） */
function severianExSpecialTime({ cfg, exSpecialCount, state }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const record = cfg as unknown as Record<string, unknown>
  const exTime = Math.max(0, exSpecialCount) * (cfg.exSpecialActionTime ?? 0)
  const shadowMeta = record.severianShadowMeta as { actionTime: number } | undefined
  const liexuanMeta = record.severianLiexuanMeta as { actionTime: number } | undefined
  const windBladeMeta = record.severianWindBladeMeta as { actionTime: number } | undefined
  const shadowTime = shadowMeta ? severianShadowHuntCount(cfg, state) * shadowMeta.actionTime : 0
  const liexuanTime = liexuanMeta ? severianLiexuanCount(cfg) * liexuanMeta.actionTime : 0
  const bladeRatio = clamp01(setting(cfg, 'severian.windBladeChargeRatio', 1))
  const bladeTime = windBladeMeta ? Math.max(0, exSpecialCount) * bladeRatio * windBladeMeta.actionTime : 0
  return {
    necessaryTime: exTime + shadowTime + liexuanTime + bladeTime,
    comboAlignTime: exTime * (cfg.exSpecialComboAlignRatio ?? 0),
  }
}

function patchSeverianExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.severianCinemaLevel ?? 0))
  const stacks = Math.max(0, Math.min(2, whole(setting(cfg, 'severian.fengfengStacks', 1))))
  const fengfengBonus = SEVERIAN_FENGFENG_MULT[stacks]
  const carrierMeta = (record.severianCarrierMeta as { moveId: string; damage: number }[] | undefined) ?? []
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 影画1：普通攻击暴击伤害 +60%（basic 组 moveId 限定，执行级）
    if (cinema >= 1 && SEVERIAN_BASIC_MOVE_IDS.has(exec.moveId)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + SEVERIAN_C1_BASIC_CRIT_DMG
    }
    // 凭风：入场技/连携/终结最后一击伤害倍率固定 +60/+300（同区加算进倍率行）
    if (fengfengBonus > 0 && SEVERIAN_FENGFENG_CARRIERS.has(exec.moveId)) {
      const base = carrierMeta.find(m => m.moveId === exec.moveId)?.damage ?? 0
      exec.damageMultiplier = base + fengfengBonus
      exec.damageMultiplierOverride = true
      exec.skillTableNote = `${exec.skillTableNote ?? ''}；凭风${stacks}层：最后一击倍率固定+${fengfengBonus}`
    }
  }
}

function buildSeverianResourceResult({ cfg, state }: AgentResourceResultInput) {
  const flow = severianFlowIncome(cfg as AgentCharConfigInput['cfg'], state as AgentResourceInput['state'])
  return {
    specResources: {
      severian_flow: {
        ...cycleFromCfg(cfg),
        flowIncome: Math.round(flow),
        shadowHuntCount: severianShadowHuntCount(cfg as AgentCharConfigInput['cfg'], state as AgentResourceInput['state']),
      },
    },
  }
}

function buildSeverianResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.severian_flow as (SeverianCycle & { flowIncome: number; shadowHuntCount: number }) | undefined
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
    description: '入场技/连携技/终结技入场时消耗的[凭风]层数：1层最后一击倍率固定+60、2层+300。极限闪避获得（最多2层），影画2苍风影猎+2层。',
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

export default severianMechanic
