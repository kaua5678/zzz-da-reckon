/**
 * 结果页「合轴率调节」弹窗的读数（CC-452，T18 阶段 1）。
 *
 * 为什么单独成模块：弹窗此前自己算——读 `getComboAlignOverride(slot, moveId, 0)` 再乘 `exec.totalTime`。
 * 但引擎的合轴率有三个来源（用户覆盖 / 倍率表默认 / 模块行直写，如强化特殊技·合轴 = 1），
 * 弹窗只看第一个 ⇒ 模块行与未改过的倍率表默认行都显示 0，总合轴时间也跟着少算
 * （普查 104 预设：50 行 / 7 招式 Σ≈395s 引擎>0 而弹窗 0）。
 * 引擎行上 `comboAlignRatio` / `totalComboAlignTime` 就是有效值，页面只负责渲染，不再重算。
 * 写侧不变：编辑仍走 `setComboAlignOverride`，引擎重算后读数自然跟上。
 */
import type { CharacterResourceResult, SkillExecution } from '@/types/resource'

type ExecLike = Pick<CharacterResourceResult['executions'][number], 'totalComboAlignTime'>

/** 某角色全部执行行的合轴秒数合计（= Σ 引擎 `totalComboAlignTime`）。 */
export function totalComboAlignTimeOf(charResult: { executions: readonly ExecLike[] }): number {
  return charResult.executions.reduce((sum, exec) => sum + exec.totalComboAlignTime, 0)
}

/** 该行合轴率能否在弹窗里改：只有来源 'setting'（用户覆盖 ?? 倍率表默认）的行，按本行 moveId 写覆盖才生效；
 *  'fixed'（模块 / 引擎 / 赠行直写）与缺省一律只读（CC-453）。 */
export function comboAlignEditable(exec: Pick<SkillExecution, 'comboAlignSource'>): boolean {
  return exec.comboAlignSource === 'setting'
}
