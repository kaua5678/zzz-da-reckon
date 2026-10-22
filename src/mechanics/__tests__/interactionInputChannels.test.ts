/**
 * **交互通道 A/B 护栏**（死口径普查的机器面，2026-10-22）。
 *
 * ## 为什么需要这个文件
 *
 * 2026-10-21 的「死口径」普查把星徽·比利「格挡 +5 决意」判成**从未实现**，据此在
 * `docs/HANDOFF_DEAD_CHANNEL_AUDIT.md` 与 `docs/STUN_CONTINUOUS_LASTWINDOW.md` 写下结论。
 * 复核实测（本文件）：**该通道一直是活的** —— 决意经 spec `1531.json#billy_parry_determination_gain`
 * （`countSource: "blockCount"` → `computeSpecResources`）进账，只是**读到 100 才换 1 次星光**，
 * 所以格挡 0→5→10 的**伤害读数**几乎不动（星光次数 8/8/9），看上去像死通道。
 *
 * 根因（本文件要长期钉住的坑）：**spec 解释器按字符串键读 cfg**
 * （`countSource` / `countField` / `valueField` / `initialValueField`）——
 * 只在模块里 `grep cfg.<字段>` 会漏掉整个 spec 层，把活通道判成死通道。
 * 判死口径**只能靠 A/B 实测**（改值看结果），不能只靠 grep 消费点。
 *
 * ## 口径（别放宽）
 *
 * ① **必须走真管线**：`setupHarness` → `config.setActionCount` → 真 `useResourceCalc()`。
 *    直调模块钩子 + 手写 cfg 会把「生产代码写不写这个字段」这个自由度抹掉（AGENTS 规则 16）。
 * ② 每个探针点**独立 `setupHarness`**（收敛态复用会产出假 no-delta）。
 * ③ 断言分三层，缺一不可：
 *    · **赢家层**：该资源的总获取量里确实出现了「次数 × 单价」（`gains[ruleId]`）；
 *    · **传导层**：次数拉到跨过阈值的档位时，伤害/执行次数确实变；
 *    · **量化层**：阈值未跨过时**伤害不变但资源变**——这正是「看着像死通道」的成因，
 *      把它写成断言，后人就不必再靠肉眼判。
 * ④ **反例（detector 自证）**：给没声明该通道的角色灌同一个字段，必须**零变化**——
 *    否则本文件的「有变化」可能只是管线噪声。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { ACTION_COUNT_BOUNDS } from '@/stores/config'

type Calc = ReturnType<typeof useResourceCalc>

function charOf(calc: Calc, agentId: string) {
  const c = calc.resourceResult.value?.characters.find(x => x.agentId === agentId)
  if (!c) throw new Error(`角色 ${agentId} 不在 resourceResult 里`)
  return c
}

type ActionCountField = keyof typeof ACTION_COUNT_BOUNDS

/** 单点探针：独立装配 → 写交互次数 → 跑真管线 */
async function probe(team: string[], agentId: string, field: ActionCountField, value: number) {
  const { config } = await setupHarness(team.map(a => ({ agentId: a })))
  config.setActionCount(0, field, value)
  const calc = useResourceCalc()
  const ch = charOf(calc, agentId)
  return {
    dmg: calc.teamTotalDamage.value ?? 0,
    spec: ch.specResources ?? {},
    stars: ch.executions.find(e => e.moveId === '1531010')?.count ?? 0,
    execCount: ch.executions.reduce((s, e) => s + (e.count ?? 0), 0),
    raw: ch,
  }
}

const BILLY_TEAM = ['1531', '1251', '1271'] // 1531 + 青衣(击破) + 赛斯(防护) ⇒ 额外能力激活

