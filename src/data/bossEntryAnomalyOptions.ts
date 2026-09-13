/**
 * Boss 进窗初始异常状态选项（纯数据）。
 *
 * ⚠ 本文件是**定义落点**（2026-09-13 展示层越层棘轮下沉：`src/views/StunAxisPage.vue` 不得
 * import `@/core`，见 ARCHITECTURE §0 依赖方向）。`src/core/stunAxis/inStunAnomaly.ts` re-export
 * 本表，引擎侧 `bossEntryAnomalyElement()` 与调用点零改动——**改选项只改这里**。
 *
 * 用户口径 v2 需求②「可指定进入窗口时的异常状态」。
 * 机制设置键 `boss.entryAnomaly`，存 number 索引（设置存储为 number），0=无。
 */
export const BOSS_ENTRY_ANOMALY_OPTIONS: ReadonlyArray<{ value: number; element: string }> = [
  { value: 0, element: '' },
  { value: 1, element: 'fire' },
  { value: 2, element: 'electric' },
  { value: 3, element: 'ice' },
  { value: 4, element: 'ether' },
  { value: 5, element: 'physical' },
  { value: 6, element: 'wind' },
]
