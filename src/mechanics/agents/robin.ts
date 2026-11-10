import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentNextRoundFeedbackInput,
  AgentPanelInput,
  AgentResourceInput,
  AgentTeamConfigInput,
  AgentTeamPanelEffectInput,
  AgentResourceSectionsInput,
  ModuleFeedback,
} from '../types'
import { collectTeamMaimCount } from '@/mechanics/gashMaim'
import { getRowValue } from '@/data/moveTableQueries'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { outOfCombatStat } from '@/mechanics/initialStat'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { panelOfSlot } from '@/core/sourcePanels'
import { applyStat } from '@/core/buff'
import { mechanicSettingPanelReader } from '@/utils/mechanicSettingCfg'
import { fmt } from '@/utils/format'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'

/**
 * 知更鸟（1661·防护/以太）——测试服角色（`Test1` 占位包起；**3.4.3+20278274** 重录＝整批更名 + 额外能力/终结技改口径），2026-10-25 第三刀。
 *
 * ## 本文档覆盖的两个机制（原文出处都在 spec 1661.json）
 *
 * ### ① 幕后协奏·全队防御（原文「特殊技：万籁与我同歌」条目）——**伤害项，不是生存项**
 * > 「[幕后协奏]状态期间全队角色获得防御力提升，知更鸟初始最大生命值大于16000时，每多拥有1000点
 * >  生命值获得{CAL:44+AvatarSkillLevel(1)*3}点防御，最高不超过{CAL:440+AvatarSkillLevel(1)*30}点，
 * >  该效果在知更鸟结束[幕后协奏]状态后仍保留15秒。」
 *
 * 落点 = **全队固定防御**（inCombatDefFlat）——锋御以防御力作伤害基底（core/damage.ts 的
 * SHARPEN_DAMAGE_PROFILE.calcBasisValue = panel.def），所以这一条是实打实的伤害项。
 * 读取源 = **知更鸟自己的源面板局外生命**（panelOfSlot(sourcePanels, slot, 'outOfCombat')，
 * 「初始最大生命值」= 局外口径），不读队友面板、不读已叠过局内 buff 的 panel。
 * 数值：Lv12 ⇒ 每满 1000 点 +80、上限 800、门槛 16000；拥有[重音节拍]时**提升效果与上限各 +25%**。
 *
 * ### ② 星耀值 / 重音节拍循环（原文核心被动 Lv.7 + 特殊技·弦歌相和）
 * > 「[幕后协奏]状态下，知更鸟发动追加攻击可以获得[星耀值]，[星耀值]最多可以拥有140点；
 * >  当[星耀值]大于等于120点时…消耗120点[星耀值]发动[登场技：星耀时刻]…
 * >  发动[登场技：星耀时刻]时，知更鸟获得1点[重音节拍]，[重音节拍]最多持有1点」
 * > 「[特殊技：弦歌相和]为追加攻击，**每10秒最多可以发动一次**…发动时获得20点[星耀值]」
 *
 * 循环：追加攻击 floor(有效战斗时间 / 10) 次 → 每次 +20 → 同时上限 140 ⇒
 * 登场技次数 = floor(星耀值总量 / 120)（见 solveRobinEntry；140 对 20/120 这组整数不咬合）。
 * 登场技本体 = moveId 1661011（1.6s，**快速支援**语义），获得 重音节拍 ⇒ 下一次进幕后协奏时
 * 把防御提升再 ×1.25（ROBIN_BUFF_POINT_DEF_MULT）。
 *
 * ## 近似（有意，逐条写明）
 * - **满覆盖近似**：幕后协奏 80s / 追加攻击 10s CD / 护盾 15s 全不建状态机——追加攻击按 floor(t/10) 满打，
 *   防御提升按常驻上屏（原文「结束后仍保留 15 秒」⇒ 80s 守护 + 15s 尾巴，覆盖率本就近 1）。
 * - **重音节拍按满覆盖**：登场技每次 +1、进幕后协奏必消耗 1（上限 1）⇒ 循环稳态恒有 ⇒ ×1.25 常驻。
 * - 护盾量（3.4.3：万籁与我同歌 2% / 弦歌相和 4% / 震律齐鸣 8% 生命）、抗打断、无敌**不建**（生存面）。
 * - **核心被动「全队每触发一次毁伤，知更鸟固定回复 15 点能量」已建模**（2026-11-08 批 4）：
 *   次数 = `gashMaim#collectTeamMaimCount`（全队各锋御槽 `maimCount` 之和），
 *   经 `ModuleFeedback.robinTeamMaimCount` 跨轮传递、converge 相位写 `cfg.robinTeamMaimCount`，
 *   走 `bonusEnergy`（**固定**回能，不进百分比/效率乘区）。判据 `robinMaimEnergy.test.ts`。
 * - **震律齐鸣 1661006 是后台招式**（`timeBucket: 'backstage'`、不占前台时间）。
 *   依据是**原文 + 用户裁决**，不是 catalog 里的 `actionTime = 0`：
 *   原文末尾「[强化特殊技：震律齐鸣]**为追加攻击**」——它由弦歌相和升级触发，不是玩家主动做的
 *   前台动作；用户 2026-11-09 补充「前台基本只有那个特殊资源槽满了才会做的强制动作，
 *   耀嘉音他们的强特也是后台的，**不耗时但是能打**」。
 *   ⚠ **`actionTime = 0` 不能当作后台判据**：全库 152 个强化特殊技里 10 个是 0/缺省，
 *   里面混着子段（`#2` / `·额外爆炸`，时长记在父行上）与整招未录时长两类，性质不同。
 * - **40 点能量是「次数上限」而非「先扣池再算次数」**：`floor(总能量/40)` 已隐含扣减
 *   （14 次 × 40 = 560 ≤ 能量 563.8）。她 `exSpecialEnergyConsume = 0`
 *   （catalog 1661006 无 `energyCost` ⇒ 引擎按 `costType='free'`，通用强特通道**不产行**，
 *   与模块自造行无双计风险），且[防护]的她能量没有第二个去处 ⇒ 无回压对象、无不动点。
 *   该笔消耗在行上 `totalEnergyConsume` 如实记账（资源卡可见），不是丢失。
 * - **3.4.3 终结技「全队[锋御]角色固定回复 20 点锐能」已建模**（2026-11-08 批 2）：走 postRound 相位
 *   （`convergence.ts:834` 起派发，带**上一轮**收敛的 `ultimateCounts`），读**自己槽**的次数
 *   写到每个 `specialty === 'sharpen'` 队友的 `cfg.sharpnessGiftFromTeam`（她自己不写、无锋御队零写），
 *   锋御模块把它作为一条 `gifts` 喂 `mechanics/sharpnessIncome`（批 1 抽出的单一事实源）。
 *   实测：知更鸟 3 次终结技 ⇒ 克拉蕾锐能总量 80 → 140（+60）。判据 `robinSharpnessGift.test.ts` +
 *   `robinSharpnessGiftPipeline.test.ts`（真管线）。
 *
 * ## 滑块
 * robin.buffPointActive（开关，缺省 1）：重音节拍是否常驻。0 = 白板幕后协奏（判据负控）。
 */
