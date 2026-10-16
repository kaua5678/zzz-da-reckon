/**
 * 弃轴提示判据（用户口径 2026-10-16）：
 *
 * > 「合轴率不修改是在**非轴模式下的默认设置**，这里**没有资源要求**。轴模式下，**如果弃轴要给提醒**，
 * >  毕竟用户选择了轴就是想看轴，**悄悄退化等于欺骗用户**。此外弃轴可以给提示，说**需要更多合轴率**，
 * >  **引导用户提高合轴率**，进而算出完整轴。」
 *
 * 两条口径各一条判据（**缺任一条就是没做**）：
 *  ① **非轴模式不提示**（没选轴 = 没有资源要求，弃轴概念不适用）；
 *  ② **选了轴且被弃 ⇒ 必须提示，且必须带「提高合轴率」的引导**（不是只说「轴不可行」）。
 *
 * 反证：把 ① 的条件删掉（`axisRequested` 不判）⇒ 用例 ① 红；把 ② 的 `action` 恒设 `'none'` ⇒ 用例 ② 红。
 */
import { describe, expect, it } from 'vitest'
import { axisFallbackNotice, axisFallbackNoticeOf } from '@/composables/axisFallbackNotice'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

describe('弃轴提示', () => {
  it('① 非轴模式恒不提示（用户口径：这里没有资源要求）', () => {
    for (const absorb of [0, 0.2, 0.4, 1]) {
      const n = axisFallbackNotice({ fallback: true, axisRequested: false, absorbRatio: absorb })
      expect(n.show, `非轴模式（absorb=${absorb}）不该提示`).toBe(false)
    }
    // 没弃轴也不提示
    expect(axisFallbackNotice({ fallback: false, axisRequested: true, absorbRatio: 0.4 }).show).toBe(false)
  })

  it('② 选了轴且被弃 ⇒ 提示，且必须引导「提高合轴率」（带当前值/上限）', () => {
    const n = axisFallbackNotice({ fallback: true, axisRequested: true, absorbRatio: 0.4 })
    expect(n.show).toBe(true)
    expect(n.title).toContain('弃用')
    // 关键：必须说清「下面的伤害不是轴打出来的」（用户口径「悄悄退化等于欺骗用户」）
    expect(n.detail).toContain('不是轴打出来的')
    // 关键：必须给「提高合轴率」这个具体指引（用户点名要求）
    expect(n.detail).toContain('合轴率')
    expect(n.action).toBe('raise-absorb')
    expect(n.currentAbsorb).toBe(0.4)
    expect(n.ceiling).toBe(1)
  })

  it('②b 文案是纯文本：不含 Markdown 记法（\u0060**\u0060 在 naive-ui alert 里会原样显示成星号，实机踩到）', () => {
    for (const absorb of [0.4, 1]) {
      const n = axisFallbackNotice({ fallback: true, axisRequested: true, absorbRatio: absorb })
      expect(n.detail, 'detail 不得含 ** 记法').not.toContain('**')
      expect(n.title, 'title 不得含 ** 记法').not.toContain('**')
    }
  })

  it('③ 合轴率已在上限 ⇒ 不再建议抬高（如实告知只能换 Boss / 改轴）', () => {
    const n = axisFallbackNotice({ fallback: true, axisRequested: true, absorbRatio: 1 })
    expect(n.show).toBe(true)
    expect(n.action).toBe('none')
    expect(n.detail).toContain('已经是上限')
    expect(n.detail).not.toContain('抬到上限')
  })

  it('④ 便捷入口按 store 读数判「用户是否要了轴」（手动开 或 自动命中）', () => {
    const mk = (useStunAxis: boolean, absorb: number) => ({
      useStunAxis,
      getMechanicSetting: (k: string, d: number) => (k === COMBO_ALIGN_ABSORB_RATIO_SETTING ? absorb : d),
    })
    // 手动开关关 + 自动轴没命中 ⇒ 不提示
    expect(axisFallbackNoticeOf(mk(false, 0.4), true, false).show).toBe(false)
    // 自动轴命中（用户虽没开手动开关，但队伍匹配到了预设轴）⇒ 提示
    expect(axisFallbackNoticeOf(mk(false, 0.4), true, true).show).toBe(true)
    // 手动开关开 ⇒ 提示
    expect(axisFallbackNoticeOf(mk(true, 0.4), true, false).show).toBe(true)
  })
})