describe('交互通道 A/B：声明的通道必须真有消费点', () => {
  it('星徽·比利 格挡 ×5 决意：资源层线性、伤害层量化（跨 100 决意阈值才变）', async () => {
    const p0 = await probe(BILLY_TEAM, '1531', 'blockCount', 0)
    const p5 = await probe(BILLY_TEAM, '1531', 'blockCount', 5)
    const p10 = await probe(BILLY_TEAM, '1531', 'blockCount', 10)
    const p15 = await probe(BILLY_TEAM, '1531', 'blockCount', 15)

    // 赢家层：spec gain 规则按 blockCount × 5 进账（这正是「grep 消费点」看不见的通道）
    const gainOf = (p: Awaited<ReturnType<typeof probe>>) =>
      Number((p.spec as Record<string, { gains?: Record<string, number> }>).billy_determination?.gains?.billy_parry_determination_gain ?? 0)
    expect(gainOf(p0)).toBe(0)
    expect(gainOf(p5)).toBe(25)
    expect(gainOf(p10)).toBe(50)
    expect(gainOf(p15)).toBe(75)

    // 量化层：0→5→10 决意总量线性涨，但星光次数只跨一次阈值 ⇒ 伤害几乎不动（**不是死通道**）
    expect(p10.dmg).toBeGreaterThan(p0.dmg)
    expect(p5.stars).toBe(p0.stars)
    // 传导层：15 次格挡跨过下一个 100 决意阈值 ⇒ 星光次数与伤害都变
    expect(p15.stars).toBeGreaterThan(p0.stars)
    expect(p15.dmg).toBeGreaterThan(p10.dmg)
  })

  it('般岳 金身格挡/双反：嗔火资源与伤害都变（模块内消费）', async () => {
    const banyue = ['1471', '1251', '1271']
    const b0 = await probe(banyue, '1471', 'blockCount', 0)
    const b8 = await probe(banyue, '1471', 'blockCount', 8)
    const d0 = await probe(banyue, '1471', 'dualCounterCount', 0)
    const d8 = await probe(banyue, '1471', 'dualCounterCount', 8)
    expect(b8.dmg).not.toBe(b0.dmg)
    expect(d8.dmg).not.toBe(d0.dmg)
  })

  it('朱鸢 闪避反击/快速支援：强化霰弹资源随次数增长（spec 通道）', async () => {
    const zhu = ['1241', '1251', '1271']
    const d0 = await probe(zhu, '1241', 'dodgeCounterCount', 0)
    const d6 = await probe(zhu, '1241', 'dodgeCounterCount', 6)
    const shells = (p: Awaited<ReturnType<typeof probe>>) =>
      Number((p.spec as Record<string, { total?: number }>).zhuyuan_shells?.total ?? 0)
    expect(shells(d6)).toBeGreaterThan(shells(d0))
  })

  it('佩洛伊斯 强特完美格挡：日珥账本有实现、但按设计不进伤害（展示层通道）', async () => {
    const peiluo = ['1551', '1251', '1271']
    const a = await probe(peiluo, '1551', 'perfectBlockCount', 0)
    const b = await probe(peiluo, '1551', 'perfectBlockCount', 20)
    const prominence = (p: Awaited<ReturnType<typeof probe>>) =>
      Number((p.spec as Record<string, { total?: number }>).peiluo_prominence?.total ?? 0)
    // 资源层确实加（20 次 × 10 = +200）……
    expect(prominence(b) - prominence(a)).toBeCloseTo(200, 6)
    // ……但日珥只做「循环是否打得起」的校验，不进伤害（spec note 明写，非死通道）
    expect(b.dmg).toBe(a.dmg)
  })

  it('反例（detector 自证）：未声明该通道的角色灌同一字段，结果必须零变化', async () => {
    // 1531 从未声明 dualCounterCount（interactionFieldTypes / interactionInputs 都没有它）
    const d0 = await probe(BILLY_TEAM, '1531', 'dualCounterCount', 0)
    const d20 = await probe(BILLY_TEAM, '1531', 'dualCounterCount', 20)
    expect(d20.dmg).toBe(d0.dmg)
    expect(d20.execCount).toBe(d0.execCount)
  })
})
