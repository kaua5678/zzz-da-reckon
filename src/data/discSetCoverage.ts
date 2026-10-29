/**
 * 驱动盘套装**触发型效果的覆盖率折算**（单一事实源；用户 2026-10-29 裁决「可以折算」）。
 *
 * 背景：catalog 里带条件/时长的 2pc/4pc 段，引擎缺省按 **100% uptime** 结算
 * （`stores/selectionReads#discEffectCoverageOf` 无记录 = 100）。对触发稀疏的效果这系统性高估：
 * 摇摆爵士 4pc（发动[连携技]/[终结技] ⇒ 全队伤害 +15%，12 秒）一局只触发几次，实测把它的覆盖率
 * 拨到 ~25% 以下时「2+2+2（三套回能 +60%）」的读数就反超它——用户 2026-10-29：「2+2+2 是给常规队用的，
 * **代替的是非常弱的四摇摆**。锋御队该用新套装加锐化拐。」
 *
 * ## 口径（与 `wEngineStackCoverage#stacksToCoverage` 同一公式，单层版）
 *
 *   覆盖率 = min(1, Σ触发次数 × 效果时长 / 战斗有效时长)
 *
 * - 触发次数按**该槽收敛后的执行行**计数（连携 / 终结，见 `DiscTriggerChannel`）；
 * - 战斗有效时长与音擎折算同源（`core/effectiveTime#effectiveBattleTime`）；
 * - 只登记「触发稀疏且可数」的效果。高频触发段（山大王 EX/连携 15s、34400 二十五秒）折算后恒 ≥100%，
 *   登记它们只是白算一遍（数值不变），故**不登记**——要登记先确认它能被算成 <100%。
 * - 取整形态：整局固定加成，舍弃触发密度/相位分布（与音擎折算同款近似）。
 *
 * @fact disc:coverage/折算口径 口径: 驱动盘触发型效果的自动覆盖率 = min(1, Σ(登记的触发通道次数) × 效果时长 / 战斗有效时长)，整局固定加成、舍弃相位；手调滑块优先（mergeDiscEffectCoverageAuto：表里已有键不用自动值），未登记效果不折算（保持 100%） | 据 用户@2026-10-29「可以折算」（回应实测：摇摆爵士 4pc 按 100% 算时读数最高、拨到 25% 以下时 2+2+2 反超）·复核@2026-10-29 | 验 src/core/__tests__/discEffectCoverageFold.test.ts | 锚 src/data/discSetCoverage.ts#discTriggerCoverage | 信 确认
 * ⟳复核: 新登记效果时确认其触发通道能从执行行数出来（连携/终结之外要扩通道就改本表与消费点）| 到期 2027-04-30
 */

/** 可数的触发通道（按该槽收敛后的执行行计数） */
export type DiscTriggerChannel = 'chain' | 'ultimate'

/** 折算输入：某个装备者槽位的收敛次数 + 战斗有效时长 */
export interface DiscTriggerCounters {
  chain: number
  ultimate: number
  battleSeconds: number
}

/** 登记表：effectId → 该效果挂在哪套（找装备者用）+ 触发通道 + 持续秒数 */
export const DISC_TRIGGER_COVERAGE: Readonly<Record<string, { setId: string; channels: readonly DiscTriggerChannel[]; durationSeconds: number }>> = {
  /** 摇摆爵士 4pc：发动连携/终结 ⇒ 全队伤害 +15%，持续 12 秒（官网文案见 catalog desc4） */
  effect_swing_jazz_4pc_team_dmg: { setId: '31600', channels: ['chain', 'ultimate'], durationSeconds: 12 },
}

/**
 * 触发次数 + 时长 → 覆盖率（%，0–100）。未登记 / 战斗时长为 0 ⇒ `null`（= 不折算，回退手调/100%）。
 * 触发次数为 0 时返回 0（= 这一局一次都没打出来，效果确实吃不到）。
 */
export function discTriggerCoverage(effectId: string, counters: DiscTriggerCounters): number | null {
  const spec = DISC_TRIGGER_COVERAGE[effectId]
  if (!spec) return null
  if (!(counters.battleSeconds > 0)) return null
  let events = 0
  for (const channel of spec.channels) events += Math.max(0, Number(counters[channel]) || 0)
  if (events <= 0) return 0
  const uptime = (events * spec.durationSeconds) / counters.battleSeconds
  return Math.max(0, Math.min(100, Math.min(1, uptime) * 100))
}

// ⚠ 这里**不放**「这套是不是 4 件」的判定：`data/` 是分层锁（CC-248）里的最底层，
//   不得 import `core/*`（判据 `data/__tests__/dataRuntimeDeps.test.ts`）。形态判定由调用方
//   用 `core/buff#discFourPieceSetIdOf` 做（那是 2+2+2/4+2 的唯一事实源）。
