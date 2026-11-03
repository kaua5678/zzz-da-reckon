/**
 * 失衡轴**动作规范序**（2026-11-03 用户口径）。
 *
 * @fact engine:失衡轴/动作顺序 口径: 轴内动作的**数组顺序不参与语义**——引擎与展示一律按 `(startTime ?? 0)` 的**时间序**（稳定排序，同刻保序）规范化后再排布 / 门控 / 逐窗展示；「时间上最后的那块跨界」是**派生**结论，不再要求用户把列表排成时间序 | 据 用户@2026-11-03「我们捏轴的时候几乎不看顺序了，**顺序本身是早期产物**，为了考虑缩短失衡后最末尾的招式被吞而设计的。现在有平a兜底和招式兜底了，**顺序几乎没啥用**」 | 验 src/utils/__tests__/axisOrder.test.ts + src/core/__tests__/stunAxisStack.test.ts | 锚 src/utils/axisOrder.ts#sortAxisActionsByTime | 信 确认
// ⟳复核: 若「轴内动作顺序不参与语义」被推翻（出现「必须按数组顺序表达优先级/跨界次序」的合法需求），或引擎改为**严格按声明 `startTime` 排布**（同槽重叠块不再被游标顺延），重核本口径 + `canonicalizeAxis` 的调用点（引擎入口 / 轴状态写入口 / 轴编辑器） | 到期 2027-06-30
 *
 * ## 为什么需要
 *
 * 编辑器（`views/StunAxisPage.vue`）把每块画在**声明的 `startTime`** 上，而引擎的排布游标是
 * `t0 = max(该槽游标, 显式 startTime)`——`startTime` 只是**下限**：数组里排在更前的块结束得晚，
 * 这块就被顺延。数组乱序时两处就会分叉：编辑器看着「几乎占满」，逐窗兑现图里中段却空出一大段
 * （实测仪玄队 `preset-1371-1391-1451`：声明 10.5s 的块被顶到 12.8s，10.47~12.5s 成了无人打的
 * 真空；规范序下发呆 1.066s → 0.266s）。
 *
 * 旧口径「**数组顺序决定谁跨界**」（轴预设 `比琉通用.json` 的 note 写着）是**早期产物**：那时没有
 * 平A兜底 / 招式兜底，只能靠「末位动作被吞」表达「窗装不下时先丢谁」。如今兜底由引擎按时间序
 * 自然给出（时间上最后者才可能跨界），用户不必再维护列表顺序 ⇒ 该口径已撤（见
 * `docs/ENGINE_PIPELINE_GUIDE.md` §4 对应坑条目的「否决记录」）。
 *
 * ⚠ 规范序**只决定次序**，不改任何时长 / 成本 / 判定：本来就按时间序排好的轴逐位不变
 * （已规范 ⇒ 返回**原引用**，调用方据此走零开销分支）。
 */
/** 只要求带 `startTime`（缺省 0 = 从窗口开头起手） */
export interface HasStartTime {
  readonly startTime?: number
}

/** 该序列是否已是规范序（时间升序；同刻视为已序——稳定排序不改变同刻相对次序） */
export function axisActionsAreOrdered(actions: readonly HasStartTime[]): boolean {
  for (let i = 1; i < actions.length; i++) {
    if ((actions[i]!.startTime ?? 0) + 1e-9 < (actions[i - 1]!.startTime ?? 0)) return false
  }
  return true
}

/**
 * 稳定按 `startTime` 升序。**已是规范序 ⇒ 返回原数组引用**（调用方可用 `===` 判定「没动」，
 * 从而对既有的、本来就排好序的轴保持逐位零变化与零拷贝）。
 */
export function sortAxisActionsByTime<T extends HasStartTime>(actions: T[]): T[] {
  if (axisActionsAreOrdered(actions)) return actions
  return actions
    .map((act, index) => ({ act, index }))
    .sort((a, b) => (a.act.startTime ?? 0) - (b.act.startTime ?? 0) || a.index - b.index)
    .map(x => x.act)
}

/** 单条轴规范化：动作已规范 ⇒ 返回**原对象**（引用相同 ⇒ 下游全部零变化） */
export function canonicalizeAxis<A extends HasStartTime, T extends { actions: A[] }>(axis: T): T {
  const sorted = sortAxisActionsByTime(axis.actions)
  return sorted === axis.actions ? axis : { ...axis, actions: sorted }
}
