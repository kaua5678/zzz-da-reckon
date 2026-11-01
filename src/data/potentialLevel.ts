/**
 * 潜能觉醒等级的唯一归一口（CC-503，r685）。**零 import**：core / mechanics / 编排层 / 展示层共用。
 *
 * 口径：1..6 整数，缺省 6 = 满档（UI 滑块 `TeamConfigPage.vue` min 1 / max 6、store 默认 6）。
 * 此前这条规则在 agents 下 ≥ 12 处各写一遍 `Math.max(1, Math.min(6, Math.floor(Number(potentialLevel ?? 6))))`
 * （harumasa 用 `whole`、jane 自带 `clampPotential`、anbyZero 无缺省），core/panel.ts 还有一份不 floor 的——
 * 生产输入恒为 1..6 整数，各副本只在垃圾输入上分叉，这里统一为：
 *   - `null` / `undefined` / 非有限数 ⇒ 缺省 6（与 jane `clampPotential` 一致）；
 *   - 其余 ⇒ `floor` 后夹到 [1, 6]（0 ⇒ 1；harumasa 旧 `|| 6` 曾把 0 当缺省，生产取不到 0，按多数派）。
 * 若日后要改边角语义，只改这里。
 */
export const POTENTIAL_LEVEL_MIN = 1
export const POTENTIAL_LEVEL_MAX = 6
export const POTENTIAL_LEVEL_DEFAULT = 6

export function potentialLevelOf(value: unknown): number {
  if (value == null) return POTENTIAL_LEVEL_DEFAULT
  const n = Number(value)
  if (!Number.isFinite(n)) return POTENTIAL_LEVEL_DEFAULT
  return Math.max(POTENTIAL_LEVEL_MIN, Math.min(POTENTIAL_LEVEL_MAX, Math.floor(n)))
}

/**
 * 潜能**开关**（2026-11-01 用户口径）：「有/无潜能」是逐角色的布尔量，与 1..6 档位正交。
 *
 * 与 potentialLevel 的分工：
 * - potentialLevel = **觉醒了多少档**（I..VI）；
 * - potentialEnabled = 这个角色**算不算潜能**（关掉 = 潜能整条不生效，等价 I 档）。
 *
 * 为什么不是「把滑块拨到 1」：拨档会**毁掉**用户选的档位（旧角色 II~VI 逐档取值，关再开回不到原档）；
 * 且新录的潜能（1391/1331，II~VI 同文）本来就没有有意义的档位，布尔量才是对的控件。
 *
 * 缺省 true（历史角色一次性默认为「有潜能」，行为逐位不变）；只有显式 false 才算关。
 */
export function potentialEnabledOf(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value !== 'false' && value !== '0' && value !== ''
  return Boolean(value)
}

/**
 * 消费侧唯一读口：把「档位 + 开关」折成引擎真正使用的 effective level。
 * 关掉开关 ⇒ 恒 POTENTIAL_LEVEL_MIN（= 无觉醒）；所有读潜能的地方都应经此函数，
 * 而不是各写一份 enabled ? level : 1（CC-503 的教训：没有名字就会有第 N 份）。
 */
export function effectivePotentialLevelOf(potentialLevel: unknown, potentialEnabled: unknown): number {
  return potentialEnabledOf(potentialEnabled) ? potentialLevelOf(potentialLevel) : POTENTIAL_LEVEL_MIN
}

// @fact engine:潜能开关 口径: 潜能 = 档位(potentialLevel 1..6) × 开关(potentialEnabled 布尔)；关掉开关 ⇒ 消费侧 effectivePotentialLevelOf 恒 I 档(无觉醒)且**档位保留**；缺省 true（历史角色行为逐位不变），只有显式 false 才算关；UI 开关只在声明 AgentMechanicModule.potentialSwitch 的角色露出 | 据 用户 2026-11-01「给潜能加个开关，因为我们这个有无潜能的完整实现了；11号这种老角色的就不用加开关了」 | 验 src/mechanics/__tests__/potentialSwitch.test.ts | 锚 src/data/potentialLevel.ts#effectivePotentialLevelOf | 信 确认
// ⟳复核: 引擎新增读潜能的通道（团队 buff formula / 面板 / 模块钩子）时，复核它是否经 effectivePotentialLevelOf（漏一处 = 开关关不掉） | 到期 2027-03-31
