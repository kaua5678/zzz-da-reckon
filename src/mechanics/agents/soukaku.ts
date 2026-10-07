/**
 * 苍角（1131）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心·刃旗助威：展旗（默认耗涡流翻倍）→ 全队攻击 初始攻×40% 顶 1000
 *   （文本为自身+入场者传递；整局按全队满覆盖近似，与现有草稿一致）
 * - 额外能力（同属性或同阵营）：耗涡流展旗 → 全队冰伤 +20%
 * - 影画4：展旗命中 → 冰抗 -10%
 *
 * 模块
 * - 影画1：增益时长 +8s → 仅延长覆盖，默认已满覆盖，无额外数值
 * - 影画2：命中概率叠涡流 / 满层转回能 — 不逐帧；略过（标注近似）
 * - 影画3/5：通用技能等级
 * - 影画6：霜染刃旗强化普攻/冲刺次数上限 12、伤害 +45% → 强化段执行级 dmgBonus +45%
 * - 终结技：其他角色 +10 能量，下一位换入额外 +20 → 邻位 30/10（同露西/丽娜）
 * - 强特自循环（2026-09-05 用户口径）：每击扇风 = 扇子(1131011, 525.3%) + 风团(1131010,
 *   204.4%×体型段数 小0/中3/大6)，30 能量/击（60 能量 = 2 击 + 2 风团）→
 *   cfg.exSpecialEnergyConsume = 30×击数（强特次数按总能量收敛 = 自我能量循环的供给侧）；
 *   下砸×1（劈斩关 = 展旗·集合啦#1 1131012 500.9%/1.25s；劈斩开 = 快速展旗·集合啦#2
 *   1131013 280.9%/0.7s 更快；集合啦#3 被玩家冲刺打断不录）；下砸后直接跟冲刺攻击·霜染
 *   (1131016)×1，再接全合轴的打年糕·霜染#3(1131006)×1（comboAlignRatio=1 不占前台）——
 *   打年糕#3 次数 = 展旗(下砸)次数 = 强特次数，霜染段回能/喧响喂回强特。
 *
 * 未建模：涡流层数状态机、展旗触发快支时间轴、霜染 6/12 次次数上限循环、
 *         扇/团段喧响单独计入（衍生段沿用艾莲剑气口径 decibel=0）。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
} from '../types'
import { cfgMechanicSettingRaw } from '@/utils/mechanicSettingCfg'
import { cfgMoveActionTime } from '@/utils/moveActionTimeCfg'
import { ultNeighborPerTargetAmounts } from '@/mechanics/ultNeighborEnergy'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'

export const SOUKAKU_ID = '1131'

/** 霜染刃旗强化普攻 #1–#3 + 强化冲刺 */
export const SOUKAKU_FROST_MOVE_IDS = new Set([
  '1131004', '1131005', '1131006', '1131016',
])

export const SOUKAKU_C6_DMG_BONUS = 45
export const SOUKAKU_C2_ENERGY_PER_TRIGGER = 1.2

// ============ 强特自循环（2026-09-05 用户口径） ============

/** 每击扇风能量成本（30 能量 = 1 扇子 + 1 风团；60 能量 = 2 击） */
export const SOUKAKU_SWING_ENERGY = 30
/** 每次强特的扇风击数（1–2，按能量决定；默认 2） */
export const SOUKAKU_SWINGS_DEFAULT = 2
export const SOUKAKU_SWINGS_MIN = 1
export const SOUKAKU_SWINGS_MAX = 2
/** 扇子直伤行（首击由通用强特行发行，模块补第 2 击）；actionTime 读 cfg.moveActionTimes（catalog，CC-409） */
export const SOUKAKU_FAN_MOVE_ID = '1131011'
/** 风团投射物行：每击一个，命中数按敌人体型（小0/中3/大6，同艾莲剑气口径）；actionTime 读 catalog */
export const SOUKAKU_WIND_BALL_MOVE_ID = '1131010'
export const SOUKAKU_WIND_HITS_BY_BODY_SIZE: Record<string, number> = {
  small: 0,
  medium: 3,
  large: 6,
}
/** 下砸（劈斩关 = 展旗·集合啦#1）；劈斩开 = 快速展旗·集合啦#2（更快）；actionTime 读 catalog */
export const SOUKAKU_SLAM_MOVE_ID = '1131012'
export const SOUKAKU_CHOP_SLAM_MOVE_ID = '1131013'
/** 下砸后直接跟的冲刺攻击·霜染刃旗；actionTime 读 catalog */
export const SOUKAKU_FROST_DASH_MOVE_ID = '1131016'
/** 接全合轴的打年糕·霜染#3（次数 = 展旗次数 = 强特次数）；actionTime 读 catalog */
export const SOUKAKU_FROST_BASIC3_MOVE_ID = '1131006'
export const SOUKAKU_FROST_BASIC3_COMBO_ALIGN = 1
/** enrich 回填占位：非 0 → 倍率表值优先回填；0 = 显式禁用回填（引擎口径，见 enrichExecutionPlan） */
const RECOVERY_BACKFILL_PLACEHOLDER = 1

