/**
 * 赠送招式的**唯一构造入口**（时间系统重构·阶段1 ②，2026-09-10）。
 *
 * 背景：诺姆「膛温换连携」与琉音「好评转大」的赠行在装配**之后**（enrich 之后）追加，
 * 于是各自手搓行对象——零值字段、总量字段、归因标记三处口径各写一遍，历史上已经漂过一次
 * （`applyNormaHatChain` 注释：缺倍率则伤害池按 `damageMultiplier ≤ 0` 跳过、失衡池无 daze）。
 * 本模块把「赠行产物契约」收进 core：调用方只给招式 / 次数 / 时长 / 倍率，
 * 零值字段与 `totalX = 单次 × 次数` 的换算由这里统一算，避免两处各写一份。
 *
 * **边界（诚实记账）**：这里统一的是**行对象**，不是「行由谁产生」——赠行仍由编排层在
 * enrich 之后追加（倍率来自 catalog，core 拿不到）。阶段1 ② 的下一步 = 让
 * `materializeRows` 直接产出这些行（需先把非轴赠行计数线程化进 core，见
 * `.claude/task-ledger.md` Next 与 `docs/ENGINE_PIPELINE_GUIDE.md` §4 坑19①）。
 */
import type { SkillExecution } from '@/types/resource'

export interface GiftRowInput {
  moveId: string
  moveName: string
  /** 赠送次数（可为小数：轴模式按窗口加权的期望值） */
  count: number
  /** 单次时长（秒） */
  actionTime: number
  /** 合轴比例（缺省 0 = 不参与合轴抵扣） */
  comboAlignRatio?: number
  /** 倍率表值（fused：多段招式取整段和，见坑 31）；0 或缺省 = 不覆盖、伤害池跳过该行 */
  damageMultiplier?: number
  /** 失衡倍率；**缺省 = 不写该字段**（琉音赠大的 daze 由失衡池侧 `adjustStunExecs` 单独计，不落行） */
  dazeMultiplier?: number
  anomalyBuildUp?: number
  /** 单次喧响回复（诺姆赠连携走目标连携表的 decibel_recovery；琉音赠大为 0） */
  decibelRecovery?: number
  /** 伤害定向键（琉音赠大 = 'ultimate'；诺姆赠连携不写，与旧口径一致） */
  skillDamageTarget?: string
  skillTableNote: string
  /** 诺姆赠连携标记（击破手对比的归因列依赖） */
  normaGiftChain?: boolean
}

/** 构造一条赠送招式行（`source: 'gift'`）：零值字段与总量换算统一在此，调用方不再各写一份 */
export function buildGiftRow(input: GiftRowInput): SkillExecution {
  const count = Math.max(0, input.count)
  const actionTime = input.actionTime ?? 0
  const comboAlignRatio = input.comboAlignRatio ?? 0
  const totalTime = count * actionTime
  const damageMultiplier = input.damageMultiplier ?? 0
  const anomalyBuildUp = input.anomalyBuildUp ?? 0
  const decibelRecovery = input.decibelRecovery ?? 0
  return {
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'chain',
    count,
    actionTime,
    source: 'gift',
    comboAlignRatio,
    totalTime,
    totalComboAlignTime: totalTime * comboAlignRatio,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery,
    totalDecibelRecovery: decibelRecovery * count,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier,
    damageMultiplierOverride: damageMultiplier > 0,
    // 缺省不写：写了 0 会被下游当作「显式禁用 daze」而不是「不适用」
    ...(input.dazeMultiplier !== undefined
      ? { dazeMultiplier: input.dazeMultiplier, dazeMultiplierOverride: input.dazeMultiplier > 0 }
      : {}),
    anomalyBuildUp,
    totalAnomalyBuildUp: anomalyBuildUp * count,
    ...(input.skillDamageTarget ? { skillDamageTarget: input.skillDamageTarget } : {}),
    skillTableNote: input.skillTableNote,
    ...(input.normaGiftChain ? { normaGiftChain: true } : {}),
  }
}
