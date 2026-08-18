import type { AgentMechanicModule, AgentCharConfigInput, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import type { CharacterResourceResult, MechanicSetting } from '@/types/resource'
import type { SkillMove } from '@/types/catalog'
import { fmt } from '@/utils/format'

/**
 * 般岳·艾洛温（1471）战斗逻辑（用户确认口径）：
 * - 命破/火属性：火伤均为贯穿伤害（引擎按贯穿力基底 atk×0.3+hp×0.1+sheerForceFlat 无视防御结算）。
 *   核心被动·群山如我（hp→贯穿力 0.1/点）即命破通用公式的描述，不额外叠加。
 * - 嗔火（交互板块，用户确认，nanoka 核心被动原文）：[特殊动作=判定给触发奖励] 极限闪避 +4；
 *   通过[闪避：不动如山]成功招架 +4、完美格挡(金身)改 +6；双反（完美闪避不打出扬砾+金身弹刀，
 *   一次攻击吃两下交互）= 4+6=10；[攻击动作=倍率表自带，不给奖励] 扬砾/昂霄/冲霄等行自带倍率/时间/失衡；
 *   怒相外闪能消耗 +0.5；每 1 秒最多触发一次（战斗时长内不封顶，近似忽略）；120 点焚身入怒相；怒相中不产嗔火。
 * - 招式映射（用户确认，次数链接动作行的倍率/时间/失衡）：
 *   闪避次数 → 完美闪避判定(+4) + 闪避反击：扬砾(1471019) 行；
 *   普通弹刀次数 → 招架判定(+4) + 招架支援：铁壁(1471023) + 支援突击：昂霄(1471026) 行；
 *   金身弹刀 + 双反 次数 → 完美格挡(+6/10) + 闪避：不动如山(1471011) 行（0.666s 耗时 + daze 143.7）
 *   + 支援突击：冲霄(1471029) 行。
 * - 怒相循环（默认）：焚身 → 山威连段×2（论道→狮子吼·怒，共 4 山威免费强特）→ 倾山（退出）→ 摧岳。
 *   怒相内 2 组免费连段默认论道→狮子吼·怒；失衡轴内捏「地动山摇·怒连段」块（banyue-combo-didong）
 *   可把其中任意组数换成地动→山摇·怒（山威免费，明王触发源两者皆认领）。山威刚好打满、无山摇剩余。
 * - 能量分化（用户确认）：[普] 普通强特耗闪能（20/40）且回复嗔火（+0.5/闪能）；
 *   [怒] 怒相连段耗山威（每怒相 4 山威 = 2 组免费连段），不耗闪能、不回复嗔火。
 * - 怒相外：能量扣除失衡轴内捏的普通强特后，剩余全部自动打成连段（60 闪能/组 = floor(剩余闪能/60)），
 *   不足 60 的零散尾数忽略；banyue.diDongComboCount 滑块把其中 N 组拆成「地动→山摇·怒」，其余打「论道→狮子吼·怒」。
 *   轴内捏的连段块（banyue-combo）= 怒相内免费连段的轴内表达（山威，4点/怒相=2组），不占闪能预算、不回复嗔火；
 *   不额外生成执行行（认领怒相内/外连段行，池守恒）。付费连段用普通论道块 + 狮子吼·怒块拼（20+40 闪能）。
 * - 强特连段末尾后摇（用户确认口径）：每个强特连段（论道→狮子吼·怒 / 地动→山摇·怒）的末尾强特有后摇，
 *   时长 = 末尾强特自身动作时间，期间不能平A → 占用战场时间（计入 estimateExSpecialTime 的 necessaryTime）；
 *   失衡内/外按失衡轴实际捏块拆分：怒相基本在失衡内打完（被连携/大招/瞬拳取消后摇，不计），失衡外以闪能连段为主
 *   = 轴内强特耗闪能后富余能量在失衡外打的连段（次数由捏轴控制）+ 轴内未覆盖的怒相组（最多 2 组 = 一组怒相；
 *   非轴模式无轴可捏 → 怒相内默认失衡内全取消，只计怒相外自动连段）；
 *   地动山摇占比沿用 banyue.diDongComboCount 滑块（60 耗能，非固定连段按偏好分配）；
 *   主页交互栏「嘲讽取消」次数每次取消一次失衡外连段的后摇（按两类连段占比拆分）。
 * - 轴模式自动补齐交互次数（保底语义，2026-08 方案A）：轴内怒相/终结技对嗔火/喧响有硬性需求，不足时自动抬双反（补嗔火 +10/次）
 *   与弹刀（普通弹刀补喧响 +215/次）；有效次数 = 交互栏输入 + 补齐量（不覆盖输入，交互栏/资源卡片显示补齐量）；
 *   computeBanyueInteractionTopUp 纯函数，useResourceCalc 外不动点收敛，设置 banyue.autoTopUpInteractions 可关闭。
 * - 怒相增益：强特/支援突击后 贯穿+300 / 火伤+36% / 暴伤+36%（Lv.7 固定，不随 3/5 命），30s；
 *   用 banyue.rageGainCoverage 覆盖率滑块（默认 100%）近似。
 * - 明王（额外能力：队伍有支援/击破）：
 *   非6命：8s 窗口，只有怒相技能（怒相连段块 banyue-combo）能触发——首次 2 层、窗口内再触发 3 层并刷新；
 *   单招论道/狮子吼·怒 等是普通强特（付费 20/40 闪能），不触发明王但可享受窗口；
 *   轴模式按失衡轴时间轴扫描（computeBanyueMingwangStacks），落窗招式按层数火伤 +5%/层；非轴模式用
 *   banyue.mingwangCoverage 覆盖率滑块近似（满层3×5%×覆盖率）。
 *   6命：明王 30s 且任意强特常态刷新 → 实际满覆盖 → 全局 buff：火伤 +39%（3层×13%），
 *   applyPanel 按 panel.additionalAbilityActive 施加（轴/非轴一致，含 C6 附伤）。
 * - 影画：C1 战栗（teammate-buffs 已录 enemy 火抗-10%，贯穿+10% 与失衡+2s 全覆盖）；
 *   C2 怒相增益各+15% + 山威强特额外回 5 闪能；C4 狮吼怒/山摇怒/倾山/摧岳 +30%（patchExecutions moveId 级）；
 *   C6 摧岳 600% 贯穿力火伤附伤（次数=倾山次数，自动触发不可调，useResourceCalc 内 pushDirect）。
 */

const AGENT_ID = '1471'

// 招式 moveId
const MOVE = {
  fenShen: '1471027', // 焚身 221.7%
  qingShan: '1471009', // 倾山 1739.9%
  cuiYue: '1471010', // 摧岳 756.7%
  lunDao: '1471015', // 论道 325.2% / 20 闪能
  shiZiHou: '1471014', // 狮子吼 307.7% / 20
  shanYao: '1471012', // 山摇 342.9% / 20
  diDong: '1471013', // 地动 510% / 20
  shanYaoNu: '1471017', // 山摇·怒 650.6% / 40
  shiZiHouNu: '1471016', // 狮子吼·怒 600.4% / 40
  buDongRuShan: '1471011', // 闪避：不动如山（招架/金身动作，daze 143.7，0.666s）
  yangLi: '1471019', // 闪避反击：扬砾 390.7%
  angXiao: '1471026', // 支援突击：昂霄 483.6%
  chongXiao: '1471029', // 支援突击：冲霄 443.8%
} as const
const C4_MOVE_IDS = new Set<string>([MOVE.shiZiHouNu, MOVE.shanYaoNu, MOVE.qingShan, MOVE.cuiYue])

// 核心被动常量（用户确认）
const INITIAL_FURY = 115 // 开局场外烧血攒嗔火到 115（不满 120，避免开局自动入怒相；120 自动怒相的情况用户暂不处理）
const FURY_ENTER = 120 // 嗔火阈值
const FURY_DODGE = 4 // 闪避反击 +4 嗔火
const FURY_PARRY = 4 // 普通弹刀（招架支援）+4（nanoka：招架回复4）
const FURY_BLOCK = 6 // 金身弹刀（完美格挡）+6（nanoka：完美格挡改6）
const FURY_DUAL = 10 // 双反（完美闪避+金身）4+6=10
const FURY_PER_FLASH = 0.5 // 每消耗 1 点闪能 +0.5
const RAGE_SWAY = 4 // 怒相进入 +4 山威
const SWAY_REFUND = 10 // 山威强特回 10 闪能
const FLASH_INCOME = 2 * 180 + 60 // 秒回 2/s×180 + 进场 60
const EX_COST = 20 // 论道/地动 20 闪能
const COMBO_COST = 60 // 连段（论道20 + 狮子吼·怒40）
const RAGE_BUFF_SHEER = 300 // Lv.7 贯穿力
const RAGE_BUFF_FIRE = 36 // Lv.7 火伤%
const RAGE_BUFF_CRIT = 36 // Lv.7 暴伤%
const C2_BUFF_BONUS = 15 // 影画2 各 +15
const C2_SWAY_REFUND_BONUS = 5 // 影画2 山威强特额外回 5 闪能
const C4_DMG_BONUS = 30 // 影画4 四招式 +30%
export const C6_ATTACH_RATIO = 600 // 影画6 摧岳附伤 600% 贯穿力
export const C6_MINGWANG_EXTRA = 8 // 影画6 明王每层额外 +8%（13%/层）
export const MINGWANG_BASE_PER_STACK = 5 // 明王基础每层火伤 +5%
export const MINGWANG_MAX_STACKS = 3 // 明王满层（简化：全覆盖，不再按窗口数层）
const C1_SHEER_DMG_BONUS = 10 // 影画1：对战栗敌人贯穿伤害+10%
const C1_STUN_DURATION = 2 // 影画1：摧岳命中失衡敌人失衡时长+2s
const PARRY_DECIBEL = 215 // 普通弹刀（parry）单次喧响奖励（calcSpecialActionBonus 口径）
const ULTIMATE_COST = 3000 // 终结技喧响消耗默认值（与资源池 ULTIMATE_COST_DEFAULT 一致）

// 默认触发次数（用户确认）：闪反 10 / 招架 6 / 金身弹刀 20 / 双反 5
const DEFAULT_DODGE = 10
const DEFAULT_PARRY = 6
const DEFAULT_BLOCK = 20
const DEFAULT_DUAL = 5
const DEFAULT_DIDONG_COMBO = 0 // 怒相外连段里分配给「地动→山摇·怒」的组数（默认 0 = 全打论道连段）

export interface BanyueRageCycle {
  /** 怒相次数 */
  rageCount: number
  /** 嗔火总量 */
  furyTotal: number
  /** 双反次数（完美闪避+金身弹刀，+10嗔火/次） */
  dualCounterCount: number
  /** 怒相外连段总数（论道连段 + 地动山摇连段，闪能支付 60/组，自动 = floor(剩余闪能/60)） */
  comboOutCount: number
  /** 怒相外「地动→山摇·怒」连段组数（滑块分配，默认 0 = 全打论道连段） */
  diDongComboCount: number
  /** 失衡轴内捏的普通强特消耗的总闪能（默认 0，轴模式由捏轴反馈；连段块免费不计） */
  axisExSpend: number
  /** 失衡轴内捏的连段块总数（免费·山威 = 怒相内连段的轴内表达，不影响怒相外自动连段） */
  axisComboCount: number
  /** 怒相内论道次数（山威） */
  lunDaoRageCount: number
  /** 怒相内狮子吼·怒次数（山威） */
  shiZiHouNuCount: number
  /** 怒相内「地动→山摇·怒」连段组数（轴内捏的 banyue-combo-didong 块决定，默认 0 = 全打论道连段） */
  rageDiDongComboCount: number
  /** 怒相内地动次数（山威免费，地动山摇连段 = rageDiDongComboCount） */
  diDongRageCount: number
  /** 怒相内山摇·怒次数（山威免费，地动派生连段 = rageDiDongComboCount） */
  shanYaoNuRageCount: number
  /** 怒相外论道连段论道次数（= comboOutCount − diDongComboCount） */
  lunDaoOutCount: number
  /** 怒相外论道连段狮子吼·怒次数（= comboOutCount − diDongComboCount） */
  shiZiHouNuOutCount: number
  /** 怒相外地动山摇连段地动次数（= diDongComboCount） */
  diDongOutCount: number
  /** 怒相外地动山摇连段山摇·怒次数（= diDongComboCount） */
  shanYaoNuOutCount: number
  /** 怒相内山摇次数（剩余山威） */
  shanYaoRageCount: number
  /** 闪能收支：总收入 / 总支出 */
  flashIncome: number
  flashSpent: number
  /** 山威免费强特总数 */
  swayExCount: number
  /** 嘲讽取消次数（钳制到失衡外连段总数） */
  tauntCancelCount: number
  /** 失衡外连段组数（轴模式 = 闪能连段 + 轴内未覆盖怒相组≤2；非轴模式 = 怒相外自动连段，怒相内默认失衡内全取消） */
  outStunComboCount: number
  /** 失衡轴内捏的连段块总数（banyue-combo + banyue-combo-didong，×窗口数；非轴模式 0） */
  axisInComboCount: number
  /** 失衡外连段末尾强特后摇次数（= outStunComboCount − 嘲讽取消；失衡内连段被连携/大招/瞬拳取消后摇，不计） */
  comboOutRecoveryCount: number
  /** 后摇按两类连段占比拆分：论道连段剩余后摇次数（末尾 = 狮子吼·怒） */
  lunDaoRecoveryCount: number
  /** 后摇按两类连段占比拆分：地动山摇连段剩余后摇次数（末尾 = 山摇·怒） */
  diDongRecoveryCount: number
}

/** 轴模式自动补齐的交互次数（保底语义：在用户输入之上补多少，不覆盖输入） */
export interface BanyueInteractionTopUp {
  /** 弹刀（普通弹刀 parry）补齐次数：补喧响（+215/次） */
  parry: number
  /** 双反补齐次数：补嗔火（+10/次） */
  dual: number
}

/**
 * 轴模式自动补齐（用户口径 2026-08，方案 A 保底补齐）：
 * - 嗔火不足 → 抬双反：轴内怒相组数 ÷ 2 = 需要的怒相次数 × 120 − 当前嗔火产出 → 双反 = 缺口 ÷ 10；
 * - 喧响不足 → 抬弹刀：轴内终结技需求（次数 × 消耗）− 当前喧响供给 → 弹刀 = 缺口 ÷ 215。
 * 有效次数 = 用户输入 + 返回值；怒相不足/喧响不足分别由双反/弹刀单独补齐，互不干扰。
 */
export function computeBanyueInteractionTopUp(opts: {
  dodgeCount: number
  parryCount: number
  blockCount: number
  dualCounterCount: number
  cinemaLevel: number
  /** 轴内捏的块次数（moveId → 次数，含连段块） */
  axisEx: Record<string, number>
  /** 轴内需要的终结技总次数（块 × 窗口数） */
  ultimateCountNeeded: number
  /** 终结技喧响消耗（默认 3000） */
  ultimateCost: number
  /** 当前喧响供给（全队） */
  decibelHave: number
}): BanyueInteractionTopUp {
  const rageGroups = (opts.axisEx['banyue-combo'] ?? 0) + (opts.axisEx['banyue-combo-didong'] ?? 0)
  const rageNeeded = Math.ceil(rageGroups / 2) // 每组连段 2 块 = 一次怒相
  const cycle = computeBanyueRageCycle(
    opts.dodgeCount,
    opts.parryCount,
    opts.blockCount,
    opts.dualCounterCount,
    0,
    axisExSpendOf(opts.axisEx),
    opts.axisEx['banyue-combo'] ?? 0,
    opts.cinemaLevel,
    opts.axisEx['banyue-combo-didong'] ?? 0,
    0,
    true,
  )
  const furyShort = Math.max(0, (rageNeeded - cycle.rageCount) * FURY_ENTER)
  const dual = Math.ceil(furyShort / FURY_DUAL)
  const decibelShort = Math.max(0, opts.ultimateCountNeeded * (opts.ultimateCost || ULTIMATE_COST) - opts.decibelHave)
  const parry = Math.ceil(decibelShort / PARRY_DECIBEL)
  return { parry, dual }
}

/** 嗔火→怒相 固定点收敛（用户口径） */
export function computeBanyueRageCycle(
  dodgeCount: number,
  parryCount: number,
  blockCount: number,
  dualCount: number,
  diDongComboCount: number,
  axisExSpend: number,
  axisComboCount: number,
  cinemaLevel: number,
  rageDiDongCombo = 0,
  tauntCancelCount = 0,
  axisActive = false,
): BanyueRageCycle {
  const dodge = Math.max(0, Math.floor(dodgeCount))
  const parry = Math.max(0, Math.floor(parryCount))
  const block = Math.max(0, Math.floor(blockCount))
  const dual = Math.max(0, Math.floor(dualCount))
  const diDongCombo = Math.max(0, Math.floor(diDongComboCount))
  const axisSpend = Math.max(0, axisExSpend)
  const axisCombo = Math.max(0, Math.floor(axisComboCount))
  const c2 = cinemaLevel >= 2
  const swayRefundPerRage = RAGE_SWAY * (SWAY_REFUND + (c2 ? C2_SWAY_REFUND_BONUS : 0))
  // 怒相内连段固定 2 组（山威免费，4 山威/怒相 = 2 组，明王触发源）；组数可按轴内捏的
  // banyue-combo-didong 块拆成「地动→山摇·怒」，其余打「论道→狮子吼·怒」；
  // 怒相外连段自动打满 = floor(剩余闪能/60)，由 diDongCombo 滑块拆分「地动→山摇·怒」vs「论道→狮子吼·怒」。
  const comboIn = 2

  let rage = 0
  let comboOut = 0
  for (let iter = 0; iter < 12; iter++) {
    const flashIncome = FLASH_INCOME + rage * swayRefundPerRage
    // 闪能扣掉轴内捏的普通强特后，剩余全部自动打成连段（不打单论道/单地动等零散招式，不足 60 的尾数忽略）
    const comboOutTotal = Math.max(0, Math.floor((flashIncome - axisSpend) / COMBO_COST))
    const flashSpent = axisSpend + comboOutTotal * COMBO_COST
    const furyTotal = INITIAL_FURY + dodge * FURY_DODGE + parry * FURY_PARRY + block * FURY_BLOCK + dual * FURY_DUAL + flashSpent * FURY_PER_FLASH
    const nextRage = Math.max(0, Math.floor(furyTotal / FURY_ENTER))
    comboOut = comboOutTotal
    if (nextRage === rage) {
      rage = nextRage
      break
    }
    rage = nextRage
  }

  const swayExCount = rage * RAGE_SWAY
  // 怒相内连段拆分：地动山摇组数 ≤ 山威配额（rage×2 组），其余打论道连段
  const diDongRage = Math.max(0, Math.min(Math.floor(rageDiDongCombo), rage * comboIn))
  const lunDaoRage = rage * comboIn - diDongRage
  const shiZiHouNu = lunDaoRage
  const shanYaoNuRage = diDongRage
  const shanYaoRage = Math.max(0, swayExCount - lunDaoRage - shiZiHouNu - diDongRage - shanYaoNuRage)
  // 怒相外连段拆分：地动山摇连段 ≤ 总数，其余打论道连段（执行计划行保持怒相外口径不变）
  const diDongComboOut = Math.min(diDongCombo, comboOut)
  const lunDaoComboOut = Math.max(0, comboOut - diDongComboOut)
  const flashSpent = axisSpend + comboOut * COMBO_COST
  // 失衡内/外拆分（用户口径，2026-08 修正）：怒相基本在失衡内打完（焚身→连段→倾山→摧岳都在失衡窗口内，
  // 连携/大招/瞬拳取消后摇，不计），失衡外以闪能连段为主——轴模式轴内强特耗闪能，富余能量在失衡外打连段
  // （次数由捏轴控制）；轴内未覆盖的怒相组最多算一组怒相（2 组）在失衡外。非轴模式无轴可捏 → 怒相内连段
  // 默认视为失衡内，只计怒相外自动连段。后摇 = 失衡外连段 − 嘲讽取消；地动山摇占比沿用怒相外滑块的拆分比例。
  const rageComboGroups = rage * comboIn // 怒相内连段组数（每怒相 2 组，几乎全在失衡内）
  const axisInCombos = axisCombo + Math.max(0, Math.floor(rageDiDongCombo)) // 轴内捏的连段块总数（×窗口）
  const uncoveredRage = axisActive ? Math.min(Math.max(0, rageComboGroups - axisInCombos), 2) : 0
  const outStunCombos = comboOut + uncoveredRage
  const taunt = Math.max(0, Math.min(Math.floor(tauntCancelCount), outStunCombos))
  const comboOutRecovery = outStunCombos - taunt
  const lunDaoShare = comboOut > 0 ? lunDaoComboOut / comboOut : 0
  const lunDaoRecovery = Math.round(comboOutRecovery * lunDaoShare)
  const diDongRecovery = comboOutRecovery - lunDaoRecovery

  return {
    rageCount: rage,
    furyTotal: INITIAL_FURY + dodge * FURY_DODGE + parry * FURY_PARRY + block * FURY_BLOCK + dual * FURY_DUAL + flashSpent * FURY_PER_FLASH,
    dualCounterCount: dual,
    comboOutCount: comboOut,
    diDongComboCount: diDongComboOut,
    axisExSpend: axisSpend,
    axisComboCount: axisCombo,
    rageDiDongComboCount: diDongRage,
    lunDaoRageCount: lunDaoRage,
    shiZiHouNuCount: shiZiHouNu,
    diDongRageCount: diDongRage,
    shanYaoNuRageCount: shanYaoNuRage,
    lunDaoOutCount: lunDaoComboOut,
    shiZiHouNuOutCount: lunDaoComboOut,
    diDongOutCount: diDongComboOut,
    shanYaoNuOutCount: diDongComboOut,
    shanYaoRageCount: shanYaoRage,
    flashIncome: FLASH_INCOME + rage * swayRefundPerRage,
    flashSpent,
    swayExCount,
    tauntCancelCount: taunt,
    outStunComboCount: outStunCombos,
    axisInComboCount: axisInCombos,
    comboOutRecoveryCount: comboOutRecovery,
    lunDaoRecoveryCount: lunDaoRecovery,
    diDongRecoveryCount: diDongRecovery,
  }
}

/**
 * 明王时间轴覆盖（非6命，失衡轴内；用户口径）：
 * - 轴内般岳槽位动作按 startTime 排序扫描（每条轴独立）；
 * - 只有怒相技能——怒相连段块 'banyue-combo'（论道→狮子吼·怒）/ 'banyue-combo-didong'（地动→山摇·怒）——触发明王窗口 8s：
 *   第一次 → 2 层；窗口内再次触发 → 3 层并刷新窗口。
 *   单招论道/狮子吼·怒 等是普通强特（付费），不触发但可享受窗口。
 * - 触发块自身不享受（明王"释放后"生效）；落在窗口内的后续招式按当前层数享受。
 * - 返回每个 moveId 的实例加权平均层数（同一招式多个块按 count 加权）。
 * - 6命：明王 30s + 任意强特常态刷新 → 满覆盖，不扫描（调用方直接走全局 buff）。
 */
export function computeBanyueMingwangStacks(
  slot: number,
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
  cinemaLevel: number,
): Map<string, number> {
  if (cinemaLevel >= 6) return new Map<string, number>()
  const triggerIds = new Set<string>(['banyue-combo', 'banyue-combo-didong'])
  const actions = axes
    .flatMap(axis => axis.actions ?? [])
    .filter(a => a.slot === slot)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
  const duration = 8

  let curStacks = 0
  let windowEnd = Number.NEGATIVE_INFINITY
  const weighted: Map<string, { total: number; count: number }> = new Map()
  for (const act of actions) {
    const start = act.startTime ?? 0
    const count = Math.max(0, Math.floor(act.count) || 1)
    if (triggerIds.has(act.moveId)) {
      curStacks = curStacks >= 2 ? 3 : 2
      windowEnd = start + duration
      // 触发块自身不享受（明王释放后生效）
      continue
    }
    const stacks = start <= windowEnd ? curStacks : 0
    if (stacks <= 0) continue
    const prev = weighted.get(act.moveId) ?? { total: 0, count: 0 }
    weighted.set(act.moveId, { total: prev.total + stacks * count, count: prev.count + count })
  }
  const result = new Map<string, number>()
  for (const [moveId, w] of weighted) {
    result.set(moveId, w.count > 0 ? w.total / w.count : 0)
  }
  return result
}

/**
 * 明王窗口逐块标注（轴编辑器可视化用）：返回 `${axisIndex}:${actionIndex}` → { layers, trigger }。
 * 触发块标 trigger=true（层数为触发后的层数，自身不享受）；落窗块标当前层数；窗外块 0 层。
 * 6命不扫描（满覆盖，UI 单独提示）。
 */
export function computeBanyueMingwangBlocks(
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
  banyueSlot: number,
  cinemaLevel: number,
): Map<string, { layers: number; trigger: boolean }> {
  const out = new Map<string, { layers: number; trigger: boolean }>()
  if (cinemaLevel >= 6) return out
  const triggerIds = new Set<string>(['banyue-combo', 'banyue-combo-didong'])
  axes.forEach((axis, ai) => {
    let curStacks = 0
    let windowEnd = Number.NEGATIVE_INFINITY
    const indexed = axis.actions
      .map((a, aii) => ({ a, aii }))
      .filter(x => x.a.slot === banyueSlot)
      .sort((x, y) => (x.a.startTime ?? 0) - (y.a.startTime ?? 0))
    for (const { a, aii } of indexed) {
      const start = a.startTime ?? 0
      const key = `${ai}:${aii}`
      if (triggerIds.has(a.moveId)) {
        curStacks = curStacks >= 2 ? 3 : 2
        windowEnd = start + 8
        out.set(key, { layers: curStacks, trigger: true })
      } else {
        out.set(key, { layers: start <= windowEnd ? curStacks : 0, trigger: false })
      }
    }
  })
  return out
}

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    for (const m of cat.moves) {
      if (m.id === moveId) return m
    }
  }
  return null
}