// @fact agent:1131/强特 口径: 强特循环 = 每击扇风(扇子 1131011 525.3%/1.16s + 风团 1131010 204.4%×体型段数 小0/中3/大6, 0.271s摊段, 30能量/击 → cfg.exSpecialEnergyConsume=30×击数, 击数滑块 soukaku.exPressCount 1-2 默认2) + 下砸×1(劈斩关=集合啦#1 1131012 500.9%/1.25s, 开=快速展旗·集合啦#2 1131013 280.9%/0.7s, 滑块 soukaku.chopSlam；集合啦#3 被玩家冲刺打断不录) + 冲刺攻击·霜染(1131016 0.4s)×1 + 打年糕·霜染#3(1131006 2.632s 全合轴 comboAlignRatio=1)×1；强特次数=floor(总能量/30×击数)，打年糕#3次数=展旗(下砸)次数=强特次数，霜染段回能喂回强特=自我能量循环；扇/团段喧响不另计(同艾莲衍生段口径) | 据 用户@2026-09-05·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/soukaku.test.ts | 锚 src/mechanics/agents/soukaku.ts#buildSoukakuExecutions | 信 确认


function clampSwings(cfg: unknown): number {
  const raw = Math.floor(Number(cfgMechanicSettingRaw(cfg, 'soukaku.exPressCount') ?? SOUKAKU_SWINGS_DEFAULT))
  return Math.min(SOUKAKU_SWINGS_MAX, Math.max(SOUKAKU_SWINGS_MIN, raw))
}

/**
 * 每次强特由本模块**补行**的前台秒数（CC-200）：扇子第 2 击 + 风团 + 下砸 + 霜染冲刺 + 打年糕#3（全合轴）。
 * `buildSoukakuExecutions` 产行与 `estimateExSpecialTime` 账本估时按同一套读法——原先账本只按通用强特时长预留，
 * 其余 ≈6s/次全靠 `timeBudgetExcess` 事后折叠追认（实测 雅-苍角-丽娜 8 强特 ≈ 47.9s）。
 * 改产行时同步本函数；`soukakuExTimeCc200.test.ts` 用真队伍断言两边相等。
 */
export function soukakuPerExExtraTime(cfg: unknown): { necessaryTime: number; comboAlignTime: number } {
  // 公开签名收 unknown（soukakuExTimeCc200.test 直传带 `setting:` 动态键的字面量；设置走 cfgMechanicSettingRaw 通用通道）。
  // r405：静态键按 Partial<CharacterOperationConfig> 读——键有类型（拼错会报错），不再经 Record。
  const typed = cfg as Partial<AgentResourceInput['cfg']>
  const swings = clampSwings(cfg)
  const hits = SOUKAKU_WIND_HITS_BY_BODY_SIZE[String(typed.bodySize ?? 'large')] ?? SOUKAKU_WIND_HITS_BY_BODY_SIZE.large
  const chop = Math.round(Number(cfgMechanicSettingRaw(cfg, 'soukaku.chopSlam') ?? 0)) >= 1
  // 六段 actionTime 读 cfg.moveActionTimes（catalog，CC-409；原常量与表值逐个相等）
  const fanAt = cfgMoveActionTime(typed, SOUKAKU_FAN_MOVE_ID)
  const ballAt = cfgMoveActionTime(typed, SOUKAKU_WIND_BALL_MOVE_ID)
  const slamAt = cfgMoveActionTime(typed, chop ? SOUKAKU_CHOP_SLAM_MOVE_ID : SOUKAKU_SLAM_MOVE_ID)
  const dashAt = cfgMoveActionTime(typed, SOUKAKU_FROST_DASH_MOVE_ID)
  const basic3At = cfgMoveActionTime(typed, SOUKAKU_FROST_BASIC3_MOVE_ID)
  const fan2 = swings >= 2 ? fanAt : 0
  const balls = hits > 0 ? swings * ballAt : 0
  return {
    necessaryTime: fan2 + balls + slamAt + dashAt + basic3At,
    comboAlignTime: basic3At * SOUKAKU_FROST_BASIC3_COMBO_ALIGN,
  }
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.soukakuCinemaLevel = cinemaLevelOf(cinemaLevel)
  // 强特能量成本 = 30 能量×击数（60 能量 = 2 击 + 2 风团，2026-09-05 用户口径）：
  // 强特次数按总能量/此成本收敛，击数滑块联动自我能量循环的供给侧。
  cfg.exSpecialEnergyConsume = SOUKAKU_SWING_ENERGY * clampSwings(cfg)
  // 影画2 满层转回能：涡流满层后再获得涡流 → 回复 1.2 能量。逐帧概率/涡流状态机未建模，
  // 按可调触发次数注入能量池（默认 5 次，用户按实际对局调整）。
  if (cinemaLevelOf(cinemaLevel) >= 2) {
    const count = Math.max(0, Math.floor(Number(cfgMechanicSettingRaw(cfg, 'soukaku.c2RefundCount') ?? 5)))
    cfg.initialEnergyGift = cfg.initialEnergyGift + SOUKAKU_C2_ENERGY_PER_TRIGGER * count
  }
}

function buildSoukakuExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  if (exCount <= 0) return
  const swings = clampSwings(cfg)
  const bodySize = String(cfg.bodySize)
  const hits = SOUKAKU_WIND_HITS_BY_BODY_SIZE[bodySize] ?? SOUKAKU_WIND_HITS_BY_BODY_SIZE.large
  const chop = Math.round(Number(cfgMechanicSettingRaw(cfg, 'soukaku.chopSlam') ?? 0)) >= 1
  // 六段 actionTime 读 cfg.moveActionTimes（catalog，CC-409）
  const fanAt = cfgMoveActionTime(cfg, SOUKAKU_FAN_MOVE_ID)
  const ballAt = cfgMoveActionTime(cfg, SOUKAKU_WIND_BALL_MOVE_ID)
  const slamAt = cfgMoveActionTime(cfg, chop ? SOUKAKU_CHOP_SLAM_MOVE_ID : SOUKAKU_SLAM_MOVE_ID)
  const dashAt = cfgMoveActionTime(cfg, SOUKAKU_FROST_DASH_MOVE_ID)
  const basic3At = cfgMoveActionTime(cfg, SOUKAKU_FROST_BASIC3_MOVE_ID)

  // 扇风·扇子：首击由通用强特行（1131011 × 强特次数，60→30×击能量）发行，这里补第 2 击。
  // 扇/团段喧响不另计（衍生段口径，decibel 置 0 = 显式禁用回填）。
  if (swings >= 2) {
    executions.push(moduleExecRow({
      moveId: SOUKAKU_FAN_MOVE_ID,
      moveName: '强化特殊技：扇走蚊虫（第2击·扇子）',
      category: 'special',
      element: 'ice',
      count: exCount,
      actionTime: fanAt,
      totalTime: exCount * fanAt,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    }))
  }
  // 风团：每击一个，每击命中数按敌人体型（小0/中3/大6）；体型段数不额外耗时（0.271s 摊到段上）
  if (hits > 0) {
    const count = exCount * swings * hits
    executions.push(moduleExecRow({
      moveId: SOUKAKU_WIND_BALL_MOVE_ID,
      moveName: '强化特殊技：扇走蚊虫（风团）',
      category: 'special',
      element: 'ice',
      count,
      actionTime: ballAt / hits,
      totalTime: exCount * swings * ballAt,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    }))
  }
  // 下砸（展旗）：劈斩关 = 集合啦#1（500.9%/1.25s）；开 = 快速展旗·集合啦#2（280.9%/0.7s 更快）。
  // 集合啦#3 被玩家冲刺打断，不录。扇/团之后的正式招式，回能/喧响按倍率表回填（非 0 占位）。
  const slamActionTime = slamAt
  executions.push(moduleExecRow({
    moveId: chop ? SOUKAKU_CHOP_SLAM_MOVE_ID : SOUKAKU_SLAM_MOVE_ID,
    moveName: chop ? '强化特殊技：下砸（劈斩·快速展旗）' : '强化特殊技：下砸（展旗）',
    category: 'special',
    element: 'ice',
    count: exCount,
    actionTime: slamActionTime,
    totalTime: exCount * slamActionTime,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    ...ENERGY_RECOVERY_OFF,
    timeBucket: 'necessary',
  }))
  // 冲刺攻击（霜染刃旗）：下砸后直接跟一次（回能/喧响按倍率表回填 → 喂回自我能量循环）
  executions.push(moduleExecRow({
    moveId: SOUKAKU_FROST_DASH_MOVE_ID,
    moveName: '冲刺攻击：对半分（霜染刃旗）',
    category: 'dodge',
    element: 'ice',
    count: exCount,
    actionTime: dashAt,
    totalTime: exCount * dashAt,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
  }))
  // 打年糕（霜染刃旗）#3：全合轴（100% 抵扣前台，不占专属时间），次数 = 展旗次数 = 强特次数
  executions.push(moduleExecRow({
    moveId: SOUKAKU_FROST_BASIC3_MOVE_ID,
    moveName: '普通攻击：打年糕（霜染刃旗）#3（合轴）',
    category: 'basic',
    element: 'ice',
    count: exCount,
    actionTime: basic3At,
    comboAlignRatio: SOUKAKU_FROST_BASIC3_COMBO_ALIGN,
    totalTime: exCount * basic3At,
    totalComboAlignTime: exCount * basic3At * SOUKAKU_FROST_BASIC3_COMBO_ALIGN,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
  }))
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.soukakuCinemaLevel)
  if (cinema < 6) return
  for (const exec of executions) {
    if (!exec.moveId || !SOUKAKU_FROST_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + SOUKAKU_C6_DMG_BONUS
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画6 霜染强化段伤害 +${SOUKAKU_C6_DMG_BONUS}%`
  }
}

export const soukakuMechanic: AgentMechanicModule = {
  crossAgentEnergyLabels: [{ key: 'soukakuUltEnergy', label: '苍角终结邻位' }],  // CC-445
  /**
   * 跨槽位供给：终结技**邻位回能**（下一位 30 / 上一位 10，两人队另一位 30）。
   * 2026-09-15 core 棘轮批次3 自 `core/resource/helpers.ts#calcCrossAgentEnergy` 的
   * `findIndex(c => c.agentId === '1131')` 迁出（规则 6）；邻位语义留在本模块。
   */
  crossAgentSupply: {
    kind: 'neighbor-ult-energy',
    displayKey: 'soukakuUltEnergy',
    supply: () => 0,
    perTargetAmounts: ({ ownSlot, teamSize, state }) => {
      const out = ultNeighborPerTargetAmounts(ownSlot, teamSize, state.ultimateCount)
      return out
    },
  },
  id: 'agent:soukaku',
  agentIds: [SOUKAKU_ID],
  name: '苍角·刃旗助威',
  description: '展旗攻击拐、额外冰伤、影画2满层回能、影画4减抗、影画6霜染增伤、终结邻位回能、强特自循环（扇风+风团体型+劈斩下砸+霜染冲刺/合轴#3）。',
  settings: [
    {
      id: 'soukaku.exPressCount',
      label: '每次强特扇风击数',
      description: '每击 = 扇子 525.3% + 风团 204.4%×体型段数（小0/中3/大6）；30 能量/击（60 能量 = 2 击 + 2 风团，2026-09-05 用户口径）',
      default: SOUKAKU_SWINGS_DEFAULT,
      min: SOUKAKU_SWINGS_MIN,
      max: SOUKAKU_SWINGS_MAX,
      step: 1,
      suffix: '击',
    },
    {
      id: 'soukaku.chopSlam',
      label: '劈斩（下砸·快速展旗）',
      description: '下砸倍率：关 = 展旗·集合啦#1（500.9%/1.25s）；开 = 快速展旗·集合啦#2（280.9%/0.7s，出手更快）',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
    },
    {
      id: 'soukaku.c2RefundCount',
      label: '影画2满层回能次数',
      description: '涡流满层后再获得涡流 → 回复 1.2 能量的触发次数（逐帧概率/涡流状态机未建模，按次数近似）；默认 5 次',
      default: 5,
      min: 0,
      max: 30,
      step: 1,
      suffix: '次',
    },
  ],
  /** CC-402：下砸两分支互斥（展旗·集合啦#1 1131012 ↔ 快速展旗·集合啦#2 1131013，`soukaku.chopSlam` 二选一）；两段都列。 */
  moveBranchGroups: [[SOUKAKU_SLAM_MOVE_ID, SOUKAKU_CHOP_SLAM_MOVE_ID]],
  buildCharConfig,
  buildExecutions: buildSoukakuExecutions,
  // CC-200：账本估时 = 通用强特（首击扇子）+ 本模块每次强特补行（与 buildSoukakuExecutions 同源）。
  // 补行次数取 floor（产行按 floor(state.exSpecialCount)），通用部分沿用通用公式的实数次数。
  estimateExSpecialTime: ({ cfg, exSpecialCount }) => {
    const extra = soukakuPerExExtraTime(cfg)
    const exRows = Math.max(0, Math.floor(exSpecialCount))
    const base = exSpecialCount * cfg.exSpecialActionTime
    return {
      necessaryTime: base + exRows * extra.necessaryTime,
      comboAlignTime: base * cfg.exSpecialComboAlignRatio + exRows * extra.comboAlignTime,
    }
  },
  patchExecutions,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 苍角命座等级（buildCharConfig 写） */
    soukakuCinemaLevel?: number
  }
}
