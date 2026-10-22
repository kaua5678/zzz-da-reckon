/**
 * **「蓄力 1 秒锁，其余时间合轴给队友」** —— 长按/蓄力类招式的统一合轴率口径（用户裁决 2026-10-22）。
 *
 * 用户原话：「**这种蓄力的角色有很多，其基本逻辑都是只需1秒蓄力，然后剩余时间合轴给队友。
 * 赛维里安也有这个强化a得做一下**」。
 *
 * 物理含义：蓄力类招式在**起手蓄势的 1 秒**里角色真的被锁住（不能换人、不能并行）；
 * 之后的斩击/穿梭/爆发段是与队友**并行**推进的，不占团队共享时间预算。
 * ⇒ 账本口径 = GROSS：`necessaryTime` 仍按全额 `actionTime` 计（行时长就是招式时长），
 * 合轴率 `(actionTime − 1) / actionTime` 的这部分进 `comboAlignTime` / `comboAlignCredit` 抵扣预算。
 *   net = actionTime − credit = **1.000s**。
 *
 * ## 为什么必须走账本通道（而不是只写在执行行上）
 * 引擎**不读执行行上的 `comboAlignRatio`** 去抵扣预算——`comboAlignCredit` 只由
 * `estimateExSpecialTime`（模块 `estimateExSpecialTime`）或 `extraNecessaryAction` 产出。
 * 只写行上 = 死数据（CC-454 的机器判据会当场标红）；实测照此办理前爱丽丝每队多占 18~21s 前台。
 *
 * ## 既有同类实现（迁移前各自手写，公式相同）
 * · 爱丽丝星芒圆舞曲 #3：`alice.ts#buildAliceCharConfig` 的 `1 - 1/actionTime`
 * · 星见雅霜月 #3：`miyabi.ts#FROST_MOON_3_LOCK_SECONDS` = 1.0 + 同式
 * · 赛维里安苍风影猎：`severian.ts#severianShadowComboAlignRatio`（本文件首个正式调用方）
 *
 * @param actionTime 招式总时长（秒）；≤ 0 返回 0
 * @param lockSeconds 蓄力锁定秒数，缺省 1.0（用户口径）
 */
export function chargeLockComboAlignRatio(actionTime: number, lockSeconds = 1): number {
  if (!(actionTime > 0) || !(lockSeconds > 0)) return 0
  return Math.max(0, Math.min(1, (actionTime - lockSeconds) / actionTime))
}
