/**
 * ⑤ 合轴匀出杠杆（jointLeverStrategy 第⑤步，用户 2026-09-13 留白裁决的机器面）：
 * 「平A会把剩余时间吃完。允许多吃，多吃就上调队友的合轴率匀出来；少吃=完全发呆不允许」。
 *
 * 数据现实（2026-09-13 全库扫描定案，账本 task-ledger-calc-core.md「③b」）：
 * catalog 表列 comboAlignRatio>0 的**只有爱丽丝(1401)平A #3** 一条 ⇒ 真实队上⑤大多走拒绝分支
 * （实测：给琉音连携行种 0.3 后升档会毁②弹刀买到的失衡窗口，接受门正确回滚）。
 * 所以本文件不赌"夹具必然咬合"，把三件事各自钉死：
 *  ① 接受判据 = 纯函数全矩阵（accept/reject 每条分支确定性覆盖，不靠搜索轨迹碰运气）；
 *  ② 机制传导 = 手动种合轴（结果页弹窗同源录入面）→ 引擎产出行吃到 → 平A池真的回流；
 *  ③ 集成诚实 = joint 跑完要么"咬合且改善"，要么"回滚且不谎报"，两分支之外即红；
 *  ④ 外溢面 = 默认档 B 不碰合轴覆盖（golden/留白棘轮零冲击的结构保证）。
 *
 * ⚠ 枚举源教训（实测）：覆盖必须打在 ov(moveId,表默认) 消费的**实际产出行 moveId** 上，
 * 种错行时 ② 的生效断言会响——这同时是消费面接线回归。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  applyTimeWeightAllocation,
  reliefTrialAccepted,
  DEEP_TIME_WEIGHT_STRATEGY_ID,
} from '@/composables/timeWeightAllocation'

/** 艾莲(主C attack) + 琉音(击破，连携行=ov 接线样板位) + 耀嘉音(支援) */
const TEAM = ['1191', '1481', '1311']

type Calc = ReturnType<typeof useResourceCalc>

const poolSecs = (calc: Calc) => (calc.resourceResult.value?.characters ?? [])
  .reduce((a, c) => a + Math.max(0, c.timeAllocation?.basicAttackTime ?? 0), 0)
const truncOf = (calc: Calc) => calc.resourceResult.value?.convergence?.timeTruncatedSeconds ?? 0
const rowsOf = (calc: Calc, slot: number) =>
  calc.resourceResult.value?.characters?.find(c => c.slot === slot)?.executions ?? []

async function boot() {
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  const calc = useResourceCalc()
  for (let i = 0; i < 3; i++) config.setAgent(i, TEAM[i])
  return { config, calc }
}

/** 槽1 琉音的连携执行行 moveId（buildCharConfig 的 ov 三路接线之一） */
function chainMoveId(calc: Calc): string {
  const row = rowsOf(calc, 1).find(e => e.category === 'chain' && e.actionTime > 0)
  expect(row, '槽1 琉音没有连携执行行，夹具前提失效（换成员，不许静默跳过）').toBeTruthy()
  return String(row!.moveId)
}