function rowValue(move: SkillMove | null, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
}

function buildBanyueCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true // 强特全部由模块生成（怒相山威/怒相外论道/地动）
  cfg.exSpecialCountFloor = true
  const record = cfg as unknown as Record<string, unknown>
  record.banyueCinemaLevel = cinemaLevel

  // 预存倍率/动作时间（双键：常量名供 estimateExSpecialTime，moveId 供 buildExecutions 按招式查表）
  const times: Record<string, number> = {}
  const dmg: Record<string, number> = {}
  for (const [key, id] of Object.entries(MOVE)) {
    const mv = findMoveById(skills, id)
    times[key] = mv?.actionTime ?? 0
    dmg[key] = rowValue(mv, 'damage')
    times[id] = mv?.actionTime ?? 0
    dmg[id] = rowValue(mv, 'damage')
  }
  record.banyueMoveTimes = times
  record.banyueMoveDmg = dmg
  cfg.banyueMoveTimes = times
  cfg.banyueMoveDmg = dmg
}

function applyBanyuePanel({ panel, cinemaLevel }: AgentPanelInput): void {
  const cfg = panel as unknown as { banyueRageCoverage?: number }
  const rageCov = Math.max(0, Math.min(1, cfg.banyueRageCoverage ?? 1))

  // 怒相增益（强特/支援突击后，30s；覆盖率滑块近似）
  if (rageCov > 0) {
    const c2 = cinemaLevel >= 2 ? C2_BUFF_BONUS : 0
    panel.sheerForceFlat = (panel.sheerForceFlat ?? 0) + RAGE_BUFF_SHEER * rageCov
    panel.fireDmg = (panel.fireDmg ?? 0) + (RAGE_BUFF_FIRE + c2) * rageCov
    panel.critDmg = (panel.critDmg ?? 0) + (RAGE_BUFF_CRIT + c2) * rageCov
  }

  // 明王 6命（满覆盖）：30s + 任意强特常态刷新 → 全局 buff 火伤 +39%（3层×13%），轴/非轴一致；
  // 非6命走时间轴扫描（轴模式）或覆盖率滑块（非轴模式），不在此施加
  if (cinemaLevel >= 6 && (panel.additionalAbilityActive ?? 0) > 0) {
    const perStack = MINGWANG_BASE_PER_STACK + C6_MINGWANG_EXTRA
    panel.fireDmg = (panel.fireDmg ?? 0) + MINGWANG_MAX_STACKS * perStack
  }

  // 影画1·战栗（全覆盖，用户确认）：对战栗敌人贯穿伤害+10%；摧岳命中失衡敌人失衡时长+2s
  if (cinemaLevel >= 1) {
    panel.sheerDmgBonus = (panel.sheerDmgBonus ?? 0) + C1_SHEER_DMG_BONUS
    panel.stunDurationBonusSeconds = (panel.stunDurationBonusSeconds ?? 0) + C1_STUN_DURATION
  }
}

function buildBanyueExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.banyueCinemaLevel ?? 0)))
  const axisEx = readAxisExCounts(cfg)
  const axisSpend = axisExSpendOf(axisEx)
  const axisCombo = axisEx['banyue-combo'] ?? 0
  const cycle = computeBanyueRageCycle(
    cfg.dodgeCounterCount ?? DEFAULT_DODGE,
    cfg.parryCount ?? DEFAULT_PARRY,
    cfg.blockCount ?? DEFAULT_BLOCK,
    cfg.dualCounterCount ?? DEFAULT_DUAL,
    cfgNum(cfg, 'banyue.diDongComboCount', DEFAULT_DIDONG_COMBO),
    axisSpend,
    axisCombo,
    cinemaLevel,
    axisEx['banyue-combo-didong'] ?? 0,
    // 失衡外连段末尾后摇的嘲讽取消次数（主页交互栏录入，每次取消一次后摇）
    Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).tauntCancelCount ?? 0))),
    // 轴模式：失衡内 = 轴内实际捏的连段块，失衡外 = 全部连段 − 轴内捏块（后摇按轴外单位数计）
    !!(cfg as unknown as Record<string, unknown>).banyueAxisActive,
  )
  record.banyueRageCoverage = Math.max(0, Math.min(1, cfgNum(cfg, 'banyue.rageGainCoverage', 1)))
  record.banyueSwayExCount = cycle.swayExCount

  const times = (record.banyueMoveTimes ?? {}) as Record<string, number>
  const dmg = (record.banyueMoveDmg ?? {}) as Record<string, number>
  const rage = cycle.rageCount
  if (rage <= 0) return

  const push = (moveId: string, name: string, count: number, category: string, note: string, energyConsume = 0, force = false) => {
    if (count <= 0 && !force) return
    executions.push({
      moveId,
      moveName: name,
      category,
      count,
      actionTime: times[moveId] ?? 0,
      comboAlignRatio: 0,
      totalTime: (times[moveId] ?? 0) * count,
      totalComboAlignTime: 0,
      energyConsume,
      totalEnergyConsume: energyConsume * count,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: dmg[moveId] ?? 0,
      damageMultiplierOverride: true,
      skillTableNote: note,
    })
  }

  // 每次怒相：焚身 → 山威连段（论道+狮吼怒 / 地动+山摇·怒，按轴内捏的 didong 块拆分）→ 倾山 → 摧岳
  push(MOVE.fenShen, '普通攻击：焚身（入怒相）', rage, 'basic', `焚身 ×${rage}：221.7%，120嗔火入怒相`)
  push(MOVE.lunDao, '强化特殊技：论道（山威·论道连段）', cycle.lunDaoRageCount, 'special', `山威免费 ×${cycle.lunDaoRageCount}：325.2%`, 0)
  push(MOVE.shiZiHouNu, '强化特殊技：狮子吼·怒（山威·论道连段）', cycle.shiZiHouNuCount, 'special', `山威免费 ×${cycle.shiZiHouNuCount}：600.4%（论道派生连段）`, 0)
  push(MOVE.diDong, '强化特殊技：地动（山威·地动山摇连段）', cycle.diDongRageCount, 'special', `山威免费 ×${cycle.diDongRageCount}：510%（地动山摇连段）`, 0)
  push(MOVE.shanYaoNu, '强化特殊技：山摇·怒（山威·地动山摇连段）', cycle.shanYaoNuRageCount, 'special', `山威免费 ×${cycle.shanYaoNuRageCount}：650.6%（地动派生连段）`, 0)
  push(MOVE.shanYao, '强化特殊技：山摇（山威）', cycle.shanYaoRageCount, 'special', `剩余山威 ×${cycle.shanYaoRageCount}：342.9%`, 0)
  push(MOVE.qingShan, '普通攻击：倾山（退出怒相）', rage, 'basic', `倾山 ×${rage}：1739.9%，退出怒相`)
  push(MOVE.cuiYue, '普通攻击：摧岳', rage, 'basic', `摧岳 ×${rage}：756.7%`)
  // 怒相外连段（自动 = floor(剩余闪能/60)，滑块拆分论道连段/地动山摇连段）
  push(MOVE.lunDao, '强化特殊技：论道（怒相外·论道连段）', cycle.lunDaoOutCount, 'special', `怒相外论道连段 ×${cycle.lunDaoOutCount}：325.2%`, EX_COST)
  push(MOVE.shiZiHouNu, '强化特殊技：狮子吼·怒（怒相外·论道连段）', cycle.shiZiHouNuOutCount, 'special', `怒相外论道连段 ×${cycle.shiZiHouNuOutCount}：600.4%（论道派生）`, 40)
  push(MOVE.diDong, '强化特殊技：地动（怒相外·地动山摇连段）', cycle.diDongOutCount, 'special', `怒相外地动山摇连段 ×${cycle.diDongOutCount}：510%`, EX_COST)
  push(MOVE.shanYaoNu, '强化特殊技：山摇·怒（怒相外·地动山摇连段）', cycle.shanYaoNuOutCount, 'special', `怒相外地动山摇连段 ×${cycle.shanYaoNuOutCount}：650.6%（地动派生）`, 40)
  // 失衡外连段末尾强特后摇（用户口径）：时长 = 末尾强特自身动作时间，期间不能平A → 占用战场时间
  // （时间已计入 estimateExSpecialTime 的 necessaryTime；此处推执行行供执行计划展示，0 倍率不进伤害池）。
  // 失衡内（怒相内连段）默认全取消；嘲讽取消次数逐次抵消失衡外后摇。
  const recoveryRows: { moveId: string; name: string; count: number; time: number; note: string }[] = []
  if (cycle.lunDaoRecoveryCount > 0) {
    const t = times[MOVE.shiZiHouNu] ?? 0
    recoveryRows.push({ moveId: 'banyue-recovery-lundao', name: '后摇（狮子吼·怒）', count: cycle.lunDaoRecoveryCount, time: t, note: `失衡外论道连段末尾后摇 ×${cycle.lunDaoRecoveryCount}：${t.toFixed(3)}s/次（期间不能平A，嘲讽可取消）` })
  }
  if (cycle.diDongRecoveryCount > 0) {
    const t = times[MOVE.shanYaoNu] ?? 0
    recoveryRows.push({ moveId: 'banyue-recovery-didong', name: '后摇（山摇·怒）', count: cycle.diDongRecoveryCount, time: t, note: `失衡外地动山摇连段末尾后摇 ×${cycle.diDongRecoveryCount}：${t.toFixed(3)}s/次（期间不能平A，嘲讽可取消）` })
  }
  for (const r of recoveryRows) {
    executions.push({
      moveId: r.moveId,
      moveName: r.name,
      category: 'special',
      count: r.count,
      actionTime: r.time,
      comboAlignRatio: 0,
      totalTime: r.time * r.count,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: 0,
      damageMultiplierOverride: true,
      skillTableNote: r.note,
    })
  }
  // 轴内捏的强特（地动/山摇·怒/山摇/狮子吼/单段论道/单段狮吼怒）：次数=轴内块×窗口数（useResourceCalc 注入）。
  // 没捏的也强制占位（count 0 → 轴编辑器里显示为 ×0 灰块，可点选放置）——默认能量全打连段在轴外，捏轴可自由改捏。
  const forcedPool: { moveId: string; name: string }[] = [
    { moveId: MOVE.shanYao, name: '强化特殊技：山摇（轴内·强特）' },
    { moveId: MOVE.shiZiHou, name: '强化特殊技：狮子吼（轴内·强特）' },
    { moveId: MOVE.diDong, name: '强化特殊技：地动（轴内·强特）' },
    { moveId: MOVE.shanYaoNu, name: '强化特殊技：山摇·怒（轴内·强特）' },
  ]
  const axisPushed = new Set<string>()
  for (const exec of executions) axisPushed.add(exec.moveId ?? '')
  for (const f of forcedPool) {
    const cnt = axisEx[f.moveId] ?? 0
    if (axisPushed.has(f.moveId) && cnt <= 0) continue // 已有行（如山威山摇、滑块地动）且没捏 → 不重复占位
    const cost = AXIS_EX_COST[f.moveId] ?? 0
    // 已存在行但轴内也捏了 → 另起一行（付费强特，与免费山威行分开计费/显示）
    push(f.moveId, f.name, cnt, 'special', `轴内捏造 ×${cnt}：${cost}闪能/次`, cost, true)
  }
  // 轴内捏的连段块（banyue-combo）= 怒相免费连段的表达（山威，一次怒相 4 山威 = 最多 2 组）：
  // 不额外生成执行行 —— 由失衡轴栈引擎展开后认领上面怒相内/怒相外的论道+狮子吼·怒行（池守恒，捏轴只挑选不改变总量）。
  // 付费连段由玩家用普通论道块 + 狮子吼·怒块表达（20+40 闪能，AXIS_EX_COST 已计）。
}

function patchBanyueExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.banyueCinemaLevel ?? 0)))

  // 闪反/普通弹刀走通用路径（dodgeCounterCount→扬砾、parryCount→铁壁+昂霄，与所有角色一致）；
  // 般岳专属：金身弹刀 + 双反（双反 = 完美闪避不打出扬砾 + 金身弹刀）→ 不动如山 + 冲霄 行
  const dual = Math.max(0, Math.floor(Number(cfg.dualCounterCount ?? 0)))
  const block = Math.max(0, Math.floor(Number(cfg.blockCount ?? 0)))
  const chongXiao = block + dual
  const times = (record.banyueMoveTimes ?? {}) as Record<string, number>
  // 不动如山（招架/金身动作）：金身弹刀 + 双反 次数 → 动作行（0.666s 耗时 + daze 143.7，失衡贡献）
  if (chongXiao > 0 && !executions.some(e => e.moveId === '1471011')) {
    const time = times['1471011'] ?? 0.666
    executions.push({
      moveId: '1471011',
      moveName: '闪避：不动如山',
      category: 'dodge',
      count: chongXiao,
      actionTime: time,
      comboAlignRatio: 0,
      totalTime: time * chongXiao,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      // 不设 dazeMultiplierOverride：enrichExecutionPlan 按 moveId 1471011 回填 daze 143.7
    })
  }
  // 支援突击：冲霄（金身弹刀 + 双反 次数）——与不动如山配套的攻击动作
  if (chongXiao > 0 && !executions.some(e => e.moveId === '1471029')) {
    const time = times['1471029'] ?? 0
    executions.push({
      moveId: '1471029',
      moveName: '支援突击：冲霄',
      category: 'assist',
      count: chongXiao,
      actionTime: time,
      comboAlignRatio: 0,
      totalTime: time * chongXiao,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      // 不设 damageMultiplierOverride：enrichExecutionPlan 按 moveId 1471029 从倍率表回填
    })
  }

  if (cinemaLevel < 4) return
  // 影画4：狮子吼·怒 / 山摇·怒 / 倾山 / 摧岳 伤害 +30%（moveId 级）
  for (const exec of executions) {
    if (exec.moveId && C4_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + C4_DMG_BONUS
    }
  }
}

function buildBanyueResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    banyueRageCycle: computeBanyueCycleFromCfg(cfg),
    // 轴模式自动补齐量（useResourceCalc 注入 cfg.banyueInteractionTopUp，保底语义）
    banyueInteractionTopUp: (cfg as unknown as Record<string, unknown>).banyueInteractionTopUp as BanyueInteractionTopUp | undefined,
  }
}

function buildBanyueResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.banyueRageCycle
  if (!cycle) return []
  // 后摇损失：执行计划里 banyue-recovery-* 行的总时长 = 未被取消的后摇占用的战场时间（= 平A时间损失）
  const recoveryTime = (result.executions ?? [])
    .filter(e => e.moveId?.startsWith('banyue-recovery'))
    .reduce((s, e) => s + (e.totalTime ?? 0), 0)
  const basicTime = result.timeAllocation?.basicAttackTime ?? 0
  const lossPct = recoveryTime + basicTime > 0 ? (recoveryTime / (recoveryTime + basicTime)) * 100 : 0
  const recoveryDetail = `失衡外连段 ${cycle.outStunComboCount} 组（轴模式 = 闪能连段 ${cycle.comboOutCount} + 轴内未覆盖怒相组≤2，轴内捏块 ${cycle.axisInComboCount}；非轴 = 怒相外自动连段）− 嘲讽取消 ${cycle.tauntCancelCount} → 剩余后摇 ${cycle.comboOutRecoveryCount} 次（论道 ${cycle.lunDaoRecoveryCount} / 地动山摇 ${cycle.diDongRecoveryCount}），每次 = 末尾强特自身时长，期间不能平A`
  return [{
    id: 'banyue-rage-cycle',
    title: '般岳·嗔火/怒相循环',
    summary: `怒相 ${cycle.rageCount} 次 · 嗔火 ${fmt(cycle.furyTotal, 0)} · 山威免费强特 ${cycle.swayExCount}`,
    rows: [
      { label: '嗔火来源', value: String(fmt(cycle.furyTotal, 0)), detail: `闪避×4 + 弹刀×4 + 金身×6 + 双反×10（${cycle.dualCounterCount}次） + 怒相外闪能×0.5` },
      { label: '怒相内强特', value: `${cycle.lunDaoRageCount ? `论道×${cycle.lunDaoRageCount} + 狮子吼·怒×${cycle.shiZiHouNuCount}` : ''}${cycle.diDongRageCount ? `${cycle.lunDaoRageCount ? ' + ' : ''}地动×${cycle.diDongRageCount} + 山摇·怒×${cycle.shanYaoNuRageCount}` : ''}${cycle.shanYaoRageCount ? ` + 山摇×${cycle.shanYaoRageCount}` : ''}`, detail: '山威免费（回10闪能/次），每怒相 4 个；怒相内 2 组连段可自由分配论道/地动山摇（轴内捏块决定）' },
      { label: '怒相外连段', value: `论道连段×${cycle.lunDaoOutCount} + 地动山摇连段×${cycle.diDongComboCount}`, detail: `共 ${cycle.comboOutCount} 组（60闪能/组，自动=floor(剩余闪能/60)）；[普]耗闪能产嗔火、[怒]耗山威免费；闪能收入 ${fmt(cycle.flashIncome, 0)} / 支出 ${fmt(cycle.flashSpent, 0)}` },
      { label: '怒相序列', value: `焚身→${[cycle.lunDaoRageCount ? `论道→狮子吼·怒×${cycle.lunDaoRageCount}` : '', cycle.diDongRageCount ? `地动→山摇·怒×${cycle.diDongRageCount}` : ''].filter(Boolean).join(' + ') || '（无连段）'}→倾山→摧岳`, detail: '每次怒相 120 嗔火；倾山退出、摧岳（C6 附伤载体）' },
      { label: '强特连段后摇', value: `失衡外 ×${cycle.comboOutRecoveryCount}（嘲讽取消 ${cycle.tauntCancelCount}）`, detail: recoveryDetail },
      { label: '后摇损失伤害（估算）', value: `${recoveryTime.toFixed(2)}s 平A时间 · 占平A ${lossPct.toFixed(1)}%`, detail: `未取消的失衡外连段末尾后摇计入必做前台时间，直接压缩平A时间池 → 平A伤害损失 ≈ 损失时间 ÷ (平A时间 + 损失时间)；全部嘲讽取消可回收 ${recoveryTime.toFixed(2)}s 平A时间。` },
      ...(result.banyueInteractionTopUp && (result.banyueInteractionTopUp.parry > 0 || result.banyueInteractionTopUp.dual > 0)
        ? [{ label: '轴模式自动补齐', value: `弹刀 +${result.banyueInteractionTopUp.parry} · 双反 +${result.banyueInteractionTopUp.dual}`, detail: '保底语义：轴内怒相/终结技对嗔火/喧响的硬性需求不足时自动补齐（有效次数 = 交互栏输入 + 补齐，不覆盖输入）；弹刀补喧响（+215/次）、双反补嗔火（+10/次）；设置 banyue.autoTopUpInteractions 可关闭' }]
        : []),
    ],
    footer: '怒相增益按覆盖率滑块近似；明王非6命按轴内时间轴扫描（非轴模式按覆盖率滑块），6命全局 +39%；后摇时长 = 末尾强特（狮子吼·怒/山摇·怒）自身动作时间。',
  }]
}

