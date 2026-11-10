/**
 * 菲欧妮（1641，火属性·异常，坎卜斯黑枝）—— nanoka 3.3.12+19629936（v12 正式数值）。
 * 原文来源：data/raw/nanoka_missing/full/1641.json（证据契约 data/recordings/1641.json）。
 *
 * - 核心被动·涅槃：异常精通 **+85**；[灼蚀]（v12 取代旧[脆弱]）——队伍任意角色造成属性异常伤害时
 *   使敌人陷入 20 秒；[灼蚀] 敌人受到属性异常伤害**有概率暴击**：
 *   · 基础暴击率 30%、暴击伤害 **25%**（v12 不再随异常角色数分档）；
 *   · 菲欧妮**初始异常掌控 > 155** 时，每点 +0.7% 暴击率；
 *   · 初始异常掌控达 **255** 时暴击率达到最大值（30 + 0.7×100 = 100）。
 *   · **[灼蚀] 敌人每 8 秒受到菲欧妮 50% 攻击力火属性伤害，视为[强化特殊技]伤害**（v12 新增，
 *     走 direct_damage 事件通道，非异放）。
 * - 额外能力：队伍有其他[异常]或同阵营角色 → [灼蚀] 敌人受到属性异常伤害的**暴击伤害 +15%**
 *   （v12 起固定 +15，不再按异常角色数 2/3 → 25%/40%）。
 * - 异放（固定 releaseMultiplier）：
 *   · [普通攻击：焚罪]（1641005）终结一击 225+20×(s-1)，暴击时暴伤额外 +40%；
 *   · [烬火追魂]（1641019）终结一击 300+27×(s-1)，暴击时暴伤额外 +40%；
 *   · 影画4：上述两者命中异常状态敌人时**额外触发一次异放，固定 600%**。
 * - [燔焰]：上限 120；[燃烧攻击]（普攻三/四段、熔毁、燎斩、眩焰、坠阳、连携、终结）造成伤害时按
 *   倍率表 attack_data_0 回复；完美格挡 +5（10 秒一次）；影画1 效率 +15%。
 *   满 90 长按普攻发动[焚罪]（消耗 90 点）。
 * - [升变]：发动[坠阳]获得 1 点（上限 1）；影画1 入场 +1；影画6 眩焰 +1；持有可发动[燎斩]（1641023）。
 * - [枯荣]：发动强化特殊技进入 20 秒；[枯荣]下发动[眩焰]后，下次[眩焰]替换为[坠阳]。
 *   ⇒ 强特循环 = 眩焰(40) → 坠阳(40, +1升变) → 燎斩(0 耗能，消耗升变)。
 * - 影画1：入场 +1 升变；[灼蚀] 暴伤额外 +25%；[燃烧攻击] 燔焰获取效率 +15%。
 * - 影画2：[灼烧]持续时间 +2 秒；对[灼蚀] 敌人造成的伤害 +30%（dmgBonus）。
 * - 影画4：焚罪/烬火追魂终结一击额外一次异放 600%。
 * - 影画6：无视目标 15% 全属性伤害抗性；眩焰获得 1 点升变；异放无视 40% 防御力。
 * - [烬火追魂]（1641019，191.2%）不占前台时间（收尾追加攻击，卢西娅 1451007 先例），
 *   计数 = 终结次数（[生竭] → 下一次换入前场触发）。
 *
 * 未建模（spec notes 在册）：[生竭]/[重明] 状态机本体（回血无乘区）、[枯荣] 逐时序状态机
 * （按「每轮眩焰→坠阳→燎斩」稳态口径）、[灼烧] 持续时间 +2 秒的 DPS 折算（异常 DPS 走引擎异常池）。
 */
import { clampRatio, whole } from '@/utils/finiteClamp'
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ReleaseModifier,
  ReleaseModifierInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting } from '@/types/resource'
import { mechanicSettingReader, capOfAuto } from '@/utils/mechanicSettingCfg'
import { getRowValue } from '@/data/moveTableQueries'
import { moduleExecRow, RECOVERY_OFF, carveBasicPool } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { minusInvincibleTime } from '@/core/effectiveTime'

const setting = mechanicSettingReader(() => settings)
export const PHOENIX_ID = '1641'
/** 核心被动：异常精通 +85（v12；旧 40） */
export const PHOENIX_CORE_PROFICIENCY = 85
/** [灼蚀]：基础暴击率 30%、暴击伤害 25%（v12） */
export const PHOENIX_SCORCH_CRIT_RATE = 30
export const PHOENIX_SCORCH_CRIT_DMG = 25
/** [灼蚀]：初始异常掌控 > 155 每点 +0.7% 暴击率；达 255 时封顶 */
export const PHOENIX_SCORCH_MASTERY_THRESHOLD = 155
export const PHOENIX_SCORCH_PER_POINT_RATE = 0.7
export const PHOENIX_SCORCH_MASTERY_CAP = 255
/** [灼蚀] 每 8 秒 50% 攻击力火伤（视为强化特殊技伤害） */
export const PHOENIX_SCORCH_DOT_INTERVAL = 8
export const PHOENIX_SCORCH_DOT_RATIO = 50
/** 额外能力：[灼蚀] 敌人受到属性异常伤害的暴击伤害 +15（v12 固定，不再分档） */
export const PHOENIX_ADDITIONAL_SCORCH_CRIT_DMG = 15
/** 影画1：[灼蚀] 暴伤额外 +25%；燔焰获取效率 +15%；入场 +1 升变 */
export const PHOENIX_C1_CRIT_DMG = 25
export const PHOENIX_C1_EMBER_EFFICIENCY = 15
/** 影画2：对[灼蚀] 敌人造成的伤害 +30% */
export const PHOENIX_C2_SCORCH_DMG_BONUS = 30
/** 影画2：施加[灼烧]时其持续时间 +2 秒（走 teamAnomalyDurationBonus 通用臂） */
export const PHOENIX_C2_BURN_DURATION_BONUS = 2
/** 影画4：焚罪/烬火追魂终结一击额外一次异放，固定 600% 倍率 */
export const PHOENIX_C4_RELEASE_MULT = 600
/** 影画6：无视 15% 全属性伤害抗性；异放无视 40% 防御 */
export const PHOENIX_C6_RES_IGNORE = 15
export const PHOENIX_C6_RELEASE_DEF_IGNORE = 40
/** 异放暴击时暴伤额外 +40%（焚罪/烬火追魂共有） */
export const PHOENIX_RELEASE_CRIT_EXTRA_DMG = 40
/** 完美格挡：每次 +5 燔焰，10 秒最多一次（原文） */
export const PHOENIX_PERFECT_BLOCK_EMBER = 5
export const PHOENIX_PERFECT_BLOCK_CD_SECONDS = 10

/** moveId（param 空间，v12 重排后） */
export const PHOENIX_CHARGED_MOVE_ID = '1641005' // 普通攻击：焚罪（长按，消耗 90 燔焰）
export const PHOENIX_BRANCH_MOVE_ID = '1641006' // 普通攻击：熔毁（分支攻击；掠火未触发完美格挡时派生）
/** 特殊技：掠火（1641007，普通 E，0 能量）：不触发完美格挡时派生熔毁，两者都可衔接第三段 */
export const PHOENIX_SLASH_MOVE_ID = '1641007'
export const PHOENIX_EX_FIRST_MOVE_ID = '1641008' // 强化特殊技：眩焰（40 能量）
export const PHOENIX_EX_SECOND_MOVE_ID = '1641009' // 强化特殊技：坠阳（40 能量，+1 升变）
export const PHOENIX_EX_LIAOZHAN_MOVE_ID = '1641023' // 强化特殊技：燎斩（消耗 1 升变，不耗能）
export const PHOENIX_ULT_MOVE_ID = '1641013' // 终结技：万死重明
export const PHOENIX_ENTRY_MOVE_ID = '1641019' // 烬火追魂（[生竭] 后下一次换入前场）
export const PHOENIX_CHAIN_MOVE_ID = '1641012' // 连携技：绝处逢生
/** 长按普攻消耗燔焰 */
export const PHOENIX_CHARGED_EMBER_COST = 90
/** [燔焰] 上限（原文「菲欧妮最多拥有120点[燔焰]」） */
export const PHOENIX_EMBER_CAP = 120
/**
 * [燃烧攻击]集合（燔焰来源：倍率表 `attack_data_0` 列 = **每次命中的燔焰获取**）。
 *
 * 标度口径（2026-09-14 用户复核确认）：这批整型列统一 **×10000**——同一行的
 * `energy_gain_base=71040` 在 catalog 里就是 `energy_recovery 7.104`，
 * 故 `attack_data[1641004]=169072` → **16.9072 燔焰/次**（v12 重导后的真实值）。
 * 分支攻击 1641006（熔毁）自 2026-10-22 起由平A段计划给出次数（掠火起手轮），不再当「操作向量」跳过。
 */
