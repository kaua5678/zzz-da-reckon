import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 希格莉德（1591，冰属性·强攻，罗斯凯利法）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1591.json + noun.json 术语解析（出枪式=Term:1000029、巡空枪势=Term:1000030、破阵=Term:1000028）。
 *
 * 面板级效果走 applyPanel 读 input.settings（文档化通道）：
 * - 核心被动·天空骑士 Lv.7：巡空枪势暴击率 +66% × 覆盖率；失衡易伤倍率 +20% × 覆盖率
 *   （引擎只在失衡行计入，轴模式窗口内自动生效，非轴按失衡占比折算）
 * - 额外能力·天际联军（[支援]/[击破]队友，声明式 spec.additionalAbility 门控）：
 *   攻击力 +840（Lv60 上限，局内小攻击自拐）；命中[浸染]敌人伤害 +15% × 风化侵染覆盖率
 *   （emitExecDirect 分支读 damagePanels.windInfectionRate，用户口径 2026-02：直接读风化覆盖率）
 * - [砥砺]（连携技·冰凌卷地发动时获得，持续50s）：后续敛枪式伤害 +20%，默认全覆盖，
 *   挂敛枪式三段行 dmgBonus（用户口径 2026-02）
 * - 影画1：自身攻击力 +25%（先乘百分比，再叠加额外能力固定值）
 * - 影画2：喧响值获取效率 +10%（穿透率 +24% 为 moveId 限定，见 patchExecutions；巡空枪势时长 +2s 不建模）
 * - 影画4：每次获得巡空枪势伤害 +18%（8s 上限 40s）× 覆盖率
 *
 * 历史（2026-02 迁移）：面板效果原在 computePanelPhases agent.id==='1591' 硬编码块施加
 * （SOP 废弃绕法①），且滑块按 0-100 百分比声明、消费端 clamp01 按 0-1 消费——UI 拖到中间值
 * 会被钳成 100%，只有 0/100 两档生效。迁移时统一为 0-1 分数刻度。
 *
 * 执行级：
 * - 敛枪式三段执行行（buildExecutions，catalog 真实分段 id）：机会 spend 按一/二/三段轮转均摊
 *   （用户口径：1次机会打1段）；破阵每次失衡送一套三段（免费不耗机会，用户口径）
 * - 影画2：[出枪式]+[敛枪式三段] 穿透率 +24%（moveId 限定 → exec.penRatioBonus）
 * - 影画1：机会溢出时下一次敛枪式最后一击（第三段）额外 100% 攻击力冰伤 × 溢出覆盖率滑块
 * - 影画6：敛枪式一/二/三段最后一击额外 80%/90%/100% 攻击力冰伤（真实分段 id，精确建模）
 *
 * 未建模（无乘区/时间轴效果，notes 记录）：
 * - [破阵]的"更快发动"与轴内易伤归属（破阵行在轴模式下按轴外处理，待引擎支持）、
 *   影画2 巡空枪势持续时间 +2 秒、敛枪式段数状态机（8/7/6 秒递减与段数升降）
 */

const SIGRID_AGENT_ID = '1591'

/**
 * 敛枪式三段（catalog 倍率表真实 id，轮转一→二→三）。
 * ⚠️ 历史事故（2026-02 用户复查发现）：旧录制把 nanoka skill_list 的 id 当倍率表 id 用——
 * 1591002 实为凛冽枪尖#2（倍率 287.9%）而非敛枪式、1591008 实为敛枪式第二段而非连携技、
 * 1591009 在倍率表中不存在；敛枪式整招缺失且 C2 穿透率挂错 5 个招式。已按 catalog 全表重排。
 */
export const SIGRID_LANCE_SEGMENT_IDS: readonly string[] = ['1591007', '1591008', '1591022']

/** [出枪式] 集合（catalog 真实 id）：凛冽枪尖第四段、乱琼、碎玉、回马枪、冰凌卷地、霜天、冰饕。
 *  凛冽枪尖（1591001-1591005）只有第四段算出枪式。 */