/**
 * 失衡轴内般岳槽位捏的强特/连段块次数（useResourceCalc 注入 cfg.banyueAxisEx，moveId → 总次数）。
 * 轴模式：玩家在轴里捏什么就按什么算（能量先扣这些，剩余闪能自动补连段），不禁止任何强特。
 */
/**
 * 般岳招式轴内标注元数据（动作池/块显示用）：
 * - tag：怒 = 怒相技能（怒相连段块，山威免费 4 点/怒相 = 2 组，明王触发源）；普 = 普通强特（付费，不触发但可享受窗口）
 * - cost：闪能消耗（预算显示用）；连段块 0 = 不耗闪能
 * 招式名直接用倍率表 zhCN（如「狮子吼·怒」——名字带「·怒」即 40 耗能，其余 20），不写倍率（随等级变）。
 */
export const BANYUE_AXIS_MOVE_META: Record<string, { tag: '怒' | '普'; cost: number }> = {
  'banyue-combo': { tag: '怒', cost: 0 },
  'banyue-combo-didong': { tag: '怒', cost: 0 },
  [MOVE.lunDao]: { tag: '普', cost: EX_COST },
  [MOVE.shiZiHou]: { tag: '普', cost: EX_COST },
  [MOVE.shanYao]: { tag: '普', cost: EX_COST },
  [MOVE.diDong]: { tag: '普', cost: EX_COST },
  [MOVE.shiZiHouNu]: { tag: '普', cost: 40 },
  [MOVE.shanYaoNu]: { tag: '普', cost: 40 },
}

