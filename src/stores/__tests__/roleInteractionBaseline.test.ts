/**
 * 交互基准 —— **全职业 0**（2026-10-21 round 32，用户裁决）。
 *
 * 用户原话（逐字）：
 * > 「这个预填次数我让 agent 改了好几次，其中一次把辅助默认改成 0 了，结果还是没变。
 * >  **干脆直接全改成 0 得了。**」
 * > 「考虑自动判断的计算成本，负收益角色的寻找成本，**全0是最省事的**」
 *
 * ## 为什么不再按职业给 6/10
 *
 * 旧口径（2026-09-04）给非支援/防护预填 `parry 6 + dodge 10`（每人 16 次 ≈ 13 秒）。
 * 那是「帮用户填好」的便利设计，但有**结构性副作用**：引擎先塞 16 次/人、再算时间账
 * ⇒ 3 人队一次多出 ≈26 秒交互，而溢出本该是「最多一次交互」的量级。
 * 实测还发现它对部分角色是**负收益**（`auto-1461-1521-1491` 的 1461/席德：
 * 只给它 6/10 交互 ⇒ 伤害 138.5 → 123.2M，因为交互挤掉普通平A、钢能产出反而少 2 组落华）。
 *
 * 改成 0 后：交互不预填，剩余时间回灌平A池（`availableBasicTime`）；
 * 要打交互的用户自己在交互栏填，或由模块 `computeInteractionTopUp` 注入。
 *
 * ## 「最优交互次数」由难度曲线给，不由默认值给
 *
 * 难度曲线（`climbDifficultyLadder`）从 **① 全 0 交互**出发，逐档 joint 搜索加回来——
 * 实测单队只要 **7~14ms**（`calcOutput` memo 缓存），成本可忽略。
 * 默认值保持 0 = 「用户没表态」，最优值 = 「计算器建议」，两者不该混为一谈。
 *
 * ## 仍然生效的两条例外
 *
 * 1. **角色专属默认**（`interactionDefaults`，如星徽·比利 招架4/格挡5）仍优先——那是角色机制声明；
 * 2. **正反馈 refund 模块**（伊德海莉 1051）不吃通用基准（玩法口径：蓄力/极寒重碾 carry，弹刀闪反归击破位）。
 */
import { describe, expect, it } from 'vitest'
import { interactionBaselineFor } from '@/stores/config'
import { roleInteractionBaseline } from '@/mechanics/interactionBaseline'

describe('roleInteractionBaseline', () => {
  it('全职业 0 交互（不预填——剩余时间由平A池接走）', () => {
    for (const s of ['attack', 'anomaly', 'stun', 'support', 'defense', undefined]) {
      expect(roleInteractionBaseline(s), `${s} 应为全 0`).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
    }
  })
})

describe('interactionBaselineFor（手动队接线：专属默认 > 正反馈排除 > 职业基准）', () => {
  /**
   * 2026-10-22 订正：星徽·比利的专属默认值已于 **2026-10-21 用户裁决改为全 0**
   * （「交互默认全 0 —— 引擎不再替用户预填」），唯一事实源 = `starlightBilly.ts#BILLY_INTERACTION_DEFAULTS`。
   *
   * 本条原断言 `parry:4, block:5` 是改口径前的旧值，与同文件「全职业 0 交互（不预填）」自相矛盾。
   * 改为钉住「专属默认仍走 interactionDefaults 通道，只是值为全 0」。
   */
  it('角色专属默认走 interactionDefaults 通道，值全 0（2026-10-21 不预填口径）', () => {
    expect(interactionBaselineFor('1531', 'attack')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })
  it('正反馈 refund 模块（伊德海莉 1051）不吃通用交互基准', () => {
    expect(interactionBaselineFor('1051', 'attack')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })
  it('职业基准兜底：**全职业 0**（2026-10-21 起不再按职业给 6/10）', () => {
    expect(interactionBaselineFor('1141', 'stun')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
    expect(interactionBaselineFor('1451', 'support')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })
})