export const PHOENIX_COMBUSTION_MOVE_IDS: ReadonlySet<string> = new Set([
  '1641003', '1641004', // 普攻三/四段
  PHOENIX_BRANCH_MOVE_ID, // 分支攻击：熔毁
  PHOENIX_EX_LIAOZHAN_MOVE_ID, // 强化特殊技：燎斩
  PHOENIX_EX_FIRST_MOVE_ID, PHOENIX_EX_SECOND_MOVE_ID, // 眩焰 / 坠阳
  PHOENIX_CHAIN_MOVE_ID, PHOENIX_ULT_MOVE_ID, // 连携 / 终结
])
/** 平A段循环（普攻一~四段，燔焰按第三/四段命中计） */
export const PHOENIX_BASIC_SEGMENT_IDS: readonly string[] = ['1641001', '1641002', '1641003', '1641004']
/** 异放固定倍率（满级 s=12）：焚罪 225+20×11=445、烬火追魂 300+27×11=597 */
export const PHOENIX_RELEASE_BASE = { charged: 225, chargedPerLevel: 20, entry: 300, entryPerLevel: 27 } as const
/** 通用技能等级口径：影画3 +2、影画5 累计 +4 */
export function phoenixSkillLevel(cinemaLevel: number): number {
  const cinema = cinemaLevelOf(cinemaLevel)
  return 12 + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
}

export interface PhoenixCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  scorchCritRate: number
  scorchCritDmg: number
  scorchDmgBonus: number
  scorchDotCount: number
  emberCap: number
  chargedCount: number
  exCount: number
  liaozhanCount: number
  entryCount: number
  c1CritDmg: number
  c2ScorchDmgBonus: number
  c4ReleaseMult: number
  c6ResIgnore: number
  c6ReleaseDefIgnore: number
  /** 平A段计划：免费 a34 名额换来的对数（用户口径 2026-10-22） */
  a34FreePairs: number
  /** 平A段计划：掠火起手轮数（名额用尽后填满剩余平A池） */
  a34PaidRounds: number
  /** 其中「掠火完美格挡 → 直接第三段」短版轮数（跳过熔毁） */
  a34PerfectRounds: number
  /** a3 命中次数 */
  basicThird: number
  /** a4 命中次数 */
  basicFourth: number
  /** 掠火次数（普通 E 起手） */
  slashCount: number
  /** 熔毁次数（掠火未完美格挡时派生） */
  meltCount: number
  note: string
}

/**
 * [灼蚀] 异常暴击（v12）：率 = 30 + 0.7×min(掌控,255)−155 的超出量（达 255 封顶 = 100）；
 * 伤 = 25 + 额外能力 15 + 影画1 25。
 *
 * `mastery` 必须是**初始异常掌控**（局外面板）——原文两处都写「初始」。
 */
export function computePhoenixScorchCrit(input: {
  initialMastery: number
  additionalActive: boolean
  cinemaLevel: number
}): { rate: number; dmg: number } {
  const mastery = Math.max(0, Math.min(PHOENIX_SCORCH_MASTERY_CAP, Number(input.initialMastery) || 0))
  const rate = PHOENIX_SCORCH_CRIT_RATE
    + Math.max(0, mastery - PHOENIX_SCORCH_MASTERY_THRESHOLD) * PHOENIX_SCORCH_PER_POINT_RATE
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const dmg = PHOENIX_SCORCH_CRIT_DMG
    + (input.additionalActive ? PHOENIX_ADDITIONAL_SCORCH_CRIT_DMG : 0)
    + (cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0)
  return { rate: Math.min(100, rate), dmg }
}

/**
 * 异放专属暴击参数（引擎 `releaseCrit` 通道，爱芮同款）：率取[灼蚀]档，伤取[灼蚀]档 + 40。
 *
 * 原文：「该次[异放]效果触发暴击时，其暴击伤害额外提升40%」——**只加在异放这一跳上**，
 * 不是面板暴伤，所以必须走事件级 releaseCrit 而不是 panel。
 */
function releaseCritOf(crit: { rate: number; dmg: number }, _mastery: number) {
  return {
    releaseCrit: {
      ratePct: crit.rate,
      dmgPct: crit.dmg + PHOENIX_RELEASE_CRIT_EXTRA_DMG,
    },
  }
}

/** 每轮[枯荣]强特（眩焰 → 坠阳 → 燎斩）各可衔接一次第三段 ⇒ 免费 a34 名额 3 个/轮 */
export const PHOENIX_A34_PER_EX_ROUND = 3
/** a3 / a4 的 moveId（三段一循环的两段；所有平A都落在这两段上） */
export const PHOENIX_A34_SEGMENT_THIRD = '1641003'
export const PHOENIX_A34_SEGMENT_FOURTH = '1641004'

export interface PhoenixBasicPlanInput {
  /** 本槽平A池秒数（= 段行可用的全部时间） */
  basicTime: number
  /** a1..a4 段元数据（buildCharConfig 预存；顺序 = 段序） */
  cycle: ReadonlyArray<{ moveId: string; actionTime: number }>
  /** 免费 a34 名额：由「可衔接第三段」的招式次数合计（见 phoenixBasicGrants） */
  grants: number
  /** 掠火元数据（起手轮的前半段；缺则退化为 a1/a2 起手兜底） */
  slash?: { actionTime: number }
  /** 熔毁元数据（掠火未触发完美格挡时的派生段；完美格挡轮跳过它） */
  melt?: { actionTime: number }
  /** 掠火完美格挡次数（把同数量的掠火轮换成「掠火 → a3a4」短版） */
  slashPerfectBlocks?: number
}

export interface PhoenixBasicPlan {
  /** moveId → 命中次数（整数；a3/a4/掠火/熔毁；a1/a2 只在缺掠火数据时作为起手段） */
  counts: Record<string, number>
  /** 免费名额换来的 a34 对数 */
  freePairs: number
  /** 掠火起手轮数（每轮 = 掠火 →（熔毁）→ a3 → a4） */
  paidRounds: number
  /** 其中走「完美格挡直入 a3」短版（跳过熔毁）的轮数 */
  perfectRounds: number
  /** 实际占用的秒数（≤ basicTime；余量留在通用 basic_attack 聚合行上作留白） */
  usedTime: number
  /** a3 / a4 命中次数合计 */
  third: number
  fourth: number
}

/**
 * 菲欧妮平A段计划（用户口径 2026-10-22 定稿）——**从 0 正向填充**，不是「有名额就必须打」。
 *
 * 战斗循环 `e → a → a → e → a → a`：所有平A都落在第三/四段。名额（=「点按普攻可衔接第三段」的招式次数）
 * 决定 a34 的**免费上限**；名额没用完时 a34 连续循环，用完后由**掠火起手轮**接着填满剩余平A池
 * （掠火 0 能量、无 CD ⇒ 永远打得出来，故 a1/a2 起手**不存在**；用户 2026-10-22 亲口订正
 * 「前面我说打完后只能从a1开始是错的…可以普通e起手接a34」）。
 *
 * 两条口径细节：
 * - 名额是**免费的上限**而非「必须打满」：`freePairs = min(grants, 池能装下的对数)`
 *   （用户原话「a34 是自动填充…从 0 逼近满时间，不是从超满截断」）；
 * - 段是**离散动作** ⇒ 次数一律整数：装不满一整对的余量（< a3 时长）留在聚合行当留白，不折算成半段。
 */
