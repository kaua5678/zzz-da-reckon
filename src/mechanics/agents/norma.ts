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
import type { CharacterResourceResult, MechanicSetting} from '@/types/resource'
import { fmt } from '@/utils/format'
import { calcPenetrationPower } from '@/data/penetrationPower'
import { getAgentSpec } from '@/specs/registry'
import { specConversionAmount } from '@/specs/runtime'
import type { AttributeConversionSpec } from '@/specs/types'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import { finiteOr0 } from '@/utils/finiteClamp'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { initialStat } from '@/mechanics/initialStat'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const cfgNum = mechanicSettingReader(() => settings)
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
// CC-212（第 235 轮）：阈值 / 每步值 / 上限 / 步数口径只在 spec `1571.json` attributeConversions 一处，
// 模块只负责来源（局外暴击、贯穿力）与落点（定向失衡）——这两样 spec runtime 表达不了（r6 §2.2）。
// 此前模块另写一份常数且按连续计算，CC-134 的「每超过 N 一律 floor」裁决因 spec 条目不执行而从未落到 1571。
function normaConversion(id: string): AttributeConversionSpec {
  const conv = getAgentSpec(NORMA_AGENT_ID)?.attributeConversions.find(c => c.id === id)
  if (!conv) throw new Error(`[norma] spec 1571 缺少 attributeConversions.${id}`)
  return conv
}

// —— 嗯呢弹幕 ——
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

// —— 技术鸿沟 ——
const TECH_GAP_STUN_EASY_PER_STACK = 3
const TECH_GAP_MAX_STACKS = 10
const TECH_GAP_ATK_CAP = 870

// —— 命座 ——
const C1_MISSILE_BAY_SECONDS = 12
const C2_STUN_EASY_PER_STACK = 6
const C2_ENERGY_PER_TRIGGER = 25 // 影画2：帽子把戏回 25 能量
const C2_TRIGGER_INTERVAL = 20 // 影画2：20 秒冷却，按战斗时间触发
const C6_MISSILE_COUNT_PER_STUN = 8 // 6秒 / 0.75秒 ≈ 8 发
const C6_MISSILE_RATIO = 200
const C6_MISSILE_COOLDOWN = 30
// 影画6：技能专属加成（只作用于破甲/高爆弹头，对应倍率表专属行）
const C6_ARMOR_PIERCE_DAZE_BONUS = 30 // 破甲弹头失衡值 +30%
const C6_HIGH_EXPLOSIVE_DMG_BONUS = 30 // 高爆弹头伤害 +30%


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
  extraAbilityAtkBonus?: number
  techGapStunBonus?: number
}

function computeNormaSource(input: NormaSourceInput): NormaMechanicSource {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const ultCount = Math.max(0, Math.floor(input.ultimateCount))
  const battleTime = input.battleTime
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

  // 嗯呢弹幕很容易全覆盖（用户确认：去覆盖率滑块，内在逻辑满覆盖；CC-192 删恒 1 的覆盖率/覆盖秒数只写字段）
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
    techGapStunBonus: input.additionalAbilityActive ? (input.techGapStunBonus ?? 0) : 0,
    extraAbilityAtkBonus: input.additionalAbilityActive ? (input.extraAbilityAtkBonus ?? 0) : 0,
    cinemaLevel,
    note:
      '膛温完整模型：进场+60，接战1.5/s、耗能×0.4%/点（瞬发40→16、长按20/s→8/s）、终结+30；≥80%帽子把戏→连携技替换，次数=floor(膛温总量/80)。' +
      '嗯呢弹幕：可刷新多次默认满覆盖；炮塔普通射击3s间隔、火力实验强化2s间隔；破甲(未失衡)/高爆(失衡)按失衡覆盖率拆。' +
      '技术鸿沟：失衡易伤+3%/层×10层、攻击+44~870、失衡时长+2s（额外能力触发时）。' +
      '影画2：帽子把戏回25能量/20s冷却（按战斗时间驱动，180s→9次）。影画6：每次失衡触发导弹轰击（30s冷却封顶），破甲弹头失衡值+30%、高爆弹头伤害+30%。',
  }
}

