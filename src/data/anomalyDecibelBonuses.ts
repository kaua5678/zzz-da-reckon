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
//      视图层不能值导入 core；core/anomalyPool.ts 以原名转出 PARRY_DECIBEL_BONUS，convergence 的 import 不变） ----
/** 弹刀（招架支援）单次个人喧响；通用保底4喧响反推同引 */
export const PARRY_DECIBEL_BONUS = 215
/** 连携单次个人喧响 */
export const CHAIN_DECIBEL_BONUS = 10
/** 闪避反击单次个人喧响 */
export const DODGE_COUNTER_DECIBEL_BONUS = 10
/** 快速支援单次个人喧响 */
export const QUICK_ASSIST_DECIBEL_BONUS = 20