const ROBIN_AGENT_ID = '1661'

/** 幕后协奏·防御：门槛（知更鸟**初始最大生命值**，低于它整条不生效） */
export const ROBIN_DEF_HP_THRESHOLD = 16000
/** 幕后协奏·防御：每满多少点生命值加一档 */
export const ROBIN_DEF_HP_PER_STEP = 1000
/** 幕后协奏·防御：每档基础值 = 44 + 3 × 技能等级（Lv12 = 80） */
export const ROBIN_DEF_PER_STEP_BASE = 44
export const ROBIN_DEF_PER_STEP_PER_LEVEL = 3
/** 幕后协奏·防御：基础上限 = 440 + 30 × 技能等级（Lv12 = 800） */
export const ROBIN_DEF_CAP_BASE = 440
export const ROBIN_DEF_CAP_PER_LEVEL = 30
/**
 * 终结技「星辰协奏曲」：**全队[锋御]角色固定回复 20 点[锐能]**（3.4.3+20278274 新增句）。
 *
 * 原文：「队伍中所有[锋御]角色固定回复 20 点[锐能]」。
 * 落点 = 每个 `specialty === 'sharpen'` 队友的 `cfg.sharpnessGiftFromTeam`（知更鸟自己不写），
 * 由锋御模块作为一条 `gifts` 传给 `mechanics/sharpnessIncome`（见 `applyRobinSharpnessGift`）。
 *
 * @fact agent:1661/终结技·锋御锐能给养 口径: 知更鸟终结技每次给**全队每个[锋御]**固定 20 点锐能（不是按槽数叠加、不含她自己）；落点 = 锋御模块 cfg.sharpnessGiftFromTeam，postRound 相位按上一轮她自己终结次数×20 绝对写入 | 据 用户@2026-11-08「知更鸟终结技『全队[锋御]固定回复 20 点锐能』目前未建模」直给数值·复核@2026-11-08 | 验 src/mechanics/__tests__/robinSharpnessGift.test.ts | 锚 src/mechanics/agents/robin.ts#applyRobinSharpnessGift | 信 确认
 * ⟳复核: 若终结技行 1661010 的锐能句改数值（或改为「每次命中」/按层数），或[锋御]职业新增非锐能语义的角色，则本常量与 specialty 判据都要重核 | 到期 2027-09-30
 */
export const ROBIN_ULT_TEAM_SHARPNESS = 20
/**
 * 核心被动（3.4.3+20278274）：「全队角色每触发一次[毁伤]，知更鸟固定回复 15 点能量」。
 *
 * 落点 = `bonusEnergy`（固定回能，不进百分比/效率乘区——原文说「**固定**回复」）。
 * 次数来源 = `gashMaim#collectTeamMaimCount`（全队各锋御槽的 `maimCount` 之和），
 * 经跨轮通道 `ModuleFeedback` 转一圈（毁伤次数是本轮资源解的产物，当轮拿不到）。
 *
 * @fact agent:1661/每毁伤回能 口径: 全队每触发一次[毁伤] ⇒ 知更鸟固定回 15 点能量（固定值、不进回能百分比/效率乘区）；次数 = 全队各锋御槽 maimCount 之和（克拉蕾含影画6 不耗层的额外毁伤） | 据 用户@2026-11-08「角色机制哪有不做的道理」+ spec 1661 核心被动原文·复核@2026-11-08 | 验 src/mechanics/__tests__/robinMaimEnergy.test.ts | 锚 src/mechanics/agents/robin.ts#ROBIN_MAIM_ENERGY_PER_TRIGGER | 信 确认
 * ⟳复核: 若原文改数值（15 → N）/改成「按次命中」或「按层数」口径，或新增非锋御的毁伤来源（计数就不该只扫 maimCount），则本常量与 collectTeamMaimCount 的扫描面都要重核 | 到期 2027-09-30
 */
export const ROBIN_MAIM_ENERGY_PER_TRIGGER = 15
/** [重音节拍]：使防御提升效果**及其上限**额外提升 25%（原文核心被动 Lv.7 末段） */
export const ROBIN_BUFF_POINT_DEF_MULT = 1.25
/**
 * 追加攻击 CD（秒）：原文「[特殊技：弦歌相和]为追加攻击，**每10秒最多可以发动一次**」。
 * ⚠ 2026-10-30 随 nanoka 3.4.1+19997538 热更由 **8 → 10**（同批：幕后协奏 60s → 80s、
 *   追加攻击护盾 3% → 4%、震律齐鸣「按最大生命值」系数 0.214+0.028×Lv → 0.256+0.052×Lv、
 *   终结技护盾→生命转化 40% → 50%、[反制支援]成功额外 +1 [重音节拍]）。CD 是**唯一进产行次数**的那条。
 */
