import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  MechanicTeamMember,
} from '../types'
import type { AgentSkills, SkillMove, PanelValues } from '@/types/catalog'
import type { CharacterResourceResult, MechanicSetting, NormaMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const NORMA_AGENT_ID = '1571'

// —— 预热膛温 ——
const HEAT_INITIAL = 60 // 进场立即获得
const HEAT_PER_SEC = 1.5 // 接战自动回复/秒
const HEAT_PER_EX = 16 // 嗯呢弹幕激活耗能 40 × 0.4%（能量→膛温统一模型）
const HEAT_PER_HOLD_SEC = 8 // 长按 20 能量/秒 × 0.4%
const HEAT_PER_ULTIMATE = 30 // 终结技释放时立即获得
const HEAT_PER_ENERGY = 0.4 // 消耗能量 → 膛温比例（% 每 1 点能量）
const HEAT_HAT_THRESHOLD = 80
const HEAT_HAT_COST = 80
const EX_SPECIAL_ENERGY_COST = 40 // 嗯呢弹幕激活耗能（网站 API：Energy Cost to Use:40，长按额外 20/s）
const HOLD_ENERGY_PER_SEC = 20 // 嗯呢弹幕长按额外耗能/秒

// —— 核心被动转模 ——
const CRIT_TO_CRITDMG_PER_PCT = 1.7 // Lv7
const CRIT_TO_CRITDMG_CAP = 85
const CRIT_TO_STUN_PER_PCT = 0.8 // Lv7
const CRIT_TO_STUN_CAP = 40
const PEN_TO_ATK_PER_POINT = 1.25
const PEN_TO_ATK_CAP = 1200

// —— 嗯呢弹幕 ——
const BARRAGE_DURATION_SECONDS = 32
const BARRAGE_TEAM_DMG_BONUS = 20
const TOWER_AUTO_SHOT_INTERVAL = 3 // 炮塔普通自动射击间隔（秒）
const BOOSTED_SHOT_INTERVAL = 2 // 火力实验导弹舱期间强化自动射击间隔（秒）
const MISSILE_BAY_SECONDS = 8 // 导弹舱持续（C1 12 秒）
// 基础射击（40 能量）：点射 1571007 + 弹头（未失衡破甲 1571008 / 失衡高爆 1571009）
const SHOT_MOVE = '1571007' // 射击（点射）
const ARMOR_PIERCE_SHOT_MOVE = '1571008' // 破甲弹头（未失衡）
const HIGH_EXPLOSIVE_SHOT_MOVE = '1571009' // 高爆弹头（失衡）
// 延长射击（长按 20/s）：延长点射 1571010 + 延长弹头（1571011/1571012），倍率为每秒
const EXTEND_SHOT_MOVE = '1571010'
const EXTEND_ARMOR_PIERCE_MOVE = '1571011'
const EXTEND_HIGH_EXPLOSIVE_MOVE = '1571012'
const BARRAGE_BASE_MOVES = [SHOT_MOVE, ARMOR_PIERCE_SHOT_MOVE, HIGH_EXPLOSIVE_SHOT_MOVE]
const BARRAGE_EXTEND_MOVES = [EXTEND_SHOT_MOVE, EXTEND_ARMOR_PIERCE_MOVE, EXTEND_HIGH_EXPLOSIVE_MOVE]
const BARRAGE_MOVES = [...BARRAGE_BASE_MOVES, ...BARRAGE_EXTEND_MOVES]
const TARGET_PRACTICE_MOVE = '1571013' // 炮塔自动攻击（打靶练习）
const ARMOR_PIERCE_MOVE = '1571014' // 火力实验破甲弹头（未失衡）
const HIGH_EXPLOSIVE_MOVE = '1571015' // 火力实验高爆弹头（失衡）
const CHAIN_MOVE = '1571018' // 诺姆本人连携技（帽子把戏赠送的是上一位队友的连携，见 useResourceCalc.applyNormaHatChain，本模块不 push）
const QUICK_ASSIST_MOVE = '1571020'

// —— 技术鸿沟 ——
const TECH_GAP_STUN_EASY_PER_STACK = 3
const TECH_GAP_MAX_STACKS = 10
const TECH_GAP_ATK_CAP = 870

// —— 命座 ——
const C1_MISSILE_BAY_SECONDS = 12
const C1_RES_REDUCTION = 15
const C2_STUN_EASY_PER_STACK = 6
const C2_ENERGY_PER_TRIGGER = 25 // 影画2：帽子把戏回 25 能量
const C2_TRIGGER_INTERVAL = 20 // 影画2：20 秒冷却，按战斗时间触发
const C4_CHAIN_DECIBEL_REWARD = 200
const C6_MISSILE_COUNT_PER_STUN = 8 // 6秒 / 0.75秒 ≈ 8 发
const C6_MISSILE_RATIO = 200
const C6_MISSILE_COOLDOWN = 30
// 影画6：技能专属加成（只作用于破甲/高爆弹头，对应倍率表专属行）
const C6_ARMOR_PIERCE_DAZE_BONUS = 30 // 破甲弹头失衡值 +30%
const C6_HIGH_EXPLOSIVE_DMG_BONUS = 30 // 高爆弹头伤害 +30%

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function cfgNum(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 额外能力触发条件由 spec.additionalAbility 声明式统一判定写入 panel.additionalAbilityActive；
 *  本模块只读标记开关，不硬编码条件（条件见 src/specs/agents/1571.json）。 */
function isNormaExtraAbilityActive(panel: PanelValues | undefined, team: MechanicTeamMember[], ownSlot: number, agentFaction: string): boolean {
  return (panel?.additionalAbilityActive ?? 0) > 0
    || (panel?.additionalAbilityActive === undefined && team.some(m => m.slot !== ownSlot && m.agent && (
      m.agent.specialty === 'attack' || m.agent.specialty === 'rupture' || m.agent.faction === agentFaction
    )))
}

/** 计算贯穿力（与 damage.ts 口径一致） */
function calcPenetrationPower(panel: PanelValues): number {
  return (panel.atk ?? 0) * 0.3 + (panel.hp ?? 0) * 0.1 + (panel.sheerForceFlat ?? 0)
}

interface NormaSourceInput {
  exSpecialCount: number
  ultimateCount: number
  frontlineTime: number
  cinemaLevel: number
  additionalAbilityActive: boolean
  stunCount: number
  stunCoverage: number
  battleTime: number
  holdSeconds: number
  extraAbilityAtkBonus: number
  techGapStunBonus: number
}

function computeNormaSource(input: NormaSourceInput): NormaMechanicSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel))
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const ultCount = Math.max(0, Math.floor(input.ultimateCount))
  const battleTime = Math.max(0, input.battleTime || 180)
  const holdSeconds = Math.max(0, Math.min(2, input.holdSeconds || 0))

  // 预热膛温（完整回复链，用户确认）：帽子在原地积蓄、诺姆后场不停——
  // 进入战场 +60 → 接战自动 1.5%/s（按整局战斗时间，后场同速）→ 消耗能量 × 0.4%（瞬发 40→16，长按 20/s→8/s）→ 终结技释放 +30。
  // 长按按「每次弹幕都长按 holdSeconds」计（能量侧 exSpecialEnergyConsume = 40+20×hold 已按此收费，2026-08 对齐）。
  const frontlineGain = battleTime * HEAT_PER_SEC
  const exGain = exCount * HEAT_PER_EX
  const holdGain = exCount * holdSeconds * HEAT_PER_HOLD_SEC
  const ultGain = ultCount * HEAT_PER_ULTIMATE
  const heatTotal = HEAT_INITIAL + frontlineGain + exGain + holdGain + ultGain
  // 膛温≥80%帽子把戏→连携技替换次数 = floor(膛温总量/80)
  const hatToChainCount = Math.floor(heatTotal / HEAT_HAT_THRESHOLD)

  // 嗯呢弹幕：可全局刷新多次，默认满覆盖（用户确认）；手动可调
  // 嗯呢弹幕很容易全覆盖（用户确认：去覆盖率滑块，内在逻辑满覆盖）
  const barrageCoverage = 1
  const barrageSeconds = battleTime * barrageCoverage
  // 打靶练习（炮塔普通自动射击 1571013）：基本全程都有，3 秒间隔
  const towerAutoShotCount = Math.floor(battleTime / TOWER_AUTO_SHOT_INTERVAL)

  // 火力实验导弹舱：每失衡一次给 8 秒、诺姆膛温换连携一次给 8 秒（C1 12 秒），重复触发刷新（封顶战斗时间）
  const missileBayCount = Math.max(0, Math.floor(input.stunCount)) + hatToChainCount
  const baySeconds = cinemaLevel >= 1 ? C1_MISSILE_BAY_SECONDS : MISSILE_BAY_SECONDS
  const boostedSeconds = Math.min(battleTime, missileBayCount * baySeconds)
  // 强化态自动攻击间隔 2 秒 → 额外导弹发数 = floor(强化时长 / 2)
  const boostedShotTotal = Math.floor(boostedSeconds / BOOSTED_SHOT_INTERVAL)
  // 失衡总时长 = 失衡覆盖率 × 战斗时间（= 失衡次数 × (基础12 + 连携补时4 + 诺姆技术鸿沟延时2)）
  // 火力实验强化期超出失衡总时长的部分，目标已脱离失衡 → 打失衡高的破甲弹（1571014）；失衡内打高爆弹（1571015）
  const stunSeconds = Math.min(battleTime, Math.max(0, input.stunCoverage) * battleTime)
  const highExplosiveSeconds = Math.min(boostedSeconds, stunSeconds)
  const armorPierceSeconds = Math.max(0, boostedSeconds - stunSeconds)
  const highExplosiveCount = Math.floor(highExplosiveSeconds / BOOSTED_SHOT_INTERVAL)
  const armorPierceCount = Math.floor(armorPierceSeconds / BOOSTED_SHOT_INTERVAL)

  // C6：任意角色失衡后导弹轰击 6 秒 / 0.75 秒 ≈ 8 发 × 200% 攻击火伤（视为终结技），30 秒 CD。
  // 每次失衡都触发（用户确认），30 秒冷却封顶触发次数 = floor(战斗时间/30)（默认 180s → 6 次）。
  const c6StunTriggers = Math.max(0, Math.floor(input.stunCount))
  const c6MaxBursts = Math.max(0, Math.floor(battleTime / C6_MISSILE_COOLDOWN))
  const c6BurstCount = cinemaLevel >= 6 ? Math.min(c6StunTriggers, c6MaxBursts) : 0
  const c6MissileCount = c6BurstCount * C6_MISSILE_COUNT_PER_STUN

  // 影画2·帽子把戏回能：战斗中触发帽子把戏（膛温换连携）回 25 能量，20 秒冷却；
  // 按战斗时间驱动，默认 180 秒可触发 9 次（开局不在 0 秒触发，冷却从第 1 次触发开始计）。
  const c2EnergyTriggers = cinemaLevel >= 2 ? Math.max(0, Math.floor(battleTime / C2_TRIGGER_INTERVAL)) : 0
  const c2EnergyTotal = c2EnergyTriggers * C2_ENERGY_PER_TRIGGER

  return {
    heatInitial: HEAT_INITIAL,
    heatFromFrontline: frontlineGain,
    heatFromExSpecial: exGain,
    heatFromHold: holdGain,
    heatFromUltimate: ultGain,
    heatTotal,
    c2EnergyTriggers,
    c2EnergyTotal,
    hatToChainCount,
    hatToChainCost: hatToChainCount * HEAT_HAT_COST,
    barrageSeconds,
    barrageCoverage,
    barrageTeamDmgBonus: input.additionalAbilityActive ? BARRAGE_TEAM_DMG_BONUS : 0,
    towerCount: exCount * 2,
    towerAutoShotCount,
    missileBayCount,
    boostedShotTotal,
    highExplosiveSeconds,
    armorPierceSeconds,
    armorPierceCount,
    highExplosiveCount,
    c6BurstCount,
    c6MissileCount,
    additionalAbilityActive: input.additionalAbilityActive,
    techGapStunBonus: input.additionalAbilityActive ? input.techGapStunBonus : 0,
    extraAbilityAtkBonus: input.additionalAbilityActive ? input.extraAbilityAtkBonus : 0,
    cinemaLevel,
    note:
      '膛温完整模型：进场+60，接战1.5/s、耗能×0.4%/点（瞬发40→16、长按20/s→8/s）、终结+30；≥80%帽子把戏→连携技替换，次数=floor(膛温总量/80)。' +
      '嗯呢弹幕：可刷新多次默认满覆盖；炮塔普通射击3s间隔、火力实验强化2s间隔；破甲(未失衡)/高爆(失衡)按失衡覆盖率拆。' +
      '技术鸿沟：失衡易伤+3%/层×10层、攻击+44~870、失衡时长+2s（额外能力触发时）。' +
      '影画2：帽子把戏回25能量/20s冷却（按战斗时间驱动，180s→9次）。影画6：每次失衡触发导弹轰击（30s冷却封顶），破甲弹头失衡值+30%、高爆弹头伤害+30%。',
  }
}

