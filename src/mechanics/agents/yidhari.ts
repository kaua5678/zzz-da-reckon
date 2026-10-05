import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, CharacterResourceResult, IterationState} from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { fmt } from '@/utils/format'
import { findMoveById, getRowValue as rowValue } from '@/data/moveTableQueries'
import { cfgMechanicSettingRaw } from '@/utils/mechanicSettingCfg'
import { finiteOr0 } from '@/utils/finiteClamp'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { forEachSlotAxisAction } from '@/mechanics/stunWindows'

const YIDHARI_AGENT_ID = '1051'

// 蓄力循环：蓄力1s（烧血）→ 霜寒拥覆#3（下砸）→ 碎惘沉击#4（平A，满蓄+30%）
const CHARGE_SLAM = '1051007'   // 霜寒拥覆 #3，秽盾 200t（actionTime 已按 ether_purify/200 重录）
const BASIC_FOLLOW = '1051003'  // 碎惘沉击 #4，吃满蓄 +30%，命中回 10% 生命值
const EX_HEAVY = '1051012'      // 强化特殊技：极寒重碾 #1（唯一耗能强特）
const TENTACLE = '1051024'      // 寒冰触手（额外能力，158.4% 只有伤害，无 daze/异常/闪能）
const SURGE_PURSUIT = '1051011' // 特殊技：溯寒追碾（重碾触发技，0 耗能；非失衡触发溯寒回15闪能）
const CHARGE_SECONDS = 1        // 每次蓄力烧血 1 秒
const FULL_CHARGE_BONUS_PCT = 30 // 满蓄力段数：碎惘沉击 +30% 伤害
const BASIC_FOLLOW_HEAL_PCT = 10 // 碎惘沉击命中回复 10% 最大生命值（固定）
const EX_HEAL_RATIO_PCT = 33     // 极寒重碾回血 = 已损失生命值 × 33%
const OUT_STUN_REFUND = 15       // 非失衡（溯寒后）极寒重碾额外回复 15 闪能
// 轴连段块 id（= 本模块 `combos` 的两把键，单一事实源；轴编辑器/预设按它放置）
const HEAVY_SINGLE = 'yidhari-heavy-single'
const HEAVY_DOUBLE = 'yidhari-heavy-double'
// 单次碾的闪能成本：0 命 60 / 1 命 50（与 buildYidhariCharConfig 的 exSpecialEnergyConsume 同一表达式）
const HEAVY_SINGLE_COST_0 = 60
const HEAVY_SINGLE_COST_1 = 50
const HEAVY_DOUBLE_COST = 85     // 50 + 35（C1 连续重碾）

function yidhariProps() {
  const resource = getAgentSpec(YIDHARI_AGENT_ID)?.resources?.find(item => item.id === 'yidhari_hp_burn')
  const props = resource?.properties ?? {}
  return {
    exSpecialEnergyCost: Number(props.exSpecialEnergyCost ?? 60) || 60,
    hpBurnPctPerSecond: Number(props.hpBurnPctPerSecond ?? 15) || 15,
    exHealRatioPct: Number(props.exHealRatioPct ?? EX_HEAL_RATIO_PCT) || EX_HEAL_RATIO_PCT,
    decibelPerHpPct: Number(props.decibelPerHpPct ?? 10) || 10,
    cinema4DecibelBonusPct: Number(props.cinema4DecibelBonusPct ?? 10) || 10,
  }
}

function loopMove(move: SkillMove | null, dmgBonusPct = 0): YidhariLoopMove {
  return {
    id: move?.id ?? '',
    damage: rowValue(move, 'damage') * (1 + dmgBonusPct / 100),
    daze: rowValue(move, 'daze'),
    anomaly: rowValue(move, 'anomaly_buildup'),
    actionTime: move?.actionTime ?? 0,
    decibel: rowValue(move, 'decibel_recovery'),
    flash: rowValue(move, 'flash_energy_recovery'),
  }
}

/** 蓄力循环单轮时长 = 蓄力1s + 下砸 + 平A */
function chargeCycleTime(cfg: Partial<CharacterOperationConfig>): number {
  const slam = cfg.yidhariChargeSlam
  const follow = cfg.yidhariBasicFollow
  return CHARGE_SECONDS + (slam?.actionTime ?? 0) + (follow?.actionTime ?? 0)
}

function applyYidhariPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if (!panel) return
  // 核心被动·拾梦空想：生命值 <50% 时伤害提升达到最大值 +100%（频繁烧血，覆盖率按 100%）
  panel.dmgBonus = (panel.dmgBonus ?? 0) + 100
  // 额外能力·完形叙事：击破/支援触发，生命值<50% 时暴击伤害 +30%（覆盖率 100%）
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.critDmg = (panel.critDmg ?? 0) + 30
  }
  // 以太帷幕·涌泉：全队局内最大生命值 +5%（0命）/ +10%（4命）——由 teammate-buffs.json 1051 条目
  // （yidhari.core_curtain_hp + yidhari.cinema4_curtain_hp）经 buff 引擎真正重算 panel.hp（含贯穿力基底）。
  // 影画1：普攻/强化特殊技 无视 20% 冰属性伤害抗性
  if (cinemaLevel >= 1) {
    panel.enemyIceResReduction__basic = (panel.enemyIceResReduction__basic ?? 0) + 20
    panel.enemyIceResReduction__exSpecial = (panel.enemyIceResReduction__exSpecial ?? 0) + 20
  }
  // 影画2：暴击伤害 +40%；溯寒/追碾后 0.5 闪能/秒（默认第5秒起永续，近似全局）
  if (cinemaLevel >= 2) {
    panel.critDmg = (panel.critDmg ?? 0) + 40
    panel.flashEnergyRegenBonusFlat = (panel.flashEnergyRegenBonusFlat ?? 0) + 0.5
  }
  // 影画6：启谛期间贯穿伤害 +25%（跟随涌泉帷幕，默认 100% 覆盖）
  if (cinemaLevel >= 6) {
    panel.sheerDmgBonus = (panel.sheerDmgBonus ?? 0) + 25
  }
}

function buildYidhariCharConfig({ cinemaLevel, skills, cfg }: AgentCharConfigInput): void {
  const props = yidhariProps()
  const cinema4Enabled = cinemaLevel >= 4
  const decibelPerHpPct = props.decibelPerHpPct * (cinema4Enabled ? 1 + props.cinema4DecibelBonusPct / 100 : 1)
  const missingHpPct = Math.max(0, Math.min(1, Number(cfgMechanicSettingRaw(cfg, 'yidhari.exHealMissingHpPct') ?? 75) / 100))
  const hpBurnPctPerSecond = Math.max(0, Math.min(100, Number(cfgMechanicSettingRaw(cfg, 'yidhari.hpBurnPctPerSecond') ?? 0.15)))
  const exPerStun = Math.max(1, Math.floor(Number(cfgMechanicSettingRaw(cfg, 'yidhari.exPerStun') ?? (cinemaLevel >= 1 ? 3 : 2))))
  const tentacleInterval = Math.max(1, Number(cfgMechanicSettingRaw(cfg, 'yidhari.tentacleInterval') ?? 13.5))

  cfg.yidhariCinema4Enabled = cinema4Enabled
  cfg.yidhariDecibelPerHpPct = decibelPerHpPct
  cfg.yidhariExHealMissingHpPct = missingHpPct
  cfg.yidhariHpBurnPctPerSecond = hpBurnPctPerSecond
  cfg.yidhariCinemaLevel = cinemaLevel

  // 蓄力循环招式（先提取，用于计算循环时长 → 烧血喧响率）
  const slam = findMoveById(skills, CHARGE_SLAM)
  const follow = findMoveById(skills, BASIC_FOLLOW)
  cfg.yidhariChargeSlam = loopMove(slam)
  cfg.yidhariBasicFollow = loopMove(follow)

  // 核心被动：进入战场时回复 60 闪能（勘域模式 180s 内最多一次；按一次计入开局赠送）
  cfg.initialEnergyGift = 60
  // 强化特殊技固定为极寒重碾（缠霜不消耗闪能）
  const exHeavy = findMoveById(skills, EX_HEAVY)
  cfg.exSpecialMoveId = EX_HEAVY
  cfg.exSpecialEnergyConsume = cinemaLevel >= 1 ? Math.max(0, props.exSpecialEnergyCost - 10) : props.exSpecialEnergyCost
  cfg.exSpecialActionTime = exHeavy?.actionTime ?? 2.6
  cfg.exSpecialDecibelRecovery = rowValue(exHeavy, 'decibel_recovery')

  // 涌泉帷幕强化连携 = 1051025（连携技：踱寒践约 #2），覆盖默认的 1051015 #1
  const chainHeavy = findMoveById(skills, '1051025')
  if (chainHeavy) {
    cfg.chainMoveId = '1051025'
    cfg.chainActionTime = chainHeavy.actionTime ?? 2.517
    cfg.chainDecibelRecovery = rowValue(chainHeavy, 'decibel_recovery')
  }

  cfg.yidhariExPerStun = exPerStun
  cfg.yidhariTentacleInterval = tentacleInterval
  cfg.exRefundPerPaid = OUT_STUN_REFUND
  // refund 反馈（每发回 15）是自指方程：迭代期强特次数按实数参与收敛（唯一不动点），
  // 终局才 floor 一次（calcTeamResources 重推 ≤3 轮）——见 resolveExSpecialCount 连续强特分支
  cfg.exContinuous = true
}