export const ROBIN_AFTERSHOCK_CD_SECONDS = 10
/** 每次追加攻击获得的[星耀值] */
export const ROBIN_ENTRY_PER_AFTERSHOCK = 20
/**
 * 额外能力（3.4.3）：进入战场时获得的喧响值（堪域 600s 内一次 ⇒ 每局一次）。
 * 数值 = **一次终结技的单价**（原文 3000 = `ULTIMATE_COST_DEFAULT`，数据层单一来源；
 * 字面量手抄会被 `handCopiedConstants` 的源码锁拦下）。
 */
export const ROBIN_ADDITIONAL_DECIBEL_GIFT = ULTIMATE_COST_DEFAULT
/** [星耀值]上限（v2 3.4.2+20049556：120 → 140，用户 2026-11-01 裁决取核心被动口径） */
export const ROBIN_ENTRY_MAX = 140
/** 触发[登场技]所需[星耀值]（也是每次消耗量；v2：100 → 120） */
export const ROBIN_ENTRY_COST = 120
/** 震律齐鸣：能量门槛 / 单次耗能（原文「若能量大于等于40点则升级为[强化特殊技：震律齐鸣]：持续消耗总计40点能量」） */
export const ROBIN_REINFORCED_ENERGY_COST = 40
/** 影画4：能量不足时也可升级为震律齐鸣，每 60 秒最多一次 */
export const ROBIN_C4_GUARANTEE_CD_SECONDS = 60
/** 震律齐鸣「根据最大生命值额外提升重击的伤害」系数：CAL 0.44 + 0.08×技能等级（Lv12 = 1.4 = 140%） */
export const ROBIN_REINFORCED_HP_RATE_BASE = 0.44
export const ROBIN_REINFORCED_HP_RATE_PER_LEVEL = 0.08
/** 影画6：上述生命值系数提升为原本的 200% */
export const ROBIN_C6_HP_RATE_MULT = 2
/**
 * 额外能力（**3.4.3+20278274** 新文本）：「全队[击破]角色攻击力提升 **80 点**，该效果随知更鸟等级提升，
 * 每级增加 12 点，最多提升{CAL:80+60*12}点」。
 *
 * v2 文本是「全队[击破]角色攻击力提升 800 点」的**定值**（v2 期间这条根本没进伤害账，spec 只登记了门控）；
 * 3.4.3 改成按等级成长的上限式——满级 60 级 = 80 + 12×60 = 800，与本仓库一律按 60 级结算的口径一致。
 * 落点 = inCombat 攻击力固定值（atkFlat），只写[击破]槽位（见 applyRobinTeamPanelEffects）。
 */
export const ROBIN_ADDITIONAL_STUN_ATK_BASE = 80
export const ROBIN_ADDITIONAL_STUN_ATK_PER_LEVEL = 12
export const ROBIN_ADDITIONAL_STUN_ATK_CAP = 800

/** [击破]队友的攻击力固定加成（满级 60 级口径） */
export function robinStunAtkBonus(level = 60): number {
  return Math.min(ROBIN_ADDITIONAL_STUN_ATK_CAP, ROBIN_ADDITIONAL_STUN_ATK_BASE + ROBIN_ADDITIONAL_STUN_ATK_PER_LEVEL * level)
}

/** 面板钩子侧的设置读口（默认值只来自 settings 声明；CC-508） */
const robinSetting = mechanicSettingPanelReader(() => robinMechanic.settings)

/** 技能等级基数：与 buff 公式通道 dynamicSkillLevel 同口径（12 + skillLevelBonus；此处取 12） */
const SKILL_LEVEL = 12

/**
 * 幕后协奏·防御提升量（纯函数；判据四臂见 robinGuard.test.ts）。
 *
 *   steps = max(0, floor((hp - 16000) / 1000))        // HP < 16000 ⇒ 0
 *   raw   = min(steps * (44 + 3*Lv), 440 + 30*Lv)      // Lv12: 每档 80 / 上限 800
 *   value = raw * (buffPoint ? 1.25 : 1)               // 只放大已生效的那部分
 *
 * ⚠ floor 是**整档**语义（原文「每多拥有1000点生命值」），余数不足一档不计；
 * ⚠ ×1.25 作用在**已被基础上限钳过**的 raw 上 = 原文「提升效果**与其上限**各 +25%」——
 *    等价于上限 800 → 1000（先乘后钳 800 会在高生命时少算）。
 */
export function robinGuardDefBonus(input: { hp: number; buffPointActive: boolean; skillLevel?: number }): number {
  const hp = Number(input.hp)
  if (!Number.isFinite(hp)) return 0
  const level = Number(input.skillLevel ?? SKILL_LEVEL)
  const steps = Math.max(0, Math.floor((hp - ROBIN_DEF_HP_THRESHOLD) / ROBIN_DEF_HP_PER_STEP))
  if (steps <= 0) return 0
  const perStep = ROBIN_DEF_PER_STEP_BASE + ROBIN_DEF_PER_STEP_PER_LEVEL * level
  const cap = ROBIN_DEF_CAP_BASE + ROBIN_DEF_CAP_PER_LEVEL * level
  const raw = Math.min(steps * perStep, cap)
  return raw * (input.buffPointActive ? ROBIN_BUFF_POINT_DEF_MULT : 1)
}

/**
 * 星耀值 / 登场技循环（纯函数；buildExecutions 与判据共用，杜绝两处各算一份）。
 *
 * - 追加攻击次数 = floor(有效战斗时间 / 10)（满覆盖近似：幕后协奏 80s 覆盖整局，见文件头）；
 * - 星耀值总量 = 追加次数 × 20；登场技次数 = floor(总量 / 100)；
 * - entryValue = 最后一次登场技之后**手里还剩的**星耀值（展示用，0..120）。
 *
 * ⚠ 为什么不是「总量封 120」：120 是**同时持有**上限，不是整局总量（用户口径「追加上限120」+ 原文
 *   「最多可以拥有120点」）。每消耗 100 点后又能重新攒，故整局可用点数不受 120 钳制；
 *   floor(总量/100) 与逐轮循环在「+20 / 100」这组整数下逐位相同（5 次追加 = 1 次登场技、余 0；
 *   10s CD 下 5 次追击 = 50s）。
 */