function applyNormaPanel({ slot: _slot, team: _team, agent, panel, outOfCombatPanel }: AgentPanelInput): void {
  // 核心被动：初始暴击>50% → 暴伤（每1% +1.7，cap 85）
  // 原文「初始暴击率超过50%」⇒ 初始 = 局外面板（CC-128；读取口 `initialStat`，CC-497）
  const critRate = initialStat(outOfCombatPanel, panel, 'critRate')
  const critDmgBonus = specConversionAmount(normaConversion('norma_crit_to_critdmg'), critRate)
  if (critDmgBonus > 0) {
    panel.critDmg = panel.critDmg + critDmgBonus
  }
  // 核心被动：暴击>50% → 强特/特/终结失衡（每1% +0.8，cap 40）—— 定向招式失衡值
  const stunBonus = specConversionAmount(normaConversion('norma_crit_to_stun'), critRate)
  if (stunBonus > 0) {
    panel.stunBuildUpBonus__exSpecial = (panel.stunBuildUpBonus__exSpecial ?? 0) + stunBonus
    panel.stunBuildUpBonus__special = (panel.stunBuildUpBonus__special ?? 0) + stunBonus
    panel.stunBuildUpBonus__ultimate = (panel.stunBuildUpBonus__ultimate ?? 0) + stunBonus
  }
  // 核心被动：贯穿力→攻击（1.25/点，cap 1200）
  const atkBonus = specConversionAmount(normaConversion('norma_pen_to_atk'), calcPenetrationPower(panel))
  if (atkBonus > 0) {
    panel.atk = panel.atk + atkBonus
  }
  // 额外能力·集群优势：持[技术鸿沟]敌人失衡持续时间 +2 秒（命中即叠全程生效，用户确认）。
  // 放 applyPanel（而非 buildCharConfig）：computeWindowDuration 读展示面板（computePanelPhases），
  // buildCharConfig 的修改不进入该面板 → 原来 +2s 从未生效。
  // 技术鸿沟失衡易伤/攻击提升由 teammate-buffs.json 与 buildCharConfig 承载（覆盖率滑块在队友 buff 侧）。
  if (additionalAbilityActiveOf(panel)) {
    panel.stunDurationBonusSeconds = panel.stunDurationBonusSeconds + 2
  }

  // 额外能力·集群优势：嗯呢弹幕期间攻击 +44~870（Lv7 满级 870）。
  // 规则 6 迁入（2026-09-17 round 20 R20-h1 批次 1 / A12）：原住在 `helpers.ts#computePanelPhases`
  // 的 `if (agent.id === '1571' || …)` 块；同槽自身面板 ⇒ 不触 P2 跨槽陷阱。
  // `buildCharConfig` 也把该值写进 `cfg.panel`（计算用），此处补进最终展示面板，
  // 保证「最终面板包含一切实际计算」——迁入后**顺序不变**（仍在 additionalAbilityActive 门控下无条件 +870）。
  //
  // CC-276：原 `|| agent.teammateBuffId === '1571'` 数据面守卫臂已删（别名字段退役，
  // 「别名 ≠ id」由 `agentIdentitySingleField.test` 在数据入口一处拦）。
  if (agent.id === '1571') {
    if (additionalAbilityActiveOf(panel)) {
      // 满覆盖（用户确认去弹幕覆盖率滑块，嗯呢弹幕易全程覆盖）
      panel.atk = panel.atk + TECH_GAP_ATK_CAP
    }
  }
}

