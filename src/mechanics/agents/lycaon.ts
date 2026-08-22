import type {
  AgentMechanicModule,
  AgentCharConfigInput,
  AgentResourceInput,
  AgentPanelInput,
} from '../types'
import type { SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, CharacterResourceResult } from '@/types/resource'

/**
 * 莱卡恩（1141）战斗逻辑（用户确认口径，2026-08）：
 * - 角色定位：击破（stun）/冰属性。拐力（核心被动冰抗-25% + 其他属性伤害+30%、
 *   额外能力失衡易伤+35%）由 teammate-buffs.json 承载，不在本模块实现。
 * - 核心被动·金属狼足（用户确认：玩家只打蓄力段所以能吃满）：
 *   [普通攻击]蓄力段 / 闪避反击 / 冲刺攻击的失衡值提升 80%（Lv7 满级）→
 *   面板 stunBuildUpBonus__basic / __dodgeCounter / __dashAttack = 80（加算乘区，
 *   与驱动盘震星迪斯科等通用失衡提升同区加算，不做乘法近似）。
 * - 潜能影像·狩猎的风度（默认潜能满级）：围猎后台普攻/冲刺/闪反期间局内冲击力 +15%
 *   （用户口径：这是局内冲击力，加成到面板看实际）→ applyPanel 局内 impact ×1.15
 *   （面板级近似全覆盖；围猎期间生效）。
 * - 影画6·冷酷猎手（用户确认：莱卡恩自己 50% 增伤全覆盖）：applyPanel 面板 dmgBonus +50。
 * - 影画4·保持风度（护盾）：不建模（用户确认）。
 * - 影画2·能量回馈（用户确认）：使敌人失衡或触发队友[连携技]时回 5 能量 → 次数 =
 *   (失衡次数 + 队伍连携总次数) × 5，由资源池 calcEnergySource 结算（lycaonC2Energy）。
 * - 影画1·满月蓄势（用户确认）：
 *   强特双模式：点按 40 能量 → 狂猎时刻 #1+#2；长按 60 能量 → #1+#3；
 *   滑块 lycaon.exHoldRatio 分配点按/长按，默认全长按。
 *   C1：强特失衡值提升 12%（8s CD → 覆盖率滑块 lycaon.c1Coverage，只给有限次强特）；
 *   长按蓄力中 #3 额外 +10% → 22%。实现为执行级 stunBuildUpBonus（与面板同乘区加算）。
 * - 围猎（2.6 潜能激发，用户确认口径）：
 *   - 次数 = 失衡次数（开场 1 次用于打第一失衡，每失衡刷新 1 次 → "每一失衡都能打一次"）。
 *   - 蓄力段：带冰积蓄的 #2/#4/#6/#8/#10/#11 是蓄力段；围猎后台只打 #2→#4→#6 短循环。
 *   - 一次围猎：① 弹刀 → 开场冰舞（1141027，必定合轴，完整数值）；② 后台跟随前台角色
 *     闪反次数打后台闪避反击（次数 = 队伍其他角色 dodgeCounterCount 之和；仅伤害+失衡值）；
 *     ③ 后台时间 − 闪反时间 = 真正围猎平A时间（蓄力短循环）；④ 收尾冰舞（自动，完整数值）。
 *     一轮失衡两个冰舞。围猎后台蓄力平A/闪反都吃核心被动失衡提升（basic/dodgeCounter 面板区）。
 *   - 后台时间模型：后台时间 = 总时间 − 无敌 − 失衡时长×次数 − 莱卡恩前台时间；
 *     平A时间 = max(0, 后台时间 − 闪反时间)，每次 ≤ 8s。
 *   - 忽略：围猎提前结束每剩余 1s → 下次冰舞失衡 +6%；招架支援强化（黄光弹刀 2→1）。
 * - 近似点：开场/收尾冰舞按倍率表完整数值；后台闪反/蓄力平A无积蓄/喧响/能量（显式 0）；
 *   潜能冲击按面板级全覆盖近似（围猎期间生效）；C2 连携次数取队伍连携总次数。
 * - 未建模：前台普攻的蓄力段口径（基础 #3 秒均，蓄力段失衡提升已由面板 basic 区覆盖）。
 */
