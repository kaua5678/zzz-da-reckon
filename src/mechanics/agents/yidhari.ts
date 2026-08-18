import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, CharacterResourceResult, IterationState, YidhariHpSource, YidhariLoopMove } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { fmt } from '@/utils/format'

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

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

function rowValue(move: SkillMove | null, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
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
function chargeCycleTime(cfg: Record<string, unknown>): number {
  const slam = cfg.yidhariChargeSlam as YidhariLoopMove | undefined
  const follow = cfg.yidhariBasicFollow as YidhariLoopMove | undefined
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
  const record = cfg as unknown as Record<string, unknown>
  const missingHpPct = Math.max(0, Math.min(1, Number(record['setting:yidhari.exHealMissingHpPct'] ?? 75) / 100))
  const hpBurnPctPerSecond = Math.max(0, Math.min(100, Number(record['setting:yidhari.hpBurnPctPerSecond'] ?? 0.15)))
  const exPerStun = Math.max(1, Math.floor(Number(record['setting:yidhari.exPerStun'] ?? (cinemaLevel >= 1 ? 3 : 2))))
  const tentacleInterval = Math.max(1, Number(record['setting:yidhari.tentacleInterval'] ?? 13.5))

  record.yidhariCinema4Enabled = cinema4Enabled
  record.yidhariDecibelPerHpPct = decibelPerHpPct
  record.yidhariExHealMissingHpPct = missingHpPct
  record.yidhariHpBurnPctPerSecond = hpBurnPctPerSecond
  record.yidhariCinemaLevel = cinemaLevel

  // 蓄力循环招式（先提取，用于计算循环时长 → 烧血喧响率）
  const slam = findMoveById(skills, CHARGE_SLAM)
  const follow = findMoveById(skills, BASIC_FOLLOW)
  cfg.yidhariChargeSlam = loopMove(slam)
  cfg.yidhariBasicFollow = loopMove(follow)
  const cycleTime = CHARGE_SECONDS + (slam?.actionTime ?? 0) + (follow?.actionTime ?? 0)
  void cycleTime

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
  cfg.yidhariRefundPerOutStunEx = OUT_STUN_REFUND
}

export function computeYidhariHpSource(
  cfg: Record<string, unknown>,
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

  // 极寒重碾拆分：失衡内 = 轴连段反推（有轴 yidhariInStunExCount）或 每次失衡次数 × 失衡次数；非失衡 = 剩余（每次回 15 闪能）
  const axisInStun = Number(cfg.yidhariInStunExCount)
  const inStunExCount = Number.isFinite(axisInStun) && (cfg.yidhariInStunExCount !== undefined)
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
  const slam = cfg.yidhariChargeSlam as YidhariLoopMove | undefined
  const follow = cfg.yidhariBasicFollow as YidhariLoopMove | undefined
  const cycleTime = chargeCycleTime(cfg as unknown as Record<string, unknown>)

  // 蓄力循环：把平A时间折算成 下砸(1051007) + 平A(1051003×1.3) 两个显式招式
  const basicExec = executions.find(e => e.moveId === 'basic_attack')
  let cycles = 0
  if (basicExec && cycleTime > 0) {
    cycles = Math.floor(Math.max(0, basicExec.totalTime) / cycleTime)
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
    executions.push({
      moveId: slam.id,
      moveName: '普通攻击：霜寒拥覆 #3（蓄力下砸）',
      category: 'basic',
      count: cycles,
      actionTime: slam.actionTime,
      comboAlignRatio: 0,
      totalTime: cycles * slam.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
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
    })
  }
  if (cycles > 0 && follow && follow.actionTime > 0) {
    executions.push({
      moveId: follow.id,
      moveName: '普通攻击：碎惘沉击 #4（满蓄+30%）',
      category: 'basic',
      count: cycles,
      actionTime: follow.actionTime,
      comboAlignRatio: 0,
      totalTime: cycles * follow.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
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
    })
  }

  // 溯寒追碾 + 极寒重碾#2（追击段）：每个强特序列先打溯寒追碾（0耗能触发），再打极寒重碾
  const exCount = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  const cinemaLevel = Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).yidhariCinemaLevel ?? 0)))
  // 0命：1 溯寒追碾配 1 重碾；1命：1 溯寒追碾配 2 重碾（C1 连续释放）
  const surgeCount = Math.ceil(exCount / (cinemaLevel >= 1 ? 2 : 1))
  if (surgeCount > 0) {
    executions.push({
      moveId: SURGE_PURSUIT,
      moveName: '特殊技：溯寒追碾（重碾触发）',
      category: 'special',
      count: surgeCount,
      actionTime: 0.95,
      comboAlignRatio: 0,
      totalTime: surgeCount * 0.95,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 6.4075,
      totalDecibelRecovery: surgeCount * 6.4075,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: 168.4,
      damageMultiplierOverride: true,
      anomalyBuildUp: 95.03,
      totalAnomalyBuildUp: surgeCount * 95.03,
      skillTableNote: `溯寒追碾 ${surgeCount} 次（0耗能触发重碾；非失衡触发溯寒回15闪能）`,
    })
  }
  // 寒冰触手（额外能力·完形叙事）：需击破/支援触发，每 13.5s 一次，只有伤害（倍率随强特技能等级，吃3/5命）
  const tentacleInterval = Math.max(1, Number((cfg as unknown as Record<string, unknown>).yidhariTentacleInterval ?? 13.5))
  const tentacleCount = Math.max(0, Math.floor(((state.frontlineTime ?? 0) + (state.backstageTime ?? 0)) / tentacleInterval))
  const additionalAbilityActive = (cfg.panel?.additionalAbilityActive ?? 0) > 0
  if (tentacleCount > 0 && additionalAbilityActive) {
    const skillBonus = cfg.panel?.skillLevelBonus ?? 0
    const dmgCoef = skillBonus > 0 ? getSkillLevelCoef(skillBonus).damageCoef : 1
    executions.push({
      moveId: TENTACLE,
      moveName: '寒冰触手（额外能力）',
      category: 'special',
      count: tentacleCount,
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
      damageMultiplier: 158.4 * dmgCoef,
      damageMultiplierOverride: true,
      skillTableNote: `寒冰触手 ${tentacleCount} 次：158.4%${dmgCoef !== 1 ? `×技能等级${dmgCoef.toFixed(4)}` : ''} 只有伤害，每 ${tentacleInterval}s 触发一次（需额外能力）`,
    })
  }
}

function buildYidhariResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  const source = computeYidhariHpSource(
    record,
    state,
    Boolean(record.yidhariCinema4Enabled),
    Number(record.yidhariExHealMissingHpPct ?? 0.75),
    Number(record.yidhariHpBurnPctPerSecond ?? 0.15),
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

export const yidhariMechanic: AgentMechanicModule = {
  id: 'agent:yidhari',
  agentIds: [YIDHARI_AGENT_ID],
  name: '伊德海莉',
  description: '蓄力循环（1s烧血→霜寒拥覆#3→碎惘沉击#4）+ 极寒重碾（失衡内2/非失衡回15闪能）+ 低血增伤100%覆盖。',
  applyPanel: applyYidhariPanel,
  buildCharConfig: buildYidhariCharConfig,
  buildExecutions: buildYidhariExecutions,
  buildResourceResult: buildYidhariResourceResult,
  resourceSections: buildYidhariResourceSections,
  combos: {
    'yidhari-heavy-single': {
      label: '连段·单次（溯寒+极寒重碾）',
      energyCost: 60, // 0命；1命时栈遍历按 50 覆盖
      moves: [{ moveId: '1051011', count: 1 }, { moveId: '1051012', count: 1 }],
    },
    'yidhari-heavy-double': {
      label: '连段·双次（溯寒+极寒重碾×2）',
      energyCost: 85, // 50 + 35（C1 连续重碾）
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