// 仅普通强特耗闪能；连段块（怒相技能）耗山威免费，不在此列
export const AXIS_EX_COST: Record<string, number> = {
  [MOVE.lunDao]: EX_COST,
  [MOVE.shiZiHou]: EX_COST,
  [MOVE.shanYao]: EX_COST,
  [MOVE.diDong]: EX_COST,
  [MOVE.shiZiHouNu]: 40,
  [MOVE.shanYaoNu]: 40,
}

export function readAxisExCounts(cfg: AgentCharConfigInput['cfg']): Record<string, number> {
  const record = cfg as unknown as Record<string, unknown>
  const raw = (record.banyueAxisEx ?? {}) as Record<string, number>
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.max(0, Math.floor(Number(v) || 0))
    if (n > 0) out[k] = n
  }
  return out
}

function axisExSpendOf(counts: Record<string, number>): number {
  let spend = 0
  for (const [k, v] of Object.entries(counts)) spend += (AXIS_EX_COST[k] ?? 0) * v
  return spend
}

/**
 * 资源池迭代/能量计算共用入口：从 cfg 读取全部输入（触发次数/滑块/轴内强特/命座）并跑嗔火固定点。
 * core/resource 用同一口径计算般岳的强特总数与山威回闪能，避免「闪能/20」通用路径把免费强特算错。
 */