export function planPhoenixBasic(input: PhoenixBasicPlanInput): PhoenixBasicPlan {
  const counts: Record<string, number> = {}
  const empty: PhoenixBasicPlan = { counts, freePairs: 0, paidRounds: 0, perfectRounds: 0, usedTime: 0, third: 0, fourth: 0 }
  const timeOf = (moveId: string) => input.cycle.find(s => s.moveId === moveId)?.actionTime ?? 0
  const thirdT = timeOf(PHOENIX_A34_SEGMENT_THIRD)
  const fourthT = timeOf(PHOENIX_A34_SEGMENT_FOURTH)
  const pairT = thirdT + fourthT
  let t = Math.max(0, Number(input.basicTime) || 0)
  if (!(pairT > 0) || t <= 0) return empty
  const add = (moveId: string, n: number) => { if (n > 0) counts[moveId] = (counts[moveId] ?? 0) + n }
  const fits = (seconds: number) => seconds > 0 && t + 1e-9 >= seconds

  // ① 免费名额：整数对连续 a34，填到「名额用完」或「池装不下下一对」
  const freePairs = Math.min(Math.max(0, Math.floor(Number(input.grants) || 0)), Math.floor((t + 1e-9) / pairT))
  t -= freePairs * pairT
  let usedTime = freePairs * pairT
  add(PHOENIX_A34_SEGMENT_THIRD, freePairs)
  add(PHOENIX_A34_SEGMENT_FOURTH, freePairs)

  // ② 名额用尽仍有剩余：掠火起手轮。**轮是原子的**（掠火 →（熔毁）→ a3 → a4 整轮打得完才记），
  // 打不完一整轮的余量留白——段与轮都是离散动作，按比例折算会凭空造出半段命中。
  let paidRounds = 0
  let perfectRounds = 0
  const slashT = Math.max(0, input.slash?.actionTime ?? 0)
  const meltT = Math.max(0, input.melt?.actionTime ?? 0)
  if (slashT > 0) {
    const pbCap = Math.max(0, Math.floor(Number(input.slashPerfectBlocks) || 0))
    const shortUnit = slashT + pairT
    const fullUnit = slashT + meltT + pairT
    // 完美格挡轮更省时间（跳过熔毁）⇒ 先吃满；再吃完整轮
    while (perfectRounds < pbCap && fits(shortUnit)) {
      perfectRounds += 1
      t -= shortUnit
      usedTime += shortUnit
    }
    let fullRounds = 0
    while (fits(fullUnit)) {
      fullRounds += 1
      t -= fullUnit
      usedTime += fullUnit
    }
    paidRounds = perfectRounds + fullRounds
    add(PHOENIX_SLASH_MOVE_ID, paidRounds)
    add(PHOENIX_BRANCH_MOVE_ID, fullRounds)
    add(PHOENIX_A34_SEGMENT_THIRD, paidRounds)
    add(PHOENIX_A34_SEGMENT_FOURTH, paidRounds)
    // 尾段前缀：掠火 → 熔毁 → a3 → a4 是**一条连续派生链**（原文「点按普攻可衔接第三段」逐段成立），
    // 所以剩余时间不足一整轮时就按链序吃前缀——玩家不会把够打掠火的时间白白留空。
    for (const seg of [
      { id: PHOENIX_SLASH_MOVE_ID, t: slashT },
      { id: PHOENIX_BRANCH_MOVE_ID, t: meltT },
      { id: PHOENIX_A34_SEGMENT_THIRD, t: thirdT },
      { id: PHOENIX_A34_SEGMENT_FOURTH, t: fourthT },
    ]) {
      if (!fits(seg.t)) continue
      add(seg.id, 1)
      t -= seg.t
      usedTime += seg.t
    }
  } else {
    // 兜底（catalog 缺掠火时长）：a1 → a2 → a3 → a4 整轮正向填充（同样整轮原子）
    const a1 = timeOf('1641001')
    const a2 = timeOf('1641002')
    const cycleT = a1 + a2 + pairT
    let rounds = 0
    while (cycleT > 0 && fits(cycleT)) {
      rounds += 1
      t -= cycleT
      usedTime += cycleT
    }
    add('1641001', rounds)
    add('1641002', rounds)
    add(PHOENIX_A34_SEGMENT_THIRD, rounds)
    add(PHOENIX_A34_SEGMENT_FOURTH, rounds)
  }

  const third = counts[PHOENIX_A34_SEGMENT_THIRD] ?? 0
  const fourth = counts[PHOENIX_A34_SEGMENT_FOURTH] ?? 0
  return { counts, freePairs, paidRounds, perfectRounds, usedTime, third, fourth }
}

/**
 * 免费 a34 名额（「点按普攻可衔接第三段」的招式次数合计）。
 *
 * 来源（原文逐条）：
 * - **强特三段**：眩焰 / 坠阳 / 燎斩各一次 ⇒ 3 × 强特轮数（用户口径「其3种e都放完」）；
 * - **连携技：绝处逢生**、**烬火追魂**（终结后换入那一下；**终结技本体原文无衔接句**，故每轮终结只按
 *   烬火追魂计 1 个名额）；
 * - **闪避反击：业火两渡**、**支援突击：再生疗法**。
 *
 * ⚠ **刻意不收「快速支援：急救」**（用户裁决 2026-10-22）：原文确有「点按普攻可衔接第三段」，
 * 但**引擎不物化快支行**（全仓唯一近似，见 `claret.ts`「无物化行的交互（快速支援）不计积累」），
 * 收它就等于「填 99 次 = 99 个免费 a34、一秒前台都不占」——无代价的名额会把 a34 上限变成摆设。
 * 二选一：给快支补一条真实动作行（会改全仓近似），或干脆不收（用户选后者）。
 *
 * ⚠ 掠火的「完美格挡 → 直接第三段」不进本函数：掠火轮本身就是填池手段，完美格挡只把该轮换成
 * 跳过熔毁的短版（`planPhoenixBasic.slashPerfectBlocks`）——重复计入会与 3×强特轮数双计。
 */
export function phoenixBasicGrants(
  cfg: Pick<AgentResourceInput['cfg'], 'dodgeCounterCount' | 'parryCount'>,
  state: Pick<AgentResourceInput['state'], 'exSpecialCount' | 'ultimateCount' | 'chainCountTotal'>,
): number {
  const exRounds = Math.max(0, Number(state.exSpecialCount) || 0)
  const ult = Math.max(0, Number(state.ultimateCount) || 0)
  const chain = Math.max(0, Number(state.chainCountTotal) || 0)
  return exRounds * PHOENIX_A34_PER_EX_ROUND
    + chain
    + ult // 烬火追魂（终结后换入那一下；终结技本体原文无衔接句）
    + Math.max(0, Number(cfg.dodgeCounterCount) || 0)
    + Math.max(0, Number(cfg.parryCount) || 0)
}

/**
 * 燔焰收入：按 **moveId × 倍率表 attack_data_0** 直算。
 * ⚠️ buildExecutions 阶段 executions 的 `totalSpecialResourceRecovery` **尚未 enrich 回填**，直接读是 0。
 *
 * **完美格挡 +5 燔焰**（用户口径 2026-10-22）：
 * - 次数源 = 主页交互栏 `perfectBlockCount`（模块 `characterCountInputs` 声明；原缺声明 ⇒ 用户填不到）；
 * - **CD 上限**：原文「10 秒一次」⇒ 有效次数 ≤ floor(有效战斗时间 / 10)。有效 = 扣 boss 无敌
 *   （`minusInvincibleTime`，与 `[灼蚀]` 周期火伤同源），不吃「快照满覆盖」——CD 是硬约束；
 * - 难度侧不需要额外动作：`perfectBlock` 已在 `teamCompare#BOSS_ATTACK_INTERACTIONS` 里
 *   ⇒ 自动吃非失衡占比修正（用户口径：这个交互要 boss 出手，失衡期怪物不攻击）。
 */