export function computeYidhariHpSource(
  // r405：原收 Record<string, unknown>（测试传字面量）；Partial 同样接受测试的 any / 字面量，且键有类型
  cfg: Partial<CharacterOperationConfig>,
  state: IterationState,
  cinema4Enabled: boolean,
  exHealMissingHpPct = 0.75,
  hpBurnPctPerSecond = 15,
): YidhariHpSource {
  const props = yidhariProps()
  const exSpecialCount = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  const stunCount = Math.max(0, Math.floor(Number(cfg.yidhariStunCount ?? 0)))
  const exPerStun = Math.max(1, Math.floor(Number(cfg.yidhariExPerStun ?? 2)))

  const safeBurnPctPerSecond = Math.max(0, Math.min(100, Number.isFinite(hpBurnPctPerSecond) ? hpBurnPctPerSecond : props.hpBurnPctPerSecond))
  const decibelPerHpPct = props.decibelPerHpPct * (cinema4Enabled ? 1 + props.cinema4DecibelBonusPct / 100 : 1)
  const safeMissingHpPct = Math.max(0, Math.min(1, exHealMissingHpPct))

  // 蓄力循环次数：平A时间 / 单轮时长
  const cycleTime = chargeCycleTime(cfg)
  const cycles = cycleTime > 0 ? Math.max(0, Math.floor((state.basicAttackTime ?? 0) / cycleTime)) : 0
  const chargedAttackSeconds = cycles * CHARGE_SECONDS

  // 极寒重碾拆分：失衡内 = 轴连段反推（有轴 exReservedCount）或 每次失衡次数 × 失衡次数；非失衡 = 剩余（每次回 15 闪能）
  const axisInStun = Number(cfg.exReservedCount)
  const inStunExCount = Number.isFinite(axisInStun) && (cfg.exReservedCount !== undefined)
    ? Math.min(exSpecialCount, Math.max(0, axisInStun))
    : Math.min(exSpecialCount, exPerStun * stunCount)
  const outStunExCount = Math.max(0, exSpecialCount - inStunExCount)

  // 回血：强特 33%×已损失（可调）+ 碎惘沉击 10%×循环次数（固定）+ 外部回血（卢西娅等）
  const exHealPct = exSpecialCount * props.exHealRatioPct * safeMissingHpPct
  const followHealPct = cycles * BASIC_FOLLOW_HEAL_PCT
  const externalHealPct = Math.max(0, Number(cfg.yidhariExternalHealPct ?? 0))
  const hpHealPct = exHealPct + followHealPct + externalHealPct

  // 烧血喧响：开局场外烧 75% 至 25%，战斗中基本循环把全部回复量烧掉 → 总烧血 = 75% + 回复量
  const burnPct = 75 + hpHealPct
  const burnDecibel = burnPct * decibelPerHpPct

  return {
    exSpecialCount,
    exSpecialEnergyCost: props.exSpecialEnergyCost,
    inStunExCount,
    outStunExCount,
    exPerStun,
    chargeCycles: cycles,
    chargedAttackSeconds,
    hpBurnPctPerSecond: safeBurnPctPerSecond,
    hpBurnPct: burnPct,
    hpHealPct,
    exHealMissingHpPct: safeMissingHpPct,
    decibelPerHpPct,
    burnDecibel,
    note: `总烧血 ${burnPct.toFixed(1)}%（开局场外 75% + 回血 ${hpHealPct.toFixed(1)}%）；蓄力循环 ${cycles} 次；极寒重碾 失衡内${inStunExCount} + 非失衡${outStunExCount}。`,
  }
}

function buildYidhariExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const slam = cfg.yidhariChargeSlam
  const follow = cfg.yidhariBasicFollow
  const cycleTime = chargeCycleTime(cfg)

  // 蓄力循环：把平A时间折算成 下砸(1051007) + 平A(1051003×1.3) 两个显式招式
  // 迭代期 cycles 实数化（2026-09-09，能量收入行级 Σ 的耦合坑）：Σ 把 slam/follow 行值计入
  // 账本后，「cycles→闪能→强特次数→必要时间→平A池→cycles」闭成反馈环，floor 整数阶梯在
  // 循环边界（bat ≈ k×cycleTime）吸收不了 → 全状态精确 2-循环（实测 parry4/dodge10 格
  // bat 26.79↔26.99、cycles 6↔7，同坑②丽娜振荡器家族）。按「实数松弛、终局才 floor」教义
  // （exContinuous 同款）：迭代期实数参与收敛，终局重推与装配（exFinalize=true，
  // 复位已移到装配后）floor 一次——行 count 终局仍整数。
  const relaxCycles = cfg.exContinuous === true && cfg.exFinalize !== true
  const basicExec = executions.find(e => e.moveId === 'basic_attack')
  let cycles = 0
  if (basicExec && cycleTime > 0) {
    const rawCycles = Math.max(0, basicExec.totalTime) / cycleTime
    cycles = relaxCycles ? rawCycles : Math.floor(rawCycles)
    // 蓄力时间保留为 basic_attack 行（烧血时间，无伤害/闪能/失衡/积蓄），让时间分配可见
    basicExec.totalTime = cycles * CHARGE_SECONDS
    basicExec.totalDecibelRecovery = 0
    basicExec.totalEnergyRecovery = 0
    basicExec.damageMultiplier = 0
    basicExec.dazeMultiplier = 0
    basicExec.dazeMultiplierOverride = true
    basicExec.anomalyBuildUp = 0
    basicExec.totalAnomalyBuildUp = 0
    basicExec.moveName = '蓄力（烧血）'
  }

  if (cycles > 0 && slam && slam.actionTime > 0) {
    executions.push(moduleExecRow({
      moveId: slam.id,
      moveName: '普通攻击：霜寒拥覆 #3（蓄力下砸）',
      category: 'basic',
      count: cycles,
      actionTime: slam.actionTime,
      totalTime: cycles * slam.actionTime,
      decibelRecovery: slam.decibel,
      totalDecibelRecovery: cycles * slam.decibel,
      energyRecovery: slam.flash,
      totalEnergyRecovery: cycles * slam.flash,
      damageMultiplier: slam.damage,
      damageMultiplierOverride: true,
      dazeMultiplier: slam.daze,
      dazeMultiplierOverride: true,
      anomalyBuildUp: slam.anomaly,
      totalAnomalyBuildUp: slam.anomaly * cycles,
      skillTableNote: `蓄力循环 ${cycles} 次：蓄力1s烧血 → 霜寒拥覆#3 下砸（秽盾200t）`,
    }))
  }
  if (cycles > 0 && follow && follow.actionTime > 0) {
    executions.push(moduleExecRow({
      moveId: follow.id,
      moveName: '普通攻击：碎惘沉击 #4（满蓄+30%）',
      category: 'basic',
      count: cycles,
      actionTime: follow.actionTime,
      totalTime: cycles * follow.actionTime,
      decibelRecovery: follow.decibel,
      totalDecibelRecovery: cycles * follow.decibel,
      energyRecovery: follow.flash,
      totalEnergyRecovery: cycles * follow.flash,
      damageMultiplier: follow.damage,
      damageMultiplierOverride: true,
      dmgBonus: FULL_CHARGE_BONUS_PCT, // 满蓄 +30% 进增伤区（非独立乘区）
      dazeMultiplier: follow.daze,
      dazeMultiplierOverride: true,
      anomalyBuildUp: follow.anomaly,
      totalAnomalyBuildUp: follow.anomaly * cycles,
      skillTableNote: `蓄力循环 ${cycles} 次：碎惘沉击#4 满蓄增伤区+30%，命中回10%生命值`,
    }))
  }

  // 溯寒追碾 + 极寒重碾#2（追击段）：每个强特序列先打溯寒追碾（0耗能触发），再打极寒重碾
  const exCount = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  const cinemaLevel = Math.max(0, Math.floor(Number(cfg.yidhariCinemaLevel ?? 0)))
  // 0命：1 溯寒追碾配 1 重碾；1命：1 溯寒追碾配 2 重碾（C1 连续释放）
  const surgeCount = Math.ceil(exCount / (cinemaLevel >= 1 ? 2 : 1))
  if (surgeCount > 0) {
    executions.push(moduleExecRow({
      moveId: SURGE_PURSUIT,
      moveName: '特殊技：溯寒追碾（重碾触发）',
      category: 'special',
      count: surgeCount,
      actionTime: 0.95,
      totalTime: surgeCount * 0.95,
      decibelRecovery: 6.4075,
      totalDecibelRecovery: surgeCount * 6.4075,
      ...ENERGY_RECOVERY_OFF,
      damageMultiplier: 168.4,
      damageMultiplierOverride: true,
      anomalyBuildUp: 95.03,
      totalAnomalyBuildUp: surgeCount * 95.03,
      skillTableNote: `溯寒追碾 ${surgeCount} 次（0耗能触发重碾；非失衡触发溯寒回15闪能）`,
    }))
  }
  // 寒冰触手（额外能力·完形叙事）：需击破/支援触发，每 13.5s 一次，只有伤害（倍率随强特技能等级，吃3/5命）；
  // 按有效战斗时间折算，无敌期间不结算（core/effectiveTime.ts）
  const tentacleInterval = Math.max(1, Number(cfg.yidhariTentacleInterval ?? 13.5))
  const tentacleCount = Math.max(0, Math.floor(effectiveBattleTime(cfg) / tentacleInterval))
  const additionalAbilityActive = (cfg.panel?.additionalAbilityActive ?? 0) > 0
  if (tentacleCount > 0 && additionalAbilityActive) {
    const skillBonus = cfg.panel?.skillLevelBonus ?? 0
    const dmgCoef = skillBonus > 0 ? getSkillLevelCoef(skillBonus).damageCoef : 1
    executions.push(moduleExecRow({
      moveId: TENTACLE,
      moveName: '寒冰触手（额外能力）',
      category: 'special',
      count: tentacleCount,
      ...RECOVERY_OFF,
      damageMultiplier: 158.4 * dmgCoef,
      damageMultiplierOverride: true,
      skillTableNote: `寒冰触手 ${tentacleCount} 次：158.4%${dmgCoef !== 1 ? `×技能等级${dmgCoef.toFixed(4)}` : ''} 只有伤害，每 ${tentacleInterval}s 触发一次（需额外能力）`,
    }))
  }
}

function buildYidhariResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const source = computeYidhariHpSource(
    cfg,
    state,
    Boolean(cfg.yidhariCinema4Enabled),
    Number(cfg.yidhariExHealMissingHpPct ?? 0.75),
    Number(cfg.yidhariHpBurnPctPerSecond ?? 0.15),
  )
  return { yidhariHpSource: source }
}

function buildYidhariResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.yidhariHpSource
  if (!source) return []
  return [{
    id: 'yidhari-hp-burn',
    title: '伊德海莉·生命值/极寒重碾',
    summary: `烧血 ${fmt(source.hpBurnPct, 1)}% → 喧响 +${fmt(source.burnDecibel, 1)} · 极寒重碾 失衡内${source.inStunExCount}/非失衡${source.outStunExCount}`,
    rows: [
      { label: '蓄力循环', value: `${source.chargeCycles} 次`, detail: `蓄力1s烧血 → 霜寒拥覆#3 → 碎惘沉击#4×1.3` },
      { label: '蓄力烧血', value: `${fmt(source.hpBurnPct, 1)}%`, detail: `${fmt(source.chargedAttackSeconds, 2)}s × ${source.hpBurnPctPerSecond}%/s` },
      { label: '极寒重碾(失衡内)', value: `${source.inStunExCount} 次`, detail: `每次失衡 ${source.exPerStun} 次 × 失衡次数` },
      { label: '极寒重碾(非失衡)', value: `${source.outStunExCount} 次`, detail: `每次回 15 闪能（溯寒后）` },
      { label: '强化特殊技回血', value: `+${fmt(source.hpHealPct, 1)}%`, detail: `强特 ${fmt(source.exHealMissingHpPct * 100, 0)}%已损×33%×次数 + 碎惘沉击 10%×循环` },
      { label: '烧血喧响', value: `+${fmt(source.burnDecibel, 1)}`, detail: `每1%生命值 ${source.decibelPerHpPct} 点喧响` },
    ],
    footer: source.note,
  }]
}

/**
 * `applyTeamConfig` · converge：把本轮失衡次数与**轴内连段反推的强特次数/闪能成本**写进自己那份 cfg。
 *
 * 迁入前它们是 `convergence.ts` 的 `merged.agentId === '1051'` 分支 + `:661-681` 的轴内连段反推
 * （2026-09-16 round 13 批次 3，规则 6）。两条路刻意分开：
 *  · `yidhariStunCount` ← `stunCount`（**与轴无关**，轴/非轴恒写——`computeYidhariHpSource` 用它
 *    算「每次失衡 `yidhariExPerStun` 次」的非轴拆分上限）；
 *  · `exReservedCount` / `exReservedEnergyCost` ← `axis`（**轴内连段反推**：单次碾 = 1 重碾 /
 *    50 或 60 闪能，双次碾 = 2 重碾 / 85 闪能，各自 × 块数 × 窗口数）。
 *
 * ⚠ **条件写形态逐位保留**：`exReservedCount` 只在 `axis.active && 合计 > 0` 时写，**不是**恒写
 * 0——`core/resource/helpers.ts#resolveExSpecialCount` 用 `!== undefined` 判「走哪条通路」
 * （有该字段 = 失衡内次数已知、按 `(总闪能 − 失衡内成本)/消耗` 反推非失衡次数；缺 = 纯能量预算口径）。
 * 恒写 0 会把「本队没有轴内重碾」错判成「失衡内 0 次」而改掉非失衡次数的求解路径。
 *
 * 成本档按**本槽**命座判定（CC-330：修正 2026-09-16 迁移遗留的 `team[0]?.cinemaLevel` 槽位错位；
 * 与 `buildYidhariCharConfig` 的 `exSpecialEnergyConsume` 同读本槽 `cinemaLevel`）。
 */
