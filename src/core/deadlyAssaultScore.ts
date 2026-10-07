/**
 * 危局强袭 · 伤害血量% → 伤害分 分段线性换算 —— **re-export 壳**。
 *
 * ⚠ 定义已下沉到 `src/data/deadlyAssaultScore.ts`（2026-09-13 展示层越层棘轮：`src/views/RunArchivePage.vue`
 * 不得 import `@/core`，见 ARCHITECTURE §0 依赖方向「展示 → 编排 → 引擎」）。
 * 本文件保留为 re-export，使编排层既有 `@/core/deadlyAssaultScore` 引用（charIncrement / pullPlannerEngine）零改动；
 * 测试与其余常量直接 import `@/data/deadlyAssaultScore`（r721 删了无人经由的转出）。
 * **改数值或曲线只改 `src/data/deadlyAssaultScore.ts`**（单一事实源，规则 11）。
 */
export {
  scoreForDamageRatio,
} from '@/data/deadlyAssaultScore'