/**
 * 本槽平A段计划（单源）：`buildExecutions` 物化段行、燔焰收入、`buildResourceResult` 展示**都调它**。
 *
 * ⚠ 为什么由 cfg+state 现算而不是「buildExecutions 写 cfg 再读」：`materializeRows` 会在钩子返回后
 * 把 cfg 快照回滚（新增键置 undefined），写进去的派生量活不过一次物化——这是引擎既有的纯度约束
 * （`AgentResourceResultInput.preModuleExecutions` 头注同理）。
 */
function phoenixBasicPlanOf(
  cfg: AgentCharConfigInput['cfg'],
  state: Pick<AgentResourceInput['state'], 'basicAttackTime' | 'exSpecialCount' | 'ultimateCount' | 'chainCountTotal'>,
): PhoenixBasicPlan {
  return planPhoenixBasic({
    basicTime: Math.max(0, Number(state.basicAttackTime) || 0),
    cycle: cfg.phoenixBasicCycle ?? [],
    grants: phoenixBasicGrants(cfg, state),
    slash: cfg.phoenixSlashMeta,
    melt: cfg.phoenixMeltMeta,
    // 完美格挡「10 秒一次」是硬约束：掠火短版轮与燔焰 +5 共用同一 CD 上限（单一事实源 phoenixPerfectBlockHits）
    slashPerfectBlocks: phoenixPerfectBlockHits(cfg),
  })
}

/**
 * 完美格挡有效次数 = min(填写次数, floor(有效战斗时间 / 10s))——掠火短版轮与燔焰 +5 **共用同一上限**。
 *
 * ⚠ 只钳「10 秒一次」这一条原文硬约束；**不**再按「有没有掠火轮」二次钳制：
 * 完美格挡是**响应 boss 攻击**的交互（原文「上挑攻击开始瞬间受到攻击…时，可触发完美格挡」），
 * 掠火本身是随时能放的普通 E，两者不是同一资源池。用户口径 2026-10-22：「格挡不该太多」——
 * 真正防它爆量的就是这条 10s CD（180s 局最多 18 次），再加交互次数自身的 0..99 界。
 */
export function phoenixPerfectBlockHits(cfg: AgentCharConfigInput['cfg']): number {
  const perfectBlocks = Math.max(0, Math.floor(Number(cfg.perfectBlockCount)))
  const cdCap = Math.floor(minusInvincibleTime(Number(cfg.battleTime), cfg) / PHOENIX_PERFECT_BLOCK_CD_SECONDS)
  return Math.min(perfectBlocks, Math.max(0, cdCap))
}

function phoenixEmberIncome(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const meta = cfg.phoenixCombustionMeta ?? {}
  const perHit = (moveId: string) => meta[moveId] ?? 0
  // 段计划（单源 planPhoenixBasic，与 buildExecutions 物化的段行同参数）：
  // 平A三/四段 + 熔毁（掠火起手轮）。用户口径 2026-10-22：熔毁不再是「操作向量」。
  const plan = state ? phoenixBasicPlanOf(cfg, state) : undefined
  let income = plan
    ? (plan.counts['1641003'] ?? 0) * perHit('1641003') + (plan.counts['1641004'] ?? 0) * perHit('1641004')
      + (plan.counts[PHOENIX_BRANCH_MOVE_ID] ?? 0) * perHit(PHOENIX_BRANCH_MOVE_ID)
    : 0
  // 强特三段 / 终结 / 连携 / 烬火追魂：直接读 state 次数（同轮，不吃执行行的轮间滞后）——
  // 燃烧攻击集合里的其余来源要么由本模块 push（坠阳/燎斩，滞后一轮），要么由 core push（眩焰/终结/连携）。
  const exRounds = Math.max(0, state?.exSpecialCount ?? 0)
  const ult = Math.max(0, state?.ultimateCount ?? 0)
  const chain = Math.max(0, state?.chainCountTotal ?? 0)
  income += exRounds * (perHit(PHOENIX_EX_FIRST_MOVE_ID) + perHit(PHOENIX_EX_SECOND_MOVE_ID) + perHit(PHOENIX_EX_LIAOZHAN_MOVE_ID))
  income += chain * perHit(PHOENIX_CHAIN_MOVE_ID)
  income += ult * (perHit(PHOENIX_ULT_MOVE_ID) + perHit(PHOENIX_ENTRY_MOVE_ID))
  // 兜底：执行行里另有未覆盖的燃烧攻击行（未来新增招式）按行计数累计，已覆盖的跳过防双计
  const covered = new Set<string>([
    '1641003', '1641004', PHOENIX_BRANCH_MOVE_ID,
    PHOENIX_EX_FIRST_MOVE_ID, PHOENIX_EX_SECOND_MOVE_ID, PHOENIX_EX_LIAOZHAN_MOVE_ID,
    PHOENIX_CHAIN_MOVE_ID, PHOENIX_ULT_MOVE_ID, PHOENIX_ENTRY_MOVE_ID,
  ])
  for (const e of executions) {
    if (!e.moveId || !PHOENIX_COMBUSTION_MOVE_IDS.has(e.moveId)) continue
    if (covered.has(e.moveId)) continue
    income += Math.max(0, e.count) * perHit(e.moveId)
  }
  // 完美格挡 +5 燔焰 / 10 秒一次（用户口径 2026-10-22）：
  // 次数按「10s 一次」的 CD 上限钳制 = floor(有效战斗时间 / 10)，再乘 5 点/次。
  // 有效战斗时间与 `[灼蚀]` 周期火伤同源（扣 boss 无敌）——CD 是硬约束，不吃覆盖率近似。
  income += phoenixPerfectBlockHits(cfg) * PHOENIX_PERFECT_BLOCK_EMBER
  return income
}

/** 长按普攻（焚罪）次数：自动 = floor(燔焰收入×影画1效率/90)；滑块 = **上限**（用户口径 2026-10-19），0 = 不设上限 */
export function phoenixChargedCount(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'] | undefined, executions: AgentResourceInput['executions']): number {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const eff = cinema >= 1 ? 1 + PHOENIX_C1_EMBER_EFFICIENCY / 100 : 1
  const auto = Math.floor(phoenixEmberIncome(cfg, state, executions) * eff / PHOENIX_CHARGED_EMBER_COST)
  return capOfAuto(auto, whole(setting(cfg, 'phoenix.chargedAttackCount')))
}