function buildNormaCharConfig({ cinemaLevel, panel, skills, cfg }: AgentCharConfigInput): void {
  cfg.normaCinemaLevel = cinemaLevel
  cfg.skipGenericExSpecial = true // 嗯呢弹幕由本模块生成 6 段
  // 嗯呢弹幕耗能（用户确认）：40 激活 + 长按 20/s（默认 2s）→ 每次 80 能量；
  // 资源池按此驱动强特次数（长按能量此前漏算 → 次数被高估，2026-08 修复）
  const holdSeconds = resolveNormaHoldSeconds(cfg)
  cfg.exSpecialEnergyConsume = EX_SPECIAL_ENERGY_COST + HOLD_ENERGY_PER_SEC * holdSeconds
  // 预存嗯呢弹幕 6 段 actionTime，供 buildExecutions 使用（不依赖运行期查倍率表）
  cfg.normaBarrageActionTimes = BARRAGE_MOVES.map(id => findMoveById(skills, id)?.actionTime ?? 0.5)
  // 预存 6 段 damage/daze 表值 + 火力实验导弹 2 段表值：影画6 技能专属加成按倍率表对应行缩放（破甲失衡+30%/高爆伤害+30%）
  const row = (id: string) => findMoveById(skills, id)
  // CC-242：取行值走 data getRowValue（吃逻辑编辑器行规则，作用面 §24.85 ④ / §24.88）
  const get = (move: SkillMove | null | undefined, rowId: string) => getRowValue(move, rowId)
  cfg.normaBarrageRowValues = {
    damage: BARRAGE_MOVES.map(id => get(row(id), 'damage')),
    daze: BARRAGE_MOVES.map(id => get(row(id), 'daze')),
  }
  cfg.normaMissileRowValues = {
    damage: [get(row(ARMOR_PIERCE_MOVE), 'damage'), get(row(HIGH_EXPLOSIVE_MOVE), 'damage')],
    daze: [get(row(ARMOR_PIERCE_MOVE), 'daze'), get(row(HIGH_EXPLOSIVE_MOVE), 'daze')],
  }

  // C1：弹头命中敌人全属性抗性 -15% —— 单一来源 = teammate-buffs.json
  // `norma_hollowell.cinema_1_aggressive_foresight`（进伤害面板）。此处原有一行写 cfg.panel 的
  // 同值减抗：cfg.panel 只供资源侧读取，从未进入伤害，属死写且一旦有人让 cfg.panel 参与伤害就会双计（2026-09-24 删）。
  // C2：帽子把戏回 25 能量/20s 冷却 —— 由资源池按战斗时间触发（见 core/resource/helpers.ts calcEnergySource）
  cfg.normaC2EnergyPerTrigger = cinemaLevel >= 2 ? C2_ENERGY_PER_TRIGGER : 0
  cfg.normaC2TriggerInterval = C2_TRIGGER_INTERVAL
  // C4：膛温换连携时诺姆与对应代理人回 200 喧响 —— 已接入：chainGift 声明的 decibelPerUnit（见模块底部）。


  // 额外能力·集群优势（额外能力触发时）：
  // - 技术鸿沟失衡易伤（+3%/层×10层，C2 6%/层）：命中就叠，全程生效。
  //   数值由 teammate-buffs.json 承载（additional_technical_gap 30 + cinema_2 额外 30），模块不再重复累加面板。
  // - 攻击提升（44~870）：**嗯呢弹幕期间**生效，按弹幕覆盖率折算。
  // - 失衡持续时间+2 秒：持鸿沟敌人失衡后生效（applyPanel 处理，见上）。
  if (additionalAbilityActiveOf(panel)) {
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

/**
 * `norma.holdSeconds` 滑块的**唯一口径**（CC-438，2026-10-04）：钳到 [0, 2]（20 能量/秒，最多 2 秒）。
 * 此前 5 个读者各读各的（能量 / 膛温 / 伤害行 / 赠链 / 前台时间），其中 3 处自带钳位、2 处靠 `computeNormaSource`
 * 内部再钳。现在所有读者都经本函数拿同一个值（钳位只写一次）。注意 `estimateExSpecialTime` 里长按仍是整局一次，
 * 原因见该处注释（量过：改成按次会扰动外层折叠环，不单改）。
 */
export function resolveNormaHoldSeconds(cfg: unknown): number {
  return Math.max(0, Math.min(2, cfgNum(cfg, 'norma.holdSeconds')))
}

/**
 * cfg + 迭代状态 → 诺姆机制源（CC-279：执行行与资源结果原先各抄一份入参装配，新增入参只改一处会让
 * 伤害行与展示结果静默分叉；收成唯一装配点）。
 */
function normaSourceOf(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): NormaMechanicSource {
  return computeNormaSource({
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    frontlineTime: state.frontlineTime,
    cinemaLevel: cinemaLevelOf(cfg.normaCinemaLevel),
    additionalAbilityActive: additionalAbilityActiveOf(cfg.panel),
    stunCount: cfg.normaStunCount ?? 0,
    stunCoverage: cfg.normaStunCoverage ?? 0,
    battleTime: cfg.battleTime,
    holdSeconds: resolveNormaHoldSeconds(cfg),
    extraAbilityAtkBonus: cfg.normaExtraAbilityAtkBonus ?? 0,
    techGapStunBonus: cfg.normaTechGapStunBonus ?? 0,
  })
}

function buildNormaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = normaSourceOf(cfg, state)

  // 嗯呢弹幕（基础 40 能量）：点射 1571007 + 弹头（未失衡破甲 1571008 / 失衡高爆 1571009），每次强特一轮。
  // 长按（20/s，最多 2 秒，norma.holdSeconds 可调）：延长射击 1571010 + 延长弹头（1571011/1571012），倍率为每秒。
  // 弹头破甲/高爆按用户"打进失衡期的占比"拆（默认 0 = 全部非失衡破甲，失衡期留给主C）。
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  const times = cfg.normaBarrageActionTimes ?? BARRAGE_MOVES.map(() => 0.5)
  const stunShare = Math.max(0, Math.min(1, cfgNum(cfg, 'norma.barrageStunShare')))
  const holdSeconds = resolveNormaHoldSeconds(cfg)
  // 影画6：破甲弹头失衡值+30%（1571008/1571011/1571014）、高爆弹头伤害+30%（1571009/1571012/1571015），
  // 技能专属效果：只作用于对应倍率行，按表值缩放（damageMultiplierOverride/dazeMultiplierOverride）。
  const cinema = cinemaLevelOf(cfg.normaCinemaLevel)
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
    executions.push(moduleExecRow({
      moveId,
      moveName: name,
      category: 'special',
      count,
      actionTime: at,
      totalTime: count * at,
      ...ENERGY_RECOVERY_OFF,
      damageMultiplier: useDmgMult ? baseDmg * c6DmgMult : undefined,
      damageMultiplierOverride: useDmgMult,
      dazeMultiplier: useDazeMult ? baseDaze * c6DazeMult : undefined,
      dazeMultiplierOverride: useDazeMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `${note}${useDmgMult ? ' · 影画6：高爆弹头伤害+30%' : ''}${useDazeMult ? ' · 影画6：破甲弹头失衡值+30%' : ''}`,
    }))
  }
  if (exCount > 0) {
    // 基础：点射 + 破甲/高爆弹头（按用户失衡占比拆）
    pushBarrage(SHOT_MOVE, '嗯呢弹幕·射击', exCount, 0, '基础 40 能量：点射 411.1%')
    pushBarrage(ARMOR_PIERCE_SHOT_MOVE, '嗯呢弹幕·破甲弹头', Math.round(exCount * (1 - stunShare)), 1, `未失衡目标：破甲弹头 616%（占比 ${Math.round((1 - stunShare) * 100)}%）`)
    pushBarrage(HIGH_EXPLOSIVE_SHOT_MOVE, '嗯呢弹幕·高爆弹头', Math.round(exCount * stunShare), 2, `失衡目标：高爆弹头 683.5%（占比 ${Math.round(stunShare * 100)}%）`)
    // 长按：延长射击每秒（1571010）+ 延长破甲/高爆每秒（1571011/1571012）。
    // 每次弹幕都长按 holdSeconds（能量已按 40+20×hold/次 收费），延长总秒数 = 次数 × holdSeconds。
    // CC-438：秒数不再 floor——滑块步长 0.5、倍率按每秒、能量按 20/s 收费，伤害同比例（默认 2 时逐位不变）。
    if (holdSeconds > 0) {
      const holdSecs = holdSeconds * exCount
      pushBarrage(EXTEND_SHOT_MOVE, '嗯呢弹幕·延长射击', holdSecs, 3, `每次长按 ${holdSeconds}s × ${exCount} 次：延长点射 261.5%/s`)
      pushBarrage(EXTEND_ARMOR_PIERCE_MOVE, '嗯呢弹幕·延长破甲', Math.max(0, Math.round(holdSecs * (1 - stunShare))), 4, `长按延长：破甲 392.8%/s（占比 ${Math.round((1 - stunShare) * 100)}%）`)
      pushBarrage(EXTEND_HIGH_EXPLOSIVE_MOVE, '嗯呢弹幕·延长高爆', Math.max(0, Math.round(holdSecs * stunShare)), 5, `长按延长：高爆 433.4%/s（占比 ${Math.round(stunShare * 100)}%）`)
    }
  }

  // 膛温≥80%帽子把戏→连携技：帽子把戏触发上一位角色的快速支援→替换为连携技，
  // 所以该连携归属上一位队友（由 useResourceCalc 注入给目标队友连携次数 + C4 喧响），诺姆本模块不 push。
  // source.hatToChainCount 由 buildResourceResult/resourceSections 展示。

  // 炮塔普通自动射击：弹幕覆盖秒数 / 3s 间隔（打靶练习 1571013）
  if (source.towerAutoShotCount > 0) {
    executions.push(moduleExecRow({
      moveId: TARGET_PRACTICE_MOVE,
      moveName: '特殊技：打靶练习（炮塔自动射击）',
      category: 'special',
      count: source.towerAutoShotCount,
      ...RECOVERY_OFF,
      skillDamageTarget: 'special',
      skillTableNote: '嗯呢弹幕期间炮塔自动射击，3 秒间隔',
    }))
  }

  // 火力实验导弹舱：强化期超出失衡总时长的部分打破甲弹（1571014，未失衡），失衡内打高爆弹（1571015，失衡）。
  // 失衡总时长 = 失衡覆盖率 × 战斗时间（= 失衡次数 × (基础12 + 连携补时4 + 技术鸿沟延时2)），强化时长超出即目标已脱离失衡。
  // 影画6：破甲弹头失衡值+30%（1571014）、高爆弹头伤害+30%（1571015），技能专属按倍率表对应行缩放。
  const missileRows = cfg.normaMissileRowValues ?? { damage: [], daze: [] }
  if (source.armorPierceCount > 0) {
    const baseDaze = missileRows.daze[0] ?? 0
    const useDazeMult = cinema >= 6 && baseDaze > 0
    executions.push(moduleExecRow({
      moveId: ARMOR_PIERCE_MOVE,
      moveName: '强化特殊技：火力实验·破甲弹头',
      category: 'special',
      count: source.armorPierceCount,
      ...RECOVERY_OFF,
      dazeMultiplier: useDazeMult ? baseDaze * c6DazeMult : undefined,
      dazeMultiplierOverride: useDazeMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `火力实验强化期超出失衡总时长部分（${fmt(source.armorPierceSeconds)}s）：未失衡目标发射破甲弹头，累积较多失衡值${useDazeMult ? ' · 影画6：破甲弹头失衡值+30%' : ''}`,
    }))
  }
  if (source.highExplosiveCount > 0) {
    const baseDmg = missileRows.damage[1] ?? 0
    const useDmgMult = cinema >= 6 && baseDmg > 0
    executions.push(moduleExecRow({
      moveId: HIGH_EXPLOSIVE_MOVE,
      moveName: '强化特殊技：火力实验·高爆弹头',
      category: 'special',
      count: source.highExplosiveCount,
      ...RECOVERY_OFF,
      damageMultiplier: useDmgMult ? baseDmg * c6DmgMult : undefined,
      damageMultiplierOverride: useDmgMult,
      skillDamageTarget: 'exSpecial',
      skillTableNote: `火力实验失衡期内（${fmt(source.highExplosiveSeconds)}s）：失衡目标发射高爆弹头，更高伤害${useDmgMult ? ' · 影画6：高爆弹头伤害+30%' : ''}`,
    }))
  }

  // C6：任意角色失衡后导弹轰击 6 秒（0.75s/发 ≈ 8 发）× 200% 攻击火伤（视为终结技），30 秒 CD
  if (source.c6MissileCount > 0) {
    executions.push(moduleExecRow({
      moveId: 'norma_c6_missile',
      moveName: '影画6·天才第一因（导弹轰击）',
      category: 'chain',
      count: source.c6MissileCount,
      ...RECOVERY_OFF,
      damageMultiplier: C6_MISSILE_RATIO,
      damageMultiplierOverride: true,
      element: 'fire',
      skillDamageTarget: 'ultimate',
      skillTableNote: `C6 导弹轰击：失衡后 6s/0.75s≈8 发 × 200% 攻击火伤（视为终结技），触发 ${source.c6BurstCount} 次`,
    }))
  }
}

function buildNormaResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const source = normaSourceOf(cfg, state)
  // C4 喧响（诺姆 + 上一位队友各 200 / 次）由本模块 chainGift 声明的 `decibelPerUnit`（400 = 两侧合计）
  // 经 `core/resource/crossAgentSupply.ts#giftDecibelForCfg` 结算进喧响收入（CC-191 删了此处从无读取方的
  // `cfg.normaHatToChainCount` 回写——它是迁到 decibelPerUnit 之前的残留）。
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
  prev: { exSpecialCount: number; ultimateCount: number; frontlineTime: number; battleTime: number },
  holdSeconds = 2,
): number {
  // CC-333：直接复用 computeNormaSource 的膛温→连携计算，避免两处手写膛温公式再次分叉
  return computeNormaSource({
    exSpecialCount: prev.exSpecialCount,
    ultimateCount: prev.ultimateCount,
    frontlineTime: prev.frontlineTime,
    battleTime: prev.battleTime,
    cinemaLevel: 0,
    additionalAbilityActive: false,
    stunCount: 0,
    stunCoverage: 0,
    holdSeconds,
  }).hatToChainCount
}

export const normaMechanic: AgentMechanicModule = {
  id: 'agent:norma',
  agentIds: [NORMA_AGENT_ID],
  // CC-61：轴编辑器「诺姆转连携」标记块（展示层；膛温换连携自动全打 floor(膛温/80)，块只是轴内标记/占位）。
  // 'norma-hat-chain' 同时被编排层 roundInputs#buildStackAxes 与 core/stunAxis 识别为 0 时长标记块。
  axisExtraBlocks: () => [{ moveId: 'norma-hat-chain', label: '诺姆转连携', actionTime: 0, quota: 9 }],
  name: '诺姆',
  description: '预热膛温资源、嗯呢弹幕（6段+炮塔+全队增伤）、膛温帽子把戏→连携替换、火力实验导弹、技术鸿沟失衡易伤。',
  /**
   * CC-402：嗯呢弹幕两组互斥分支（按失衡态 / 长按二选一）；两段都列。
   * - 基础弹头：破甲 1571008（未失衡）↔ 高爆 1571009（失衡），`norma.barrageStunShare` 决定占比；
   * - 延长弹头：延长破甲 1571011 ↔ 延长高爆 1571012，长按（`norma.holdSeconds`）时才发射。
   */
  moveBranchGroups: [
    [ARMOR_PIERCE_SHOT_MOVE, HIGH_EXPLOSIVE_SHOT_MOVE],
    [EXTEND_ARMOR_PIERCE_MOVE, EXTEND_HIGH_EXPLOSIVE_MOVE],
  ],
  applyPanel: applyNormaPanel,
  buildCharConfig: buildNormaCharConfig,
  /**
   * converge 阶段：把本轮失衡次数 / 覆盖率写进本槽 cfg（诺姆火力实验导弹舱与
   * 失衡内资源循环消费）。2026-09-15 arch 棘轮自 `convergence.ts` 的 `merged.agentId === '1571'`
   * 分支搬入（规则 6：编排层不写角色规则）。两个字段的消费方**只有本模块**
   * （`config.ts:466/468` 声明，`norma.ts:299-301/478-480` 读），故 agentId 判断冗余。
   * ⚠ `stunCoverage` 取 `teamStunCoverage`（编排层对**所有**角色通用注入的同一个量），
   * 与原分支的 `provStunCoverage` 同源同值。
   * 战斗时间不再抄私有副本（r723，r6 §8.0 #13）：原 `normaBattleTime` 只在 converge 写入、此前取 180，
   * 现直接读 `cfg.battleTime`（buildCharConfig 恒写，与入参 `combatTime` 同源于 `configStore.enemy.battleTime`）。
   */
  applyTeamConfig: ({ cfg, phase, stunCount }: AgentTeamConfigInput) => {
    if (phase !== 'converge') return
    cfg.normaStunCount = stunCount
    cfg.normaStunCoverage = cfg.teamStunCoverage ?? 0
  },
  /**
   * 跨槽位供给：膛温帽子把戏 → 送给「上一位队友」的连携行（规则 6 在引擎层的落点）。
   *
   * 迁移自 `core/resource.ts#normaGiftChainInfo`（2026-09-13，数值逐位保留）：那段数学原先住在
   * 引擎里，且靠 `configs.findIndex(c => c.agentId === '1571')` 找槽位——新角色接赠链要改引擎。
   * 现在引擎按 `kind: 'gift-chain'` 查槽位 + 调本 `supply()`，落点缺省 = 上一位队友。
   */
  crossAgentSupply: {
    kind: 'gift-chain:chain',
    supply: ({ cfg, state }) => computeNormaHatToChainCount(
      {
        exSpecialCount: state.exSpecialCount,
        ultimateCount: state.ultimateCount,
        frontlineTime: state.frontlineTime,
        battleTime: cfg.battleTime,
      },
      resolveNormaHoldSeconds(cfg),
    ),
    // 落点 = 缺省「上一位队友」（不声明 targetSlot；CC-294）。此处原读 `liuyin.ultimateTargetSlot`（注释称与琉音共用下拉），
    // 但 buildCharConfig 只把**本模块**设置写进 cfg ⇒ 诺姆 cfg 上恒无此键、恒取 -1：引擎一直按上一位预留，
    // 只有编排层 chainGift 真读了琉音的设置 ⇒ 设置 ≠ 自动时两个队友各拿一份赠链。下拉标签也是「琉音…」，
    // 且只在琉音在队时显示。若要让诺姆落点可调，给本模块注册自己的设置并在这里声明 targetSlot。
    // 赠的是**连携**行 ⇒ 单位耗时 = 落点槽的 chainActionTime（与琉音赠大用 ultimateActionTime 不同）
    secondsPerUnit: ({ targetCfg }) => targetCfg.chainActionTime,
    // 影画4·膛温换连携：每次赠链「诺姆 + 上一位队友**各** +200 不可分享喧响」。
    // ⚠ 引擎在逐槽循环里对每个 cfg 调本函数，但 `normaCinemaLevel` **只写在诺姆自己的 cfg 上**
    //   ⇒ 实际只在诺姆槽结算（迁移前的 `* 200 * 2` 即此语义：在诺姆槽一次算入两侧的量）。
    //   故这里返回 **400 = 两侧合计**，不是单侧 200——改口径前先看这条。
    //   门控（影画4）在模块内判，引擎不读 normaCinemaLevel。
    decibelPerUnit: ({ cfg }) => (cinemaLevelOf(cfg.normaCinemaLevel) >= 4 ? 400 : 0),
  },
  /**
   * 影画2·帽子把戏回能（2026-09-26 CC-14a）：战斗中触发回 25 能量，20 秒冷却；按战斗时间驱动
   * （默认 180s → floor(180/20)=9 次）。算式逐字来自 `core/resource/resourceIncome.ts#calcEnergySource`。
   */
  bonusEnergy({ cfg, totalTime }) {
    const per = finiteOr0(cfg.normaC2EnergyPerTrigger)
    const interval = finiteOr0(cfg.normaC2TriggerInterval)
    return [{
      key: 'hatTrickEnergy',
      label: '帽子把戏',
      value: per > 0 && interval > 0 ? Math.max(0, Math.floor(totalTime / interval)) * per : 0,
      detail: '影画2：25/次 × 20s 冷却（按战斗时间触发）',
    }]
  },
  estimateExSpecialTime({ cfg, exSpecialCount }) {
    // 嗯呢弹幕真实前台时间（修复：通用公式只用 #1 单段 0.493s → 严重低估）：
    // 一次强特 = 点射 #1(0.493) + 弹头 #2/#3(0.74)；长按延长（#4 0.4 + 延长弹头 0.6）/s
    // ⚠ 已知口径分叉（CC-438 r476 量过、**故意不改**）：这里长按整局只算一次（`+ holdSeconds × holdTime`），
    // 而伤害行 / 膛温 / 能量都按「每次弹幕都长按」计。最终必要时间不受影响——外层折叠环按 Σ物化行补齐残差
    // （实测 6 次弹幕两种写法 necessaryTime 都是 53.073）；但改成按次计会改变折叠环的落点（`rr.iterations`——末轮内层迭代数——1→0；r479 核实：外层本就至少跑两轮，差异来自 pass0 冻结的 refund/idle 吃进了估计值），
    // 12 个诺姆预设 zd 全变、heavy 变体 ±3～7%，timeFillRatchet 两队留白/超预算 0→2s 判红。
    // 要改必须和 DEBT 1a（折叠环 / 停点规则）一起动，见 docs/mcp-r6-refactor-list.md §8 r476 行。
    const times = cfg.normaBarrageActionTimes ?? [0.493, 0.74, 0.74, 0.4, 0.6, 0.6]
    const holdSeconds = resolveNormaHoldSeconds(cfg)
    const baseTime = (times[0] ?? 0.493) + Math.max(times[1] ?? 0, times[2] ?? 0)
    const holdTime = (times[3] ?? 0.4) + Math.max(times[4] ?? 0, times[5] ?? 0)
    const necessaryTime = Math.max(0, Math.floor(exSpecialCount)) * baseTime + holdSeconds * holdTime
    return { necessaryTime, comboAlignTime: 0 }
  },
  buildExecutions: buildNormaExecutions,
  buildResourceResult: buildNormaResourceResult,
  // 装配后赠送连携（CC-35d-A：原 resourceCalc/normaHatChain.ts 按 id 找槽，现由编排层按能力派发）
  chainGift: result => result.normaMechanicSource
    ? { count: result.normaMechanicSource.hatToChainCount, label: '诺姆膛温替换', note: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）' }
    : null,
  resourceSections: buildNormaResourceSections,
  settings,
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 诺姆技术鸿沟失衡易伤（额外能力触发时，+3%/层×10层） */
    normaTechGapStunBonus?: number
    /** 诺姆额外能力攻击提升（44~870，随等级） */
    normaExtraAbilityAtkBonus?: number
    /** 诺姆失衡次数（外层不动点传入，供火力实验导弹舱次数） */
    normaStunCount?: number
    /** 诺姆失衡覆盖率（外层不动点传入，供火力实验高爆/破甲按失衡时长拆分） */
    normaStunCoverage?: number
    /** 诺姆嗯呢弹幕 6 段 actionTime（1571007-1571012，buildCharConfig 预存） */
    normaBarrageActionTimes?: number[]
    /** 诺姆嗯呢弹幕 6 段 damage/daze 表值（buildCharConfig 预存，供 C6 技能专属加成缩放） */
    normaBarrageRowValues?: { damage: number[]; daze: number[] }
    /** 诺姆火力实验导弹 2 段 damage/daze 表值（1571014 破甲/1571015 高爆，buildCharConfig 预存） */
    normaMissileRowValues?: { damage: number[]; daze: number[] }
    /** 诺姆影画2·帽子把戏触发间隔（20秒） */
    normaC2TriggerInterval?: number
    /** 诺姆命座等级 */
    normaCinemaLevel?: number
    /** 诺姆影画2·帽子把戏每次回能（25；未达2命为 0） */
    normaC2EnergyPerTrigger?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 诺姆预热膛温/嗯呢弹幕/技术鸿沟明细 */
    normaMechanicSource?: NormaMechanicSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 诺姆预热膛温/嗯呢弹幕/技术鸿沟资源明细 */
export interface NormaMechanicSource {
  heatInitial: number
  heatFromFrontline: number
  heatFromExSpecial: number
  /** 长按延长射击额外膛温（长按能量 20/s × 0.4%）；完整模型：膛温 = 消耗能量 × 0.4% */
  heatFromHold: number
  heatFromUltimate: number
  heatTotal: number
  /** 影画2·帽子把戏回能触发次数（floor(战斗时间/20)，默认180s→9次） */
  c2EnergyTriggers: number
  /** 影画2·帽子把戏回能总量（次数 × 25） */
  c2EnergyTotal: number
  /** 膛温≥80%帽子把戏→连携技替换次数 = floor(膛温总量/80) */
  hatToChainCount: number
  /** 嗯呢弹幕期间全队增伤（+20%，额外能力触发时；弹幕按满覆盖） */
  barrageTeamDmgBonus: number
  /** 炮塔总座数（每次弹幕 2 座） */
  towerCount: number
  /** 炮塔普通自动射击次数（弹幕覆盖秒数 / 3s，打靶练习 1571013） */
  towerAutoShotCount: number
  /** 火力实验导弹舱次数 = 失衡次数 + 膛温换连携次数 */
  missileBayCount: number
  /** 导弹舱强化自动射击总发数（每舱 8s/2s=4 发，C1 12s/2s=6 发） */
  boostedShotTotal: number
  /** 火力实验强化期失衡内秒数（打高爆弹） */
  highExplosiveSeconds: number
  /** 火力实验强化期超出失衡的秒数（打失衡高的破甲弹） */
  armorPierceSeconds: number
  /** 破甲弹头发数（未失衡，1571014） */
  armorPierceCount: number
  /** 高爆弹头发数（失衡，1571015） */
  highExplosiveCount: number
  /** C6 导弹轰击触发次数（min(失衡次数, floor(180/30))） */
  c6BurstCount: number
  /** C6 导弹总发数 = 触发次数 × 8 发 */
  c6MissileCount: number
  /** 额外能力是否触发 */
  additionalAbilityActive: boolean
  /** 技术鸿沟失衡易伤（+3%/层×10层，额外能力触发时） */
  techGapStunBonus: number
  /** 额外能力攻击提升（44~870，随等级） */
  extraAbilityAtkBonus: number
  cinemaLevel: number
  note: string
}