export const lycaonMechanic: AgentMechanicModule = {
  id: 'agent:1141',
  agentIds: ['1141'],

  applyPanel({ cinemaLevel, panel }: AgentPanelInput) {
    // 核心被动·金属狼足：普攻蓄力/闪反/冲刺失衡 +80%（Lv7 满级；增强后含闪反/冲刺）
    const CHARGE_STUN_BONUS = 80
    panel.stunBuildUpBonus__basic = (panel.stunBuildUpBonus__basic ?? 0) + CHARGE_STUN_BONUS
    panel.stunBuildUpBonus__dodgeCounter = (panel.stunBuildUpBonus__dodgeCounter ?? 0) + CHARGE_STUN_BONUS
    panel.stunBuildUpBonus__dashAttack = (panel.stunBuildUpBonus__dashAttack ?? 0) + CHARGE_STUN_BONUS
    // 潜能影像·狩猎的风度（默认潜能满级）：局内冲击力 +15%（用户口径：加成到面板看实际）
    panel.impact = (panel.impact ?? 0) * 1.15
    // 影画6·冷酷猎手：莱卡恩自己对目标伤害 +50%（用户口径：全覆盖）
    if (cinemaLevel >= 6) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 50
    }
  },

  buildCharConfig({ cfg, cinemaLevel, skills }: AgentCharConfigInput) {
    // 围猎后台蓄力平A的秒均倍率：蓄力短循环 #2→#4→#6（用户确认，后台只打这三段循环）
    const CHARGE_MOVE_IDS = ['1141002', '1141004', '1141006']
    let dmgSum = 0
    let dazeSum = 0
    let tSum = 0
    for (const id of CHARGE_MOVE_IDS) {
      const mv = findMoveById(skills, id)
      dmgSum += rowValue(mv, 'damage')
      dazeSum += rowValue(mv, 'daze')
      tSum += mv?.actionTime ?? 0
    }
    if (tSum > 0) {
      cfg.lycaonChargePerSec = dmgSum / tSum
      cfg.lycaonChargeDazePerSec = dazeSum / tSum
    }
    // 前台普攻秒均（用户确认：玩家只打蓄力段 → 全部蓄力段 #2/#4/#6/#8/#10/#11 平均 × 平A时间）
    const ALL_CHARGE_IDS = ['1141002', '1141004', '1141006', '1141008', '1141010', '1141011']
    let fDmgSum = 0
    let fDazeSum = 0
    let fTimeSum = 0
    for (const id of ALL_CHARGE_IDS) {
      const mv = findMoveById(skills, id)
      fDmgSum += rowValue(mv, 'damage')
      fDazeSum += rowValue(mv, 'daze')
      fTimeSum += mv?.actionTime ?? 0
    }
    if (fTimeSum > 0) {
      cfg.lycaonFrontChargePerSec = fDmgSum / fTimeSum
      cfg.lycaonFrontChargeDazePerSec = fDazeSum / fTimeSum
    }
    // 围猎后台闪避反击单次失衡倍率（1141019）
    cfg.lycaonDodgeDaze = rowValue(findMoveById(skills, '1141019'), 'daze')
    // 冰舞（1141027）完整数值：开场/收尾冰舞有异常积蓄与喧响
    const iceDance = findMoveById(skills, '1141027')
    cfg.lycaonIceDanceAnomaly = rowValue(iceDance, 'anomaly_buildup')
    cfg.lycaonIceDanceDecibel = rowValue(iceDance, 'decibel_recovery')
    // 强特三段喧响（执行行 enrich 回填同值用；type 要求 decibelRecovery 必填）
    const exDecibels: Record<string, number> = {}
    for (const id of ['1141015', '1141016', '1141017']) {
      exDecibels[id] = rowValue(findMoveById(skills, id), 'decibel_recovery')
    }
    cfg.lycaonExDecibels = exDecibels

    // 命座等级（buildExecutions 无 cinemaLevel 输入，经 cfg 传递）
    cfg.lycaonCinemaLevel = cinemaLevel

    // 强特双模式（用户口径）：点按 40 能量 → #1+#2（1.717s）；长按 60 能量 → #1+#3（2.501s）
    const holdRatio = clamp01(cfgNum(cfg, 'lycaon.exHoldRatio', 1))
    cfg.exSpecialEnergyConsume = EX_TAP_ENERGY * (1 - holdRatio) + EX_HOLD_ENERGY * holdRatio
    cfg.exSpecialActionTime = EX_TAP_TIME * (1 - holdRatio) + EX_HOLD_TIME * holdRatio
    cfg.skipGenericExSpecial = true
    cfg.exSpecialCountFloor = true
    // C1 覆盖率（8s CD → 覆盖率滑块，只给有限次强特强化）
    cfg.lycaonC1Coverage = clamp01(cfgNum(cfg, 'lycaon.c1Coverage', 1))
    // C2 回能（5 能量/次；次数 = 失衡次数 + 队伍连携总次数，由 useResourceCalc 注入 lycaonC2Energy）
    cfg.lycaonC2EnergyPerTrigger = cinemaLevel >= 2 ? 5 : 0
  },

  buildExecutions({ cfg, state, executions }: AgentResourceInput) {
    // 前台平A（引擎 basic_attack 汇总行）改按全部蓄力段秒均（用户确认：玩家只打蓄力段 → 吃招式限定，
    // 失衡提升已由面板 stunBuildUpBonus__basic = 80 承担，这里只覆盖倍率）
    const frontPerSec = cfg.lycaonFrontChargePerSec
    const frontDazePerSec = cfg.lycaonFrontChargeDazePerSec
    if (frontPerSec && frontDazePerSec) {
      const plainBasic = executions.find(e => e.moveId === 'basic_attack' && !e.damageMultiplierOverride)
      if (plainBasic) {
        plainBasic.damageMultiplier = frontPerSec
        plainBasic.damageMultiplierOverride = true
        plainBasic.dazeMultiplier = frontDazePerSec
        plainBasic.dazeMultiplierOverride = true
        plainBasic.skillTableNote = '前台平A按全部蓄力段（#2/#4/#6/#8/#10/#11）平均秒均 × 平A时间（用户口径：玩家只打蓄力段）；失衡提升吃核心被动 basic 区 +80%'
      }
    }

    const exCount = state.exSpecialCount
    if (exCount <= 0) return
    const cinema = cfg.lycaonCinemaLevel ?? 0
    const holdRatio = clamp01(cfgNum(cfg, 'lycaon.exHoldRatio', 1))
    const tap = Math.round(exCount * (1 - holdRatio))
    const hold = Math.max(0, exCount - tap)
    // C1 强化次数：8s CD → floor(战斗时间/8) × 覆盖率，封顶强特总数
    const totalTime = cfg.lycaonTotalTime ?? 180
    const c1Coverage = clamp01(cfg.lycaonC1Coverage ?? 1)
    const strongCount = cinema >= 1
      ? Math.min(exCount, Math.max(0, Math.floor(totalTime / 8)) * c1Coverage)
      : 0
    const holdStrong = Math.min(hold, strongCount)
    const tapStrong = Math.max(0, strongCount - holdStrong)
    const holdPlain = hold - holdStrong
    const tapPlain = tap - tapStrong

    const c1Note = cinema >= 1 ? '（影画1强化）' : ''
    // 点按：狂猎时刻 #1 + #2（40 能量）
    pushEx(executions, cfg, '1141015', tapPlain, EX_TAP_ENERGY, 0, '狂猎时刻 #1（点按）')
    pushEx(executions, cfg, '1141016', tapPlain, EX_TAP_ENERGY, 0, '狂猎时刻 #2（点按）')
    pushEx(executions, cfg, '1141015', tapStrong, EX_TAP_ENERGY, 12, `狂猎时刻 #1（点按${c1Note}）`)
    pushEx(executions, cfg, '1141016', tapStrong, EX_TAP_ENERGY, 12, `狂猎时刻 #2（点按${c1Note}）`)
    // 长按：狂猎时刻 #1 + #3（60 能量；#3 蓄力额外 +10% → 22%）
    pushEx(executions, cfg, '1141015', holdPlain, EX_HOLD_ENERGY, 0, '狂猎时刻 #1（长按）')
    pushEx(executions, cfg, '1141017', holdPlain, EX_HOLD_ENERGY, 0, '狂猎时刻 #3（长按）')
    pushEx(executions, cfg, '1141015', holdStrong, EX_HOLD_ENERGY, 12, `狂猎时刻 #1（长按${c1Note}）`)
    pushEx(executions, cfg, '1141017', holdStrong, EX_HOLD_ENERGY, 22, `狂猎时刻 #3（长按蓄力${c1Note}）`)
  },

  patchExecutions({ cfg, executions }: AgentResourceInput) {
    const huntCount = cfg.lycaonStunCount ?? 0
    if (huntCount <= 0) return

    const windowDur = cfg.lycaonWindowDuration ?? 16
    const totalTime = cfg.lycaonTotalTime ?? 180
    const invincible = cfg.lycaonInvincibleTime ?? 0
    const backstageDodgeCount = cfg.lycaonBackstageDodgeCount ?? 0

    // 莱卡恩前台时间 = 自身执行计划全部招式总时间（平A/强特/终结/连携/闪反/弹刀/支援突击）
    const frontTime = executions.reduce((sum, e) => sum + (e.totalTime ?? 0), 0)

    // 围猎可用后台时间（用户口径）：总时间 - 无敌时间 - 失衡总时长 - 莱卡恩前台时间
    const backstageTotal = Math.max(0, totalTime - invincible - huntCount * windowDur - frontTime)
    if (backstageTotal <= 0) return

    // 后台闪反时间 = 闪反次数 × 闪避反击 actionTime（1141019 = 0.6s）
    const DODGE_ACTION_TIME = 0.6
    const dodgeTime = backstageDodgeCount * DODGE_ACTION_TIME
    // 真正的围猎平A时间 = 后台时间 - 闪反时间（每次围猎 ≤ 8s）
    const huntBasicTotal = Math.max(0, Math.min(8 * huntCount, backstageTotal - dodgeTime))

    // ① + ④ 开场冰舞（弹刀后触发，必定合轴）+ 收尾冰舞（围猎结束自动）：
    // 1141027 完整数值（damage/daze/异常积蓄/喧响），不占前台时间
    executions.push({
      moveId: '1141027',
      moveName: '支援突击：复仇反扑·冰舞（围猎·开场+收尾）',
      category: 'assist',
      count: huntCount * 2,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.lycaonIceDanceDecibel ?? 0,
      totalDecibelRecovery: (cfg.lycaonIceDanceDecibel ?? 0) * huntCount * 2,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      anomalyBuildUp: cfg.lycaonIceDanceAnomaly ?? 0,
      skillTableNote: `围猎开场（弹刀后必定合轴）+ 收尾（自动）各 1 次/失衡 × ${huntCount} 次；完整数值（含异常积蓄/喧响）`,
    })

    // ② 后台闪避反击（跟随前台角色闪反，仅伤害+失衡值；失衡提升由面板 dodgeCounter 区承担）
    if (backstageDodgeCount > 0 && (cfg.lycaonDodgeDaze ?? 0) > 0) {
      executions.push({
        moveId: '1141019',
        moveName: '闪避反击（围猎·后台跟随）',
        category: 'dodge',
        count: backstageDodgeCount,
        actionTime: 0,
        comboAlignRatio: 0,
        totalTime: 0,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0, // 显式 0：后台招式仅伤害+失衡值（enrich 尊重显式 0）
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        anomalyBuildUp: 0,
        skillTableNote: `围猎后台跟随闪反 × ${backstageDodgeCount} 次（队伍其他角色闪反次数之和）；仅伤害+失衡值（吃核心被动闪反失衡+80%）`,
        timeBucket: 'backstage',
      })
    }

    // ③ 围猎后台蓄力平A：#2→#4→#6 短循环秒均 × 平A时间（仅伤害+失衡值；失衡提升由面板 basic 区承担）
    const perSec = cfg.lycaonChargePerSec ?? 0
    const dazePerSec = cfg.lycaonChargeDazePerSec ?? 0
    if (huntBasicTotal > 0 && (perSec > 0 || dazePerSec > 0)) {
      executions.push({
        moveId: 'basic_attack',
        moveName: '普通攻击（围猎·后台蓄力 #2→#4→#6）',
        category: 'basic',
        count: 0,
        actionTime: 0,
        comboAlignRatio: 0,
        totalTime: huntBasicTotal,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        damageMultiplier: perSec,
        damageMultiplierOverride: true,
        dazeMultiplier: dazePerSec,
        dazeMultiplierOverride: true,
        anomalyBuildUp: 0,
        skillTableNote: `围猎·后台蓄力平A：${huntBasicTotal.toFixed(1)}s（后台 ${backstageTotal.toFixed(1)}s − 闪反 ${dodgeTime.toFixed(1)}s，每次≤8s × ${huntCount}）；仅伤害+失衡值（吃核心被动蓄力失衡+80%）`,
        timeBucket: 'backstage',
      })
    }
  },

  settings: [
    {
      id: 'lycaon.exHoldRatio',
      label: '莱卡恩·长按强特占比（点按/长按分配）',
      description: '强化特殊技：狂猎时刻 两种施放——点按 40 能量（#1+#2，1.717s）与长按 60 能量（#1+#3，2.501s）。本滑块为长按占比，默认 100%（全长按，倍率更高）。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'lycaon.c1Coverage',
      label: '莱卡恩·影画1强特失衡强化覆盖率',
      description: '影画1：狂猎时刻失衡值 +12%（长按蓄力 #3 额外 +10% → 22%），8 秒冷却触发一次。按覆盖率折算强化次数 = min(强特总数, floor(战斗时间/8) × 覆盖率)，默认 100%。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
  ],
}