describe('⑤ 合轴匀出 · 接受判据（纯函数全矩阵）', () => {
  const base = { p0: 10, t0: 5, d0: 100, s0: 4, feasible: true }
  it('平A池↑（用户语义：匀出的时间回流多吃）→ 接受', () => {
    expect(reliefTrialAccepted({ ...base, p1: 10.01, t1: 5, d1: 100, s1: 4 })).toBe(true)
  })
  it('截断↓（多吃被合轴吸收）→ 接受', () => {
    expect(reliefTrialAccepted({ ...base, p1: 10, t1: 4.9, d1: 100, s1: 4 })).toBe(true)
  })
  it('总伤↑ → 接受', () => {
    expect(reliefTrialAccepted({ ...base, p1: 10, t1: 5, d1: 100.1, s1: 4 })).toBe(true)
  })
  it('无任何改善信号 → 拒绝（不许白动覆盖）', () => {
    expect(reliefTrialAccepted({ ...base, p1: 10, t1: 5, d1: 100, s1: 4 })).toBe(false)
    // 池微涨在量化噪声内（≤1e-3）也算无改善
    expect(reliefTrialAccepted({ ...base, p1: 10.0005, t1: 5, d1: 100, s1: 4 })).toBe(false)
  })
  it('有信号但总伤跌破地板 → 拒绝（不许拿伤害当匀的代价）', () => {
    expect(reliefTrialAccepted({ ...base, p1: 20, t1: 0, d1: 99.9, s1: 4 })).toBe(false)
  })
  it('有信号但失衡降 → 拒绝（琉音连携种子的实测死状：stun 4→3 + dmg −8.9%）', () => {
    expect(reliefTrialAccepted({ ...base, p1: 11, t1: 5, d1: 100, s1: 3 })).toBe(false)
  })
  it('有信号但可行门破（截断恶化）→ 拒绝（净占用≤预算是硬不变量）', () => {
    expect(reliefTrialAccepted({ ...base, p1: 11, t1: 6, d1: 101, s1: 4, feasible: false })).toBe(false)
  })
})

describe('⑤ 合轴匀出 · 机制传导与集成诚实', () => {
  it('传导面：手动种合轴 → 产出行吃到（ov 接线）→ 升档后平A池真回流', async () => {
    const { config, calc } = await boot()
    const moveId = chainMoveId(calc)
    const p0 = poolSecs(calc)
    config.setComboAlignOverride(1, moveId, 0.8)
    config.triggerRefresh()
    const seeded = rowsOf(calc, 1).find(e => String(e.moveId) === moveId)
    expect(seeded?.comboAlignRatio ?? 0, '种子未进执行行 = ov() 接线断').toBeCloseTo(0.8, 3)
    expect(poolSecs(calc), '队友可合轴段不占共享轴 ⇒ 平A池必须增大（坑21）').toBeGreaterThan(p0)
  }, 120_000)

  it('诚实面：joint 跑完两分支必居其一（咬合=note+改善；否则=回滚到种子值且不谎报），硬不变量恒守', async () => {
    const { config, calc } = await boot()
    const moveId = chainMoveId(calc)
    config.setComboAlignOverride(1, moveId, 0.3)
    config.triggerRefresh()
    const p0 = poolSecs(calc); const t0 = truncOf(calc)
    const d0 = calc.teamTotalDamage.value; const s0 = calc.stunPoolResult.value?.stunCount ?? 0
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const note = r.note ?? ''
    const ovr = config.getComboAlignOverride(1, moveId, -1)
    const bit = note.includes('合轴匀出')
    if (bit) {
      expect(r.applied, 'note 声称咬合却 applied=false').toBe(true)
      expect(poolSecs(calc), '声称匀出却没回流').toBeGreaterThan(p0)
      expect(ovr).toBeGreaterThan(0.3)
    } else {
      // 拒绝分支：覆盖必须停在种子值（当场回滚，不留半成品突变）
      expect(ovr, `杠杆未咬合但覆盖被动到 ${ovr}（应回滚到 0.3）`).toBeCloseTo(0.3, 6)
    }
    // 两分支共守的硬不变量
    expect(calc.teamTotalDamage.value, '总伤不降').toBeGreaterThanOrEqual(d0 - 1e-6)
    expect(calc.stunPoolResult.value?.stunCount ?? 0, '失衡不降').toBeGreaterThanOrEqual(s0)
    expect(truncOf(calc), '截断不升').toBeLessThanOrEqual(t0 + 1e-6)
  }, 180_000)

  it('外溢面：默认档（B）不碰合轴覆盖——杠杆只挂 joint，golden 路径零外溢', async () => {
    const { config, calc } = await boot()
    const moveId = chainMoveId(calc)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(r.strategyId).toBe('marginal-equalize')
    expect(config.getComboAlignOverride(1, moveId, -1), 'B 档偷设合轴覆盖').toBe(-1)
    for (const s of [1, 2]) {
      for (const e of rowsOf(calc, s)) {
        expect(config.getComboAlignOverride(s, String(e.moveId), -1)).toBe(-1)
      }
    }
  }, 120_000)
})
