/* 「11号」（1041）机制模块。
 *
 * 口径（非轴模式：覆盖率滑块默认满覆盖；轴模式经捏轴精确）：
 * - 核心被动：[普通攻击]/[冲刺攻击]触发[火力镇压]时伤害 +70%
 *   → patchExecutions 按火力镇压 moveId 行挂 dmgBonus × 覆盖率滑块 soldier11.fireSuppressCoverage。
 * - 额外能力·燎原（spec.additionalAbility：队伍存在同属性或同阵营角色）：
 *   → 火属性伤害 +10%（无条件部分，computePanelPhases 1041 块）
 *   → 攻击失衡敌人额外 +22.5% × 滑块 soldier11.prairieFireStunCoverage（computePanelPhases 1041 块）
 *   → 潜能觉醒·绝焰只取最高档：额外能力触发时自身暴伤 +48%（applyPanel）。
 * - 影画1 快速升温：接战时能量不足 40 回满至 80，50s 最多一次
 *   → 整局口径近似：floor(battleTime/50)×40 注入 initialEnergyGift（整局总量口径，不做时间轴）。
 * - 影画2 高温汇聚：触发火力镇压时普攻/冲刺/闪反伤害 +3%，上限 12 层
 *   → 满层 36% 按覆盖率滑块 soldier11.c2StackCoverage 摊入 basic/dodge 类执行行。
 * - 影画6 炽热心流：强特/连携/终结获得 8 层充能（上限 8），火力镇压消耗 1 层无视 25% 火抗
 *   → 期望加权：生效比例 = min(1, 充能来源次数×8 / 火力镇压总次数)，resIgnore 按比例折算。
 *   （充能资源卡仍由 spec soldier11_charge 承载展示。）
 *
 * - 快速火刀循环（2026-09-03 用户口径，原文「必定触发[火力镇压]」状态）：
 *   强特（盛燃烈火 1041011）发动后普攻/冲刺必定触发[火力镇压]，最多 30 秒或触发 8 次（=火刀层数 8）；
 *   用户标准连招：获取层数招（强特 → 8 层）→ A4 快速取消（1041008，1 层）→ A5 快速火刀
 *   （1041025，1 层）→ 强化A5 结算爆炸（1041026，消耗剩余 6 层，每层 166.4% 火伤）。
 *   层数结算：每发强特的 8 层恰好支持 1 套快速火刀（1+1+6），套数 ≤ 强特次数（层数预算封顶）；
 *   爆炸行吃核心被动 +70%/影画2/C6（1041026 在火力镇压 moveId 集合内）。轴内块 = combos
 *   `soldier11-fire-knife`（轴编辑器可捏，展开行落在失衡窗口内吃易伤 = 失衡内层数结算）。
 *   格挡反击（火力充能/迸发受击）额外 +3 层（上限 8）为防御向触发，不建模块（伤害层数按每强特 8 层计）。
 *
 * 本模块替代原 specPanelBuffs.soldier11ChargeMechanic（工厂模块只有面板 buff，
 * 无法承载 moveId 级增伤与 cfg 写入），spec 资源仍经 computeSpecResources 消费。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

const AGENT_ID = '1041'

// 火力镇压全部 moveId（普通攻击 #1-#7 + 冲刺攻击）
const FIRE_SUPPRESS_MOVE_IDS = new Set<string>([
  '1041002', '1041004', '1041006', '1041008', '1041024', '1041025', '1041026',
  '1041013', // 冲刺攻击：火力镇压
])

const CORE_FIRE_SUPPRESS_BONUS = 70 // 核心被动：火力镇压伤害 +70%
const C2_MAX_STACK_BONUS = 36 // 影画2：3% × 12 层
const C6_RES_IGNORE = 25 // 影画6：无视 25% 火属性伤害抗性
const C6_CHARGE_PER_CAST = 8 // 影画6：每次强特/连携/终结获得 8 层充能
const C1_REFILL_AMOUNT = 40 // 影画1：能量不足 40 回复至 80 ≈ +40/次
const C1_INTERVAL_SECONDS = 50 // 影画1：50s 最多触发一次
const POTENTIAL_CRIT_DMG = 48 // 潜能觉醒·绝焰最高档：暴伤 +48%（额外能力门控）

/** 火刀层数（必定触发[火力镇压]次数）：每发强特 +8（原文「最多持续30秒或触发8次」） */
export const SOLDIER11_BLADE_LAYERS_PER_EX = 8
/** 爆炸层数 = 8 − A4(1层) − A5(1层) = 6（强化A5 消耗「当前所有剩余触发次数」，每层各打一发 #7） */
export const SOLDIER11_EXPLOSION_LAYERS = SOLDIER11_BLADE_LAYERS_PER_EX - 1 - 1
/** 强化A5 每层爆炸命中（1041026：166.4% 火伤，无失衡/积蓄/喧响/时长） */
export const SOLDIER11_EXPLOSION_MOVE_ID = '1041026'
/** 强化特殊技·盛燃烈火 能量成本（catalog 1041011 energyCost） */
export const SOLDIER11_EX_ENERGY = 80