function applyNormaPanel({ slot, team, panel }: AgentPanelInput): void {
  // 核心被动：暴击>50% → 暴伤（每1% +1.7，cap 85）
  const critRate = panel.critRate ?? 0
  const over = Math.max(0, critRate - 50)
  if (over > 0) {
    panel.critDmg = (panel.critDmg ?? 0) + Math.min(CRIT_TO_CRITDMG_CAP, over * CRIT_TO_CRITDMG_PER_PCT)
  }
  // 核心被动：暴击>50% → 强特/特/终结失衡（每1% +0.8，cap 40）—— 定向招式失衡值
  if (over > 0) {
    const stunBonus = Math.min(CRIT_TO_STUN_CAP, over * CRIT_TO_STUN_PER_PCT)
    panel.stunBuildUpBonus__exSpecial = (panel.stunBuildUpBonus__exSpecial ?? 0) + stunBonus
    panel.stunBuildUpBonus__special = (panel.stunBuildUpBonus__special ?? 0) + stunBonus
    panel.stunBuildUpBonus__ultimate = (panel.stunBuildUpBonus__ultimate ?? 0) + stunBonus
  }
  // 核心被动：贯穿力→攻击（1.25/点，cap 1200）
  const penPower = calcPenetrationPower(panel)
  if (penPower > 0) {
    panel.atk = (panel.atk ?? 0) + Math.min(PEN_TO_ATK_CAP, penPower * PEN_TO_ATK_PER_POINT)
  }
  // 额外能力·集群优势：持[技术鸿沟]敌人失衡持续时间 +2 秒（命中即叠全程生效，用户确认）。
  // 放 applyPanel（而非 buildCharConfig）：computeWindowDuration 读展示面板（computePanelPhases），
  // buildCharConfig 的修改不进入该面板 → 原来 +2s 从未生效。
  // 技术鸿沟失衡易伤/攻击提升由 teammate-buffs.json 与 buildCharConfig 承载（覆盖率滑块在队友 buff 侧）。
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.stunDurationBonusSeconds = (panel.stunDurationBonusSeconds ?? 0) + 2
  }
}