export function computeBanyueCycleFromCfg(cfg: AgentCharConfigInput['cfg']): BanyueRageCycle {
  const axisEx = readAxisExCounts(cfg)
  return computeBanyueRageCycle(
    cfg.dodgeCounterCount ?? DEFAULT_DODGE,
    cfg.parryCount ?? DEFAULT_PARRY,
    cfg.blockCount ?? DEFAULT_BLOCK,
    cfg.dualCounterCount ?? DEFAULT_DUAL,
    cfgNum(cfg, 'banyue.diDongComboCount', DEFAULT_DIDONG_COMBO),
    axisExSpendOf(axisEx),
    axisEx['banyue-combo'] ?? 0,
    Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).banyueCinemaLevel ?? 0))),
    // 怒相内「地动→山摇·怒」连段组数 = 轴内捏的 banyue-combo-didong 块（非轴模式 banyueAxisEx 为空 → 0）
    axisEx['banyue-combo-didong'] ?? 0,
    // 失衡外连段末尾后摇的嘲讽取消次数（主页交互栏录入，每次取消一次后摇）
    Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).tauntCancelCount ?? 0))),
    // 轴模式：失衡内 = 轴内实际捏的连段块，失衡外 = 全部连段 − 轴内捏块（后摇按轴外单位数计）
    !!(cfg as unknown as Record<string, unknown>).banyueAxisActive,
  )
}

function cfgNum(cfg: AgentCharConfigInput['cfg'], key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

const settings: MechanicSetting[] = [
  {
    id: 'banyue.diDongComboCount',
    label: '般岳·地动山摇连段数（怒相外）',
    description: '怒相外连段（闪能 60/组）自动打满 = floor(剩余闪能/60)；本滑块分配其中多少组打成「地动→山摇·怒」，其余打「论道→狮子吼·怒」。默认 0 = 全打论道连段。怒相内 2 组山威免费连段固定为论道→狮子吼·怒。',
    default: DEFAULT_DIDONG_COMBO,
    min: 0,
    max: 20,
    step: 1,
    suffix: '组',
  },
  {
    id: 'banyue.rageGainCoverage',
    label: '般岳·怒相增益覆盖率',
    description: '强特/支援突击后的贯穿+300/火伤+36%/暴伤+36%（30s）覆盖率；默认100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'banyue.autoTopUpInteractions',
    label: '般岳·轴模式自动补齐交互次数（保底）',
    description: '轴模式下轴内怒相/终结技对资源有硬性需求：嗔火不足自动抬双反（+10/次）、喧响不足自动抬弹刀（+215/次，普通弹刀）。有效次数 = 用户输入 + 自动补齐（保底语义，不覆盖输入，交互栏/资源卡片会显示补齐量）；关闭则保持现状（资源不足只提示不跳过）。',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
  },
  {
    id: 'banyue.mingwangCoverage',
    label: '般岳·明王覆盖率（非轴模式）',
    description: '非6命明王为 8s 窗口（怒相二连触发，2层→3层刷新），非失衡轴模式无时间轴可扫描 → 按覆盖率滑块近似：火伤 +15%×覆盖率（满层3×5%）；轴模式由轴内时间轴扫描精确计算，此滑块失效。6命满覆盖 +39%，无需设置。',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const banyueMechanic: AgentMechanicModule = {
  id: 'agent:banyue',
  agentIds: [AGENT_ID],
  name: '般岳',
  description: '嗔火→怒相循环（山威免费连段）、怒相增益、影画4/6 moveId 级增伤与倾山附伤。',
  applyPanel: applyBanyuePanel,
  buildCharConfig: buildBanyueCharConfig,
  estimateExSpecialTime: ({ cfg, exSpecialCount, ultimateCount }) => {
    const record = cfg as unknown as Record<string, unknown>
    const axisEx = readAxisExCounts(cfg)
    const cycle = computeBanyueCycleFromCfg(cfg)
    const times = (record.banyueMoveTimes ?? {}) as Record<string, number>
    const rage = cycle.rageCount
    // 计划内必做动作：焚身+倾山+摧岳（每次怒相）+ 全部强特（山威连段 + 怒相外连段 + 地动 + 轴内捏的强特/连段块）
    const sequenceTime = rage * ((times.fenShen ?? 0) + (times.qingShan ?? 0) + (times.cuiYue ?? 0))
    let axisExTime = 0
    for (const [mid, cnt] of Object.entries(axisEx)) {
      if (mid === 'banyue-combo') axisExTime += cnt * ((times.lunDao ?? 0) + (times.shiZiHouNu ?? 0))
      else if (mid === 'banyue-combo-didong') axisExTime += cnt * ((times.diDong ?? 0) + (times.shanYaoNu ?? 0))
      else axisExTime += cnt * (times[mid] ?? 0)
    }
    const exTime = (cycle.lunDaoRageCount + cycle.lunDaoOutCount) * (times.lunDao ?? 0)
      + (cycle.shiZiHouNuCount + cycle.shiZiHouNuOutCount) * (times.shiZiHouNu ?? 0)
      + cycle.shanYaoRageCount * (times.shanYao ?? 0)
      + (cycle.diDongRageCount + cycle.diDongOutCount) * (times.diDong ?? 0)
      + (cycle.shanYaoNuRageCount + cycle.shanYaoNuOutCount) * (times.shanYaoNu ?? 0)
      + axisExTime
    // 失衡外连段末尾强特后摇（用户口径）：时长 = 末尾强特自身动作时间，期间不能平A → 计入必做前台时间，
    // 平A时间 = 总时间 − 无敌 − 必做前台，后摇越多平A池越小（战场时间被占用）。嘲讽取消次数已从 cycle 扣减。
    const recoveryTime = cycle.lunDaoRecoveryCount * (times.shiZiHouNu ?? 0)
      + cycle.diDongRecoveryCount * (times.shanYaoNu ?? 0)
    // 金身弹刀 + 双反（不动如山 + 冲霄 行）：真实占用战场时间，计入必做前台 → 压缩平A池
    // （否则这两行时间只出现在执行计划里、不参与时间预算，总计会超战斗时间）
    const chongXiao = Math.max(0, Math.floor(Number(cfg.blockCount ?? 0)))
      + Math.max(0, Math.floor(Number(cfg.dualCounterCount ?? 0)))
    const blockDualTime = chongXiao * ((times.buDongRuShan ?? 0.666) + (times.chongXiao ?? 0))
    return { necessaryTime: sequenceTime + exTime + recoveryTime + blockDualTime, comboAlignTime: 0 }
  },
  buildExecutions: buildBanyueExecutions,
  patchExecutions: patchBanyueExecutions,
  buildResourceResult: buildBanyueResourceResult,
  resourceSections: buildBanyueResourceSections,
  // 失衡轴动作块：怒相连段（论道→狮子吼·怒 / 地动→山摇·怒）= 怒相技能，山威免费（4 山威/怒相 = 2 组），
  // 不耗闪能不回嗔火；怒相内 2 组连段可在两个块间自由分配（didong 块优先占山威配额），明王触发源两者皆认领
  combos: {
    'banyue-combo': {
      label: '怒相连段（论道→狮子吼·怒）',
      energyCost: COMBO_COST,
      moves: [{ moveId: MOVE.lunDao, count: 1 }, { moveId: MOVE.shiZiHouNu, count: 1 }],
    },
    'banyue-combo-didong': {
      label: '怒相连段（地动→山摇·怒）',
      energyCost: COMBO_COST,
      moves: [{ moveId: MOVE.diDong, count: 1 }, { moveId: MOVE.shanYaoNu, count: 1 }],
    },
  },
  settings,
}
