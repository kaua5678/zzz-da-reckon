/**
 * 异常触发的喧响奖励常量（纯数据）。
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