export const SIGRID_CHUQIANG_MOVE_IDS: Set<string> = new Set([
  '1591005', // 普通攻击：凛冽枪尖 #4
  '1591011', // 强化特殊技：乱琼
  '1591012', // 强化特殊技：碎玉
  '1591014', // 闪避反击：回马枪
  '1591015', // 连携技：冰凌卷地
  '1591016', // 终结技：霜天
  '1591021', // 支援突击：冰饕
])

// 面板级常量（nanoka 3.2.3 Lv.7 / 满级影画）
export const SIGRID_CORE_CRIT_RATE = 66
export const SIGRID_CORE_STUN_VULN = 20
export const SIGRID_ADDITIONAL_ATK_FLAT = 840
/** 浸染增伤：15% × 风化侵染覆盖率（emitExecDirect 分支读 damagePanels 的 windInfectionRate，用户口径 2026-02） */
export const SIGRID_INFECTION_DMG = 15
/** [砥砺]（连携技发动时获得）：后续敛枪式伤害 +20%，默认全覆盖（用户口径 2026-02） */
export const SIGRID_DILI_DMG = 20
export const SIGRID_C2_DECIBEL_EFFICIENCY = 10
export const SIGRID_C4_DMG = 18
export const SIGRID_C1_ATK_PCT = 25
// 执行级常量
const CINEMA2_PEN_RATIO = 24
const CINEMA1_OVERFLOW_RATIO = 100
/** 影画6 最后一击附加：一/二/三段 = 80/90/100%（catalog 有真实分段 id，精确建模不再取中值） */
export const SIGRID_C6_LAST_HIT_RATIOS: readonly number[] = [80, 90, 100]

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const value = Number(settings?.[id])
  return Number.isFinite(value) ? value : fallback
}

/**
 * 面板级机制（核心被动 / 额外能力 / 影画1·2·4）——applyPanel 读 input.settings（已解析滑块，0-1 分数）。
 * 从 computePanelPhases 硬编码块迁入（SOP 废弃绕法① → 文档化通道）。
 * 顺序保持原口径：影画1 攻击先乘百分比，再叠加额外能力固定 +840。
 */
function applySigridPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  const coreCov = clamp01(settingOf(settings, 'sigrid.corePassiveCoverage', 1))
  if (cinemaLevel >= 1) {
    panel.atk = Math.round((panel.atk ?? 0) * (1 + SIGRID_C1_ATK_PCT / 100))
  }
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.atk = (panel.atk ?? 0) + SIGRID_ADDITIONAL_ATK_FLAT
    // 浸染增伤不在这里：读风化侵染覆盖率（异常池结果），emitExecDirect 分支按覆盖率逐行折算
  }
  panel.critRate = (panel.critRate ?? 0) + SIGRID_CORE_CRIT_RATE * coreCov
  panel.stunDmgMultiplierBonus = (panel.stunDmgMultiplierBonus ?? 0) + SIGRID_CORE_STUN_VULN * coreCov
  if (cinemaLevel >= 2) {
    panel.decibelGainEfficiency = (panel.decibelGainEfficiency ?? 0) + SIGRID_C2_DECIBEL_EFFICIENCY
  }
  if (cinemaLevel >= 4) {
    const c4Cov = clamp01(settingOf(settings, 'sigrid.cinema4Coverage', 1))
    panel.dmgBonus = (panel.dmgBonus ?? 0) + SIGRID_C4_DMG * c4Cov
  }
}

function buildSigridCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  cfg.sigridCinemaLevel = cinemaLevel
  // 强化特殊技：默认满覆盖巡空枪势（核心被动覆盖滑块缺省 1，出枪式命中即刷新≈常驻）→
  // 用巡空枪势状态的「碎玉」(1591012, 2096.1%)，而非非巡空枪势的「乱琼」(1591011, 877.7%)。
  // 乱琼仅在前摇未进巡空枪势的首个 E 出现，口径忽略。二者同属[出枪式]，机会/影画2穿透自然成立。
  const suiYu = skills?.categories?.find(c => c.id === 'special')?.moves?.find(m => m.id === '1591012')
  if (suiYu) {
    cfg.exSpecialMoveId = '1591012'
    if (suiYu.actionTime) cfg.exSpecialActionTime = suiYu.actionTime
    const ecRaw = suiYu.energyCost?.['Energy Cost']
    const ec = ecRaw ? parseFloat(ecRaw) : NaN
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  // 敛枪式最后一击的附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus），
  // 此 panel 为 computePanel 的局内权威面板（已含额外能力+840 与影画1 攻击25%）。
  cfg.sigridAtk = Math.max(0, panel?.atk ?? 0)
  // 敛枪式三段元数据从 catalog 预存（buildExecutions 输入无 skills；单一事实源仍是倍率表）
  const basicMoves = skills?.categories?.find(c => c.id === 'basic')?.moves ?? []
  const segments = SIGRID_LANCE_SEGMENT_IDS.map(moveId => {
    const move = basicMoves.find(m => m.id === moveId)
    const row = (id: string) => move?.rows?.find(r => r.id === id)?.values?.[0] ?? 0
    return {
      moveId,
      actionTime: move?.actionTime ?? 0,
      decibelRecovery: row('decibel_recovery'),
      energyRecovery: row('energy_recovery'),
    }
  })
  ;(cfg as unknown as Record<string, unknown>).sigridLanceSegments = segments
  // 平A四段元数据（凛冽枪尖 #1-#4）：#4 命中次数按段循环计数（用户口径：不用平均值×秒数）
  const basicCycle = ['1591001', '1591002', '1591004', '1591005'].map(moveId => ({
    moveId,
    actionTime: basicMoves.find(m => m.id === moveId)?.actionTime ?? 0,
  }))
  ;(cfg as unknown as Record<string, unknown>).sigridBasicCycle = basicCycle
}

/**
 * 平A按段循环下的 #4（出枪式）命中次数（用户口径 2026-02：按段数 1-4 循环计数，不用平均数据×秒数）。
 * 压枪（取消 a1/a2）时循环变为 a3→a4：完整循环时长 2.983s → 1.765s，同样平A时间 #4 次数变多。
 * 完整循环各计 1 次 #4；尾部余量推进到 #4（≥ 前三段/前一段时长）再计 1 次。
 */
export function countBasicFinisherHits(basicTime: number, cycle: { moveId: string; actionTime: number }[], pressCancel: boolean): number {
  const segs = pressCancel
    ? cycle.filter(s => s.moveId === '1591004' || s.moveId === '1591005')
    : cycle
  if (segs.length === 0 || basicTime <= 0) return 0
  const cycleTime = segs.reduce((sum, s) => sum + s.actionTime, 0)
  if (cycleTime <= 0) return 0
  const fullCycles = Math.floor(basicTime / cycleTime)
  const tail = basicTime - fullCycles * cycleTime
  // 尾部要推进到 #4：需打完它之前的所有段
  const beforeFinisher = segs.slice(0, -1).reduce((sum, s) => sum + s.actionTime, 0)
  return fullCycles + (tail >= beforeFinisher ? 1 : 0)
}

/**
 * applyTeamConfig · converge：记录上一轮收敛的失衡次数。
 * 破阵口径（用户 2026-02）：每次失衡送一套敛枪式三段（免费，不耗机会）→ 触发次数 = 失衡次数。
 */
