/**
 * 危局强袭 · 伤害分 ↔ 伤害血量% 分段线性换算 —— **re-export 壳**。
 *
 * ⚠ 定义已下沉到 `src/data/deadlyAssaultScore.ts`（2026-09-13 展示层越层棘轮：`src/views/RunArchivePage.vue`
 * 不得 import `@/core`，见 ARCHITECTURE §0 依赖方向「展示 → 编排 → 引擎」）。
 * 本文件保留为 re-export，使引擎侧/编排层既有 `@/core/deadlyAssaultScore` 引用与测试零改动。
 * **改数值或曲线只改 `src/data/deadlyAssaultScore.ts`**（单一事实源，规则 11）。
 */
export {
  DEADLY_ASSAULT_SCORE_CAP,
  scoreForDamageRatio,
  damageRatioForScore,
} from '@/data/deadlyAssaultScore'
export type { DeadlyAssaultMode } from '@/data/deadlyAssaultScore'
