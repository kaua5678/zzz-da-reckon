/**
 * CC-74：「11号 1041 + 平A兜底」端到端护栏（census §5.69 盲区：perf 夹具没有带 basicFillerSlot 的轴，
 * 模块钩子 expandBasicFill 的输出一路流到伤害池这段只有 roundInputs 单测）。
 *
 * 做法：整管线（setupHarness + useResourceCalc，轴模式，轴里放莱卡恩一个动作，basicFillerSlot = 0 → 11号）；
 * 在测试里临时把 11号 模块的 expandBasicFill 按比例缩放，观察伤害池 `direct-0-1041008` 行。
 * 第 93 轮实测（HEAD 872bb72）：
 * - 无填充：`direct-0-1041008` count 7 / totalDamage ≈ 107208（轴外口径）
 * - 钩子原样：同一行 count 7 / ≈ 161686（全部落在失衡内口径）。钩子产出 > 7 被夹紧到 7 是**设计内**：
 *   `convergence.ts#inAxisFractionProvider` 按 `min(1, 轴内次数 / e.count)` 求轴内占比，填充不会新增执行次数
 * - 钩子 ×0：与无填充逐位相同
 * - 钩子 ×0.1 / ×0.05（线性区）：拆成轴内行 `direct-0-1041008` + 轴外行 `direct-0-1041008-out`，
 *   轴内 count = 钩子产出，两行 count 之和守恒 = 7，轴内每次伤害不变
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import { findMoveById } from '@/data/moveTableQueries'
import { setupHarness } from '@/test/harness'

const ROW_ID = 'direct-0-1041008'
type Hook = NonNullable<AgentMechanicModule['expandBasicFill']>
const mod = () => getAgentMechanic('1041') as AgentMechanicModule & { expandBasicFill?: Hook }
let restore: Hook | undefined

afterEach(() => { if (restore) mod().expandBasicFill = restore; restore = undefined })

describe('CC-74 11号平A兜底端到端', () => {
  it('钩子输出流到伤害池：有填充 > 无填充；×0 == 无填充；线性区 count == 钩子产出且每次伤害不变', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1041', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1141', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1211', cinemaLevel: 0, potentialLevel: 6 },
    ])
    config.useStunAxis = true
    const calc = useResourceCalc()
    const orig = mod().expandBasicFill!
    restore = orig
    let seq = 0
    const run = (filler: number | undefined, scale: number | null) => {
      mod().expandBasicFill = scale === null ? orig : (i) => orig(i).map(x => ({ ...x, count: x.count * scale }))
      // 每次换新数组 + 新名字，强制 computed 重算（钩子替换本身不是响应式的）
      config.stunAxes = [{ name: `cc74-${seq++}`, count: 2, actions: [{ slot: 1, moveId: '1141011', count: 1 }], basicFillerSlot: filler }]
      const row = calc.damagePoolRows.value.find(r => r.id === ROW_ID)
      expect(row, `${ROW_ID} 行必须存在`).toBeTruthy()
      const out = calc.damagePoolRows.value.find(r => r.id === `${ROW_ID}-out`)
      return { count: row!.count, outCount: out?.count ?? 0, total: row!.totalDamage, fill: calc.stackTraversalResult.value?.basicFillBySlot?.[0] ?? 0 }
    }

    const none = run(undefined, null)
    const full = run(0, null)
    const zero = run(0, 0)
    const tenth = run(0, 0.1)
    const twentieth = run(0, 0.05)

    expect(none.fill).toBe(0)
    expect(full.fill).toBeGreaterThan(0)
    const at = findMoveById(catalog.agentSkillsByAgentMap.get('1041'), '1041008')?.actionTime
    expect(at).toBeGreaterThan(0)
    const hookCount = full.fill / at!

    // ① 有填充时 1041008 走失衡内口径，总伤高于无填充（repT 被改大 ⇒ 次数骤减 ⇒ 此条变红）
    expect(full.total).toBeGreaterThan(none.total)
    // ② 钩子产出 0 ⇒ 与无填充逐位相同（钩子是该行轴内次数的唯一来源）
    expect(zero.count).toBe(none.count)
    // r652 CC-469′：填充**秒数**（栈算出的窗口剩余时间）与钩子缩放无关，现在计入「已覆盖窗口秒」进失衡池 ⇒ 有填充槽但钩子×0
    // 的合成态与「无填充槽」在覆盖率/失衡上不再逐位同；钩子是该行**次数**的唯一来源这一口径仍由上一行钉住，total 不再锁。
    // ③ 线性区：行次数 == 钩子产出，每次伤害不随次数变
    expect(tenth.count).toBeCloseTo(hookCount * 0.1, 6)
    expect(twentieth.count).toBeCloseTo(hookCount * 0.05, 6)
    // ④ 次数守恒：轴内 + 轴外 == 无填充时的总次数（填充只改占比，不改执行次数）
    for (const r of [full, tenth, twentieth]) expect(r.count + r.outCount).toBeCloseTo(none.count, 9)
    const per = tenth.total / tenth.count
    expect(twentieth.total / twentieth.count).toBeCloseTo(per, 3)
    expect(full.total / full.count).toBeCloseTo(per, 3)
  })
})
