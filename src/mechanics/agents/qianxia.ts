import { whole } from '@/utils/finiteClamp'
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import { basicComboCycleSeconds } from '@/data/moveTableQueries'
import { basicSummarySeconds } from '@/types/resource'
import { mechanicSettingPanelReader, mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import type { CharacterResourceResult } from '@/types/resource'
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { initialStat } from '@/mechanics/initialStat'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const setting = mechanicSettingReader(() => qianxiaMechanic.settings)
const settingOf = mechanicSettingPanelReader(() => qianxiaMechanic.settings)
/**
 * 千夏（1491，物理·支援，妄想天使）—— 妄想天使支援拐 + 猫的凝视。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1491.json。
 *
 * 拐力主体在 teammate-buffs.json 1491 组（核心被动攻击公式/帷幕易伤/影画1/2/4），
 * 帷幕失衡易伤+30%（buff_23620b7000）由 computePanelPhases 按 spec.additionalAbility
 * （队伍存在[强攻]或同阵营角色）门控，见 resourceCalc/helpers.ts。
 *
 * 本模块承接（用户口径 2026-08-31 建模）：
 * - 额外能力/影画1 进场回能 15（勘域模式 180s 最多 1 次）→ CD 整局近似。
 * - 猫的凝视触发（核心被动）：队伍中[强攻]或[异常]角色持续攻击命中持凝视敌人时触发并清除；
 *   强攻触发 150%攻击力、异常触发 240%攻击力（必暴+暴伤+80%），视为触发代理人伤害。
 *   次数口径（标记供给驱动）：触发数 = min(千夏标记招式命中数, 队内强攻/异常命中近似)；
 *   标记招式 = 普攻第四段(1491004)/强特(1491007/1491008/1491018/1491019)/连携/终结——
 *   总量口径下这些行都会物化，直接数执行行 count。失衡时触发所需攻击次数大幅减少 →
 *   不惩罚（总量口径供给充足）。合成执行行挂千夏面板（倍率 150/240，伤害按触发代理人
 *   = 千夏结算），后台不占前台。
 * - 影画2《猫的随波逐流》：帷幕内全队攻击+10%（teammate-buffs 已录）+ 触发倍率提升
 *   强攻+200%/异常+300%（→350%/540%）+ 凝视触发次数减少（失衡时供给更足，并入总量近似）。
 * - 影画6《空洞大爆炸》潜心创作：自身必暴+暴伤（applyPanel，覆盖率滑杆）+ 全队凝视伤害+50%。
 *
 * 未建模（近似点）：磨爪器逐次持有状态机（持有上限 6 的排队语义按总量近似——
 * 泡泡后场自动攻击次数 = min(磨爪器总获取, 上限×轮转) 总量口径直接用获取总量）；
 * 猫的凝视 12 秒持续/千夏前场刷新（按标记供给充足近似）。
 */

const QIANXIA_AGENT_ID = '1491'
const QIANXIA_FIELD_ENTRY_ENERGY = 15
/** 影画6 潜心创作：必定暴击 + 暴伤 = min(105, 初始攻击 × 0.03%) */
export const QIANXIA_C6_CRIT_RATE = 100
export const QIANXIA_C6_CRIT_DMG_CAP = 105
/** 猫的凝视触发倍率（核心被动 Lv.7）：强攻 150% / 异常 240% 攻击力 */
export const QIANXIA_GAZE_ATTACK_MULTIPLIER = 150
export const QIANXIA_GAZE_ANOMALY_MULTIPLIER = 240
/** 影画2：触发倍率提升 强攻+200% / 异常+300% */
export const QIANXIA_C2_GAZE_ATTACK_BONUS = 200
export const QIANXIA_C2_GAZE_ANOMALY_BONUS = 300
/** 异常角色触发的凝视伤害必定暴击 + 暴击伤害 +80% */
export const QIANXIA_GAZE_ANOMALY_CRIT_DMG = 80
/** 影画6：全队触发凝视伤害 +50% */
export const QIANXIA_C6_GAZE_DMG_BONUS = 50
/** 磨爪器获取：开帷幕 +2/次；异常施加 +1（10s CD）；帷幕内每 10s +1；大招重击 +6 */
export const QIANXIA_SCRATCHER_PER_VEIL = 2
export const QIANXIA_SCRATCHER_PER_ANOMALY = 1
export const QIANXIA_SCRATCHER_CD_SECONDS = 10
export const QIANXIA_SCRATCHER_PER_ULT = 6
/** 泡泡自动攻击倍率（后场消耗 1 磨爪器；继承千夏初始攻击力） */
export const QIANXIA_BUBBLE_MULTIPLIER = 100
/** 普攻标记段：鬼马流星锤 #4。引擎普攻只有一条汇总行（基准段 #3 秒均），按整套时长折算（CC-195） */
export const QIANXIA_BASIC_MARK_MOVE_ID = '1491004'
/** 千夏标记招式（命中添加猫的凝视；倍率表真实行） */
export const QIANXIA_GAZE_MARK_MOVE_IDS = new Set([
  '1491004', // 普通攻击：鬼马流星锤 #4
  '1491007', // 强化特殊技：泡泡糖轰炸 #1
  '1491008', // 强化特殊技：特别拍照技巧 #1
  '1491018', // 强化特殊技：泡泡糖轰炸 #2
  '1491019', // 强化特殊技：特别拍照技巧 #2
])

export interface QianxiaGazeCycle {
  cinemaLevel: number
  /** 千夏标记招式命中总数（凝视供给） */
  markSupply: number
  /** 猫的凝视触发次数 = min(标记供给, 触发者命中近似) */
  gazeTriggerCount: number
  /** 强攻触发占比（0-1，队内无强攻触发者时 0） */
  attackTriggerRatio: number
  /** 异常触发占比 */
  anomalyTriggerRatio: number
  /** 磨爪器总获取（帷幕/异常/每10s/大招） */
  scratcherTotal: number
  /** 本轮**实际消费**的全队帷幕数（收敛线程注入值）：磨爪器按它算，测试/UI 据此核对滞后 */
  teamVeilCount: number
  /** 泡泡后场自动攻击次数（消耗磨爪器） */
  bubbleAttackCount: number
  attackMultiplier: number
  anomalyMultiplier: number
  note: string
}

function computeQianxiaGazeCycle(input: {
  cinemaLevel: number
  markSupply: number
  /** 队内强攻角色数（触发者） */
  attackAgents: number
  /** 队内异常角色数（触发者） */
  anomalyAgents: number
  /** 触发者整局命中数近似（强攻/异常角色合计；默认按标记供给同量级） */
  triggerHits: number
  teamVeilCount: number
  anomalyTriggerCount: number
  ultimateCount: number
  battleTime: number
}): QianxiaGazeCycle {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  const markSupply = whole(input.markSupply)
  const attackAgents = whole(input.attackAgents)
  const anomalyAgents = whole(input.anomalyAgents)
  // 触发者混合时按角色数占比拆分（强攻触发优先级同原文并列）
  const triggererTotal = attackAgents + anomalyAgents
  const attackTriggerRatio = triggererTotal > 0 ? attackAgents / triggererTotal : 0
  const anomalyTriggerRatio = triggererTotal > 0 ? anomalyAgents / triggererTotal : 0
  const gazeTriggerCount = Math.min(markSupply, whole(input.triggerHits))
  const scratcherTotal = input.teamVeilCount * QIANXIA_SCRATCHER_PER_VEIL
    + Math.min(whole(input.anomalyTriggerCount), Math.floor(input.battleTime / QIANXIA_SCRATCHER_CD_SECONDS)) * QIANXIA_SCRATCHER_PER_ANOMALY
    + Math.floor(input.battleTime / QIANXIA_SCRATCHER_CD_SECONDS)
    + input.ultimateCount * QIANXIA_SCRATCHER_PER_ULT
  // 泡泡自动攻击 = 消耗磨爪器（总量近似，持有上限 6 的轮转不逐次模拟）
  const bubbleAttackCount = Math.min(scratcherTotal, whole(input.battleTime / 2))
  return {
    cinemaLevel,
    markSupply,
    gazeTriggerCount,
    attackTriggerRatio,
    anomalyTriggerRatio,
    scratcherTotal,
    teamVeilCount: input.teamVeilCount,
    bubbleAttackCount,
    attackMultiplier: QIANXIA_GAZE_ATTACK_MULTIPLIER + (cinemaLevel >= 2 ? QIANXIA_C2_GAZE_ATTACK_BONUS : 0),
    anomalyMultiplier: QIANXIA_GAZE_ANOMALY_MULTIPLIER + (cinemaLevel >= 2 ? QIANXIA_C2_GAZE_ANOMALY_BONUS : 0),
    note: '凝视触发 = min(千夏标记招式命中, 触发者命中)；倍率按队内强攻/异常占比拆分；磨爪器按总量近似（上限6轮转不逐次）。',
  }
}

function buildQianxiaCharConfig({ cfg, cinemaLevel, team, panel, skills }: AgentCharConfigInput): void {
  cfg.qianxiaCinemaLevel = cinemaLevel
  // CC-195：普攻 #4 标记折算用——鬼马流星锤 #1–#4 一整套时长（每套出一次 #4）
  cfg.qianxiaBasicMarkCycleSeconds = basicComboCycleSeconds(skills, QIANXIA_BASIC_MARK_MOVE_ID)
  // 凝视触发者：队内强攻/异常角色数（千夏自己是支援不计）
  const attackAgents = team.filter(m => m.agent?.specialty === 'attack').length
  const anomalyAgents = team.filter(m => m.agent?.specialty === 'anomaly').length
  cfg.qianxiaAttackAgents = attackAgents
  cfg.qianxiaAnomalyAgents = anomalyAgents
  if (additionalAbilityActiveOf(panel)) {
    cfg.initialEnergyGift = cfg.initialEnergyGift + QIANXIA_FIELD_ENTRY_ENERGY
  }
}

function pushQianxiaExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  damageMultiplier?: number
  critRateBonus?: number
  critDmgBonus?: number
  dmgBonus?: number
}): void {
  if (input.count <= 0) return
  executions.push(moduleExecRow({
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'special',
    element: 'physical',
    count: input.count,
    ...RECOVERY_OFF,
    timeBucket: 'backstage',
    autoSplitByStun: true, // CC-391 D1：凝视由队友持续命中触发、泡泡在后场消耗磨爪器自动攻击 ⇒ 轴模式按失衡时间占比吃易伤（不靠放置）
    ...(input.damageMultiplier == null ? {} : { damageMultiplier: input.damageMultiplier, damageMultiplierOverride: true }),
    ...(input.critRateBonus ? { critRateBonus: input.critRateBonus } : {}),
    ...(input.critDmgBonus ? { critDmgBonus: input.critDmgBonus } : {}),
    ...(input.dmgBonus ? { dmgBonus: input.dmgBonus } : {}),
  }))
}