export function solveRobinEntry(input: { combatTime: number; teammateFrontlineSeconds?: number }): {
  aftershockCount: number
  entryValue: number
  entrySkillCount: number
} {
  const time = Math.max(0, Number(input.combatTime) || 0)
  // 原文「**队伍中其他操作中的角色**发动任意攻击命中敌人时自动发动」⇒ 没有队友在场就一次都不触发。
  // 用 `teammateFrontlineSeconds`（Σ 队友前台秒）作判据：> 0 ⟺ 队里确有别的角色在场上打过。
  // 这条不是近似的额外假设——单角色队里知更鸟全程幕后协奏，没有任何人替她触发追击。
  const hasTeammates = Number(input.teammateFrontlineSeconds ?? 0) > 0
  const aftershockCount = hasTeammates ? Math.floor(time / ROBIN_AFTERSHOCK_CD_SECONDS) : 0
  const totalEntry = aftershockCount * ROBIN_ENTRY_PER_AFTERSHOCK
  const entrySkillCount = Math.floor(totalEntry / ROBIN_ENTRY_COST)
  const leftover = Math.max(0, totalEntry - entrySkillCount * ROBIN_ENTRY_COST)
  const entryValue = Math.min(ROBIN_ENTRY_MAX, leftover)
  return { aftershockCount, entryValue, entrySkillCount }
}

function buildRobinCharConfig({ cfg, skills, cinemaLevel }: AgentCharConfigInput): void {
  const all = skills.categories.flatMap(c => c.moves)
  const timeOf = (id: string) => Math.max(0, all.find(m => m.id === id)?.actionTime ?? 0)
  cfg.robinCinemaLevel = cinemaLevel
  // 额外能力（3.4.3）：「进入战场时，获得 **3000 点喧响值**，在堪域模式中此效果 600 秒内最多触发一次」
  // （v2 文本是「获得 1 个[重音节拍]」——那个是面子资源，不入伤害账；3.4.3 改成了真喧响）。
  // 消费方 = 引擎的终结技通道：她的终结技 1661010「终结技：星辰协奏曲」由通用 ultimate 行物化，
  // 次数 = floor(总喧响 / 单价) ⇒ 这 3000 点直接多一发。实测本配装终极技 2 → 3 次、伤害 +7.15%
  // （判据 timeGolden agent:1661:c0，逐槽 ult 字段 2.0000 → 3.0000）。
  cfg.initialDecibelGift = cfg.initialDecibelGift + ROBIN_ADDITIONAL_DECIBEL_GIFT
  cfg.robinEntryActionTime = timeOf('1661011')
  cfg.robinAftershockDamage = getRowValue(all.find(m => m.id === '1661005'), 'damage')
  // 震律齐鸣表值（1661006；能量≥40 升级，影画4/6 追加规则见 buildRobinExecutions）
  cfg.robinReinforcedDamage = getRowValue(all.find(m => m.id === '1661006'), 'damage')
  cfg.robinReinforcedDaze = getRowValue(all.find(m => m.id === '1661006'), 'daze')
  cfg.robinEntryDamage = getRowValue(all.find(m => m.id === '1661011'), 'damage')
  // 1661019 表值（不带 override ⇒ 由引擎按 fusedOf 回填也行，但显式预存让「表值变了」可见）
  cfg.robinCornerAssistDamage = getRowValue(all.find(m => m.id === '1661019'), 'damage')
  cfg.robinCornerAssistDaze = getRowValue(all.find(m => m.id === '1661019'), 'daze')
  // 1661004「特殊技：万籁与我同歌」表值（连携招架后自动释放那一行的载体）
  cfg.robinSpecialDamage = getRowValue(all.find(m => m.id === '1661004'), 'damage')
  cfg.robinSpecialDaze = getRowValue(all.find(m => m.id === '1661004'), 'daze')
  cfg.robinSpecialDecibel = getRowValue(all.find(m => m.id === '1661004'), 'decibel_recovery')
}

/** 资源结算读数（展示用）：登场技次数 + 重音节拍稳态。与 buildExecutions 同源调 solveRobinEntry。 */
function buildRobinResourceResult({ cfg, state, teamFrontlineSeconds }: Pick<AgentResourceInput, 'cfg' | 'state' | 'teamFrontlineSeconds'>) {
  const entry = solveRobinEntry({ combatTime: effectiveCombatTime(state, cfg), teammateFrontlineSeconds: teamFrontlineSeconds })
  return {
    robinEntrySource: {
      aftershockCount: entry.aftershockCount,
      entryValue: entry.entryValue,
      entrySkillCount: entry.entrySkillCount,
      // 重音节拍：登场技每次 +1、进幕后协奏必消耗 1（上限 1）⇒ 循环稳态恒有
      buffPointActive: entry.entrySkillCount > 0,
      // 队友反制支援次数（converge 相位 applyTeamConfig 写入）→ 1661019 触发次数
      teammateCounterAssists: Math.max(0, Math.floor(Number(cfg.robinTeammateCounterAssists ?? 0))),
    },
  }
}

/**
 * 资源卡分区（展示层）：星耀值循环的读数与「幕后协奏防御」的口径说明。
 * 防御值本身不在这里算——它是面板项（teamPanelEffects），资源卡只解释口径与门槛。
 */
function buildRobinResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.robinEntrySource
  if (!source) return []
  return [
    {
      id: 'robin-entry',
      title: '知更鸟·星耀值 / 重音节拍',
      summary: `追击 ${fmt(source.aftershockCount)} 次 · 登场技 ${fmt(source.entrySkillCount)} 次 · 结余星耀值 ${fmt(source.entryValue)}`,
      rows: [
        { label: `追加攻击（${ROBIN_AFTERSHOCK_CD_SECONDS}s CD）`, value: `${fmt(source.aftershockCount)} 次`, detail: '每次 +20 星耀值（满覆盖近似：幕后协奏 80s 覆盖整局）' },
        { label: '星耀值上限', value: `${fmt(ROBIN_ENTRY_MAX)}`, detail: '同时持有上限；每 100 点触发一次登场技，余量继续累积' },
        { label: '登场技（≥100 点）', value: `${fmt(source.entrySkillCount)} 次`, detail: '每次消耗 100 点 + 获得 1 个 重音节拍（快速支援语义，占前台）' },
        { label: '重音节拍', value: source.buffPointActive ? '常驻' : '无', detail: '幕后协奏防御提升 ×1.25（上限同步 ×1.25）' },
        {
          label: '完美节拍（1661019）',
          value: `${fmt(source.teammateCounterAssists)} 次`,
          detail: '触发 = 队伍中**其他**角色发动[反制支援]且[完美反制]（1:1）；自动发动 ⇒ 不占前台时间、不产喧响与秽盾',
        },
      ],
      footer: '幕后协奏·全队固定防御：每满 1000 点初始生命 +80（上限 800），门槛 16000，重音节拍 ×1.25；'
        + '护盾量 / 抗打断未建模（生存面）；每毁伤回 15 能量**已建模**（走 bonusEnergy，次数 = 全队锋御槽 maimCount 之和）。',
    },
  ]
}