// 强特双模式常量（用户口径）
const EX_TAP_ENERGY = 40
const EX_HOLD_ENERGY = 60
const EX_TAP_TIME = 0.767 + 0.95 // 狂猎时刻 #1 + #2
const EX_HOLD_TIME = 0.767 + 1.734 // 狂猎时刻 #1 + #3
// 强特段 actionTime（倍率表）
const EX_MOVE_TIMES: Record<string, number> = {
  '1141015': 0.767,
  '1141016': 0.95,
  '1141017': 1.734,
}

function pushEx(
  executions: CharacterResourceResult['executions'],
  cfg: { exSpecialComboAlignRatio?: number; lycaonExDecibels?: Record<string, number> },
  moveId: string,
  count: number,
  energy: number,
  stunBuildUpBonus: number,
  label: string,
): void {
  if (count <= 0) return
  const actionTime = EX_MOVE_TIMES[moveId] ?? 1
  const decibel = cfg.lycaonExDecibels?.[moveId] ?? 0
  executions.push({
    moveId,
    moveName: `强化特殊技：${label}`,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: cfg.exSpecialComboAlignRatio ?? 0,
    totalTime: count * actionTime,
    totalComboAlignTime: count * actionTime * (cfg.exSpecialComboAlignRatio ?? 0),
    energyConsume: energy,
    totalEnergyConsume: energy * count,
    decibelRecovery: decibel,
    totalDecibelRecovery: decibel * count,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    ...(stunBuildUpBonus > 0 ? { stunBuildUpBonus } : {}),
    ...(stunBuildUpBonus > 0 ? { skillTableNote: `影画1强化：失衡值提升 +${stunBuildUpBonus}%（乘区加算）` } : {}),
  })
}

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const found = cat.moves.find(m => m.id === moveId)
    if (found) return found
  }
  return null
}

function rowValue(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