function applyYidhariTeamConfig({ cfg, cinemaLevel, phase, stunCount, team, axis }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  cfg.yidhariStunCount = stunCount
  // 连续强特通道：非保留模式（非轴）下不返还的强特次数上限。
  // 原式 = `n(cfg.yidhariExPerStun ?? 2) * n(cfg.yidhariStunCount ?? 0)`（消费端 resourceIncome 非轴分支），
  // 而 `yidhariStunCount` 的唯一写入方就是上面那行 ⇒ 此处用同一 stunCount 逐位复刻。
  cfg.exRefundFreeCap = finiteOr0(cfg.yidhariExPerStun ?? 2) * finiteOr0(stunCount)
  if (!axis) return
  let inStunEx = 0
  let inStunEnergy = 0
  if (axis.active) {
    const slot = Number(cfg.slot)
    const ownCinema = cinemaLevel ?? team.find(m => m.slot === slot)?.cinemaLevel ?? team[slot]?.cinemaLevel ?? 0
    const singleCost = Number(ownCinema) >= 1 ? HEAVY_SINGLE_COST_1 : HEAVY_SINGLE_COST_0
    forEachSlotAxisAction(axis, slot, (act, wins) => {
      const times = act.count * wins
      if (act.moveId === HEAVY_SINGLE) {
        inStunEx += times
        inStunEnergy += singleCost * times
      } else if (act.moveId === HEAVY_DOUBLE) {
        inStunEx += 2 * times
        inStunEnergy += HEAVY_DOUBLE_COST * times
      }
    })
  }
  if (inStunEx > 0) {
    cfg.exReservedCount = inStunEx
    cfg.exReservedEnergyCost = inStunEnergy
  }
}

/**
 * 自身烧血喧响（规则 6 引擎落点，2026-09-26 CC-14b）：伊德海莉「开局场外烧 75% 至 25% +
 * 战斗中把全部回复量烧掉」换算的**不可分享**喧响（原始量，未乘获得效率）。
 *
 * 算式逐字来自 `core/resource/helpers.ts#iterate`（迭代期）与 `core/resource/resourceIncome.ts
 * #calcDecibelSource`（结果装配），两处常量 75 / 33 / 10 与取整方式逐位不变。差别只在外部治疗项：
 *  · 迭代期调用方传 `providerUltCount`（帷幕提供者的终结技次数），按 `healPctPerCurtainProviderUlt`
 *    逐次结算；
 *  · 结果装配调用方传 `providerUltCount: 0`——`assembleSlot` 已把「每次 × 次数」写回
 *    `cfg.yidhariExternalHealPct`，再乘次数会重复计入。
 *
 * 判别用**无默认值**的模块专属字段 `yidhariDecibelPerHpPct`（唯一写入方 = 本模块
 * `buildYidhariCharConfig`，非该角色 cfg 恒 undefined）；带 `?? 默认` 的两个字段对任意 cfg 都有值，
 * 不能做判据（判据同 T6；规则 6：引擎按能力/字段查询，不按角色名查询）。
 */
function yidhariSelfBurnDecibel({ cfg, basicAttackTime, exSpecialCount, providerUltCount }: {
  cfg: CharacterOperationConfig
  basicAttackTime: number
  exSpecialCount: number
  providerUltCount: number
}): number {
  if (cfg.yidhariDecibelPerHpPct === undefined) return 0
  const missing = Math.max(0, Math.min(1, cfg.yidhariExHealMissingHpPct ?? 0.75))
  const decibelPerHp = cfg.yidhariDecibelPerHpPct ?? 10
  const external = Math.max(0, (cfg.yidhariExternalHealPct ?? 0)
    + (cfg.healPctPerCurtainProviderUlt ?? 0) * providerUltCount)
  const cycleTime = chargeCycleTime(cfg)
  const cycles = cycleTime > 0 ? Math.floor(basicAttackTime / cycleTime) : 0
  const exHeal = exSpecialCount * EX_HEAL_RATIO_PCT * missing
  const followHeal = cycles * BASIC_FOLLOW_HEAL_PCT
  return (75 + exHeal + followHeal + external) * decibelPerHp
}

/**
 * 装配期写回（2026-09-26 CC-14c，自 `core/resource/assembleSlot.ts` 逐字迁入）：外部回血（卢西娅
 * 星光汇聚之地）按帷幕提供者**最终**终结技次数折算后累加进 `cfg.yidhariExternalHealPct`
 * （供结果装配期 `selfBurnDecibel(providerUltCount: 0)` 与 HP 来源展示共用精确值）。
 *
 * 判别沿用无默认值的模块专属字段 `yidhariDecibelPerHpPct`：原 core 以
 * `configs.findIndex(c => c.yidhariDecibelPerHpPct !== undefined)` 选槽，字段缺失时不写回——此处同款守卫，逐位等价。
 */
function yidhariOnFinalAssemble({ cfg, providerUltCount }: { cfg: CharacterOperationConfig; providerUltCount: number }): void {
  if (cfg.yidhariDecibelPerHpPct === undefined) return
  cfg.yidhariExternalHealPct = (cfg.yidhariExternalHealPct ?? 0)
    + (cfg.healPctPerCurtainProviderUlt ?? 0) * providerUltCount
}