/**
 * 队友反制支援次数 → 自己的 1661019 触发次数（converge 相位写入，供 buildExecutions 读）。
 *
 * 为什么读得到：`buildCharConfig` 已把每槽的 `counterAssistCount` 写进**各自**的 cfg
 * （`helpers.ts#buildCharConfig`），而 converge 派发递的是**同一批 cfg 对象**（实测三槽可见）。
 * 口径（原文）：「队伍中**其他**角色发动[反制支援]后，若触发[完美反制]自动发动」
 * ⇒ 只数别槽、不数自己；一次反制支援 = 整组化解 = 一次完美反制 ⇒ 1:1。
 */
function applyRobinTeamConfig({ slot, cfg, characters, team, phase, ultimateCounts, threads }: AgentTeamConfigInput): void {
  if (phase === 'converge') {
    let teammateCount = 0
    for (const other of characters) {
      if (other.slot === slot) continue
      teammateCount += Math.max(0, Math.floor(Number(other.counterAssistCount) || 0))
    }
    cfg.robinTeammateCounterAssists = teammateCount
    // 全队毁伤次数（上一轮资源解的产物，经 ModuleFeedback 转一圈）⇒ 核心被动「每毁伤回 15 能量」
    cfg.robinTeamMaimCount = Math.max(0, Math.floor(Number(threads?.moduleFeedback.robinTeamMaimCount ?? 0)))
    return
  }
  applyRobinSharpnessGift({ slot, characters, team, phase, ultimateCounts })
}

/**
 * 终结技「全队[锋御]角色固定回复 `20` 点[锐能]」——**跨槽锐能给养**（3.4.3+20278274 新增句）。
 *
 * 原文（spec 1661 终结技 1661010 条目）：「队伍中所有[锋御]角色固定回复 20 点[锐能]」。
 *
 * ## 为什么必须走 postRound + cfg 字段（规则 6）
 * 锐能池住在**各锋御自己的模块**里（克拉蕾/挽昼都走 `sharpnessIncome`），引擎没有、也不该有
 * 跨槽锐能通道。唯一被允许的跨槽写 cfg 路径 = 本钩子的 postRound 相位
 * （`convergence.ts:834` 起派发，带**上一轮**收敛的 `ultimateCounts`）：
 * 知更鸟读**自己槽**的终结技次数，写到每个锋御队友的 `cfg.sharpnessGiftFromTeam`，
 * 锋御模块把它作为一条 `gifts` 传给 `sharpnessIncome`（批 1 留的那个口）。
 *
 * ## 三条硬判据（写在 `robinSharpnessGift.test.ts`）
 * ① 单锋御队：该锋御的锐能池 **+ 20 × 知更鸟终结技次数**；
 * ② 无锋御队：**零写**（字段缺省 = 该来源本局不发生，不留 0 残留）；
 * ③ **她自己的槽不写**：原文限定「[锋御]角色」，她是[防护] ⇒ 判据必须是 specialty，
 *    不能退化成「是所有队友都写」。
 *
 * ## 为什么用 `characters.find(c => c.slot === …)` 而不是 `characters[slot]`
 * `characters` 是**按位置压缩**的（`buildCharConfig` 跳过空槽）⇒ 槽位号 ≠ 下标；
 * `characters[slot]` 在前导/中间空槽时会取到 undefined 或**别人那份 cfg**（判据 17 的经典缺陷）。
 * ⚠ `ultimateCounts` 与 `characters` **同序**（都按压缩后的位置），故取她的次数也必须用
 * 「她那份 cfg 在 characters 里的下标」，不能写 `ultimateCounts[slot]`——两者在有空槽时不同。
 */
function applyRobinSharpnessGift(input: {
  slot: number
  characters: AgentTeamConfigInput['characters']
  team: AgentTeamConfigInput['team']
  phase: AgentTeamConfigInput['phase']
  ultimateCounts?: readonly number[]
}): void {
  const { slot, characters, team, phase, ultimateCounts } = input
  if (phase !== 'postRound') return
  const ownIdx = characters.findIndex(c => c.slot === slot)
  if (ownIdx < 0) return
  const ultCount = Math.max(0, Math.floor(Number(ultimateCounts?.[ownIdx] ?? 0)))
  const gift = ultCount * ROBIN_ULT_TEAM_SHARPNESS
  for (const mate of characters) {
    // ③ 她自己那一槽不写（原文限定 [锋御]）
    if (mate.slot === slot) continue
    if (!isSharpenSlot(mate.slot, team)) continue
    // **绝对写**（不是 +=）：postRound 每轮都会跑，累加会按轮数重复计入；
    // 0 次终结技时写 0 而非跳过——清零是必要的（上一轮的赠予不能留在池里）。
    mate.sharpnessGiftFromTeam = gift
  }
}

/** 该槽位是否是[锋御]（`specialty === 'sharpen'`）。身份从 `team` 快照读，不认 agentId 名单。 */
function isSharpenSlot(slot: number, team: AgentTeamConfigInput['team']): boolean {
  return team.some(m => m.slot === slot && m.agent?.specialty === 'sharpen')
}

