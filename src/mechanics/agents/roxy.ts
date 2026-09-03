import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, RoxyWindEnergySource } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'

/**
 * 洛克茜（1621）v12 重录（2026-09-03，nanoka 3.2.12+18601660）：
 * - 核心被动·热夜初拥（Lv.7 原文）：每消耗 25 点能量获得 1 点[风能]（上限 3 点）；
 *   初始能量自动回复 >1.2 时，每超过 0.01 攻击 +5（上限 960）、冲击 +0.4（上限 76.8）；
 *   恕不远送命中[风化] → [浸染]还原、队友[浸染]增益按职业等：依赖风化队伍，未建模（note）。
 * - 额外能力·辉金心脏（强攻/命破/锋御队友）：自身伤害 +8%+1.2%/级（Lv.7 = 15.2%）；
 *   攻击命中 → 失衡易伤倍率 +30%（至失衡结束，满覆盖近似）+ 失衡时长 +2s；
 *   敌方[风化]时风/浸染直伤 +8%（按风化覆盖率近似全伤通道）；进场回 40 能量（勘域 180s）；
 *   风化延长 20s（无数值）；强特后异常积蓄效率 +30%（50s，满覆盖近似，未接）。
 * - 资源循环（v12）：小心风寒（1621007，10 能量启动 +30/s 自旋）→ 结束自动 敬请安息（1621023）
 *   消耗全部[风能]（每 1 点 = 额外 1621021 一段 + 生成 1 个[风眼]，上限 9、30s 自爆/超限最早引爆）；
 *   风眼爆鸣 1621022；敬请安息后场上+自身≥3 → 自动 恕不远送（1621005，引爆至多 3 个风眼：
 *   3 个同命中 → 巨旋风 1621020（1s）；不足 → 小旋风 1621019（1s/个，v12 = 1 秒）；终结技 +1 点[风能]。
 * - 影画：C1 敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40%；C2 小心风寒失衡易伤 +30%（v12：旧 25% → 30%）
 *   + 流势/自旋维持（机动向不建模）；C4 招架+1/闪反+2 能量 + 终结 +20% 伤（失衡+10% 未单接）；
 *   C6 无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风 ×250%（失衡+20% 未单接）+ [余响]每 3s 额外 2 次巨旋风（逐时序，pending）。
 */
