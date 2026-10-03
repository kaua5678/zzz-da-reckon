/**
 * 读 cfg 上 catalog 预填的招式 actionTime（CC-409）。
 *
 * 写入方：`composables/resourceCalc/helpers.ts#buildCharConfig`（`data/moveTableQueries#moveActionTimesOf(skills)`）。
 * 读取方：角色模块在 buildExecutions / 纯函数入参处取某招式的动作时间——替代模块内 `X_ACTION_TIME = 1.55` 常量。
 * 缺表返回 0（与 `findMoveById(skills, id)?.actionTime ?? 0` 同口径）：缺表是数据问题，要在时间账里看得见，不要用常量遮住。
 */
export function cfgMoveActionTime(cfg: { moveActionTimes?: Record<string, number> } | null | undefined, moveId: string): number {
  return cfg?.moveActionTimes?.[moveId] ?? 0
}