function buildNormaCharConfig({ slot, cinemaLevel, team, skills, cfg, panel }: AgentCharConfigInput): void {
  // 自身阵营取自队伍快照
  const selfAgent = team[slot]?.agent
  const agentFaction = selfAgent?.faction ?? ''
  cfg.normaCinemaLevel = cinemaLevel
  // 额外能力触发条件：优先读声明式判定（panel.additionalAbilityActive，spec.additionalAbility 判定写入），兜底硬编码。
  cfg.normaAdditionalAbilityActive = isNormaExtraAbilityActive(panel, team, slot, agentFaction)
  cfg.skipGenericExSpecial = true // 嗯呢弹幕由本模块生成 6 段
  cfg.exSpecialCountFloor = true // 嗯呢弹幕是真实次数（6 段 × 次数），必须取整
  // 嗯呢弹幕耗能（用户确认）：40 激活 + 长按 20/s（默认 2s）→ 每次 80 能量；
  // 资源池按此驱动强特次数（长按能量此前漏算 → 次数被高估，2026-08 修复）
  const holdSeconds = Math.max(0, Math.min(2, cfgNum(cfg, 'norma.holdSeconds', 2)))
  cfg.exSpecialEnergyConsume = EX_SPECIAL_ENERGY_COST + HOLD_ENERGY_PER_SEC * holdSeconds
  // 预存嗯呢弹幕 6 段 actionTime，供 buildExecutions 使用（不依赖运行期查倍率表）
  cfg.normaBarrageActionTimes = BARRAGE_MOVES.map(id => findMoveById(skills, id)?.actionTime ?? 0.5)
  // 预存 6 段 damage/daze 表值 + 火力实验导弹 2 段表值：影画6 技能专属加成按倍率表对应行缩放（破甲失衡+30%/高爆伤害+30%）
  const row = (id: string) => findMoveById(skills, id)
  const get = (move: SkillMove | null | undefined, rowId: string) => {
    if (!move) return 0
    const r = move.rows.find(r => r.id === rowId)
    return r?.values[0] ?? 0
  }
  cfg.normaBarrageRowValues = {
    damage: BARRAGE_MOVES.map(id => get(row(id), 'damage')),
    daze: BARRAGE_MOVES.map(id => get(row(id), 'daze')),
  }
  cfg.normaMissileRowValues = {
    damage: [get(row(ARMOR_PIERCE_MOVE), 'damage'), get(row(HIGH_EXPLOSIVE_MOVE), 'damage')],
    daze: [get(row(ARMOR_PIERCE_MOVE), 'daze'), get(row(HIGH_EXPLOSIVE_MOVE), 'daze')],
  }

  // C1：弹头命中敌人全属性抗性 -15%（15 秒，重复刷新）；视为全局减抗，默认满覆盖。
  if (cinemaLevel >= 1) {
    panel.enemyResReduction = (panel.enemyResReduction ?? 0) + C1_RES_REDUCTION
  }
  // C2：帽子把戏回 25 能量/20s 冷却 —— 由资源池按战斗时间触发（见 core/resource/helpers.ts calcEnergySource）
  cfg.normaC2EnergyPerTrigger = cinemaLevel >= 2 ? C2_ENERGY_PER_TRIGGER : 0
  cfg.normaC2TriggerInterval = C2_TRIGGER_INTERVAL
  // C4：膛温换连携时诺姆与对应代理人回 200 喧响 —— 需喧响池注入，暂未接入（待核对）。


  // 额外能力·集群优势（额外能力触发时）：
  // - 技术鸿沟失衡易伤（+3%/层×10层，C2 6%/层）：命中就叠，全程生效。
  //   数值由 teammate-buffs.json 承载（additional_technical_gap 30 + cinema_2 额外 30），模块不再重复累加面板。
  // - 攻击提升（44~870）：**嗯呢弹幕期间**生效，按弹幕覆盖率折算。
  // - 失衡持续时间+2 秒：持鸿沟敌人失衡后生效（applyPanel 处理，见上）。
  const aa = cfg.normaAdditionalAbilityActive
  if (aa) {
    const perStack = cinemaLevel >= 2 ? C2_STUN_EASY_PER_STACK : TECH_GAP_STUN_EASY_PER_STACK
    cfg.normaTechGapStunBonus = perStack * TECH_GAP_MAX_STACKS // 仅展示（teammate-buff 承载失衡易伤数值）
    cfg.normaExtraAbilityAtkBonus = TECH_GAP_ATK_CAP // 满覆盖（用户确认去滑块）
    // 攻击提升（44~870，弹幕期间按覆盖率折算）已由 computePanelPhases 硬编码块写入展示/计算面板
    // （能读 configStore 的弹幕覆盖率滑块，与 cfg.panel 一致），此处不再重复累加。
  } else {
    cfg.normaTechGapStunBonus = 0
    cfg.normaExtraAbilityAtkBonus = 0
  }
}

function buildNormaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = computeNormaSource({
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    frontlineTime: state.frontlineTime,
    cinemaLevel: cfg.normaCinemaLevel ?? 0,
    additionalAbilityActive: cfg.normaAdditionalAbilityActive ?? false,
    stunCount: cfg.normaStunCount ?? 0,
    stunCoverage: cfg.normaStunCoverage ?? 0,
    battleTime: cfg.normaBattleTime ?? 180,
    holdSeconds: cfgNum(cfg, 'norma.holdSeconds', 2),
    extraAbilityAtkBonus: cfg.normaExtraAbilityAtkBonus ?? 0,
    techGapStunBonus: cfg.normaTechGapStunBonus ?? 0,
  })

  // 嗯呢弹幕（基础 40 能量）：点射 1571007 + 弹头（未失衡破甲 1571008 / 失衡高爆 1571009），每次强特一轮。
  // 长按（20/s，最多 2 秒，norma.holdSeconds 可调）：延长射击 1571010 + 延长弹头（1571011/1571012），倍率为每秒。
  // 弹头破甲/高爆按用户"打进失衡期的占比"拆（默认 0 = 全部非失衡破甲，失衡期留给主C）。
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  const times = cfg.normaBarrageActionTimes ?? BARRAGE_MOVES.map(() => 0.5)
  const stunShare = Math.max(0, Math.min(1, cfgNum(cfg, 'norma.barrageStunShare', 0)))
  const holdSeconds = Math.max(0, Math.min(2, cfgNum(cfg, 'norma.holdSeconds', 2)))
  // 影画6：破甲弹头失衡值+30%（1571008/1571011/1571014）、高爆弹头伤害+30%（1571009/1571012/1571015），
  // 技能专属效果：只作用于对应倍率行，按表值缩放（damageMultiplierOverride/dazeMultiplierOverride）。
  const cinema = cfg.normaCinemaLevel ?? 0
  const c6DazeMult = cinema >= 6 ? 1 + C6_ARMOR_PIERCE_DAZE_BONUS / 100 : 1
  const c6DmgMult = cinema >= 6 ? 1 + C6_HIGH_EXPLOSIVE_DMG_BONUS / 100 : 1
  const barrageRows = cfg.normaBarrageRowValues ?? { damage: [], daze: [] }
  const pushBarrage = (moveId: string, name: string, count: number, idx: number, note: string) => {
    if (count <= 0) return
    const at = times[idx] ?? 0.5
    const isAP = moveId === ARMOR_PIERCE_SHOT_MOVE || moveId === EXTEND_ARMOR_PIERCE_MOVE
    const isHE = moveId === HIGH_EXPLOSIVE_SHOT_MOVE || moveId === EXTEND_HIGH_EXPLOSIVE_MOVE
    const baseDmg = barrageRows.damage[idx] ?? 0
    const baseDaze = barrageRows.daze[idx] ?? 0
    const useDmgMult = isHE && baseDmg > 0
    const useDazeMult = isAP && baseDaze > 0
    executions.push({
      moveId,
      moveName: name,
      category: 'special',
      count,
      actionTime: at,
      comboAlignRatio: 0,
      totalTime: count * at,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: useDmgMult ? baseDmg * c6DmgMult : undefined,
      damageMultiplierOverride: useDmgMult,
      dazeMultiplier: useDazeMult ? baseDaze * c6DazeMult : undefined,
      dazeMultiplierOverride: useDazeMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `${note}${useDmgMult ? ' · 影画6：高爆弹头伤害+30%' : ''}${useDazeMult ? ' · 影画6：破甲弹头失衡值+30%' : ''}`,
    })
  }
  if (exCount > 0) {
    // 基础：点射 + 破甲/高爆弹头（按用户失衡占比拆）
    pushBarrage(SHOT_MOVE, '嗯呢弹幕·射击', exCount, 0, '基础 40 能量：点射 411.1%')
    pushBarrage(ARMOR_PIERCE_SHOT_MOVE, '嗯呢弹幕·破甲弹头', Math.round(exCount * (1 - stunShare)), 1, `未失衡目标：破甲弹头 616%（占比 ${Math.round((1 - stunShare) * 100)}%）`)
    pushBarrage(HIGH_EXPLOSIVE_SHOT_MOVE, '嗯呢弹幕·高爆弹头', Math.round(exCount * stunShare), 2, `失衡目标：高爆弹头 683.5%（占比 ${Math.round(stunShare * 100)}%）`)
    // 长按：延长射击每秒（1571010）+ 延长破甲/高爆每秒（1571011/1571012）。
    // 每次弹幕都长按 holdSeconds（能量已按 40+20×hold/次 收费），延长总秒数 = 次数 × holdSeconds。
    const holdInt = Math.max(0, Math.floor(holdSeconds))
    if (holdInt > 0) {
      const holdSecs = holdInt * exCount
      pushBarrage(EXTEND_SHOT_MOVE, '嗯呢弹幕·延长射击', holdSecs, 3, `每次长按 ${holdInt}s × ${exCount} 次：延长点射 261.5%/s`)
      pushBarrage(EXTEND_ARMOR_PIERCE_MOVE, '嗯呢弹幕·延长破甲', Math.max(0, Math.round(holdSecs * (1 - stunShare))), 4, `长按延长：破甲 392.8%/s（占比 ${Math.round((1 - stunShare) * 100)}%）`)
      pushBarrage(EXTEND_HIGH_EXPLOSIVE_MOVE, '嗯呢弹幕·延长高爆', Math.max(0, Math.round(holdSecs * stunShare)), 5, `长按延长：高爆 433.4%/s（占比 ${Math.round(stunShare * 100)}%）`)
    }
  }

  // 膛温≥80%帽子把戏→连携技：帽子把戏触发上一位角色的快速支援→替换为连携技，
  // 所以该连携归属上一位队友（由 useResourceCalc 注入给目标队友连携次数 + C4 喧响），诺姆本模块不 push。
  // source.hatToChainCount 由 buildResourceResult/resourceSections 展示。

  // 炮塔普通自动射击：弹幕覆盖秒数 / 3s 间隔（打靶练习 1571013）
  if (source.towerAutoShotCount > 0) {
    executions.push({
      moveId: TARGET_PRACTICE_MOVE,
      moveName: '特殊技：打靶练习（炮塔自动射击）',
      category: 'special',
      count: source.towerAutoShotCount,
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
      skillDamageTarget: 'special',
      skillTableNote: '嗯呢弹幕期间炮塔自动射击，3 秒间隔',
    })
  }

  // 火力实验导弹舱：强化期超出失衡总时长的部分打破甲弹（1571014，未失衡），失衡内打高爆弹（1571015，失衡）。
  // 失衡总时长 = 失衡覆盖率 × 战斗时间（= 失衡次数 × (基础12 + 连携补时4 + 技术鸿沟延时2)），强化时长超出即目标已脱离失衡。
  // 影画6：破甲弹头失衡值+30%（1571014）、高爆弹头伤害+30%（1571015），技能专属按倍率表对应行缩放。
  const missileRows = cfg.normaMissileRowValues ?? { damage: [], daze: [] }
  if (source.armorPierceCount > 0) {
    const baseDaze = missileRows.daze[0] ?? 0
    const useDazeMult = cinema >= 6 && baseDaze > 0
    executions.push({
      moveId: ARMOR_PIERCE_MOVE,
      moveName: '强化特殊技：火力实验·破甲弹头',
      category: 'special',
      count: source.armorPierceCount,
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
      dazeMultiplier: useDazeMult ? baseDaze * c6DazeMult : undefined,
      dazeMultiplierOverride: useDazeMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `火力实验强化期超出失衡总时长部分（${fmt(source.armorPierceSeconds ?? 0)}s）：未失衡目标发射破甲弹头，累积较多失衡值${useDazeMult ? ' · 影画6：破甲弹头失衡值+30%' : ''}`,
    })
  }
  if (source.highExplosiveCount > 0) {
    const baseDmg = missileRows.damage[1] ?? 0
    const useDmgMult = cinema >= 6 && baseDmg > 0
    executions.push({
      moveId: HIGH_EXPLOSIVE_MOVE,
      moveName: '强化特殊技：火力实验·高爆弹头',
      category: 'special',
      count: source.highExplosiveCount,
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
      damageMultiplier: useDmgMult ? baseDmg * c6DmgMult : undefined,
      damageMultiplierOverride: useDmgMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `火力实验失衡期内（${fmt(source.highExplosiveSeconds ?? 0)}s）：失衡目标发射高爆弹头，更高伤害${useDmgMult ? ' · 影画6：高爆弹头伤害+30%' : ''}`,
    })
  }

  // C6：任意角色失衡后导弹轰击 6 秒（0.75s/发 ≈ 8 发）× 200% 攻击火伤（视为终结技），30 秒 CD
  if (source.c6MissileCount > 0) {
    executions.push({
      moveId: 'norma_c6_missile',
      moveName: '影画6·天才第一因（导弹轰击）',
      category: 'chain',
      count: source.c6MissileCount,
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
      damageMultiplier: C6_MISSILE_RATIO,
      damageMultiplierOverride: true,
      element: 'fire',
      skillDamageTarget: 'ultimate',
      skillTableNote: `C6 导弹轰击：失衡后 6s/0.75s≈8 发 × 200% 攻击火伤（视为终结技），触发 ${source.c6BurstCount} 次`,
    })
  }
}

function buildNormaResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const source = computeNormaSource({
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    frontlineTime: state.frontlineTime,
    cinemaLevel: cfg.normaCinemaLevel ?? 0,
    additionalAbilityActive: cfg.normaAdditionalAbilityActive ?? false,
    stunCount: cfg.normaStunCount ?? 0,
    stunCoverage: cfg.normaStunCoverage ?? 0,
    battleTime: cfg.normaBattleTime ?? 180,
    holdSeconds: cfgNum(cfg, 'norma.holdSeconds', 2),
    extraAbilityAtkBonus: cfg.normaExtraAbilityAtkBonus ?? 0,
    techGapStunBonus: cfg.normaTechGapStunBonus ?? 0,
  })
  // C4 喧响（200 × 膛温换连携次数 × 诺姆+队友 2 人）：回写 hatCount 供资源池 calcDecibelSource
  // 下一轮迭代注入 extraUnshareableDecibel —— 喧响真实计入终结技次数（此前仅展示层注入，不影响终结技）
  if ((cfg.normaCinemaLevel ?? 0) >= 4) {
    cfg.normaHatToChainCount = source.hatToChainCount
  } else {
    cfg.normaHatToChainCount = 0
  }
  return { normaMechanicSource: source }
}

function buildNormaResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.normaMechanicSource
  if (!source) return []
  return [
    {
      id: 'norma-heat',
      title: '诺姆·预热膛温',
      summary: `膛温总量 ${fmt(source.heatTotal)}（进场 ${fmt(source.heatInitial)} + 接战 ${fmt(source.heatFromFrontline)} + 弹幕 ${fmt(source.heatFromExSpecial)} + 长按 ${fmt(source.heatFromHold)} + 终结 ${fmt(source.heatFromUltimate)}）`,
      rows: [
        { label: '进入战场', value: `+${fmt(HEAT_INITIAL)}` },
        { label: '接战每秒', value: `+${fmt(HEAT_PER_SEC)}` },
        { label: '嗯呢弹幕', value: `+${fmt(HEAT_PER_EX)}/次`, detail: `耗能 40 × ${fmt(HEAT_PER_ENERGY)}%` },
        { label: '长按延长', value: `+${fmt(HEAT_PER_HOLD_SEC)}/s`, detail: `耗能 20/s × ${fmt(HEAT_PER_ENERGY)}%（默认长按 2s）` },
        { label: '终结技', value: `+${fmt(HEAT_PER_ULTIMATE)}/次` },
        { label: '帽子→连携', value: `-${fmt(HEAT_HAT_COST)}/次 × ${fmt(source.hatToChainCount)} 次`, detail: '膛温≥80%帽子把戏替换为连携技' },
      ],
      footer: '膛温完整模型：耗能×0.4%（瞬发40→16、长按20/s→8/s），叠加进场60+自动1.5/s+终结30；帽子把戏→连携技替换次数=floor(膛温总量/80)。',
    },
    {
      id: 'norma-barrage',
      title: '诺姆·嗯呢弹幕',
      summary: `弹幕全程覆盖（用户确认去滑块）· 炮塔 ${fmt(source.towerCount)} 座`,
      rows: [
        { label: '基础射击', value: '40 能量', detail: '点射 1571007(411%) + 破甲 1571008(616%，非失衡) / 高爆 1571009(683.5%，失衡)' },
        { label: '长按延长', value: '20/s', detail: '延长点射 1571010(261.5%/s) + 延长破甲 1571011(392.8%/s) / 延长高爆 1571012(433.4%/s)，可调 0-2s' },
        { label: '失衡期占比', value: '默认全非失衡', detail: '失衡期留给主C；可调 norma.barrageStunShare 打进失衡的比例' },
        { label: '全队增伤', value: `+${fmt(source.barrageTeamDmgBonus)}%`, detail: '弹幕期间+20%（额外能力触发时，全程覆盖）' },
        { label: '炮塔自动射击', value: `${fmt(source.towerAutoShotCount)} 次`, detail: '打靶练习 1571013，全程 3s 间隔' },
        { label: '火力实验强化', value: `${fmt(source.boostedShotTotal)} 发`, detail: `失衡+膛温换连携 ${fmt(source.missileBayCount)} 次 × 8s(C1 12s)；失衡内 ${fmt(source.highExplosiveSeconds)}s 打高爆、超出 ${fmt(source.armorPierceSeconds)}s 打破甲` },
        { label: '技术鸿沟失衡易伤', value: `+${fmt(source.techGapStunBonus)}%`, detail: '额外能力触发时' },
        { label: '影画2·帽子把戏回能', value: `+${fmt(source.c2EnergyTotal)} 能量`, detail: `25/次 × ${fmt(source.c2EnergyTriggers)} 次（20s 冷却，按战斗时间驱动）` },
      ],
      footer: '嗯呢弹幕基础 40 能量/次，长按 20/s 额外延长射击；默认全非失衡（破甲），失衡占比与覆盖率可在资源利用率页调整。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'norma.barrageStunShare',
    label: '诺姆·嗯呢弹幕失衡期占比',
    description: '嗯呢弹幕打进失衡期的比例（失衡期目标打高爆弹 683.5% 更高，但失衡期通常留给主C）；默认 0% 全部非失衡（破甲弹）。',
    default: 0,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'norma.holdSeconds',
    label: '诺姆·嗯呢弹幕长按秒数',
    description: '长按延长射击秒数（20 能量/秒，最多 2 秒）；默认拉满 2 秒，0 表示不延长。',
    default: 2,
    min: 0,
    max: 2,
    step: 0.5,
    suffix: '秒',
  },
]