function buildPhoenixCharConfig({ cfg, cinemaLevel, panel, skills, outOfCombatPanel }: AgentCharConfigInput): void {
  cfg.phoenixCinemaLevel = cinemaLevel
  // 原文两处都写「初始异常掌控」⇒ 取局外面板
  cfg.phoenixInitialMastery = outOfCombatPanel ? outOfCombatPanel.anomalyMastery : panel.anomalyMastery
  // 强化特殊技：眩焰（40 能量）走通用强特通道；[枯荣] 循环下每轮另有坠阳（40）+ 燎斩（0）。
  const special = skills.categories.find(c => c.id === 'special')?.moves
  const exFirst = special?.find(m => m.id === PHOENIX_EX_FIRST_MOVE_ID)
  const exSecond = special?.find(m => m.id === PHOENIX_EX_SECOND_MOVE_ID)
  if (exFirst) {
    cfg.exSpecialMoveId = PHOENIX_EX_FIRST_MOVE_ID
    if (exFirst.actionTime) cfg.exSpecialActionTime = exFirst.actionTime
    // 一轮[枯荣]强特 = 眩焰(40) + 坠阳(40) ⇒ 引擎按「轮」计次数，收费必须收两段合计 80。
    // 柏妮思同款（`(c1+c2)/2` 合并计价）：只收 40 会让强特次数翻倍（实测可用能量 473 却排出 11 轮）。
    const ecFirst = parseFloat(exFirst.energyCost?.['Energy Cost'] ?? '')
    const ecSecond = parseFloat(exSecond?.energyCost?.['Energy Cost'] ?? '')
    const perRound = (Number.isFinite(ecFirst) && ecFirst > 0 ? ecFirst : 0)
      + (Number.isFinite(ecSecond) && ecSecond > 0 ? ecSecond : 0)
    if (perRound > 0) cfg.exSpecialEnergyConsume = perRound
  }
  const all = skills.categories.flatMap(c => c.moves)
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return {
      moveId,
      actionTime: m?.actionTime ?? 0,
      // CC-242：取行值走 data getRowValue（吃逻辑编辑器行规则，作用面 §24.85 ④ / §24.88）
      damage: getRowValue(m, 'damage'),
      decibelRecovery: getRowValue(m, 'decibel_recovery'),
      energyCost: parseFloat(m?.energyCost?.['Energy Cost'] ?? '') || 0,
    }
  }
  // 燃烧攻击燔焰获取（attack_data_0 列，moveId → 每次命中燔焰）
  const combustion: Record<string, number> = {}
  for (const moveId of PHOENIX_COMBUSTION_MOVE_IDS) {
    const m = all.find(mm => mm.id === moveId)
    combustion[moveId] = getRowValue(m, 'attack_data_0')
  }
  cfg.phoenixCombustionMeta = combustion
  cfg.phoenixBasicCycle = PHOENIX_BASIC_SEGMENT_IDS.map(metaOf)
  cfg.phoenixChargedMeta = metaOf(PHOENIX_CHARGED_MOVE_ID)
  cfg.phoenixExSecondMeta = metaOf(PHOENIX_EX_SECOND_MOVE_ID)
  cfg.phoenixLiaozhanMeta = metaOf(PHOENIX_EX_LIAOZHAN_MOVE_ID)
  cfg.phoenixSlashMeta = metaOf(PHOENIX_SLASH_MOVE_ID)
  cfg.phoenixMeltMeta = metaOf(PHOENIX_BRANCH_MOVE_ID)
  cfg.phoenixEntryMeta = metaOf(PHOENIX_ENTRY_MOVE_ID)
}

/**
 * 面板层（v12）：核心异常精通 +85；影画6 无视 15% 全属性伤害抗性；影画2 对[灼蚀]目标增伤 30%。
 *
 * [灼蚀] 异常暴击（率/伤）**不在这里写**——走 spec teamBuffs 声明式承载
 * （phoenix.scorch_anomaly_crit_*），公式读**初始**异常掌控；自体与队友同吃，引擎 EV 乘区通用消费。
 * 防双通道双计。
 */
function applyPhoenixPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  if (!panel) return
  const cinema = cinemaLevelOf(cinemaLevel)
  panel.anomalyProficiency = panel.anomalyProficiency + PHOENIX_CORE_PROFICIENCY
  // 影画6「**菲欧妮**无视目标 15% 全属性伤害抗性」——主语是**角色**（不是「造成的伤害」）
  // ⇒ **通用无视抗性**（用户口径 2026-11-09）：直伤与异常**都吃**，与「怪物减抗」同通道。
  if (cinema >= 6) panel.enemyResReduction = panel.enemyResReduction + PHOENIX_C6_RES_IGNORE
  // 影画6 的异放那半「菲欧妮触发的[异放]效果无视敌人 40% 防御力」——**异放专属层**（异常父层的子层）。
  // 落在面板上是为了**可展示**（算而不显 = 用户以为没算）；damage 链不读该字段，只由 releaseModifier 取用。
  if (cinema >= 6) panel.enemyAnomalyReleaseDefReduction = panel.enemyAnomalyReleaseDefReduction + PHOENIX_C6_RELEASE_DEF_IGNORE
  // 影画2：对[灼蚀]状态下的敌人造成的伤害 +30%（[灼蚀] 由队伍异常伤害施加，默认满覆盖）
  if (cinema >= 2) panel.dmgBonus = panel.dmgBonus + PHOENIX_C2_SCORCH_DMG_BONUS
}

/** 影画6：异放限定无视 40% 防御（普罗米娅同款通道） */
/**
 * 异放专属减防（影画6）：**只在异放事件结算**（异常父层的子层）。
 *
 * 读数源 = 面板 `enemyAnomalyReleaseDefReduction`（applyPanel 写入）——单一事实源，
 * 既让状态面板能显示，也让本函数不必重算（原本直接返回常量，面板看不见）。
 */
function phoenixReleaseModifier({ self }: ReleaseModifierInput): ReleaseModifier {
  const v = self.panel?.enemyAnomalyReleaseDefReduction ?? 0
  return v > 0
    ? { enemyResReduction: 0, enemyDefReduction: v, note: `；影画6：异放无视 ${v}% 防御（releaseModifier 异放专属）` }
    : { enemyResReduction: 0, note: '' }
}

/**
 * 执行行：焚罪（长按普攻）、燎斩（拥有升变时的强化特殊技）、烬火追魂（终结后换入）。
 *
 * 强特循环口径（[枯荣] 稳态）：每轮 = 眩焰（通用 exSpecialCount 通道，40 能量）
 * → 坠阳（40 能量，+1 升变）→ 燎斩（消耗升变，0 耗能）。
 * 坠阳与燎斩各自按 exCount 计次（一轮一次），坠阳耗能 40 由本行显式记账。
 */
function buildPhoenixExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // ① 先算段计划并落 cfg（燔焰收入与焚罪次数都由它派生），再算焚罪次数
  const basicPlan = phoenixBasicPlanOf(cfg, state)
  const chargedCount = phoenixChargedCount(cfg, state, executions)
  cfg.phoenixChargedCount = chargedCount
  const exCount = Math.max(0, state.exSpecialCount)
  const ultCount = Math.max(0, state.ultimateCount)
  cfg.phoenixExCount = exCount
  cfg.phoenixEntryCount = ultCount

  // ② 平A段行物化（用户口径 2026-10-22）：a3/a4 连续循环 + 掠火起手轮（掠火 →（熔毁）→ a3 → a4）。
  // 这些段**是从平A池时长解出来的**（名字见 phoenixBasicPlan.usedTime）⇒ 时间必须从通用 basic_attack
  // 聚合行挤出（carveBasicPool），否则同一段时间记两份（希格莉德 2026-09-05 事故同型）。
  // 回能/喧响仍留在聚合行（RECOVERY_OFF：平A回能按整段时长记在池上，段行不带，见 carveBasicPool 头注）。
  const segmentRows: ReadonlyArray<{ moveId: string; label: string }> = [
    { moveId: PHOENIX_SLASH_MOVE_ID, label: '特殊技：掠火（起手·未触发完美格挡时派生熔毁）' },
    { moveId: PHOENIX_BRANCH_MOVE_ID, label: '普通攻击：熔毁（掠火派生）' },
    { moveId: '1641003', label: '普通攻击：裁生·第三段' },
    { moveId: '1641004', label: '普通攻击：裁生·第四段' },
  ]
  for (const seg of segmentRows) {
    const n = basicPlan.counts[seg.moveId] ?? 0
    if (n <= 0) continue
    const meta = seg.moveId === '1641003'
      ? cfg.phoenixBasicCycle?.find(s => s.moveId === '1641003')
      : seg.moveId === '1641004'
        ? cfg.phoenixBasicCycle?.find(s => s.moveId === '1641004')
        : seg.moveId === PHOENIX_BRANCH_MOVE_ID ? cfg.phoenixMeltMeta : cfg.phoenixSlashMeta
    if (!meta || meta.actionTime <= 0) continue
    executions.push(moduleExecRow({
      moveId: seg.moveId,
      moveName: seg.label,
      category: 'basic',
      element: 'fire',
      count: n,
      actionTime: meta.actionTime,
      totalTime: n * meta.actionTime,
      // 段行与聚合行同桶（'basic'）：它们本来就是平A池里的时间，前台归属/截断/留白口径必须一致
      timeBucket: 'basic',
      ...RECOVERY_OFF,
    }))
  }
  // 掠火是普通特殊技（0 能量）：段行只记时间与伤害，不记账能量消耗
  carveBasicPool(executions, basicPlan.usedTime)

  const chargedMeta = cfg.phoenixChargedMeta
  if (chargedMeta && chargedCount > 0) {
    executions.push(moduleExecRow({
      moveId: chargedMeta.moveId,
      moveName: '普通攻击：焚罪（消耗90燔焰）',
      category: 'basic',
      element: 'fire',
      count: chargedCount,
      actionTime: chargedMeta.actionTime,
      totalTime: chargedCount * chargedMeta.actionTime,
      skillTableNote: `燔焰驱动 ×${chargedCount}（90 点/次）`,
    }))
  }
  // 坠阳（1641009）：[枯荣] 下眩焰之后每轮一次，40 能量；+1 升变
  const exSecondMeta = cfg.phoenixExSecondMeta
  if (exSecondMeta && exCount > 0) {
    executions.push(moduleExecRow({
      moveId: exSecondMeta.moveId,
      moveName: '强化特殊技：坠阳',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: exSecondMeta.actionTime,
      totalTime: exCount * exSecondMeta.actionTime,
      energyConsume: exSecondMeta.energyCost,
      totalEnergyConsume: exCount * exSecondMeta.energyCost,
      skillTableNote: `[枯荣]下每轮眩焰后发动 ×${exCount}（40 能量/次，获得 1 点[升变]）`,
    }))
  }
  // 燎斩（1641023）：消耗 1 点[升变]，不耗能
  const liaozhanMeta = cfg.phoenixLiaozhanMeta
  if (liaozhanMeta && exCount > 0) {
    executions.push(moduleExecRow({
      moveId: liaozhanMeta.moveId,
      moveName: '强化特殊技：燎斩',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: liaozhanMeta.actionTime,
      totalTime: exCount * liaozhanMeta.actionTime,
      skillTableNote: `消耗[升变] ×${exCount}（坠阳产出 1 点/轮，不耗能量）`,
    }))
  }
  // 烬火追魂（1641019）：[生竭] → 下一次换入前场发动，计数 = 终结次数；收尾追加攻击不占前台时间
  const entryMeta = cfg.phoenixEntryMeta
  if (entryMeta && ultCount > 0) {
    executions.push(moduleExecRow({
      moveId: entryMeta.moveId,
      moveName: '烬火追魂（终结后换入发动）',
      category: 'chain',
      element: 'fire',
      count: ultCount,
      actionTime: entryMeta.actionTime,
      skillTableNote: `[生竭]后换入发动 ×${ultCount}（计数=终结次数；收尾追加攻击不占前台时间）`,
    }))
  }
}