export const yidhariMechanic: AgentMechanicModule = {
  id: 'agent:yidhari',
  agentIds: [YIDHARI_AGENT_ID],
  // CC-65b：不吃通用交互基准（原 stores/config.ts 写死名单；正反馈 refund 循环 carry，弹刀/闪反归击破位）
  noGenericInteraction: true,
  // CC-60：自动失衡轴「章」档位归属（原 data/stunAxisPresets.ts#selectAutoStunAxisPreset 与 StunAxisPage 写死本角色 id）
  axisPresetChapterOwner: true,
  // CC-63：兜底平A填充 → 蓄力循环（basic_attack 已被改写为「蓄力烧血」无伤害/失衡），映射到 下砸 + 平A。
  // 原在编排层 roundInputs#expandExecutedToCounts 写死 `fillerAgentId === '1051'`，算式逐字搬入（1s 蓄力 + 两段 actionTime）。
  expandBasicFill: ({ fillSec, actionTimeOf }) => {
    const loopTime = 1 + (actionTimeOf(CHARGE_SLAM) ?? 0) + (actionTimeOf(BASIC_FOLLOW) ?? 0)
    const loops = loopTime > 0 ? fillSec / loopTime : 0
    return [{ moveId: CHARGE_SLAM, count: loops }, { moveId: BASIC_FOLLOW, count: loops }]
  },
  // CC-57：轴编辑器候选池隐藏裸极寒重碾（原 StunAxisPage 写死 `c.agentId === '1051' && moveId === '1051012'`）
  // CC-393：连携固定用 1051025（涌泉帷幕强化连携，见 buildYidhariCharConfig「覆盖默认的 1051015 #1」，无条件）⇒ 1051015 永不出手；
  // 不隐藏时编辑器会以 [表] 块提供它，放进轴 = 在 #2 的连携次数之外再按 #1 倍率加一份直伤（重复计伤）
  axisHiddenMoves: ['1051012', '1051015'],
  // CC-433：轴编辑器「寒冰触手」常驻候选块（原 StunAxisPage 写死 findMove(skills, '1051024') 分支，逐字段搬入）。
  // 0 时长（额外能力触发，不占行动时间）；quota 9 与诺姆转连携同为候选「可放」提示上限，不是机制次数——
  // 机制次数在上面 tentacleCount = floor(有效战斗时长 / 13.5)。core/stunAxis 按 moveId 1051024 识别为轴专属块。
  axisExtraBlocks: () => [{ moveId: TENTACLE, label: '寒冰触手', actionTime: 0, quota: 9 }],
  name: '伊德海莉',
  description: '蓄力循环（1s烧血→霜寒拥覆#3→碎惘沉击#4）+ 极寒重碾（失衡内2/非失衡回15闪能）+ 低血增伤100%覆盖。',
  applyPanel: applyYidhariPanel,
  buildCharConfig: buildYidhariCharConfig,
  applyTeamConfig: applyYidhariTeamConfig,
  // 队友开帷幕供给（2026-09-25 CC-6b）：伊德海莉终结技每次开一次帷幕，供卢西娅 C4
  // 帷幕能力消费。契约 = 纯函数，只读自己 state；引擎经 `crossAgentSupplyCountOf`
  // 收集成标量，模块不直接读队友 state。
  crossAgentSupply: {
    kind: 'curtain-open',
    supply: ({ state }) => Math.max(0, Math.floor(state.ultimateCount)),
  },
  // 自身烧血喧响（2026-09-26 CC-14b）：算式见上方 yidhariSelfBurnDecibel 注释。
  selfBurnDecibel: yidhariSelfBurnDecibel,
  // 装配期写回（2026-09-26 CC-14c）：见上方 yidhariOnFinalAssemble 注释。
  onFinalAssemble: yidhariOnFinalAssemble,
  /**
   * 终局整数重推（规则 6 引擎落点，2026-09-25 CC-6c）：强特次数实数化收尾。
   * `stage='tail'`（S3a 欠打回填之后、S4 装配之前）——与 preTail 不可合并（合并会改数值）；
   * `reset` 无条件写 false（逐位保留原语义），装配后才由引擎复位。
   */
  finalizePass: {
    stage: 'tail',
    applies: cfg => cfg.exContinuous === true,
    begin: cfg => { cfg.exFinalize = true },
    reset: cfg => { cfg.exFinalize = false },
  },
  buildExecutions: buildYidhariExecutions,
  buildResourceResult: buildYidhariResourceResult,
  resourceSections: buildYidhariResourceSections,
  combos: {
    [HEAVY_SINGLE]: {
      label: '单次碾（溯寒+极寒重碾）',
      energyCost: HEAVY_SINGLE_COST_0, // 0命；1命时栈遍历按 50 覆盖（HEAVY_SINGLE_COST_1）
      // CC-69：非轴执行计划（roundInputs）同口径 1 命 50（原在 roundInputs.ts 按 moveId 写死）
      energyCostAtCinema: { minCinema: 1, energyCost: HEAVY_SINGLE_COST_1 },
      moves: [{ moveId: '1051011', count: 1 }, { moveId: '1051012', count: 1 }],
    },
    [HEAVY_DOUBLE]: {
      label: '双次碾（溯寒+极寒重碾×2）',
      energyCost: HEAVY_DOUBLE_COST, // 50 + 35（C1 连续重碾）
      moves: [{ moveId: '1051011', count: 1 }, { moveId: '1051012', count: 2 }],
    },
  },
  settings: [{
    id: 'yidhari.hpBurnPctPerSecond',
    label: '蓄力每秒烧血比例',
    description: '霜寒拥覆蓄力平均每秒消耗的最大生命值比例，默认 15%/秒。',
    default: 0.15,
    min: 0,
    max: 1,
    step: 0.01,
    suffix: '%',
  }, {
    id: 'yidhari.exHealMissingHpPct',
    label: '强特释放时已损失生命值',
    description: '0命按25%血释放（已损75%）；1命连续释放第二次约49%血（已损51%）。',
    default: 75,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  }, {
    id: 'yidhari.exPerStun',
    label: '每次失衡极寒重碾次数',
    description: '追碾（失衡内）极寒重碾次数：0命默认2次，1命可连续释放默认3次。',
    default: 2,
    min: 1,
    max: 6,
    step: 1,
  }, {
    id: 'yidhari.tentacleInterval',
    label: '寒冰触手触发间隔',
    description: '额外能力寒冰触手（蓄力3段/极寒重碾后召唤）触发间隔，默认13.5秒（12s CD 无法完美卡轴）。',
    default: 13.5,
    min: 1,
    max: 60,
    step: 0.5,
    suffix: 's',
  }],
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 伊德海莉命座等级（buildCharConfig 写） */
    yidhariCinemaLevel?: number
    /** 伊德海莉每秒生命燃烧百分比（buildCharConfig 由机制设置 clamp 后写） */
    yidhariHpBurnPctPerSecond?: number
    /** 伊德海莉 4 命：生命值降低时喧响获得提升 10% */
    yidhariCinema4Enabled?: boolean
    /** 伊德海莉强特释放时已损失生命值比例（0-1，默认0.75） */
    yidhariExHealMissingHpPct?: number
    /** 伊德海莉每次失衡极寒重碾次数（0命2 / 1命3） */
    yidhariExPerStun?: number
    /** 伊德海莉寒冰触手触发间隔（秒，默认13.5） */
    yidhariTentacleInterval?: number
    /** 伊德海莉蓄力循环招式（buildExecutions 消费） */
    yidhariChargeSlam?: YidhariLoopMove
    yidhariBasicFollow?: YidhariLoopMove
    /** 伊德海莉每降低 1% 生命值获得的喧响（含命座修正） */
    yidhariDecibelPerHpPct?: number
    /** 伊德海莉失衡次数（外层不动点传入，供失衡内极寒重碾次数） */
    yidhariStunCount?: number
    /** 伊德海莉外部回血（%自身最大生命值）：如卢西娅星光汇聚之地等，由其他机制换算后累加 */
    yidhariExternalHealPct?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 伊德海莉烧血/回血/喧响明细 */
    yidhariHpSource?: YidhariHpSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 伊德海莉蓄力循环招式（buildCharConfig 从倍率表提取，buildExecutions 消费） */
export interface YidhariLoopMove {
  id: string
  damage: number
  daze: number
  anomaly: number
  actionTime: number
  decibel: number
  flash: number
}

/** 伊德海莉生命值烧血/回血/喧响明细 */
export interface YidhariHpSource {
  /** 能量/闪能决定的强化特殊技总次数（极寒重碾） */
  exSpecialCount: number
  /** 强化特殊技单次闪能消耗 */
  exSpecialEnergyCost: number
  /** 失衡内（追碾）极寒重碾次数 = 每次失衡次数 × 失衡次数 */
  inStunExCount: number
  /** 非失衡（溯寒后）极寒重碾次数 = 总次数 − 失衡内，每次回 15 闪能 */
  outStunExCount: number
  /** 每次失衡的极寒重碾次数（0命2 / 1命3，可调） */
  exPerStun: number
  /** 蓄力循环次数（蓄力1s→霜寒拥覆#3→碎惘沉击#4） */
  chargeCycles: number
  /** 蓄力总时长（秒，烧血时间） */
  chargedAttackSeconds: number
  /** 每秒消耗生命值百分比（近似） */
  hpBurnPctPerSecond: number
  /** 总烧血百分比 */
  hpBurnPct: number
  /** 强化特殊技回血：已损失生命值 × 33% × 次数（近似） */
  hpHealPct: number
  /** 强化特殊技释放时已损失生命值比例（0-1，默认 0.75 最优） */
  exHealMissingHpPct: number
  /** 每降低 1% 生命值获得的喧响 */
  decibelPerHpPct: number
  /** 烧血换算出的总喧响 */
  burnDecibel: number
  note: string
}