function buildRobinExecutions({ cfg, state, executions, teamFrontlineSeconds }: AgentResourceInput): void {
  const combatTime = effectiveCombatTime(state, cfg)
  const entry = solveRobinEntry({ combatTime, teammateFrontlineSeconds: teamFrontlineSeconds })
  const cinema = cinemaLevelOf(cfg.robinCinemaLevel)
  const panel = cfg.panel
  /**
   * 震律齐鸣（1661006，v2 核心被动 + 影画 4/6）：
   * ① 原文「发动[特殊技：弦歌相和]时，若能量大于等于40点则升级为[强化特殊技：震律齐鸣]：
   *    持续消耗总计40点能量」⇒ 升级次数 = min(追击次数, floor(总能量 / 40))，行上如实记 `totalEnergyConsume`。
   *    ⚠ **单轮读态、不回压本轮能量池**（升级耗的 40 点不改本轮 EX 次数）——用户 2026-11-01 口径
   *    「你认为怎么实现符合文本都可以」；不动点联立留作 debt。
   * ② 影画4：能量不足时也可升级，每 60s 最多一次 ⇒ 只补「能量没升的那些」。
   * ③ 影画6：升级后的[震律齐鸣]必定暴击（行级 critRateBonus 抬到 100）+ 生命值系数 ×2。
   */
  const energyUpgraded = Math.min(entry.aftershockCount, Math.floor(Math.max(0, state.totalEnergy) / ROBIN_REINFORCED_ENERGY_COST))
  const guaranteed = cinema >= 4
    ? Math.min(Math.max(0, entry.aftershockCount - energyUpgraded), Math.floor(combatTime / ROBIN_C4_GUARANTEE_CD_SECONDS))
    : 0
  const reinforcedCount = Math.max(0, energyUpgraded + guaranteed)
  const plainAftershockCount = Math.max(0, entry.aftershockCount - reinforcedCount)
  // 追加攻击：幕后协奏期间队友命中触发，后台行（不占前台时间）
  if (plainAftershockCount > 0) {
    executions.push(moduleExecRow({
      moveId: '1661005',
      moveName: `特殊技：弦歌相和（幕后协奏·队友命中触发，${ROBIN_AFTERSHOCK_CD_SECONDS}s CD）`,
      category: 'special',
      count: plainAftershockCount,
      damageMultiplier: Number(cfg.robinAftershockDamage ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'backstage',
      // CC-391 D1：CD 驱动的后台自动行（10s CD，不靠玩家放置）⇒ 轴模式按失衡时间占比吃易伤
      autoSplitByStun: true,
      skillTableNote: `满覆盖近似：floor(有效战斗时间/${ROBIN_AFTERSHOCK_CD_SECONDS})，每次 +20 星耀值（同时上限 ${ROBIN_ENTRY_MAX}）`,
    }))
  }
  if (reinforcedCount > 0) {
    const hpRate = (ROBIN_REINFORCED_HP_RATE_BASE + ROBIN_REINFORCED_HP_RATE_PER_LEVEL * SKILL_LEVEL)
      * (cinema >= 6 ? ROBIN_C6_HP_RATE_MULT : 1)
    // 「根据最大生命值额外提升重击的伤害」折算成等价倍率（本行基底 = 攻击力，与 1661006 本行同乘区/同元素/同防御）
    const hpExtraMultiplier = panel.hp * hpRate * 100 / Math.max(1, panel.atk)
    executions.push(moduleExecRow({
      moveId: '1661006',
      moveName: `强化特殊技：震律齐鸣（能量≥${ROBIN_REINFORCED_ENERGY_COST} 升级${cinema >= 4 ? ' / 影画4 保底' : ''}${cinema >= 6 ? ' / 必定暴击' : ''}）`,
      category: 'special',
      count: reinforcedCount,
      damageMultiplier: Number(cfg.robinReinforcedDamage ?? 0) + hpExtraMultiplier,
      dazeMultiplier: Number(cfg.robinReinforcedDaze ?? 0),
      // 能量升级的那几次各扣 40 点（影画4 保底不耗能）；行级如实记账
      totalEnergyConsume: energyUpgraded * ROBIN_REINFORCED_ENERGY_COST,
      ...RECOVERY_OFF,
      timeBucket: 'backstage',
      autoSplitByStun: true,
      ...(cinema >= 6 ? { critRateBonus: Math.max(0, 100 - Number(panel.critRate)) } : {}),
      skillTableNote: `升级 = 能量 ≥${ROBIN_REINFORCED_ENERGY_COST}（耗 ${ROBIN_REINFORCED_ENERGY_COST}）${cinema >= 4 ? ' 或影画4 每 60s 保底' : ''}；生命值附加 = maxHP × ${Math.round(hpRate * 100)}%${cinema >= 6 ? '；影画6 必定暴击' : ''}`,
    }))
  }
  /**
   * 特殊技：万籁与我同歌（1661004）——**[连携招架]后自动释放**（3.4.3 描述层新增句）：
   * > 「成功[连携招架]时发动[支援突击]后，若知更鸟不为当前操作角色则自动释放[特殊技：万籁与我同歌]」
   *
   * 触发次数 = **Boss 的 x 弹次数**（`cfg.bossXParryTotal` = Boss 预设 `defaults.xParryTotal`）。
   * 用户口径 2026-11-10 逐字：「x 弹必须是 **boss 身上**有的，普通的交替弹不会有。这个计数器只能去
   * boss 身上取这个次数，**其他地方不会产**。角色读了 boss x 弹相当于转化为普通弹刀进行方便计算」
   * ⇒ 不要拿队友 `parryCount` 顶替（那是普通弹刀，不是 x 弹；第一版正是这么写错的）。
   *
   * ⚠ 时间口径：timeBucket = backstage、不占前台——原文是「自动释放」，玩家不做这个动作；
   *   与 1661005/1661006 后台行同一取向（用户 2026-11-09「后台的强特不耗时但是能打」）。
   *   与 1661019 的区别：那一行连表值时间都是 0（新包归零），本行表值有 1.208s，是我们主动判成后台。
   * ⚠ 「若知更鸟不为当前操作角色」这条前置**未单独判定**（近似）：她是辅助、默认不在前台。
   *   若用户把她当主 C 操作，这一条会多算 —— 引擎目前没有「本槽是否前台操作位」的稳定信号。
   */
  const xParryCount = Math.max(0, Math.floor(Number(cfg.bossXParryTotal ?? 0)))
  if (xParryCount > 0) {
    const specialDecibel = Number(cfg.robinSpecialDecibel ?? 0)
    executions.push(moduleExecRow({
      moveId: '1661004',
      moveName: '特殊技：万籁与我同歌（连携招架后自动释放）',
      category: 'special',
      count: xParryCount,
      damageMultiplier: Number(cfg.robinSpecialDamage ?? 0),
      dazeMultiplier: Number(cfg.robinSpecialDaze ?? 0),
      decibelRecovery: specialDecibel,
      totalDecibelRecovery: xParryCount * specialDecibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'backstage',
      autoSplitByStun: true,
      skillTableNote: `触发 = Boss x 弹次数（连携招架）${xParryCount}；自动释放、不占前台`,
    }))
  }
  // 支援突击·完美节拍（1661019）：**队友**发动反制支援且完美反制时自动发动。
  // 3.4.1+19997538 起该行 decibel/ether 均为 0、actionTime = 0（自动触发段，不占前台、不产喧响与秽盾，
  // 与新包同批归零的 1661005/1661006 同性质）⇒ 只出伤害 + 失衡。
  const teammateCounter = Math.max(0, Math.floor(Number(cfg.robinTeammateCounterAssists ?? 0)))
  if (teammateCounter > 0) {
    executions.push(moduleExecRow({
      moveId: '1661019',
      moveName: '支援突击：完美节拍（队友反制支援·完美反制后自动发动）',
      category: 'assist',
      count: teammateCounter,
      actionTime: 0,
      totalTime: 0,
      damageMultiplier: Number(cfg.robinCornerAssistDamage ?? 0),
      dazeMultiplier: Number(cfg.robinCornerAssistDaze ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
      skillTableNote: '触发 = 队伍中**其他**角色发动[反制支援]且触发[完美反制]（1:1）；自动发动，不占前台时间、不产喧响与秽盾',
    }))
  }
  // 登场技：≥100 星耀值时被换入发动（快速支援语义），占前台
  if (entry.entrySkillCount > 0) {
    const t = Number(cfg.robinEntryActionTime ?? 0)
    executions.push(moduleExecRow({
      moveId: '1661011',
      moveName: '登场技：登场技（消耗 100 星耀值，获 重音节拍）',
      category: 'assist',
      count: entry.entrySkillCount,
      actionTime: t,
      totalTime: entry.entrySkillCount * t,
      damageMultiplier: Number(cfg.robinEntryDamage ?? 0),
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
      skillTableNote: '登场技 = 快速支援 + 全队 4% 生命护盾（生存面不录）+ 重音节拍（幕后协奏防御 ×1.25）；剩余星耀值 ' + fmt(entry.entryValue),
      // ⚠ 3.4.1+19997538 新增：连携技 / 登场技 / 支援突击**发动后触发快速支援，1.5s 内换人自动释放[特殊技：万籁与我同歌]**
      //   ——是换人操作面的连续性，不改本模块的次数解（登场技仍按星耀值 ≥100 触发）。
    }))
  }
}

/**
 * 幕后协奏·全队防御提升（**本模块唯一的伤害项写入点**）。
 *
 * 读**知更鸟自己的源面板局外生命**：sourcePanels 由派发器给出（AgentTeamPanelEffectInput，键 = 槽位号），
 * 与 calcPanel 的 sourcePanelsByOwner 同源同实例；源面板 = 角色自身配置、**不含队友 buff**，
 * 正是「初始最大生命值」的口径（outOfCombat 相位）。
 *
 * 写入走 **inCombatDefFlat 通道**（applyStat 的 CORE_STAT_BY_BONUS flat 分支）：
 * 最终 panel.def = base * (1 + Σpct) + Σflat，即「固定防御、不被局内百分比放大」。
 * 与其它 teamPanelEffects 一样必须是**可交换加法**——flat 累加天然满足。
 */
function applyRobinTeamPanelEffects({ slot, agent, targetAgent, panel, settings, sourcePanels, report }: AgentTeamPanelEffectInput): void {
  if (agent.id !== ROBIN_AGENT_ID) return
  // 额外能力（3.4.3）：全队[击破]角色攻击力提升 80 点，随知更鸟等级每级 +12（满级 = 800 点）。
  // 原文门控是「队伍中存在[锋御]或[击破]角色时触发」——本效果只落在[击破]槽位上，
  // 只要有一个[击破]在队，门控就必然成立（不存在「有击破却没触发」的组合）⇒ 不必单独判门控。
  if (targetAgent.specialty === 'stun') {
    const atk = robinStunAtkBonus()
    applyStat(panel, 'atkFlat', atk, 'flat')
    report?.({ stat: 'atkFlat', value: atk, mode: 'flat' })
  }
  const hp = outOfCombatStat(panelOfSlot(sourcePanels, slot, 'outOfCombat'), 'hp')
  const buffPointActive = robinSetting(settings, 'robin.buffPointActive') > 0
  const bonus = robinGuardDefBonus({ hp, buffPointActive })
  if (!(bonus > 0)) return
  applyStat(panel, 'inCombatDefFlat', bonus, 'flat')
  report?.({ stat: 'inCombatDefFlat', value: bonus, mode: 'flat' })
}

/**
 * 面板钩子：影画4（奉献者的虚像，v2 3.4.2+20049556）「知更鸟自身造成的伤害提升10%」。
 * ⚠ 只写本人面板（panel 是这一槽自己的那份），与 teamBuffs 的全队项区分。
 */
function applyRobinPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if (cinemaLevelOf(cinemaLevel) >= 4) panel.dmgBonus = panel.dmgBonus + 10
}

/**
 * 下一轮反馈：**全队毁伤触发总次数**（核心被动「每毁伤回 15 能量」的次数来源）。
 *
 * 为什么要跨轮：毁伤次数是**本轮资源解**的产物（`maimCount` 在各锋御槽的 source 里），
 * 而知更鸟的能量在本轮解算时就要用 ⇒ 只能取上一轮的值，由外层不动点收敛。
 * 单锋御 / 无锋御队都成立（`collectTeamMaimCount` 不要求 ≥2 槽；无锋御 ⇒ 0）。
 */
function robinNextRoundFeedback({ adjustedResult }: AgentNextRoundFeedbackInput): ModuleFeedback {
  const count = collectTeamMaimCount(adjustedResult.characters)
  return count > 0 ? { robinTeamMaimCount: count } : {}
}

export const robinMechanic: AgentMechanicModule = {
  id: 'agent:robin',
  agentIds: [ROBIN_AGENT_ID],
  name: '知更鸟',
  description: '3.4.3（3.4.3+20278274）：幕后协奏·全队固定防御（每 1000 初始生命 +80 / 上限 800 / 重音节拍 ×1.25）'
    + ' + 星耀值循环（追加攻击 10s CD +20 / 上限 140 / ≥120 触发登场技）+ 完美节拍 1661019'
    + ' + 额外能力（全队[击破]攻击 +800 / 进战 +3000 喧响）'
    + '；影画1 全队无视20%防御 / 影画2 全队无视15%抗性（spec teamBuffs）/ 影画4 自身+10%伤害；'
    + '终结技的「全队锋御 +20 锐能」与核心被动「每毁伤回 15 能量」均已建模（前者 postRound 写队友 cfg，后者走 bonusEnergy）。',
  applyPanel: applyRobinPanel,
  teamPanelEffects: applyRobinTeamPanelEffects,
  applyTeamConfig: applyRobinTeamConfig,
  // 1661019 已有模块行（队友反制支援触发）⇒ 轴编辑器不得再把它当 [表] 直读候选（会双计）
  axisHiddenMoves: ['1661019'],
  buildCharConfig: buildRobinCharConfig,
  buildExecutions: buildRobinExecutions,
  buildResourceResult: buildRobinResourceResult,
  nextRoundFeedback: robinNextRoundFeedback,
  /**
   * 核心被动「全队角色每触发一次[毁伤]，知更鸟固定回复 15 点能量」。
   *
   * 走 `bonusEnergy`（固定回能入口）而不是 `crossAgentEnergy`：后者的语义是
   * 「队友给**落点**送能量」，而本条是**她自己**因队友的毁伤事件回能，落点就是自己。
   *
   * ⚠ 不进百分比/效率乘区：原文说「**固定**回复」，与诺姆帽子把戏、安东影画1 同款。
   */
  bonusEnergy({ cfg }) {
    const count = Math.max(0, Math.floor(Number(cfg.robinTeamMaimCount ?? 0)))
    return [{
      key: 'teamMaimEnergy',
      label: '每毁伤回能',
      value: count * ROBIN_MAIM_ENERGY_PER_TRIGGER,
      detail: `核心被动：全队每触发一次[毁伤]固定回 ${ROBIN_MAIM_ENERGY_PER_TRIGGER} 点（本局 ${count} 次，固定值不进回能乘区）`,
    }]
  },
  resourceSections: buildRobinResourceSections,
  settings: [
    {
      id: 'robin.buffPointActive',
      label: '知更鸟｜重音节拍常驻（幕后协奏防御 ×1.25）',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      description: '登场技每循环获得 1 个[重音节拍]、进幕后协奏必消耗 1 个（上限 1）⇒ 循环稳态恒有。'
        + '置 0 = 白板幕后协奏（判据负控 / 配装未堆生命时看基础值）。',
    },
  ],
}

/**
 * D2：本模块私有的 cfg 字段（只有本文件读写；仍是 CharacterOperationConfig 的成员，纯类型零运行时）。
 */
/**
 * D2：本模块私有的 ModuleFeedback 键（只有本文件读写，声明随模块走）。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 上一轮全队毁伤触发总次数（核心被动「每毁伤回 15 能量」的次数；见 robinNextRoundFeedback） */
    robinTeamMaimCount?: number
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /**
     * 本局**队友**发动[反制支援]的次数（converge 相位由 applyTeamConfig 写入）。
     * 用途 = 1661019「支援突击：完美节拍」的触发次数：原文
     * 「队伍中**其他**角色发动[反制支援]后，若触发[完美反制]自动发动」——**不含她自己**发动的那几次。
     */
    robinTeammateCounterAssists?: number
    /**
     * 本局**全队毁伤触发总次数**（converge 相位由 applyTeamConfig 从跨轮通道写入）。
     * 用途 = 核心被动「每毁伤回 15 能量」的次数（`bonusEnergy` 读）。
     */
    robinTeamMaimCount?: number
    /** 命座等级（buildCharConfig 写；影画4 保底升级 / 影画6 必定暴击用） */
    robinCinemaLevel?: number
    /** 震律齐鸣 1661006 表值（buildCharConfig 预存） */
    robinReinforcedDamage?: number
    robinReinforcedDaze?: number
    /** 登场技 1661011 动作时长（buildCharConfig 预存） */
    robinEntryActionTime?: number
    /** 追加攻击表值倍率（1661005 damage） */
    robinAftershockDamage?: number
    /** 登场技表值倍率（1661011 damage） */
    robinEntryDamage?: number
    /** 支援突击·完美节拍表值（1661019 damage / daze） */
    robinCornerAssistDamage?: number
    robinCornerAssistDaze?: number
    /** 特殊技：万籁与我同歌 1661004 表值（buildCharConfig 预存；连携招架自动释放那一行用） */
    robinSpecialDamage?: number
    robinSpecialDaze?: number
    robinSpecialDecibel?: number
  }
}

declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 知更鸟星耀值 / 重音节拍循环读数（buildResourceResult 写、展示层读） */
    robinEntrySource?: {
      aftershockCount: number
      entryValue: number
      entrySkillCount: number
      buffPointActive: boolean
      /** 队友反制支援次数 = 完美节拍 1661019 的触发次数（只数别槽，不含自己） */
      teammateCounterAssists: number
    }
  }
}
