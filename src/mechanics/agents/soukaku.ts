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
import type { CharacterOperationConfig } from '@/types/resource'

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
/** 扇子直伤行（首击由通用强特行发行，模块补第 2 击） */
export const SOUKAKU_FAN_MOVE_ID = '1131011'
export const SOUKAKU_FAN_ACTION_TIME = 1.16
/** 风团投射物行：每击一个，命中数按敌人体型（小0/中3/大6，同艾莲剑气口径） */
export const SOUKAKU_WIND_BALL_MOVE_ID = '1131010'
export const SOUKAKU_WIND_BALL_ACTION_TIME = 0.271
export const SOUKAKU_WIND_HITS_BY_BODY_SIZE: Record<string, number> = {
  small: 0,
  medium: 3,
  large: 6,
}
/** 下砸（劈斩关 = 展旗·集合啦#1）；劈斩开 = 快速展旗·集合啦#2（更快） */
export const SOUKAKU_SLAM_MOVE_ID = '1131012'
export const SOUKAKU_SLAM_ACTION_TIME = 1.25
export const SOUKAKU_CHOP_SLAM_MOVE_ID = '1131013'
export const SOUKAKU_CHOP_SLAM_ACTION_TIME = 0.7
/** 下砸后直接跟的冲刺攻击·霜染刃旗 */
export const SOUKAKU_FROST_DASH_MOVE_ID = '1131016'
export const SOUKAKU_FROST_DASH_ACTION_TIME = 0.4
/** 接全合轴的打年糕·霜染#3（次数 = 展旗次数 = 强特次数） */
export const SOUKAKU_FROST_BASIC3_MOVE_ID = '1131006'
export const SOUKAKU_FROST_BASIC3_ACTION_TIME = 2.632
export const SOUKAKU_FROST_BASIC3_COMBO_ALIGN = 1
/** enrich 回填占位：非 0 → 倍率表值优先回填；0 = 显式禁用回填（引擎口径，见 enrichExecutionPlan） */
const RECOVERY_BACKFILL_PLACEHOLDER = 1

// @fact agent:1131/强特 口径: 强特循环 = 每击扇风(扇子 1131011 525.3%/1.16s + 风团 1131010 204.4%×体型段数 小0/中3/大6, 0.271s摊段, 30能量/击 → cfg.exSpecialEnergyConsume=30×击数, 击数滑块 soukaku.exPressCount 1-2 默认2) + 下砸×1(劈斩关=集合啦#1 1131012 500.9%/1.25s, 开=快速展旗·集合啦#2 1131013 280.9%/0.7s, 滑块 soukaku.chopSlam；集合啦#3 被玩家冲刺打断不录) + 冲刺攻击·霜染(1131016 0.4s)×1 + 打年糕·霜染#3(1131006 2.632s 全合轴 comboAlignRatio=1)×1；强特次数=floor(总能量/30×击数)，打年糕#3次数=展旗(下砸)次数=强特次数，霜染段回能喂回强特=自我能量循环；扇/团段喧响不另计(同艾莲衍生段口径) | 据 用户@2026-09-05 | 验 src/mechanics/__tests__/soukaku.test.ts | 锚 src/mechanics/agents/soukaku.ts#buildSoukakuExecutions | 信 确认

/**
 * 终结技邻位回能：三人下一位 30 / 上一位 10；两人另一位 30。
 */
export function assignSoukakuUltNeighborEnergy(
  slots: number[],
  soukakuSlot: number,
): Record<number, number> {
  const out: Record<number, number> = {}
  const others = slots.filter(s => s !== soukakuSlot)
  if (others.length === 0) return out
  if (others.length === 1) {
    out[others[0]] = 30
    return out
  }
  const ordered = [...slots].sort((a, b) => a - b)
  const idx = ordered.indexOf(soukakuSlot)
  const next = ordered[(idx + 1) % ordered.length]
  const prev = ordered[(idx - 1 + ordered.length) % ordered.length]
  out[next] = 30
  out[prev] = 10
  return out
}

export function applySoukakuTeamEnergyFlags(characters: CharacterOperationConfig[]): void {
  const sk = characters.find(c => c.agentId === SOUKAKU_ID)
  if (!sk) return
  const energy = assignSoukakuUltNeighborEnergy(
    characters.map(c => c.slot),
    sk.slot,
  )
  for (const ch of characters) {
    ;(ch as any).soukakuEnergyPerSoukakuUlt = energy[ch.slot] ?? 0
  }
  ;(sk as any).soukakuCinemaLevel = (sk as any).soukakuCinemaLevel
    ?? Number((sk as any).soukakuCinemaLevel ?? 0)
}

function clampSwings(cfg: unknown): number {
  const raw = Math.floor(Number((cfg as Record<string, unknown>)['setting:soukaku.exPressCount'] ?? SOUKAKU_SWINGS_DEFAULT))
  return Math.min(SOUKAKU_SWINGS_MAX, Math.max(SOUKAKU_SWINGS_MIN, raw))
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.soukakuCinemaLevel = cinemaLevel ?? 0
  // 强特能量成本 = 30 能量×击数（60 能量 = 2 击 + 2 风团，2026-09-05 用户口径）：
  // 强特次数按总能量/此成本收敛，击数滑块联动自我能量循环的供给侧。
  cfg.exSpecialEnergyConsume = SOUKAKU_SWING_ENERGY * clampSwings(cfg)
  // 影画2 满层转回能：涡流满层后再获得涡流 → 回复 1.2 能量。逐帧概率/涡流状态机未建模，
  // 按可调触发次数注入能量池（默认 5 次，用户按实际对局调整）。
  if ((cinemaLevel ?? 0) >= 2) {
    const count = Math.max(0, Math.floor(Number((cfg as any)['setting:soukaku.c2RefundCount'] ?? 5)))
    record.soukakuC2RefundCount = count
    cfg.initialEnergyGift = Number(cfg.initialEnergyGift ?? 0) + SOUKAKU_C2_ENERGY_PER_TRIGGER * count
  }
}

function buildSoukakuExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const exCount = Math.max(0, Math.floor(Number((state as unknown as Record<string, unknown>).exSpecialCount ?? 0)))
  if (exCount <= 0) return
  const swings = clampSwings(cfg)
  const bodySize = String((cfg as unknown as Record<string, unknown>).bodySize ?? 'large')
  const hits = SOUKAKU_WIND_HITS_BY_BODY_SIZE[bodySize] ?? SOUKAKU_WIND_HITS_BY_BODY_SIZE.large
  const chop = Math.round(Number((cfg as unknown as Record<string, unknown>)['setting:soukaku.chopSlam'] ?? 0)) >= 1

  // 扇风·扇子：首击由通用强特行（1131011 × 强特次数，60→30×击能量）发行，这里补第 2 击。
  // 扇/团段喧响不另计（衍生段口径，decibel 置 0 = 显式禁用回填）。
  if (swings >= 2) {
    executions.push({
      moveId: SOUKAKU_FAN_MOVE_ID,
      moveName: '强化特殊技：扇走蚊虫（第2击·扇子）',
      category: 'special',
      element: 'ice',
      count: exCount,
      actionTime: SOUKAKU_FAN_ACTION_TIME,
      comboAlignRatio: 0,
      totalTime: exCount * SOUKAKU_FAN_ACTION_TIME,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  // 风团：每击一个，每击命中数按敌人体型（小0/中3/大6）；体型段数不额外耗时（0.271s 摊到段上）
  if (hits > 0) {
    const count = exCount * swings * hits
    executions.push({
      moveId: SOUKAKU_WIND_BALL_MOVE_ID,
      moveName: '强化特殊技：扇走蚊虫（风团）',
      category: 'special',
      element: 'ice',
      count,
      actionTime: SOUKAKU_WIND_BALL_ACTION_TIME / hits,
      comboAlignRatio: 0,
      totalTime: exCount * swings * SOUKAKU_WIND_BALL_ACTION_TIME,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  // 下砸（展旗）：劈斩关 = 集合啦#1（500.9%/1.25s）；开 = 快速展旗·集合啦#2（280.9%/0.7s 更快）。
  // 集合啦#3 被玩家冲刺打断，不录。扇/团之后的正式招式，回能/喧响按倍率表回填（非 0 占位）。
  const slamActionTime = chop ? SOUKAKU_CHOP_SLAM_ACTION_TIME : SOUKAKU_SLAM_ACTION_TIME
  executions.push({
    moveId: chop ? SOUKAKU_CHOP_SLAM_MOVE_ID : SOUKAKU_SLAM_MOVE_ID,
    moveName: chop ? '强化特殊技：下砸（劈斩·快速展旗）' : '强化特殊技：下砸（展旗）',
    category: 'special',
    element: 'ice',
    count: exCount,
    actionTime: slamActionTime,
    comboAlignRatio: 0,
    totalTime: exCount * slamActionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
  })
  // 冲刺攻击（霜染刃旗）：下砸后直接跟一次（回能/喧响按倍率表回填 → 喂回自我能量循环）
  executions.push({
    moveId: SOUKAKU_FROST_DASH_MOVE_ID,
    moveName: '冲刺攻击：对半分（霜染刃旗）',
    category: 'dodge',
    element: 'ice',
    count: exCount,
    actionTime: SOUKAKU_FROST_DASH_ACTION_TIME,
    comboAlignRatio: 0,
    totalTime: exCount * SOUKAKU_FROST_DASH_ACTION_TIME,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    energyRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
  })
  // 打年糕（霜染刃旗）#3：全合轴（100% 抵扣前台，不占专属时间），次数 = 展旗次数 = 强特次数
  executions.push({
    moveId: SOUKAKU_FROST_BASIC3_MOVE_ID,
    moveName: '普通攻击：打年糕（霜染刃旗）#3（合轴）',
    category: 'basic',
    element: 'ice',
    count: exCount,
    actionTime: SOUKAKU_FROST_BASIC3_ACTION_TIME,
    comboAlignRatio: SOUKAKU_FROST_BASIC3_COMBO_ALIGN,
    totalTime: exCount * SOUKAKU_FROST_BASIC3_ACTION_TIME,
    totalComboAlignTime: exCount * SOUKAKU_FROST_BASIC3_ACTION_TIME * SOUKAKU_FROST_BASIC3_COMBO_ALIGN,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalDecibelRecovery: 0,
    energyRecovery: RECOVERY_BACKFILL_PLACEHOLDER,
    totalEnergyRecovery: 0,
    timeBucket: 'necessary',
  })
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).soukakuCinemaLevel ?? 0)))
  if (cinema < 6) return
  for (const exec of executions) {
    if (!exec.moveId || !SOUKAKU_FROST_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + SOUKAKU_C6_DMG_BONUS
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画6 霜染强化段伤害 +${SOUKAKU_C6_DMG_BONUS}%`
  }
}

export const soukakuMechanic: AgentMechanicModule = {
  // 队伍级机制（原先由 useResourceCalc 手工 import + 调用 applySoukakuTeamEnergyFlags）：
  // 苍角终结技邻位回能（邻位 30/10）。只在 build 阶段动手，与迁移前的调用时机一致。
  applyTeamConfig: ({ characters, phase }) => {
    if (phase !== 'build') return
    applySoukakuTeamEnergyFlags(characters)
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
  buildCharConfig,
  buildExecutions: buildSoukakuExecutions,
  patchExecutions,
}

export default soukakuMechanic