/**
 * 诺姆膛温换连携次数（供资源池 iterate 直接调用，避免 buildResourceResult 时序问题）：
 * 膛温 = 进场 60 + 接战 battleTime×1.5（帽子原地积蓄，后场不停）+ 弹幕 exCount×16 + 终结 ult×30 + 长按 hold×8；
 * hatCount = floor(膛温/80)。C4 喧响 = hatCount × 200 × 2 由调用方按命座折算。
 */
export function computeNormaHatToChainCount(
  cfg: { normaCinemaLevel?: number; normaBattleTime?: number },
  prev: { exSpecialCount: number; ultimateCount: number; frontlineTime: number; battleTime?: number },
  holdSeconds = 2,
): number {
  // battleTime 缺省兜底：旧调用无 battleTime 时按整局 180s 计（帽子整局积蓄口径）
  const battleTime = Math.max(0, prev.battleTime ?? 180)
  const heatTotal = HEAT_INITIAL
    + battleTime * HEAT_PER_SEC
    + Math.max(0, Math.floor(prev.exSpecialCount)) * HEAT_PER_EX
    + Math.max(0, Math.floor(prev.ultimateCount)) * HEAT_PER_ULTIMATE
    + Math.max(0, Math.min(2, holdSeconds)) * HEAT_PER_HOLD_SEC
  return Math.floor(heatTotal / HEAT_HAT_THRESHOLD)
}