/**
 * 必做前台时间：通用强特（眩焰）+ 坠阳 + 燎斩 + 焚罪。
 *
 * ⚠ **不含平A段行**（a3/a4/掠火/熔毁）：它们是**从平A池时长解出来**的（`planPhoenixBasic` 按
 * `state.basicAttackTime` 算次数），占的就是池里那份时间 ⇒ 进 necessary 会与池重复计费。
 * 先例：希格莉德「出枪式段占平A池时间不进必要时间」（`sigrid.ts#sigridExSpecialTime`）。
 */
function phoenixExSpecialTime({ cfg, exSpecialCount, state }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const exTime = Math.max(0, exSpecialCount) * cfg.exSpecialActionTime
  const chargedMeta = cfg.phoenixChargedMeta
  // 焚罪次数要用段计划（燔焰收入 → 焚罪），而段计划要 basicAttackTime；外部直调没有 state 时退化为 0 次焚罪
  const chargedCount = state
    ? whole(phoenixChargedCount(cfg, state, []))
    : whole(Number(cfg.phoenixChargedCount ?? 0))
  const chargedTime = chargedMeta ? chargedCount * chargedMeta.actionTime : 0
  const exSecond = cfg.phoenixExSecondMeta
  const liaozhan = cfg.phoenixLiaozhanMeta
  const exSecondTime = exSecond ? Math.max(0, exSpecialCount) * exSecond.actionTime : 0
  const liaozhanTime = liaozhan ? Math.max(0, exSpecialCount) * liaozhan.actionTime : 0
  return {
    necessaryTime: exTime + chargedTime + exSecondTime + liaozhanTime,
    comboAlignTime: exTime * cfg.exSpecialComboAlignRatio,
  }
}

/**
 * 事件层：
 * ① 异放（焚罪/烬火追魂终结一击，固定 releaseMultiplier，附异常暴击参数 releaseCrit）
 * ② 影画4：上述两者各**额外触发一次异放 600%**
 * ③ [灼蚀] DoT：每 8 秒 50% 攻击力火伤（direct_damage，视为强化特殊技伤害）
 */
function buildPhoenixAnomalyEvents({ cfg, events, totalTime }: AgentEventInput): void {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const s = phoenixSkillLevel(cinema)
  const coverage = clampRatio(setting(cfg, 'phoenix.releaseCoverage'))
  const chargedCount = whole(Number(cfg.phoenixChargedCount ?? 0))
  const entryCount = whole(Number(cfg.phoenixEntryCount ?? 0))
  const mastery = Number(cfg.phoenixInitialMastery ?? 0)
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  const crit = computePhoenixScorchCrit({ initialMastery: mastery, additionalActive, cinemaLevel: cinema })

  if (coverage > 0 && chargedCount > 0) {
    const chargedRelease = Math.round(chargedCount * coverage)
    if (chargedRelease > 0) {
      const mult = PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (s - 1)
      events.push({
        eventId: 'phoenix_charged_release',
        eventName: '焚罪终结一击·异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
        carrierMoveName: '普通攻击：焚罪（终结一击）',
        followCarrierInStun: true,
        count: chargedRelease,
        ...releaseCritOf(crit, mastery),
        formula: `releaseMultiplier=${mult}（225+20×(${s}-1)，固定倍率）+ 暴击时暴伤额外+${PHOENIX_RELEASE_CRIT_EXTRA_DMG}`,
        fields: [`releaseMultiplier=${mult}`, `charged=${chargedCount}`, `coverage=${coverage}`],
        note: '终结一击命中属性异常状态敌人触发；异放暴击时暴伤额外 +40%（异常暴击参数见 spec teamBuffs）。',
      })
    }
    if (cinema >= 4) {
      const c4Count = Math.round(chargedCount * coverage)
      if (c4Count > 0) {
        events.push({
          eventId: 'phoenix_c4_charged_release',
          eventName: '影画4·焚罪额外异放',
          eventType: 'release',
          element: 'dominant',
          carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
          carrierMoveName: '普通攻击：焚罪（终结一击）',
          followCarrierInStun: true,
          count: c4Count,
          formula: `releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}（固定倍率）`,
          fields: [`releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}`, `charged=${chargedCount}`],
          note: '影画4：焚罪终结一击命中异常状态敌人时额外触发一次异放，固定 600%。',
        })
      }
    }
  }
  if (coverage > 0 && entryCount > 0) {
    const entryRelease = Math.round(entryCount * coverage)
    if (entryRelease > 0) {
      const mult = PHOENIX_RELEASE_BASE.entry + PHOENIX_RELEASE_BASE.entryPerLevel * (s - 1)
      events.push({
        eventId: 'phoenix_entry_release',
        eventName: '烬火追魂终结一击·异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_ENTRY_MOVE_ID,
        carrierMoveName: '烬火追魂（终结一击）',
        followCarrierInStun: true,
        count: entryRelease,
        ...releaseCritOf(crit, mastery),
        formula: `releaseMultiplier=${mult}（300+27×(${s}-1)，固定倍率）+ 暴击时暴伤额外+${PHOENIX_RELEASE_CRIT_EXTRA_DMG}`,
        fields: [`releaseMultiplier=${mult}`, `entry=${entryCount}`, `coverage=${coverage}`],
        note: '烬火追魂终结一击命中属性异常状态敌人触发；异放暴击时暴伤额外 +40%。',
      })
    }
    if (cinema >= 4) {
      const c4Count = Math.round(entryCount * coverage)
      if (c4Count > 0) {
        events.push({
          eventId: 'phoenix_c4_entry_release',
          eventName: '影画4·烬火追魂额外异放',
          eventType: 'release',
          element: 'dominant',
          carrierMoveId: PHOENIX_ENTRY_MOVE_ID,
          carrierMoveName: '烬火追魂（终结一击）',
          followCarrierInStun: true,
          count: c4Count,
          formula: `releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}（固定倍率）`,
          fields: [`releaseMultiplier=${PHOENIX_C4_RELEASE_MULT}`, `entry=${entryCount}`],
          note: '影画4：烬火追魂终结一击命中异常状态敌人时额外触发一次异放，固定 600%。',
        })
      }
    }
  }
  // ③ [灼蚀] 每 8 秒 50% 攻击力火伤（视为强化特殊技伤害）
  const scorchCoverage = clampRatio(setting(cfg, 'phoenix.scorchCoverage'))
  const effectiveSeconds = minusInvincibleTime(totalTime, cfg)
  const ticks = Math.max(0, Math.floor((effectiveSeconds * scorchCoverage) / PHOENIX_SCORCH_DOT_INTERVAL))
  if (ticks > 0) {
    events.push({
      eventId: 'phoenix_scorch_dot',
      eventName: '[灼蚀]周期火伤',
      eventType: 'direct_damage',
      element: 'fire',
      carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
      carrierMoveName: '[灼蚀]',
      count: ticks,
      damageMultiplier: PHOENIX_SCORCH_DOT_RATIO,
      // 原文「该伤害视为[强化特殊技]伤害」⇒ 吃强化特殊技定向 buff（增伤/暴伤/减防的 __exSpecial 通道）
      skillDamageTarget: 'exSpecial',
      formula: `每 ${PHOENIX_SCORCH_DOT_INTERVAL}s 造成 ${PHOENIX_SCORCH_DOT_RATIO}% 攻击力火属性伤害；次数 = floor(战斗时长 × 覆盖率 / ${PHOENIX_SCORCH_DOT_INTERVAL})`,
      fields: ['totalTime', 'phoenix.scorchCoverage', 'PHOENIX_SCORCH_DOT_INTERVAL', 'PHOENIX_SCORCH_DOT_RATIO'],
      note: `[灼蚀] 敌人每 8 秒受到菲欧妮 50% 攻击力火伤（视为强化特殊技伤害）；次数按 ${effectiveSeconds.toFixed(1)}s（已扣无敌）× ${(scorchCoverage * 100).toFixed(0)}% 近似。异常暴击 率${crit.rate.toFixed(1)}%/伤${crit.dmg}% 由 spec teamBuffs 承载。`,
    })
  }
}

function buildPhoenixResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const cinema = cinemaLevelOf(cfg.phoenixCinemaLevel)
  const basicPlan = phoenixBasicPlanOf(cfg, state)
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  const crit = computePhoenixScorchCrit({
    initialMastery: Number(cfg.phoenixInitialMastery ?? 0),
    additionalActive,
    cinemaLevel: cinema,
  })
  return {
    phoenixCycle: {
      cinemaLevel: cinema,
      additionalActive,
      coreProficiency: PHOENIX_CORE_PROFICIENCY,
      scorchCritRate: Math.round(crit.rate * 100) / 100,
      scorchCritDmg: crit.dmg,
      scorchDmgBonus: cinema >= 2 ? PHOENIX_C2_SCORCH_DMG_BONUS : 0,
      scorchDotCount: 0,
      emberCap: PHOENIX_EMBER_CAP,
      chargedCount: whole(Number(cfg.phoenixChargedCount ?? 0)),
      exCount: whole(Number(cfg.phoenixExCount ?? 0)),
      liaozhanCount: whole(Number(cfg.phoenixExCount ?? 0)),
      entryCount: whole(Number(cfg.phoenixEntryCount ?? 0)),
      c1CritDmg: cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0,
      c2ScorchDmgBonus: cinema >= 2 ? PHOENIX_C2_SCORCH_DMG_BONUS : 0,
      c4ReleaseMult: cinema >= 4 ? PHOENIX_C4_RELEASE_MULT : 0,
      c6ResIgnore: cinema >= 6 ? PHOENIX_C6_RES_IGNORE : 0,
      c6ReleaseDefIgnore: cinema >= 6 ? PHOENIX_C6_RELEASE_DEF_IGNORE : 0,
      a34FreePairs: basicPlan.freePairs,
      a34PaidRounds: basicPlan.paidRounds,
      a34PerfectRounds: basicPlan.perfectRounds,
      basicThird: basicPlan.third,
      basicFourth: basicPlan.fourth,
      slashCount: basicPlan.counts[PHOENIX_SLASH_MOVE_ID] ?? 0,
      meltCount: basicPlan.counts[PHOENIX_BRANCH_MOVE_ID] ?? 0,
      note: '[灼蚀] 异常暴击承载 = spec teamBuffs（含队友受益）；[生竭]/[重明] 状态机未建模（回血无乘区）；[枯荣] 按稳态循环（眩焰→坠阳→燎斩）；平A按段计划（a3/a4 循环 + 掠火起手，名额=可衔接第三段的招式次数）。',
    },
  }
}

function buildPhoenixResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.phoenixCycle
  if (!cycle) return []
  return [{
    id: 'phoenix-cycle',
    title: '菲欧妮·灼蚀与燔焰',
    summary: `异常精通 +${cycle.coreProficiency} · [灼蚀] 暴击 率${cycle.scorchCritRate}%/伤${cycle.scorchCritDmg}% · 焚罪 ×${cycle.chargedCount} · 燎斩 ×${cycle.liaozhanCount}`,
    rows: [
      { label: '核心异常精通', value: `+${cycle.coreProficiency}`, detail: '计入面板' },
      { label: '[灼蚀] 异常暴击率', value: `${cycle.scorchCritRate}%`, detail: '30 + 0.7×(初始掌控−155)，255 封顶' },
      { label: '[灼蚀] 异常暴伤', value: `${cycle.scorchCritDmg}%`, detail: `25${cycle.additionalActive ? ' +额外能力15' : ''}${cycle.c1CritDmg > 0 ? ' +影画1 25' : ''}` },
      { label: '[灼蚀] 周期火伤', value: '8s/次 · 50%', detail: '视为强化特殊技伤害' },
      { label: '影画2目标增伤', value: `+${cycle.scorchDmgBonus}%`, detail: '对[灼蚀]敌人' },
      { label: '影画4额外异放', value: `${cycle.c4ReleaseMult}%`, detail: '焚罪/烬火追魂各一次' },
      { label: '影画6无视抗性', value: `+${cycle.c6ResIgnore}%`, detail: '全属性伤害抗性' },
      { label: '影画6异放无视防御', value: `+${cycle.c6ReleaseDefIgnore}%`, detail: '异放限定' },
      { label: '平A循环', value: `a34×${cycle.a34FreePairs + cycle.a34PaidRounds}`, detail: `免费名额 ${cycle.a34FreePairs} 对（强特/连携/终结/闪反/快支/支援突击）+ 掠火起手 ${cycle.a34PaidRounds} 轮` },
      { label: '平A段命中', value: `a3 ×${cycle.basicThird} · a4 ×${cycle.basicFourth}`, detail: '三段一循环：所有平A落在第三/四段' },
      { label: '掠火 / 熔毁', value: `×${cycle.slashCount} / ×${cycle.meltCount}`, detail: `掠火 0 能量起手；完美格挡 ${cycle.a34PerfectRounds} 轮跳过熔毁直入第三段` },
      { label: '焚罪次数', value: `×${cycle.chargedCount}`, detail: '燔焰收入/90' },
      { label: '燎斩次数', value: `×${cycle.liaozhanCount}`, detail: '[升变]驱动（=眩焰次数）' },
      { label: '烬火追魂次数', value: `×${cycle.entryCount}`, detail: '=终结次数' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'phoenix.chargedAttackCount',
    label: '菲欧妮·焚罪次数上限',
    description: '[普通攻击：焚罪]（消耗 90 燔焰）整局次数的**上限**。次数自动 = 燃烧攻击行 attack_data_0 燔焰收入 × 影画1效率1.15 ÷ 90；调低 = 你手动吞掉一部分。0 = 不设上限。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'phoenix.releaseCoverage',
    label: '菲欧妮·异放触发覆盖率',
    description: '焚罪/烬火追魂终结一击命中「属性异常状态敌人」的占比（异常队默认满覆盖）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'phoenix.scorchCoverage',
    label: '菲欧妮·[灼蚀]覆盖率',
    description: '[灼蚀]（20 秒，队伍任意角色造成属性异常伤害时施加）的整局覆盖率——[灼蚀]周期火伤（每 8 秒 50% 攻击力）按此折算。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const phoenixMechanic: AgentMechanicModule = {
  id: 'agent:phoenix',
  agentIds: [PHOENIX_ID],
  name: '菲欧妮·涅槃',
  description: 'v12：核心异常精通+85、[灼蚀] 异常暴击（率30+0.7×(初始掌控−155) 封顶255、伤25）+额外能力暴伤+15、[灼蚀]周期火伤（8s/50%攻击力）；异放（焚罪445/烬火追魂597，暴击再+40暴伤）+影画4 额外600%；[燔焰]120→焚罪90、[升变]→燎斩、[枯荣] 眩焰→坠阳→燎斩稳态；影画6 无视15%抗性+异放无视40%防御。',
  applyPanel: applyPhoenixPanel,
  /**
   * 主页交互栏「完美格挡」输入框（用户裁决 2026-10-22：「可以，毕竟他有交互收益」）。
   *
   * 该机制此前**实现存在但用户填不到**：`phoenixEmberIncome` 读 `cfg.perfectBlockCount`，
   * 但全仓只有佩洛伊斯（`specPanelBuffs.ts`）声明过这个输入框 ⇒ 菲欧妮页面无入口。
   *
   * 难度侧两件事都由既有通道自动成立，**不新增代码**：
   * - 需 boss 出手 ⇒ `teamCompare#BOSS_ATTACK_INTERACTIONS` 已含 `perfectBlock` ⇒ 吃非失衡占比修正；
   * - CD 上限 ⇒ 由 `phoenixEmberIncome` 按 `floor(有效战斗时间/10s)` 钳（不在难度侧重复建模）。
   */
  characterCountInputs: [
    {
      field: 'perfectBlockCount',
      label: '完美格挡',
      title: '强化特殊技触发完美格挡的次数：每次回复燔焰 5 点，**10 秒最多一次**——引擎按 floor(有效战斗时间/10s) 钳上限（boss 无敌时间已扣）。'
        + '这个交互需要 boss 出手，所以在队伍对比/难度曲线里吃「非失衡占比」修正（失衡期怪物不攻击，能凑的次数更少）。',
    },
  ],
  buildCharConfig: buildPhoenixCharConfig,
  estimateExSpecialTime: phoenixExSpecialTime,
  buildExecutions: buildPhoenixExecutions,
  /**
   * 平A聚合行降级为**时间 + 回能载体**（用户口径 2026-10-22）：伤害/失衡/异常积蓄已由段行（a3/a4 + 掠火/熔毁）
   * 逐段承载，聚合行再按「第 3 段秒均 × 时间」结算就是同一段时间记两份。
   * 时间侧已由 buildExecutions 的 carveBasicPool 挤出段行时长；这里只归零三个倍率通道，
   * 回能（energy/decibel total）保持原值——平A回能按整段时长记在池上（carveBasicPool 头注同口径）。
   */
  patchExecutions: ({ executions }: AgentResourceInput) => {
    for (const exec of executions) {
      if (exec.moveId !== 'basic_attack') continue
      exec.damageMultiplier = 0
      exec.damageMultiplierOverride = true
      exec.dazeMultiplier = 0
      exec.dazeMultiplierOverride = true
      exec.anomalyBuildUp = 0
      exec.anomalyBuildUpOverride = true
      exec.skillTableNote = '平A按段计划物化（a3/a4 循环 + 掠火起手轮）：本行只承载时间与回能，伤害/失衡/积蓄见段行'
    }
  },
  buildAnomalyEvents: buildPhoenixAnomalyEvents,
  buildResourceResult: buildPhoenixResourceResult,
  resourceSections: buildPhoenixResourceSections,
  releaseModifier: phoenixReleaseModifier,
  /**
   * 影画2：「菲欧妮对敌人施加[灼烧]效果时，该效果的持续时间提升2秒」。
   *
   * 走引擎通用臂 `teamAnomalyDurationBonus`（柏妮思 火+3 / 丽娜 电+3 / 简 物理+5 同款，**加算**）。
   * 影响乱流/紊乱窗口与持续单属性覆盖——按你的口径这是经典字段，不该省。
   */
  teamAnomalyDurationBonus: ({ element, slot, team }) => {
    // `MechanicTeamMember.cinemaLevel` 已归一化（非空槽恒有值）⇒ 直接比较，不走 cinemaLevelOf、也不写 `?? 0`
    const member = team.find(m => m.slot === slot)
    if (!member || member.cinemaLevel < 2) return 0
    return element === 'fire' ? PHOENIX_C2_BURN_DURATION_BONUS : 0
  },
  /**
   * **烬火追魂（`1641019`）不扣喧响**：原文首句「当菲欧妮处于[生竭]状态时，下一次普通换入/
   * 快速支援/招架支援换入前场时发动」——触发条件是**状态+换入**，没有「喧响等级达到[极]」购买句
   * ⇒ 它不由喧响购买。父块 `1641013`（终结技）与它同在执行行池里且父块照收 3000。
   * 只免喧响，不免窗口时间。
   */
  axisMoveFreeOfDecibel: moveId => moveId === PHOENIX_ENTRY_MOVE_ID,
  settings,
}


/** 招式元数据（buildCharConfig 从 catalog 预存） */
interface PhoenixMoveMeta { moveId: string; actionTime: number; damage: number; decibelRecovery: number; energyCost: number }

/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 菲尼克斯命座等级（buildCharConfig 写） */
    phoenixCinemaLevel?: number
    /** 菲尼克斯**初始**异常掌控（buildCharConfig 由局外面板预存；[灼蚀] 暴击公式读它） */
    phoenixInitialMastery?: number
    /** 菲尼克斯燃烧攻击燔焰获取（moveId → 每次命中燔焰，attack_data_0 列） */
    phoenixCombustionMeta?: Record<string, number>
    /** 菲尼克斯掠火（普通特殊技 1641007）招式元数据 */
    phoenixSlashMeta?: PhoenixMoveMeta
    /** 菲尼克斯熔毁（掠火派生分支 1641006）招式元数据 */
    phoenixMeltMeta?: PhoenixMoveMeta
    /** 菲尼克斯平A各段元数据（buildCharConfig 从 catalog 预存） */
    phoenixBasicCycle?: PhoenixMoveMeta[]
    /** 菲尼克斯焚罪（长按普攻）招式元数据 */
    phoenixChargedMeta?: PhoenixMoveMeta
    /** 菲尼克斯坠阳（强特第二段）招式元数据 */
    phoenixExSecondMeta?: PhoenixMoveMeta
    /** 菲尼克斯燎斩（升变消耗）招式元数据 */
    phoenixLiaozhanMeta?: PhoenixMoveMeta
    /** 菲尼克斯烬火追魂（终结后换入）招式元数据 */
    phoenixEntryMeta?: PhoenixMoveMeta
    /** 菲尼克斯焚罪次数（资源阶段写） */
    phoenixChargedCount?: number
    /** 菲尼克斯眩焰次数（资源阶段写） */
    phoenixExCount?: number
    /** 菲尼克斯烬火追魂次数（资源阶段写 = 终结次数） */
    phoenixEntryCount?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['phoenix_cycle']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 不死鸟循环明细 */
    phoenixCycle?: PhoenixCycle
  }
}