const ROXY_AGENT_ID = '1621'
/** 风能：每 25 能量 +1 点（核心被动 Lv.7），存量上限 3；终结技额外 +1 点 */
export const ENERGY_PER_WIND_ENERGY = 25
export const WIND_ENERGY_MAX = 3
/** 敬请安息每消耗 1 点[风能]：额外 1621021（52.5%）+ 生成 1 个[风眼] */
export const WIND_EYE_PER_ENERGY = 1
export const WIND_EYE_MAX = 9
/** 恕不远送：引爆至多 3 个风眼；3 个同命中 → 巨旋风（1621020）；不足 → 小旋风（1621019，1s/个） */
export const SEND_OFF_BURST_MAX = 3
export const MINI_TORNADO_SECONDS = 1
/** moveId（v12）：小心风寒/自旋每秒/敬请安息/额外段/风眼爆鸣/小旋风每秒/巨旋风每秒/恕不远送/终结 */
const EX_CHILL_MOVE_ID = '1621007'
const SPIN_SECOND_MOVE_ID = '1621008'
const REST_PEACE_MOVE_ID = '1621023'
const PER_ENERGY_EXTRA_MOVE_ID = '1621021'
const EYE_BURST_MOVE_ID = '1621022'
const MINI_TORNADO_MOVE_ID = '1621019'
const MEGA_TORNADO_MOVE_ID = '1621020'
const SEND_OFF_MOVE_ID = '1621005'
const ROXY_ULT_MOVE_ID = '1621012'
/** 影画1：敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40% */
export const ROXY_C1_CRIT_DMG = 40
export const ROXY_C1_RES_REDUCTION = 15
/** 影画2：小心风寒命中 → 失衡易伤+30%（v12：旧 25% → 30%）+ 小心风寒失衡值+5% */
export const ROXY_C2_STUN_VULN = 30
export const ROXY_C2_EX_CHILL_DAZE_BONUS = 5
/** 影画4：招架回1/闪反回2 能量 + 终结技伤害+20%（失衡值+10%） */
export const ROXY_C4_PARRY_ENERGY = 1
export const ROXY_C4_DODGE_ENERGY = 2
export const ROXY_C4_ULT_DMG = 20
export const ROXY_C4_ULT_DAZE_BONUS = 10
/** 影画6：无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风倍率 ×250%（失衡值+20%）+ 余响 2 次/引爆 */
export const ROXY_C6_WIND_RES_REDUCTION = 15
export const ROXY_C6_MEGA_TORNADO_MULT = 2.5
export const ROXY_C6_MEGA_DAZE_BONUS = 20
export const ROXY_C6_ECHO_BURSTS = 2
/** 额外能力：自身伤害 +8%+1.2%/级（Lv.7 = 15.2%）；进场回 40 能量 */
export const ROXY_AA_DMG_BONUS_LV7 = 8 + 1.2 * 6
export const ROXY_AA_ENTER_ENERGY = 40
/** 转模：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限 960）、冲击 +0.4（上限 76.8） */
export const ROXY_REGEN_ATK_PER_0_01 = 5
export const ROXY_REGEN_ATK_CAP = 960
export const ROXY_REGEN_IMPACT_PER_0_01 = 0.4
export const ROXY_REGEN_IMPACT_CAP = 76.8

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 洛克茜风能/风眼资源（v12 + 用户手法 2026-09-03）：
 * 手法：强特长按（小心风寒→自旋）直到获得 3 风能就松手 → 敬请安息消耗全部风能。
 * 每轮强特 = 风能 +3（自旋 75 能量 = 2.5s × 30/s → 每 25 能量 +1 ×3）+ 终结技 +1；
 * 每轮敬请安息消耗 3 点（= 3 额外段 1621021 + 3 风眼）→ 恕不远送 = floor(消耗/3) = 每轮 1 次巨旋风（1s），
 * 无余数（3/轮 手法下小旋风恒 0，留作余数兜底）。
 */
export function computeRoxyWindEnergy(input: {
  exSpecialCount: number
  exSpecialEnergyConsume?: number
  ultimateCount?: number
  spinSeconds?: number
  cinemaLevel?: number
}): RoxyWindEnergySource {
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const spinSeconds = Math.max(0, Number(input.spinSeconds ?? 2.5))
  const cinema = Math.max(0, Math.floor(Number(input.cinemaLevel ?? 0)))
  // 每轮自旋耗能 = 自旋秒 × 30/s（+ 10 启动）；风能 = 每 25 能量 +1，手法按 3 点/轮攒满
  const energySpentTotal = exCount * (10 + spinSeconds * 30)
  const windEnergyGain = exCount * Math.floor((spinSeconds * 30 + 10) / ENERGY_PER_WIND_ENERGY)
    + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
  // 存量上限 3：每发敬请安息至多消耗 3 点 → 总消耗 = min(总获得, 强特次数 × 3)
  const windEnergyConsumed = Math.min(windEnergyGain, exCount * WIND_ENERGY_MAX)
  const windEyeGenerated = windEnergyConsumed * WIND_EYE_PER_ENERGY
  const sendOffCount = Math.floor(windEnergyConsumed / SEND_OFF_BURST_MAX)
  // 影画6 余响：每次恕不远送给主目标加[余响]，每 3 秒生成 1 次巨旋风、共 2 次（重复触发叠加）
  // → 总量近似 = 每次引爆额外 2 次（引爆间隔 > 6s 时逐次完整；叠加刷新按 2×引爆计）
  const megaTornadoCount = sendOffCount + (cinema >= 6 ? sendOffCount * ROXY_C6_ECHO_BURSTS : 0)
  const miniTornadoCount = Math.max(0, windEnergyConsumed - sendOffCount * SEND_OFF_BURST_MAX)

  return {
    energySpentTotal,
    windEnergyGain,
    windEnergyCap: WIND_ENERGY_MAX,
    windEnergyConsumed,
    windEyeGenerated,
    windEyeDestroyed: windEyeGenerated,
    sendOffCount,
    megaTornadoCount,
    miniTornadoCount,
    miniTornadoSeconds: miniTornadoCount * MINI_TORNADO_SECONDS,
    spinSeconds,
    note: 'v12+手法（用户 2026-09-03）：长按强特攒满 3 风能（自旋 2.5s×30/s≈75 能量）松手 → 敬请安息消耗 3（3 额外段+3 风眼）→ 恕不远送 1 次巨旋风（1s）；终结技 +1 风能。',
  }
}

