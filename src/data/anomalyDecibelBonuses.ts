/**
 * 喧响奖励单价（纯数据）：异常 / 紊乱 / 乱流触发，以及特殊动作（弹刀 / 连携 / 闪反 / 快支，CC-232 起）。队友伴随比例见 decibelCompanion.ts。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/components/ResourceResultCard.vue`
 * 不得 import `@/core`，见 ARCHITECTURE §0 依赖方向）。`src/core/anomalyPool/helpers.ts` 改为
 * import 本文件（引擎侧内部调用点零改动）——**单一事实源在此，core 与 data 不各存一份**（规则 11）。
 */
/** 触发属性异常奖励 */
export const ANOMALY_DECIBEL_BONUS = 170
/** 触发紊乱奖励 */
export const DISORDER_DECIBEL_BONUS = 85
/** 触发乱流奖励 */
export const TURBULENCE_DECIBEL_BONUS = 85

// ---- 特殊动作喧响单价（CC-232 从 core/anomalyPool.ts 下沉：ResultPage「特殊动作喧响」卡说明文字原为手写 215/10/10/20，
//      视图层不能值导入 core） ----
/** 弹刀（招架支援）单次个人喧响；通用保底4喧响反推同引 */
export const PARRY_DECIBEL_BONUS = 215
/** 连携单次个人喧响 */
export const CHAIN_DECIBEL_BONUS = 10
/** 闪避反击单次个人喧响 */
export const DODGE_COUNTER_DECIBEL_BONUS = 10
/** 快速支援单次个人喧响 */
export const QUICK_ASSIST_DECIBEL_BONUS = 20

/**
 * **进入失衡**单次个人喧响（全队每人各得，含队友伴随 50%）。
 *
 * 用户裁决 2026-10-20（逐字：「1.每人。」）：回答「失衡触发 20/次 归属是每人还是全队」——
 * **每人**，即失衡 N 次 ⇒ 三名角色各得 20N，不是「打出最后一击的人拿 20N」。
 *
 * ⚠ 与上面 4 项特殊动作**口径不同**：那 4 项是「谁做的动作谁拿」（别人的次数不计给自己），
 * 本项是「每人都有」。故在 `calcDecibelSource` 里走独立通道 `stunTriggerBonus`，
 * 不并进 `specialActionBonus`（并进去结果卡就说不清「这 20 算给了谁」）。
 *
 * ⚠ 历史：`core/stunPool.ts` 头注释记着 CC-231 删过一条「失衡次数 × 20」字段——那条是
 * **失衡池卡片上的展示字段**（无消费者、归属未定），删得对；本次是按新裁决**重新接线到喧响收入**，
 * 不是把它加回去。
 */
export const STUN_TRIGGER_DECIBEL_BONUS = 20