// A45 快速循环（用户口径 2026-08）：窗口招（强特/连携/终结）后必打快速 A4+A5，
// 动作时间各为原段一半（快速取消）；层数结算（2026-09-03）：每发强特 8 层 = 1 套（A4 1 + A5 1 + 爆炸 6）。
const A4_MOVE_ID = '1041008'
const A4_QUICK_TIME = 1.828 * 0.5
const A5_MOVE_ID = '1041025'
const A5_QUICK_TIME = 1.383 * 0.5
const CYCLE_TIME = A4_QUICK_TIME + A5_QUICK_TIME

const specBase = specToMechanicModule(getAgentSpec(AGENT_ID)!)

function cfgNum(cfg: AgentCharConfigInput['cfg'], key: string, fallback: number): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${key}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function buildSoldier11CharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.soldier11CinemaLevel = cinemaLevel
  // 影画1 快速升温：整局口径注入（不做 50s 时间轴，整局总量近似）
  if (cinemaLevel >= 1) {
    const battleTime = cfg.battleTime ?? 180
    const triggers = Math.max(0, Math.floor(battleTime / C1_INTERVAL_SECONDS))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * C1_REFILL_AMOUNT
  }
}

export function patchSoldier11Executions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.soldier11CinemaLevel ?? 0)))
  const coreCov = cfgNum(cfg, 'soldier11.fireSuppressCoverage', 1)
  const c2Cov = cfgNum(cfg, 'soldier11.c2StackCoverage', 1)

  // 影画6 充能可用比例：充能来源（强特/连携/终结）×8 层 vs 火力镇压总消耗
  let fireSuppressCount = 0
  for (const exec of executions) {
    if (exec.moveId && FIRE_SUPPRESS_MOVE_IDS.has(exec.moveId)) fireSuppressCount += exec.count ?? 0
  }
  const chargeCasts = (state.exSpecialCount ?? 0) + (state.chainCountTotal ?? 0) + (state.ultimateCount ?? 0)
  const c6Ratio = cinema >= 6 && fireSuppressCount > 0
    ? Math.min(1, (chargeCasts * C6_CHARGE_PER_CAST) / fireSuppressCount)
    : 0

  for (const exec of executions) {
    if (!exec.moveId) continue
    if (FIRE_SUPPRESS_MOVE_IDS.has(exec.moveId)) {
      // 核心被动：火力镇压伤害 +70% × 覆盖率
      exec.dmgBonus = (exec.dmgBonus ?? 0) + CORE_FIRE_SUPPRESS_BONUS * coreCov
      if (c6Ratio > 0) exec.resIgnore = (exec.resIgnore ?? 0) + C6_RES_IGNORE * c6Ratio
    }
    // 影画2 高温汇聚：普攻/冲刺/闪反（basic/dodge 类）满层 36% × 覆盖率
    if (cinema >= 2 && (exec.category === 'basic' || exec.category === 'dodge')) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + C2_MAX_STACK_BONUS * c2Cov
    }
  }
}