export const normaMechanic: AgentMechanicModule = {
  id: 'agent:norma',
  agentIds: [NORMA_AGENT_ID],
  name: '诺姆',
  description: '预热膛温资源、嗯呢弹幕（6段+炮塔+全队增伤）、膛温帽子把戏→连携替换、火力实验导弹、技术鸿沟失衡易伤。',
  applyPanel: applyNormaPanel,
  buildCharConfig: buildNormaCharConfig,
  estimateExSpecialTime({ cfg, exSpecialCount }) {
    // 嗯呢弹幕真实前台时间（修复：通用公式只用 #1 单段 0.493s → 严重低估）：
    // 一次强特 = 点射 #1(0.493) + 弹头 #2/#3(0.74) + 长按延长（#4 0.4 + 延长弹头 0.6）/s
    const times = cfg.normaBarrageActionTimes ?? [0.493, 0.74, 0.74, 0.4, 0.6, 0.6]
    const holdSeconds = Math.max(0, Math.min(2, cfgNum(cfg, 'norma.holdSeconds', 2)))
    const baseTime = (times[0] ?? 0.493) + Math.max(times[1] ?? 0, times[2] ?? 0)
    const holdTime = (times[3] ?? 0.4) + Math.max(times[4] ?? 0, times[5] ?? 0)
    const necessaryTime = Math.max(0, Math.floor(exSpecialCount)) * baseTime + holdSeconds * holdTime
    return { necessaryTime, comboAlignTime: 0 }
  },
  buildExecutions: buildNormaExecutions,
  buildResourceResult: buildNormaResourceResult,
  resourceSections: buildNormaResourceSections,
  settings,
}
