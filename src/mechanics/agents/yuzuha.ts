import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting, YuzuhaMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const YUZUHA_AGENT_ID = '1411'
const SWEETNESS_INITIAL = 3
const SWEETNESS_CAP = 6
const TEAM_ATK_RATIO = 0.4
const TEAM_ATK_CAP = 600
const TEAM_DMG_BONUS = 15
const CHARGED_CANNON_DMG_RATIO = 300
/** 影画6：招架支援/狸之帐成功招架额外 +1 甜度点（次数≈parryCount） */
const C6_SWEETNESS_PER_PARRY = 1
/** 蓄能炮弹：每蓄能 0.4 秒消耗 1 点甜度点追加一枚 300% 攻击力物理炮弹，单次蓄能最长 0.8 秒 */
const CHARGE_SECONDS_PER_CANNON = 0.4
const CHARGE_SECONDS_MAX = 0.8
export const YUZUHA_CHARGED_CANNON_MOVE_ID = '1411_charged_cannon'

export function computeYuzuhaMechanic(input: {
  initialAtk: number
  chainEntryCount: number
  chargedCannonCount: number
  cinemaLevel?: number
  parryCount?: number
  chargeSeconds?: number
}): YuzuhaMechanicSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel ?? 0))
  const parryCount = Math.max(0, Math.floor(input.parryCount ?? 0))
  const sweetnessIncome = SWEETNESS_INITIAL
    + Math.max(0, input.chainEntryCount)
    + (cinemaLevel >= 6 ? parryCount * C6_SWEETNESS_PER_PARRY : 0)
  const sweetnessTotal = Math.min(SWEETNESS_CAP, sweetnessIncome)
  const teamAtkBonus = Math.min(TEAM_ATK_CAP, Math.max(0, input.initialAtk) * TEAM_ATK_RATIO)
  // 蓄能炮弹（影画6 整条机制）：支援突击夹心硬糖射击时长按蓄能，每 0.4s 耗 1 甜度追加一枚；受甜度存量钳制。
  // 硬糖射击（8秒CD追击）未建模，甜度预算全部计入蓄能炮弹。
  const chargeSeconds = Math.min(CHARGE_SECONDS_MAX, Math.max(0, input.chargeSeconds ?? CHARGE_SECONDS_MAX))
  const cannonsPerAssist = cinemaLevel >= 6 ? Math.floor(chargeSeconds / CHARGE_SECONDS_PER_CANNON) : 0
  const chargedCannonCount = cannonsPerAssist > 0 && sweetnessTotal > 0
    ? Math.min(cannonsPerAssist * parryCount, sweetnessTotal)
    : Math.max(0, Math.floor(input.chargedCannonCount ?? 0))
  return {
    sweetnessInitial: SWEETNESS_INITIAL,
    sweetnessFromChain: Math.max(0, input.chainEntryCount),
    sweetnessFromParry: cinemaLevel >= 6 ? parryCount * C6_SWEETNESS_PER_PARRY : 0,
    sweetnessTotal,
    sweetnessCap: SWEETNESS_CAP,
    teamAtkBonus,
    teamAtkCap: TEAM_ATK_CAP,
    teamDmgBonus: TEAM_DMG_BONUS,
    chargedCannonCount,
    chargedCannonsPerAssist: cannonsPerAssist,
    note: '甜度点：进场3点、上限6，其他角色连携入场+1（二命），六命招架成功额外+1；狸之愿：40%初始攻击力（上限600）并+15%伤害，持续40秒；蓄能强力炮弹每0.4秒消耗1甜度点，300%攻击力物理伤害。硬糖射击（8秒CD追击）未建模，甜度预算全部计入蓄能炮弹。',
  }
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildYuzuhaCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  // 滑块必须经 buildCharConfig 落到 cfg，buildResourceResult 阶段才读得到（applyPanel 早于 cfg 构建拿不到 settings）
  cfg.yuzuhaChainEntryCount = Math.max(0, Math.floor(cfgSetting(cfg, 'yuzuha.chainEntryCount', 0)))
  cfg.yuzuhaChargeSeconds = Math.min(CHARGE_SECONDS_MAX, Math.max(0, cfgSetting(cfg, 'yuzuha.chargeSeconds', CHARGE_SECONDS_MAX)))
  cfg.yuzuhaCinemaLevel = cinemaLevel
}

function buildYuzuhaResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    yuzuhaMechanicSource: computeYuzuhaMechanic({
      initialAtk: cfg.panel.atk ?? 0,
      chainEntryCount: cfg.yuzuhaChainEntryCount ?? 0,
      chargedCannonCount: 0,
      cinemaLevel: cfg.yuzuhaCinemaLevel ?? 0,
      parryCount: cfg.parryCount ?? 0,
      chargeSeconds: cfg.yuzuhaChargeSeconds ?? CHARGE_SECONDS_MAX,
    }),
  }
}

function buildYuzuhaExecutions({ cfg, executions }: AgentResourceInput): void {
  const source = computeYuzuhaMechanic({
    initialAtk: cfg.panel.atk ?? 0,
    chainEntryCount: cfg.yuzuhaChainEntryCount ?? 0,
    chargedCannonCount: 0,
    cinemaLevel: cfg.yuzuhaCinemaLevel ?? 0,
    parryCount: cfg.parryCount ?? 0,
    chargeSeconds: cfg.yuzuhaChargeSeconds ?? CHARGE_SECONDS_MAX,
  })
  if (source.chargedCannonCount <= 0) return
  executions.push({
    moveId: YUZUHA_CHARGED_CANNON_MOVE_ID,
    moveName: '蓄能强力炮弹（影画6）',
    category: 'assist',
    count: source.chargedCannonCount,
    actionTime: 0,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: CHARGED_CANNON_DMG_RATIO,
    damageMultiplierOverride: true,
    timeBucket: 'backstage',
  })
}

function buildYuzuhaResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.yuzuhaMechanicSource
  if (!source) return []
  return [
    {
      id: 'yuzuha-sweetness',
      title: '柚叶甜度点',
      summary: `${source.sweetnessTotal}/${source.sweetnessCap}`,
      rows: [
        { label: '进场甜度', value: `+${source.sweetnessInitial}` },
        { label: '连携入场', value: `+${source.sweetnessFromChain}`, detail: '其他角色连携技入场+1（二命）' },
        ...(source.sweetnessFromParry > 0
          ? [{ label: '影画6·招架成功', value: `+${source.sweetnessFromParry}`, detail: '招架支援/狸之帐成功招架+1' }]
          : []),
        { label: '蓄能炮弹', value: `${source.chargedCannonCount} 发 × ${CHARGED_CANNON_DMG_RATIO}%`, detail: `每次支援突击蓄能 ${source.chargedCannonsPerAssist} 枚（0.4s/枚耗1甜度），300%攻击力物理` },
      ],
      footer: '六命招架成功额外+1；硬糖射击（8秒CD追击）未建模，甜度预算全部计入蓄能炮弹。',
    },
    {
      id: 'yuzuha-liwang-wish',
      title: '柚叶狸之愿（全队）',
      summary: `攻击 +${fmt(source.teamAtkBonus)}（上限${source.teamAtkCap}）· 伤害 +${source.teamDmgBonus}%`,
      rows: [
        { label: '攻击力加成', value: `+${fmt(source.teamAtkBonus)}`, detail: `40%初始攻击力` },
        { label: '伤害提升', value: `+${source.teamDmgBonus}%`, detail: '持续40秒，重复触发刷新' },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'yuzuha.chainEntryCount',
    label: '柚叶连携入场次数',
    description: '其他角色通过连携技入场时柚叶获得1甜度点；默认0，可按轮转调整。',
    default: 0,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'yuzuha.chargeSeconds',
    label: '柚叶蓄能时长（影画6）',
    description: '支援突击夹心硬糖射击的长按蓄能时长；每0.4秒耗1甜度点追加一枚300%物理炮弹，最长0.8秒（2枚）。',
    default: 0.8,
    min: 0,
    max: 0.8,
    step: 0.4,
    suffix: '秒',
  },
]

export const yuzuhaMechanic: AgentMechanicModule = {
  id: 'agent:yuzuha',
  agentIds: [YUZUHA_AGENT_ID],
  name: '柚叶',
  description: '甜度点/狸之愿：进场3甜度点，连携入场+1；影画6蓄能炮弹逐发结算、招架成功+1甜度点。',
  buildCharConfig: buildYuzuhaCharConfig,
  buildExecutions: buildYuzuhaExecutions,
  buildResourceResult: buildYuzuhaResourceResult,
  resourceSections: buildYuzuhaResourceSections,
  settings,
}