/**
 * 标记供给（纯函数）：千夏标记招式执行行命中数 + 普攻 #4 折算。
 * CC-195：原先写回 `cfg.qianxiaMarkSupply` 供装配期读，属 `AgentResourceResultInput.preModuleExecutions`
 * 头注释点名的反模式（多 pass 下最后写入者 ≠ 装配时的 state ⇒ 展示与行不同源）；现两处各自对同一批
 * 行重算——CC-198 起这批行是「patchExecutions 派发前」（prePatchExecutions），含额外强特 1491008。
 */
function markSupplyOf(cfg: AgentResourceInput['cfg'], executions: readonly AgentResourceInput['executions'][number][]): number {
  let markSupply = 0
  for (const exec of executions) {
    if (exec.moveId && QIANXIA_GAZE_MARK_MOVE_IDS.has(exec.moveId)) markSupply += whole(exec.count)
  }
  // CC-195：普攻 #4 不会以独立行出现（普攻 = 一条汇总行），按「每打满一套鬼马流星锤出一次 #4」折算。
  // 此前普攻对标记供给恒为 0，而凝视次数 = min(标记供给, 触发者命中) 默认就等于供给。
  const markCycle = Number(cfg.qianxiaBasicMarkCycleSeconds ?? 0)
  if (markCycle > 0) markSupply += Math.floor(basicSummarySeconds(executions) / markCycle)
  return markSupply
}