function buildRoxyCharConfig({ skills, cfg, cinemaLevel }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true
  const record = cfg as unknown as Record<string, unknown>
  record.roxyCinemaLevel = cinemaLevel ?? 0
  // v12 moveIds
  record.roxyExChillMoveId = findMoveById(skills, EX_CHILL_MOVE_ID)?.id ?? ''
  record.roxySpinSecondMoveId = findMoveById(skills, SPIN_SECOND_MOVE_ID)?.id ?? ''
  record.roxyRestPeaceMoveId = findMoveById(skills, REST_PEACE_MOVE_ID)?.id ?? ''
  record.roxyPerEnergyExtraMoveId = findMoveById(skills, PER_ENERGY_EXTRA_MOVE_ID)?.id ?? ''
  record.roxyEyeBurstMoveId = findMoveById(skills, EYE_BURST_MOVE_ID)?.id ?? ''
  record.roxyMiniTornadoMoveId = findMoveById(skills, MINI_TORNADO_MOVE_ID)?.id ?? ''
  record.roxyMegaTornadoMoveId = findMoveById(skills, MEGA_TORNADO_MOVE_ID)?.id ?? ''
  record.roxySendOffMoveId = findMoveById(skills, SEND_OFF_MOVE_ID)?.id ?? ''
  record.roxySpinSeconds = Math.max(0, cfgSetting(cfg, 'roxy.spinSeconds', 2))
  record.roxySpinSecondDamage = getRowValue(findMoveById(skills, SPIN_SECOND_MOVE_ID), 'damage')
  cfg.mechanicRowValues = {
    [PER_ENERGY_EXTRA_MOVE_ID]: getRowValue(findMoveById(skills, PER_ENERGY_EXTRA_MOVE_ID), 'damage'),
    [EYE_BURST_MOVE_ID]: getRowValue(findMoveById(skills, EYE_BURST_MOVE_ID), 'damage'),
    [MINI_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MINI_TORNADO_MOVE_ID), 'damage'),
    [MEGA_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'damage'),
    [SEND_OFF_MOVE_ID]: getRowValue(findMoveById(skills, SEND_OFF_MOVE_ID), 'damage'),
  }
  // 影画4：招架支援回1能量/次 + 闪避反击回2能量/次（招式内至多1次）
  if ((cinemaLevel ?? 0) >= 4) {
    const energy = (cfg.parryCount ?? 0) * ROXY_C4_PARRY_ENERGY + (cfg.dodgeCounterCount ?? 0) * ROXY_C4_DODGE_ENERGY
    if (energy > 0) cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + energy
  }
  // 额外能力·辉金心脏：进场回 40 能量（勘域 180s 一次 → 每局一次；门控未接，note）
  cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + ROXY_AA_ENTER_ENERGY
  // 影画失衡值（v12 原文「失衡值提升」）：预缩倍率表 daze 值，patchRoxyExecutions 经 dazeMultiplierOverride 精确结算
  if ((cinemaLevel ?? 0) >= 2) {
    record.roxyExChillDaze = getRowValue(findMoveById(skills, EX_CHILL_MOVE_ID), 'daze') * (1 + ROXY_C2_EX_CHILL_DAZE_BONUS / 100)
  }
  if ((cinemaLevel ?? 0) >= 4) {
    record.roxyUltDaze = getRowValue(findMoveById(skills, ROXY_ULT_MOVE_ID), 'daze') * (1 + ROXY_C4_ULT_DAZE_BONUS / 100)
  }
  if ((cinemaLevel ?? 0) >= 6) {
    record.roxyMegaDaze = getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'daze') * (1 + ROXY_C6_MEGA_DAZE_BONUS / 100)
  }
}

function applyRoxyPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 核心被动转模（v12）：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限960）、冲击 +0.4（上限76.8）
  const regen = Math.max(0, Number((panel as any).energyRegen ?? 1.2) - 1.2)
  const atkBonus = Math.min(ROXY_REGEN_ATK_CAP, Math.round((regen / 0.01) * ROXY_REGEN_ATK_PER_0_01))
  const impactBonus = Math.min(ROXY_REGEN_IMPACT_CAP, (regen / 0.01) * ROXY_REGEN_IMPACT_PER_0_01)
  if (atkBonus > 0) panel.atk = (panel.atk ?? 0) + atkBonus
  if (impactBonus > 0) panel.impact = (panel.impact ?? 0) + impactBonus
  // 额外能力：自身伤害 +15.2%（Lv.7；门控由团队条件，面板统一施加——无强攻/命破/锋御队略高估，note）
  panel.dmgBonus = (panel.dmgBonus ?? 0) + ROXY_AA_DMG_BONUS_LV7
  const cinema = cinemaLevel ?? 0
  if (cinema >= 1) {
    panel.critDmg = (panel.critDmg ?? 0) + ROXY_C1_CRIT_DMG
    panel.enemyResReduction = (panel.enemyResReduction ?? 0) + ROXY_C1_RES_REDUCTION
  }
  if (cinema >= 2) {
    panel.stunDmgMultiplierBonus = (panel.stunDmgMultiplierBonus ?? 0) + ROXY_C2_STUN_VULN
  }
  if (cinema >= 6) {
    panel.enemyWindResReduction = (panel.enemyWindResReduction ?? 0) + ROXY_C6_WIND_RES_REDUCTION
  }
}

function buildRoxyResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  return {
    roxyWindEnergySource: computeRoxyWindEnergy({
      exSpecialCount: state.exSpecialCount,
      exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
      ultimateCount: state.ultimateCount,
      spinSeconds: Number(record.roxySpinSeconds ?? 0),
      cinemaLevel: Number(record.roxyCinemaLevel ?? 0),
    }),
  }
}

function buildRoxyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const source = computeRoxyWindEnergy({
    exSpecialCount: state.exSpecialCount,
    exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
    ultimateCount: state.ultimateCount,
    spinSeconds: Number(record.roxySpinSeconds ?? 0),
    cinemaLevel: Number(record.roxyCinemaLevel ?? 0),
  })
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  if (exCount > 0) {
    // 小心风寒（1621007）+ 自旋（1621008 每秒）+ 敬请安息（1621023）
    executions.push({
      moveId: EX_CHILL_MOVE_ID, moveName: '强化特殊技：小心风寒', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 10, totalEnergyConsume: exCount * 10,
      decibelRecovery: 0, totalDecibelRecovery: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
    const spinMoveMult = Number((cfg as unknown as Record<string, unknown>).roxySpinSecondDamage ?? 0)
    if (source.spinSeconds > 0) {
      executions.push({
        moveId: SPIN_SECOND_MOVE_ID, moveName: '自旋（每秒，耗能 30/s）', category: 'special',
        count: exCount, actionTime: 0, comboAlignRatio: 0,
        totalTime: 0, totalComboAlignTime: 0,
        energyConsume: 0, totalEnergyConsume: 0,
        decibelRecovery: 0, totalDecibelRecovery: 0,
        energyRecovery: 0, totalEnergyRecovery: 0,
        timeBucket: 'backstage',
        damageMultiplier: spinMoveMult * source.spinSeconds,
        damageMultiplierOverride: true,
      })
    }
    executions.push({
      moveId: REST_PEACE_MOVE_ID, moveName: '强化特殊技：敬请安息（风炮）', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0,
      decibelRecovery: 0, totalDecibelRecovery: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  const spec = getAgentSpec(ROXY_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      roxyPerEnergyExtraCount: source.windEnergyConsumed,
      roxyEyeBurstCount: source.windEyeGenerated,
      roxySendOffCount: source.sendOffCount,
      roxyMiniTornadoSeconds: source.miniTornadoSeconds,
      roxyMegaTornadoCount: source.megaTornadoCount,
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? ((cfg as any).mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function patchRoxyExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.roxyCinemaLevel ?? 0)))
  for (const exec of executions) {
    // 影画2：小心风寒（1621007）失衡值 +5%
    if (cinema >= 2 && exec.moveId === EX_CHILL_MOVE_ID) {
      const d = Number(record.roxyExChillDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    if (cinema >= 4 && exec.moveId === ROXY_ULT_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ROXY_C4_ULT_DMG
      // 影画4：终结技（1621012）失衡值 +10%
      const d = Number(record.roxyUltDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    // 影画6：巨型风旋（1621020）倍率 ×250%（含余响生成行，共用 moveId）失衡值 +20%
    if (cinema >= 6 && exec.moveId === MEGA_TORNADO_MOVE_ID) {
      exec.damageMultiplier = (exec.damageMultiplier ?? 0) * ROXY_C6_MEGA_TORNADO_MULT
      exec.damageMultiplierOverride = true
      const d = Number(record.roxyMegaDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
  }
}

function buildRoxyResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.roxyWindEnergySource
  if (!source) return []
  return [
    {
      id: 'roxy-wind-energy',
      title: '洛克茜风能',
      summary: `风能 +${source.windEnergyGain} · 敬请安息消耗 ${source.windEnergyConsumed} · 风眼 × ${source.windEyeGenerated}`,
      rows: [
        { label: '强特/终结耗能', value: `${fmt(source.energySpentTotal)}`, detail: '每 25 能量获得 1 点风能（核心被动 Lv.7）+ 终结技 +1' },
        { label: '风能获取', value: `+${source.windEnergyGain}`, detail: '存量上限 3（每发敬请安息至多消耗 3）' },
        { label: '敬请安息消耗', value: `-${source.windEnergyConsumed}`, detail: '每点 = 额外 1621021 一段 + 生成 1 个风眼' },
      ],
      footer: source.note,
    },
    {
      id: 'roxy-wind-eye',
      title: '洛克茜风眼·恕不远送',
      summary: `风眼 ${source.windEyeGenerated} · 恕不远送 × ${source.sendOffCount} · 巨旋风 ${source.megaTornadoCount} · 小旋风 ${source.miniTornadoSeconds}s`,
      rows: [
        { label: '风眼生成', value: `${source.windEyeGenerated} 个`, detail: `上限 ${WIND_EYE_MAX}、30s 自爆/超限最早引爆（爆鸣 1621022 × ${source.windEyeDestroyed}）` },
        { label: '恕不远送', value: `${source.sendOffCount} 次`, detail: '敬请安息后场上+自身≥3 → 自动发动（引爆至多 3 个风眼）' },
        { label: '巨型风旋', value: `${source.megaTornadoCount} 次`, detail: '3 个风眼同时命中 → 巨旋风（1621020）持续 1 秒；影画6 ×250%' },
        { label: '微型风旋', value: `${fmt(source.miniTornadoSeconds)}s`, detail: '不足 3 个的余数 → 小旋风（1621019）1s/个' },
      ],
      footer: 'v12 口径；余响（影画6 每 3s 额外 2 次巨旋风）逐时序未建模，pending。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'roxy.spinSeconds',
    label: '洛克茜自旋秒数',
    description: '手法（用户 2026-09-03）：长按强特到获得 3 风能就松手 = 自旋 75 能量/30每秒 = 2.5 秒；自旋每秒 2608.6% 风伤。',
    default: 2.5,
    min: 0,
    max: 10,
    step: 0.5,
    suffix: '秒',
  },
]

export const roxyMechanic: AgentMechanicModule = {
  id: 'agent:roxy',
  agentIds: [ROXY_AGENT_ID],
  name: '洛克茜',
  description: 'v12：风能（25能量/点+终结+1）→ 敬请安息（消耗全部，每点额外段+1风眼）→ 风眼爆鸣/恕不远送（引爆至多3 → 巨旋风或小旋风）+ 自旋每秒伤害；核心转模（能量回复>1.2→攻击/冲击）；C1 全抗-15%/暴伤+40%、C2 易伤+30%、C4 回能+终结+20%、C6 风抗15%+巨旋风×250%。',
  applyPanel: applyRoxyPanel,
  buildCharConfig: buildRoxyCharConfig,
  buildExecutions: buildRoxyExecutions,
  patchExecutions: patchRoxyExecutions,
  buildResourceResult: buildRoxyResourceResult,
  resourceSections: buildRoxyResourceSections,
  settings,
}
