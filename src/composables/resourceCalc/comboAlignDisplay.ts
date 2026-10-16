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

/**
 * **「固定」行的原因**（用户口径 2026-10-16：「**但你现在很多是固定的不让调，我不知道为什么**」）。
 *
 * 固定不是一个原因，而是**三种**——此前弹窗只显示一个「固定」标签 + 一句 disabled 才有的 title，
 * 用户看不出为什么。实测分布（`.zc/perf/T188rows.perf.ts`，`banyue-qingyi-lucia` 可调 13 / 固定 22）：
 *
 * | 原因 | 判据 | 例子 | 为什么不该让用户改 |
 * |---|---|---|---|
 * | `engine` | 引擎常量行（平A汇总 `basic_attack`、机制行如强特·合轴恒 = 1） | `basic_attack` / `1451011`(ratio=1) | 它不是「用户选择的比例」，是引擎的记账口径 |
 * | `gift` | 赠送行（`giftRows.ts` 标 `fixed`） | 诺姆转连携、琉音转大 | 其合轴跟随**父动作**，独立改它没有物理意义 |
 * | `module` | 模块 `buildExecutions` / `patchExecutions` 推的行 | `banyue-recovery-lundao`(后摇)、`1471029`(冲霄) | 合轴率是**角色机制的一部分**（后摇不可合轴） |
 *
 * 判定顺序：赠送行 → 模块行 → 其余 = 引擎常量行。三者都是「不由用户那个滑块决定」，
 * 但**理由不同** ⇒ UI 必须分别显示（用户要的是「为什么」）。
 */
export type ComboAlignFixedReason = 'engine' | 'gift' | 'module'

/**
 * 本模块需要的最小行形状。
 * ⚠ 用**结构类型**而不是 `Pick<SkillExecution, …>`：`source` 在 `SkillExecution` 上是可选字段
 * （`source?: 'stun' | 'gift' | 'self'`），且该类型**没有 `note` 字段**（实测 tsc 报
 * 「Type '"note"' does not satisfy the constraint 'keyof SkillExecution'」）——
 * 写 `Pick` 会把「本模块其实只需要两个字段」这件事说反。
 */
export interface ComboAlignRowLike {
  comboAlignSource?: SkillExecution['comboAlignSource']
  moveId: string
  /** 赠送行判据（与 `giftRows.ts` 的 `source: 'gift'` 同源） */
  source?: 'stun' | 'gift' | 'self'
}

/** 赠送行判据：`source === 'gift'`（唯一事实源 = `giftRows.ts` 构造时写的那个字段） */
function isGiftRow(exec: ComboAlignRowLike): boolean {
  return exec.source === 'gift'
}

export function comboAlignFixedReason(exec: ComboAlignRowLike): ComboAlignFixedReason | null {
  if (comboAlignEditable(exec)) return null
  if (isGiftRow(exec)) return 'gift'
  // 平A汇总行是引擎记账口径，不是模块行（`category:'basic'` 的模块行才归 module）
  if (exec.moveId === 'basic_attack') return 'engine'
  // 模块推的行没有来源印章；引擎常量行同理 ⇒ 两者靠「是否带 moveId 之外的可辨识特征」区分不了，
  // 故统一归 module（对用户而言「不是你调的」这一点相同，措辞里说明两类可能）。
  return 'module'
}

/** 固定原因 → 给用户看的短标签 */
export function comboAlignFixedLabel(reason: ComboAlignFixedReason): string {
  switch (reason) {
    case 'engine': return '引擎固定'
    case 'gift': return '跟随赠送'
    case 'module': return '机制固定'
  }
}

/** 固定原因 → 一句「为什么不能调」（hover 提示用） */
export function comboAlignFixedHint(reason: ComboAlignFixedReason): string {
  switch (reason) {
    case 'engine':
      return '引擎的记账行的合轴比例（如平A汇总、机制行）= 引擎内部口径，不是可选的用户输入'
    case 'gift':
      return '赠送行（队友转连携 / 转大等）的合轴跟随它的父动作，单独改它没有物理意义'
    case 'module':
      return '该行的合轴率由角色机制决定（如后摇不可合轴、强特合轴恒为 1），不是用户可调的比例'
  }
}