function cycleFromCfg(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state'], markSupply: number): QianxiaGazeCycle {
  const cinemaLevel = cinemaLevelOf(cfg.qianxiaCinemaLevel)
  return computeQianxiaGazeCycle({
    cinemaLevel,
    markSupply,
    attackAgents: whole(Number(cfg.qianxiaAttackAgents ?? 0)),
    anomalyAgents: whole(Number(cfg.qianxiaAnomalyAgents ?? 0)),
    // 触发者命中数近似：滑块 0 = 按标记供给同量级（postRound 后标记供给写入）
    triggerHits: whole(setting(cfg, 'qianxia.gazeTriggerHits')) || markSupply,
    teamVeilCount: whole(Number(cfg.teamVeilCountTotal ?? 0)),
    // 异常施加次数：队内有异常角色时按 10s CD 上限近似（异常队施加远超 CD；爱芮全场应援同款口径）
    anomalyTriggerCount: whole(Number(cfg.qianxiaAnomalyAgents ?? 0)) > 0
      ? Math.floor(Math.max(1, cfg.battleTime) / QIANXIA_SCRATCHER_CD_SECONDS)
      : 0,
    ultimateCount: whole(state.ultimateCount),
    battleTime: Math.max(1, cfg.battleTime),
  })
}

/**
 * patchExecutions：数标记供给（标记招式行 count）+ 凝视/泡泡合成行。
 * CC-198：从 buildExecutions 挪到 patchExecutions——额外强特行 1491008「特别拍照技巧」由 rowBuild 在模块
 * buildExecutions **之后**物化，旧位置看不到它（标记恒少计）。展示侧同步改读 prePatchExecutions（同一批行）。
 * 本函数推的行都是 backstage、totalTime 0、倍率自带（damageMultiplierOverride），放在末尾不影响任何时间/计数通道。
 */
function buildQianxiaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinemaLevel = cinemaLevelOf(cfg.qianxiaCinemaLevel)
  // 标记供给 = 千夏标记招式命中数（真实执行行直数，含连携/终结由倍率表物化）+ 普攻 #4 折算
  const cycle = cycleFromCfg(cfg, state, markSupplyOf(cfg, executions))
  const c6Bonus = cinemaLevel >= 6 ? QIANXIA_C6_GAZE_DMG_BONUS : 0
  // 强攻触发行（150%/350%）
  pushQianxiaExecution(executions, {
    moveId: '1491_gaze_attack_trigger',
    moveName: '猫的凝视·强攻触发',
    count: Math.floor(cycle.gazeTriggerCount * cycle.attackTriggerRatio),
    damageMultiplier: cycle.attackMultiplier,
    dmgBonus: c6Bonus,
  })
  // 异常触发行（240%/540%，必暴+暴伤+80%）
  pushQianxiaExecution(executions, {
    moveId: '1491_gaze_anomaly_trigger',
    moveName: '猫的凝视·异常触发',
    count: Math.floor(cycle.gazeTriggerCount * cycle.anomalyTriggerRatio),
    damageMultiplier: cycle.anomalyMultiplier,
    critRateBonus: 100,
    critDmgBonus: QIANXIA_GAZE_ANOMALY_CRIT_DMG,
    dmgBonus: c6Bonus,
  })
  // 泡泡后场自动攻击（磨爪器消耗，继承千夏攻击）
  pushQianxiaExecution(executions, {
    moveId: '1491_bubble_auto_attack',
    moveName: '泡泡·后场自动攻击（磨爪器）',
    count: cycle.bubbleAttackCount,
    damageMultiplier: QIANXIA_BUBBLE_MULTIPLIER,
  })
}

function buildQianxiaResourceResult({ cfg, state, prePatchExecutions }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return { qianxiaGaze: cycleFromCfg(cfg, state, markSupplyOf(cfg, prePatchExecutions)) }
}

function buildQianxiaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.qianxiaGaze
  if (!cycle) return []
  return [{
    id: 'qianxia-gaze',
    title: '千夏·猫的凝视与磨爪器',
    summary: `凝视触发 ${cycle.gazeTriggerCount} 次 · 磨爪器 ${cycle.scratcherTotal} 个`,
    rows: [
      { label: '凝视标记供给', value: `${cycle.markSupply} 次`, detail: '千夏标记招式命中（普攻第四段/强特/连携/终结）' },
      { label: '凝视触发', value: `${cycle.gazeTriggerCount} 次`, detail: `min(标记供给, 触发者命中)；强攻 ${(cycle.attackTriggerRatio * 100).toFixed(0)}% · 异常 ${(cycle.anomalyTriggerRatio * 100).toFixed(0)}%` },
      { label: '强攻触发倍率', value: `${cycle.attackMultiplier}%`, detail: `基础 150%${cycle.cinemaLevel >= 2 ? ' + 影画2 200%' : ''}` },
      { label: '异常触发倍率', value: `${cycle.anomalyMultiplier}%`, detail: `基础 240%（必暴+暴伤80）${cycle.cinemaLevel >= 2 ? ' + 影画2 300%' : ''}` },
      { label: '磨爪器', value: `${cycle.scratcherTotal} 个`, detail: '帷幕×2 + 异常施加×1(10s CD) + 帷幕内每10s×1 + 大招重击×6' },
      { label: '泡泡自动攻击', value: `${cycle.bubbleAttackCount} 次`, detail: '后场消耗磨爪器，继承千夏初始攻击力，不占前台' },
    ],
    footer: cycle.note,
  }]
}

function applyQianxiaPanel({ cinemaLevel, panel, outOfCombatPanel, settings }: AgentPanelInput): void {
  if (cinemaLevelOf(cinemaLevel) < 6) return
  // 潜心创作（8s，强特后）按整局覆盖率近似；必定暴击 + 初始攻击×0.03% 暴伤（封顶105）。
  // 原文「根据自身初始攻击力的0.03%」⇒ 初始 = 局外面板（CC-124；读取口 `initialStat`，CC-497）
  const coverage = Math.max(0, Math.min(1, settingOf(settings, 'qianxia.c6FocusCoverage')))
  const atk = initialStat(outOfCombatPanel, panel, 'atk')
  panel.critRate = panel.critRate + QIANXIA_C6_CRIT_RATE * coverage
  panel.critDmg = panel.critDmg + Math.min(QIANXIA_C6_CRIT_DMG_CAP, atk * 0.03) * coverage
}

export const qianxiaMechanic: AgentMechanicModule = {
  id: 'agent:qianxia',
  agentIds: [QIANXIA_AGENT_ID],
  // CC-80：泡泡糖轰炸 → 免费特别拍照技巧 → 1 帷幕 = 强特次数 1:1（原 mechanics/teamVeil.ts 写死集合）
  teamVeilCount: ({ exCount }) => exCount,
  name: '千夏',
  description: '进场回能15（额外能力门控）；猫的凝视触发（强攻150%/异常240%倍率+必暴，影画2倍率提升）；磨爪器循环+泡泡后场追击；影画6 潜心创作自身必暴/暴伤+全队凝视伤害+50%；拐力主体在 teammate-buffs 1491 组。',
  settings: [
    {
      id: 'qianxia.c6FocusCoverage',
      label: '影画6潜心创作覆盖率',
      description: '强特后[潜心创作中！]8秒状态的整局覆盖率（自身必暴 + 攻击×0.03%暴伤封顶105）',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'qianxia.gazeTriggerHits',
      label: '凝视触发者命中数',
      description: '队内强攻/异常角色整局攻击命中数近似（凝视触发次数上限）；0=按标记供给同量级自动',
      default: 0,
      min: 0,
      max: 600,
      step: 10,
      suffix: '次',
    },
  ],
  applyPanel: applyQianxiaPanel,
  buildCharConfig: buildQianxiaCharConfig,
  patchExecutions: buildQianxiaExecutions,
  buildResourceResult: buildQianxiaResourceResult,
  resourceSections: buildQianxiaResourceSections,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 写入：anomalyAgents */
    qianxiaAnomalyAgents?: number
    /** 写入：attackAgents */
    qianxiaAttackAgents?: number
    /** 写入：basicComboCycleSeconds(skills, QIANXIA_BASIC_MARK_MOVE_ID) */
    qianxiaBasicMarkCycleSeconds?: number
    /** 写入：cinemaLevel */
    qianxiaCinemaLevel?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['qianxia_gaze']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 千夏凝视循环明细 */
    qianxiaGaze?: QianxiaGazeCycle
  }
}
