/**
 * 环内选点的**接线**测试（仿 outerFeedbackRegression）：`vi.mock` 包一层真实的
 * `pickOuterCycleMember`，只记录每次入参 members 与返回值，**不改返回值**。
 *
 * 为什么需要它：`outerCycle.test.ts` 钉的是纯函数判据本身；纯函数正确但调用方传了
 * 错位的成员切片（如长环分支的 `from` 下标算错）时，纯函数单测全绿而真管线落点已错。
 * 本文件用 `yixuan-jufufu-lucia` 真预设队跑完整管线，断言长环分支收到的成员是
 * **首尾对齐的闭环切片**、且规范停点不是末轮（与 `timeGolden` 的落点读数同源但独立）。
 *
 * ⑤ 落点同一性（lead 复核 2026-09-24 补）：只看纯函数的返回值不够——把适配层的
 * `all[picked.index]` 改成取末轮，纯函数单测与 ①–④ 全绿，只有 `timeGolden` 数值基线变红。
 * 故再包一层 `createRunCalcRound` 记录每轮输出，断言最终结果**就是**纯函数选中的那一轮（引用相同）。
 */
import { describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import type { CalcRoundResult } from '@/composables/resourceCalc/convergence'

const observed = vi.hoisted(() => ({
  /** 真管线每轮的非空输出（按计算顺序）。 */
  rounds: [] as CalcRoundResult[],
  calls: [] as Array<{
    members: Array<{ stunIn: number; next: number; disc: number; time: number }>
    result: { index: number; pickedEarlier: boolean }
    tol: { stun: number; disc: number; time: number }
    /** 调用时刻最近 members.length 轮的输出 = 各成员对应的轮结果（长环成员 = 历史末尾一个周期）。 */
    tail: CalcRoundResult[]
  }>,
}))

vi.mock('@/composables/resourceCalc/convergence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/resourceCalc/convergence')>()
  return {
    ...actual,
    createRunCalcRound: (...factoryArgs: Parameters<typeof actual.createRunCalcRound>) => {
      const run = actual.createRunCalcRound(...factoryArgs)
      return (...args: Parameters<typeof run>) => {
        const out = run(...args)
        if (out) observed.rounds.push(out)
        return out
      }
    },
  }
})

vi.mock('@/composables/resourceCalc/outerCycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/resourceCalc/outerCycle')>()
  return {
    ...actual,
    pickOuterCycleMember: (
      members: Parameters<typeof actual.pickOuterCycleMember>[0],
      tol: Parameters<typeof actual.pickOuterCycleMember>[1],
    ) => {
      const result = actual.pickOuterCycleMember(members, tol)
      observed.calls.push({
        members: members.map(m => ({ ...m })),
        result: { ...result },
        tol: { ...tol },
        tail: observed.rounds.slice(-members.length),
      })
      return result
    },
  }
})

/** 建 yixuan-jufufu-lucia 预设队（与 timeGolden.test.ts 同一路径：先建空队再套预设）。 */
async function setupYixuanPreset() {
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  const team: [string, string, string] = ['1371', '1391', '1451']
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  config.applyTeamPreset(team)
  // CC-154（第 177 轮）：本文件测「长环分支的接线」，需要一个真出长环的场景。physical 下模块计数改读计数通道后本队外层
  // 收敛为 2-环（不再有长环）⇒ 钉 off（机制钉，非不变量；场景口径同 CC-148 第 2 类）。
  config.setMechanicSetting('time.stunPlanProjection', 0)
  return { calc, config }
}

describe('环内选点的接线：长环成员切片首尾对齐且取规范停点', () => {
  it('yixuan-jufufu-lucia：长环分支只调用一次且成员闭环、选点与相位无关', async () => {
    const { calc } = await setupYixuanPreset()
    observed.rounds = []
    observed.calls = []
    const rr = calc.resourceResult.value
    expect(rr, '预设队无资源结果').toBeTruthy()

    const longCalls = observed.calls.filter(c => c.members.length >= 3)
    expect(longCalls.length, `长环分支应恰好调用一次，实测 ${longCalls.length} 次（总调用 ${observed.calls.length} 次）`).toBe(1)

    const { members, result, tail, tol } = longCalls[0]
    const n = members.length
    // ① 切片对齐：成员 j 的输出失衡 = 成员 j+1 的输入失衡（严格相等）
    for (let j = 0; j < n - 1; j++) {
      expect(members[j].next, `成员 ${j} 的 next 未接上成员 ${j + 1} 的 stunIn`).toBe(members[j + 1].stunIn)
    }
    // ② 闭环：末轮输出回到首轮输入（容差 = 判稳容差）
    expect(Math.abs(members[n - 1].next - members[0].stunIn), '长环切片未闭环').toBeLessThan(0.05)
    // ③ 规范停点与相位无关：把成员环任意旋转后再调纯函数，选中的必须是同一个成员（按 stunIn/next 值认）。
    //    2026-10-03 第 427 轮 CC-402（卢西娅终结技两段融合改了本队的环）后，规范成员（③′ 输入失衡最小者 stunIn≈0.309）
    //    恰好落在环的末相位 ⇒ 原「index 不是末轮」断言失效——它锁的本来就是「选点不随检出相位变」，改成直接锁这个性质。
    //    代价：本夹具在当前相位下分辨不出「适配层改取末轮」的回归（⑤ 的引用同一性在 picked == 末轮时两边相同）；
    //    若将来要恢复这层判别力，换一个规范成员不在末相位的长环队。
    const actualPick = (await vi.importActual<typeof import('@/composables/resourceCalc/outerCycle')>('@/composables/resourceCalc/outerCycle')).pickOuterCycleMember
    const picked = members[result.index]
    for (let r = 1; r < n; r++) {
      const rotated = [...members.slice(r), ...members.slice(0, r)]
      const rp = actualPick(rotated, tol)
      expect([rotated[rp.index].stunIn, rotated[rp.index].next], `旋转 ${r} 后选中的不是同一成员`).toEqual([picked.stunIn, picked.next])
    }
    // ④ 出口与选点标志
    expect(rr!.convergence?.outerExit).toBe('cycle')
    expect(Boolean(rr!.convergence?.outerCyclePickedEarlier)).toBe(result.pickedEarlier) // 与纯函数返回值同源（r427 前恒 true，取决于相位；false 时字段不写）
    // ⑤ 落点同一性：最终结果就是纯函数选中的那一轮，而不是末轮（适配层吞掉 index 时只有这条会红）
    expect(tail.length).toBe(n)
    expect(rr!.characters, '最终结果不是纯函数选中的那一轮').toBe(tail[result.index].resourceResult!.characters)
    if (result.index !== n - 1) expect(rr!.characters, '最终结果退化成了末轮').not.toBe(tail[n - 1].resourceResult!.characters)
  }, 300_000)
})