export const soldier11Mechanic: AgentMechanicModule = {
  id: 'agent:soldier11',
  agentIds: [AGENT_ID],
  name: '「11号」',
  description: '火力镇压增伤/燎原火伤/影画1回能/影画2叠层/影画6充能无视火抗',
  settings: [
    {
      id: 'soldier11.fireSuppressCoverage',
      label: '「11号」·火力镇压增伤覆盖率',
      description: '核心被动：火力镇压伤害+70% 的覆盖率（非轴模式默认满覆盖）。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      id: 'soldier11.c2StackCoverage',
      label: '「11号」·影画2 高温汇聚覆盖率',
      description: '影画2：普攻/冲刺/闪反伤害+3%×12层（满层36%）的覆盖率。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      id: 'soldier11.prairieFireStunCoverage',
      label: '「11号」·燎原失衡增伤覆盖率',
      description: '额外能力：攻击失衡敌人火伤额外+22.5% 的覆盖率（非轴模式默认满覆盖）。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  estimateExSpecialTime: ({ cfg, exSpecialCount, ultimateCount }) => {
    // A45 循环计入必要时间（窗口数 = 强特+终结+连携；受平A池约束由折叠循环收敛；
    // 2026-09-03 层数结算：套数 ≤ 强特次数，每发强特 8 层 = 1 套快速火刀）
    const chainOverride = cfg.chainCountTotalOverride
    const chain = chainOverride ?? 0
    const windows = Math.max(0, Math.floor(exSpecialCount) + Math.floor(ultimateCount) + Math.floor(chain))
    const cycles = Math.min(windows, Math.max(0, Math.floor(exSpecialCount)))
    const loopTime = cycles * CYCLE_TIME
    const base = exSpecialCount * (cfg.exSpecialActionTime ?? 0)
    const comboBase = exSpecialCount * (cfg.exSpecialActionTime ?? 0) * (cfg.exSpecialComboAlignRatio ?? 0)
    return { necessaryTime: base + loopTime, comboAlignTime: comboBase }
  },
  applyPanel: ({ panel }) => {
    // 潜能觉醒·绝焰（最高档）：额外能力·燎原触发时自身暴伤 +48%
    if ((panel.additionalAbilityActive ?? 0) > 0) {
      panel.critDmg = (panel.critDmg ?? 0) + POTENTIAL_CRIT_DMG
    }
  },
  buildCharConfig: buildSoldier11CharConfig,
  // A45 快速循环伤害行：窗口招（强特/连携/终结）后必打，动作时间减半占前台；
  // 倍率走倍率表（#4=火力镇压、#5=结算6段），核心被动/C6 经 patchExecutions 咬合。
  // 2026-09-03 层数结算：每发强特 8 层火刀 = 1 套（A4 1层 + A5 1层 + 爆炸 6 层），套数 ≤ 强特次数。
  buildExecutions: ({ cfg: _cfg, state, executions }: AgentResourceInput): void => {
    const exTotal = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
    const windows = Math.max(0,
      Math.floor(state.exSpecialCount ?? 0)
      + Math.floor(state.chainCountTotal ?? 0)
      + Math.floor(state.ultimateCount ?? 0))
    const basicPool = state.basicAttackTime ?? 0
    // 层数结算封顶：每发强特的 8 层恰好支持 1 套（1+1+6），无层数预算的窗口不跑快速火刀
    const cycles = Math.min(windows, exTotal, CYCLE_TIME > 0 ? Math.floor(basicPool / CYCLE_TIME) : 0)
    if (cycles <= 0) return
    executions.push({
      moveId: A4_MOVE_ID, moveName: '火力镇压A4（快速取消）', category: 'basic',
      count: cycles, actionTime: A4_QUICK_TIME, comboAlignRatio: 0,
      totalTime: A4_QUICK_TIME * cycles, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
    })
    executions.push({
      moveId: A5_MOVE_ID, moveName: '火力镇压A5（快速火刀）', category: 'basic',
      count: cycles, actionTime: A5_QUICK_TIME, comboAlignRatio: 0,
      totalTime: A5_QUICK_TIME * cycles, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
    })
    // 强化A5 爆炸：消耗每套剩余 6 层，每层一发 1041026（166.4%/层，t=0 含在 A5 内，无失衡/积蓄/喧响）
    executions.push({
      moveId: SOLDIER11_EXPLOSION_MOVE_ID, moveName: '火力镇压#7：强化A5 每层爆炸', category: 'basic',
      count: cycles * SOLDIER11_EXPLOSION_LAYERS, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
    })
  },
  patchExecutions: patchSoldier11Executions,
  buildResourceResult: ({ cfg, state }: AgentResourceResultInput) => {
    const spec = getAgentSpec(AGENT_ID)
    return {
      specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
    }
  },
  resourceSections: (input: AgentResourceSectionsInput) => specBase.resourceSections?.(input) ?? [],
  /** 快速火刀动作块（轴编辑器可用）：A4 快速取消 → A5 快速火刀 → 6 层爆炸；
   *  展开行落在失衡窗口内吃易伤（轴内层数结算）。强特本体行由通用执行计划承载。 */
  combos: {
    'soldier11-fire-knife': {
      label: '快速火刀（A4快速取消 + A5快速火刀 + 6层爆炸）',
      energyCost: SOLDIER11_EX_ENERGY,
      moves: [
        { moveId: A4_MOVE_ID, count: 1 },
        { moveId: A5_MOVE_ID, count: 1 },
        { moveId: SOLDIER11_EXPLOSION_MOVE_ID, count: SOLDIER11_EXPLOSION_LAYERS },
      ],
    },
  },
}