function applySigridTeamConfig({ slot, characters, phase, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cfg = characters[slot]
  if (!cfg) return
  ;(cfg as unknown as Record<string, unknown>).sigridStunCount = stunCount
}

/** N 次轮转（一→二→三循环）各段次数：N=4 → (2,1,1) */
export function splitLanceRotation(count: number): [number, number, number] {
  const n = Math.max(0, Math.floor(count))
  return [Math.floor((n + 2) / 3), Math.floor((n + 1) / 3), Math.floor(n / 3)]
}

/**
 * 敛枪式执行行（模块接管，spec event 已删除——旧 carrierMoveId 1591002 是错误 id 且解释器从未接线）：
 * - 巡空枪势轮转：机会 spend 次数按一/二/三段均摊（用户口径：1次机会打1段轮转）
 * - 破阵：每次失衡送一套三段（免费不耗机会，用户口径），段数 = 失衡次数
 * 两部分合并进同一段行（count 相加）；真实 moveId → enrich 从倍率表回填倍率/失衡/积蓄。
 */
function buildSigridExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const segments = (record.sigridLanceSegments as
    | { moveId: string; actionTime: number; decibelRecovery: number; energyRecovery: number }[]
    | undefined) ?? []
  if (segments.length !== 3) return

  // 机会 spend 次数：复用 spec 解释器的资源账本（含可调滑块）
  let rotationCasts = 0
  const spec = getAgentSpec(SIGRID_AGENT_ID)
  if (spec) {
    for (const [, entry] of computeSpecResources(spec, cfg, state)) {
      const spendCounts = (entry as { spendCounts?: Record<string, number> })?.spendCounts
      if (spendCounts?.sigrid_lance_spend != null) {
        rotationCasts = Math.max(0, Math.floor(spendCounts.sigrid_lance_spend))
        break
      }
    }
  }
  // 破阵套数（用户口径 2026-02）：
  // - 轴模式：轴内「破阵连段」块数（含诺姆赠送连携触发的破阵），由 useResourceCalc 注入；
  //   块经窗口时间门控，窗内放得下几套就几套（易伤归属随之自然成立）
  // - 非轴：C6 = 连携总次数（每次连携命中失衡敌人触发一次）；非 C6 = 失衡次数
  const cinema = Math.max(0, Math.floor(Number(record.sigridCinemaLevel ?? 0)))
  const axisActive = record.sigridAxisActive === true
  let pozhenSets: number
  if (axisActive) {
    pozhenSets = Math.max(0, Math.floor(Number(record.sigridAxisPozhenSets ?? 0)))
  } else if (cinema >= 6) {
    // C6：破阵次数 = 失衡内连携次数（含诺姆赠送，轴模式由 chainCountTotalOverride 之外的 gift 计数另行并入）
    const chainTotal = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * Number(record.sigridStunCount ?? 0)
    pozhenSets = Math.max(0, Math.floor(chainTotal))
  } else {
    pozhenSets = Math.max(0, Math.floor(Number(record.sigridStunCount ?? 0)))
  }

  const rotation = splitLanceRotation(rotationCasts)
  const atk = Math.max(0, Number(record.sigridAtk ?? 0))
  const overflowCov = clamp01(cfgSetting(cfg, 'sigrid.c1OverflowCoverage', 1))

  for (let i = 0; i < 3; i++) {
    const count = rotation[i] + pozhenSets
    if (count <= 0) continue
    const meta = segments[i]
    // 影画6：各段最后一击附加 80/90/100% 攻击力（精确分段，进基础区 flatDamageBonus）
    let flat = cinema >= 6 && atk > 0 ? atk * SIGRID_C6_LAST_HIT_RATIOS[i] / 100 : 0
    // 影画1：机会溢出时下一次敛枪式的最后一击（= 第三段）额外 +100% × 溢出覆盖率
    if (i === 2 && cinema >= 1 && overflowCov > 0 && atk > 0) {
      flat += atk * CINEMA1_OVERFLOW_RATIO * overflowCov / 100
    }
    executions.push({
      moveId: meta.moveId,
      moveName: `普通攻击：敛枪式 ${['一', '二', '三'][i]}段`,
      category: 'basic',
      element: 'ice',
      count,
      // [砥砺]（连携技发动时获得，持续50s）：后续敛枪式伤害 +20%，默认全覆盖（用户口径）
      dmgBonus: SIGRID_DILI_DMG,
      actionTime: meta.actionTime,
      comboAlignRatio: 0,
      // 时间记真实时长（count × actionTime）：敛枪式是前台真实动作，t=0 会显示「无时间」。
      // 收敛性（2026-09-03 论证，取代 2026-02「正反馈发散 3200 亿秒」旧注释）：
      // 机会来源 = 出枪式命中数 = f(basicAttackTime)（patchSigridExecutions），
      // 敛枪式时间计入必要时间 → 平A池压缩 → 出枪式命中/机会减少 → 敛枪式减少 → 负反馈收敛；
      // 折叠循环沿「±1s 量化残差」口径（resource.ts）收敛，无发散路径。
      totalTime: count * meta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: meta.decibelRecovery,
      totalDecibelRecovery: count * meta.decibelRecovery,
      energyRecovery: meta.energyRecovery,
      totalEnergyRecovery: count * meta.energyRecovery,
      ...(flat > 0 ? { flatDamageBonus: flat } : {}),
    })
  }
}

function patchSigridExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).sigridCinemaLevel ?? 0)))
  // 机会来源（原文：任意[出枪式]命中获得1次机会）：统计出枪式招式次数 + 凛冽枪尖#4 近似，
  // 写 cfg 供下一轮 spec 资源账本读取（cfgField sigridChuqiangHits，轮间收敛）
  let chuqiangHits = 0
  for (const exec of executions) {
    if (exec.moveId && SIGRID_CHUQIANG_MOVE_IDS.has(exec.moveId)) {
      chuqiangHits += Math.max(0, exec.count ?? 0)
    }
  }
  // #4 命中：按段循环计数（用户口径 2026-02），压枪开关取消 a1/a2 → 循环 1.765s
  const record = cfg as unknown as Record<string, unknown>
  const basicCycle = (record.sigridBasicCycle as { moveId: string; actionTime: number }[] | undefined) ?? []
  const pressCancel = clamp01(cfgSetting(cfg, 'sigrid.pressCancel', 0)) > 0
  chuqiangHits += countBasicFinisherHits(Math.max(0, (state as any)?.basicAttackTime ?? 0), basicCycle, pressCancel)
  ;(cfg as unknown as Record<string, unknown>).sigridChuqiangHits = chuqiangHits

  for (const exec of executions) {
    if (!exec.moveId) continue
    // 影画2：出枪式 + 敛枪式三段 穿透率 +24%（moveId 限定，用户口径）
    if (cinema >= 2 && (SIGRID_CHUQIANG_MOVE_IDS.has(exec.moveId) || SIGRID_LANCE_SEGMENT_IDS.includes(exec.moveId))) {
      exec.penRatioBonus = (exec.penRatioBonus ?? 0) + CINEMA2_PEN_RATIO
    }
  }
}

const settings: MechanicSetting[] = [
  {
    id: 'sigrid.pressCancel',
    label: '希格莉德压枪',
    description: '压枪技巧：取消凛冽枪尖 a1/a2，平A循环变为 a3→a4（2.983s → 1.765s），同样平A时间下 #4 出枪式命中更多 → 敛枪式机会更多。1=开 0=关。',
    default: 0,
    min: 0,
    max: 1,
    step: 1,
    suffix: '',
  },
  {
    id: 'sigrid.corePassiveCoverage',
    label: '希格莉德巡空枪势覆盖率',
    description: '核心被动：巡空枪势状态下暴击率+66%、命中失衡敌人失衡易伤+20% 的时间覆盖率，默认 100%（出枪式命中即刷新，近似常驻）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'sigrid.cinema4Coverage',
    label: '希格莉德影画4覆盖率',
    description: '影画4·英雄养成中：每次获得巡空枪势伤害+18%（8秒，上限40秒）的覆盖率，默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'sigrid.c1OverflowCoverage',
    label: '希格莉德影画1机会溢出覆盖率',
    description: '影画1·很久很久以前：敛枪式发动机会（上限1）溢出频率，溢出时下一次敛枪式最后一击额外+100%攻击力，默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const sigridMechanic: AgentMechanicModule = {
  id: 'agent:sigrid',
  agentIds: [SIGRID_AGENT_ID],
  name: '希格莉德',
  description: '出枪式/巡空枪势/敛枪式：面板效果 applyPanel（暴击+66%、失衡易伤+20%、额外能力攻击/浸染增伤、影画1/2/4）；敛枪式三段轮转执行行 + 破阵（每次失衡送一套，免费）在 buildExecutions；影画2穿透率+24%（moveId 限定）与影画1/6最后一击附加在 patchExecutions/buildExecutions。',
  applyPanel: applySigridPanel,
  applyTeamConfig: applySigridTeamConfig,
  buildCharConfig: buildSigridCharConfig,
  buildExecutions: buildSigridExecutions,
  patchExecutions: patchSigridExecutions,
  // spec 资源（敛枪式发动机会）与资源卡沿用 spec 解释器
  buildResourceResult: ({ cfg, state }: AgentResourceResultInput) => ({
    specResources: (() => {
      const spec = getAgentSpec(SIGRID_AGENT_ID)
      return spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {}
    })(),
  }),
  resourceSections: (input: AgentResourceSectionsInput) => {
    const spec = getAgentSpec(SIGRID_AGENT_ID)
    return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  },
  settings,
}
