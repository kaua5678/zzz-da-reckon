/**
 * 锋御锐暴乘区期望值（纯函数，用户口径 2026-09-09）。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/components/FinalPanel.vue` /
 * `StatPanel.vue` 不得 import `@/core`，见 ARCHITECTURE §0 依赖方向）。`src/core/damage.ts`
 * re-export 本函数，引擎侧（`calcSharpCritMultiplier`、`substatOptimizer`）与既有 `core/damage.ts
 * sharpCritMultiplier` 文档引用零改动——**改公式只改这里**（单一事实源，规则 11）。
 *
 * 普通暴击 100% 封顶；锋御的**锐暴封顶 200%**——100% 以上每多 1% 是一次「额外锐暴判定」的概率，
 * 每次锐暴都是**乘算**：锐暴伤害 150% → 爆一次 ×2.5、爆两次 ×2.5² = 6.25。
 *   期望 = r ≤ 100 时 1 + r·d；r > 100 时 (1+d) × (1 + p·d)，p = min(1, (r-100)/100)。
 * 实测锚：r=150、d=1.5 → 0.5×2.5 + 0.5×6.25 = 4.375（= 2.5×1.75）。
 */
export function sharpCritMultiplier(critRateRaw: number, sharpCritDmgPct: number): number {
  const d = sharpCritDmgPct / 100
  const r = Math.max(0, critRateRaw)
  if (r <= 100) return 1 + (r / 100) * d
  const p = Math.min(1, (r - 100) / 100)
  return (1 + d) * (1 + p * d)
}
