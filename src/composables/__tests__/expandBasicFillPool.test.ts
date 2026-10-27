/**
 * 兜底池（2026-10-27 用户口径）+ `expandBasicFill` 的资源入参。
 *
 * 用户逐字：「我预计在这基础上做一个**兜底池**，可以把某些招式放进去，这些招式会自动填充进兜底时间……
 * 这里兜底部分和前面预设失衡部分不一样，**他本身作为一个产出招式的地方，而不从余量池拿取**。」
 * 三种形态里本轮落地的是**形态三**：
 * > 「三是**格里斯这种 e 在平 a 链中的**，就只能把这段时间给平 a 和 e 的循环链了。」
 *
 * 本文件锁三件事：
 * ① 编排层把**本轮引擎读数**（energy / decibel / executedExSpecialCount）真的传进钩子，
 *    且**没有读数时不传**（「没有读数」≠「读数为 0」，后者会让模块把窗尾误判成资源充足）；
 * ② 格莉丝的窗尾切分**时间守恒**（Σ 秒数 = fillSec，不多不少）——它是兜底填充的硬约束，
 *    一旦多算就是「凭空造动作」；少算就是窗尾静默蒸发；
 * ③ 强特认领**不超过本轮真打出来的次数**（超额会被失衡分数的 `min(1,·)` 钳掉，
 *    并把这部分秒数从平A的轴内占比里抢走 ⇒ 静默少算）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs } from '@/composables/resourceCalc/roundInputs'
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import { expandGraceBasicFill } from '@/mechanics/agents/grace'
import { findMoveById } from '@/data/moveTableQueries'

type Hook = NonNullable<AgentMechanicModule['expandBasicFill']>
type HookInput = Parameters<Hook>[0]

/** 格莉丝强特（1181006）在伤害池里的行 id（`direct-<slot>-<moveId>`；轴外拆到 `-out`） */
const EX_ROW_ID = 'direct-0-1181006'
/** 端到端用例临时摘/挂格莉丝钩子，afterEach 复位（模块对象是全局单例） */
let restorePoolHook: Hook | undefined
afterEach(() => {
  if (!restorePoolHook) return
  ;(getAgentMechanic('1181') as AgentMechanicModule).expandBasicFill = restorePoolHook
  restorePoolHook = undefined
})

function roundInputsOf(
  config: Awaited<ReturnType<typeof setupHarness>>['config'],
  catalog: Awaited<ReturnType<typeof setupHarness>>['catalog'],
) {
  const calc = useResourceCalc()
  return createConvergenceRoundInputs({ configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig })
}

describe('兜底池 ①：资源读数进钩子（缺省 ≠ 0）', () => {
  const mod = () => getAgentMechanic('1041') as AgentMechanicModule & { expandBasicFill?: Hook }
  let restore: Hook | undefined
  afterEach(() => { if (restore) { mod().expandBasicFill = restore; restore = undefined } })

  it('三个读数原样注入；未给预算时三个字段都不存在', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1041' }, { agentId: '1181' }, { agentId: '1211' }])
    const inputs = roundInputsOf(config, catalog)
    const seen: HookInput[] = []
    const orig = mod().expandBasicFill!
    restore = orig
    mod().expandBasicFill = input => { seen.push(input); return orig(input) }

    inputs.expandExecutedToCounts({}, { 0: 3.5 }, { 0: { energy: 120, decibel: 2500, exSpecial: 2 } })
    expect(seen.at(-1)?.energyAvailable).toBe(120)
    expect(seen.at(-1)?.decibelAvailable).toBe(2500)
    expect(seen.at(-1)?.exSpecialAvailable).toBe(2)

    // 旧调用点（不传 fillResources）⇒ 三个字段都不得出现（不是 0）
    inputs.expandExecutedToCounts({}, { 0: 3.5 })
    const last = seen.at(-1)!
    expect('energyAvailable' in last).toBe(false)
    expect('decibelAvailable' in last).toBe(false)
    expect('exSpecialAvailable' in last).toBe(false)
  })
})

describe('兜底池 ③：格莉丝窗尾 = A + 特殊技循环链（时间守恒）', () => {
  const secondsOf = (rows: ReadonlyArray<{ moveId: string; count: number }>, t: (id: string) => number | undefined) =>
    rows.reduce((sum, r) => sum + (r.moveId === 'basic' ? r.count : r.count * (t(r.moveId) ?? 0)), 0)

  it('Σ 秒数 = fillSec（各种填充长度、各种强特上限都成立）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1181' }, { agentId: '1211' }, { agentId: '1091' }])
    const skills = catalog.agentSkillsByAgentMap.get('1181')
    const t = (id: string) => findMoveById(skills, id)?.actionTime
    for (const fillSec of [0.5, 2.7, 5, 6.5, 13.2, 40]) {
      for (const exCap of [0, 1, 2, 9]) {
        const rows = expandGraceBasicFill({ fillSec, actionTimeOf: t, exSpecialAvailable: exCap })
        expect(secondsOf(rows, t), `fill=${fillSec} exCap=${exCap}`).toBeCloseTo(fillSec, 6)
        // 认领上限硬约束
        const ex = rows.find(r => r.moveId === '1181006')?.count ?? 0
        expect(ex).toBeLessThanOrEqual(exCap)
        expect(Number.isInteger(ex)).toBe(true)
      }
    }
  })

  it('没有强特可认领 ⇒ 只发普特槽 + 平A，绝不凭空发强特', async () => {
    const { catalog } = await setupHarness([{ agentId: '1181' }, { agentId: '1211' }, { agentId: '1091' }])
    const skills = catalog.agentSkillsByAgentMap.get('1181')
    const t = (id: string) => findMoveById(skills, id)?.actionTime
    for (const exSpecialAvailable of [undefined, 0]) {
      const rows = expandGraceBasicFill({ fillSec: 6.5, actionTimeOf: t, exSpecialAvailable })
      expect(rows.find(r => r.moveId === '1181006')?.count ?? 0).toBe(0)
      expect(rows.find(r => r.moveId === '1181005')!.count).toBeGreaterThan(0)
    }
    // 零/负填充 ⇒ 不产任何行
    expect(expandGraceBasicFill({ fillSec: 0, actionTimeOf: t, exSpecialAvailable: 3 })).toEqual([])
  })

  it('端到端管线：轴队里格莉丝当兜底槽 ⇒ 强特行吃到失衡易伤（关掉钩子即回到全轴外）', async () => {
    const { config } = await setupHarness([
      { agentId: '1181', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1141', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1211', cinemaLevel: 0, potentialLevel: 6 },
    ])
    config.useStunAxis = true
    const calc = useResourceCalc()
    const grace = getAgentMechanic('1181') as AgentMechanicModule & { expandBasicFill?: Hook }
    const hook = grace.expandBasicFill!
    restorePoolHook = hook
    let seq = 0
    /** @param usePool false ⇒ 摘掉钩子（模拟兜底池实现前的行为：窗尾全记 basic） */
    const run = (usePool: boolean) => {
      grace.expandBasicFill = usePool ? hook : undefined
      config.stunAxes = [{ name: `pool-1181-${seq++}`, count: 2, actions: [{ slot: 1, moveId: '1141011', count: 1 }], basicFillerSlot: 0 }]
      const rows = calc.damagePoolRows.value
      const inRow = rows.find(r => r.id === EX_ROW_ID)
      const outRow = rows.find(r => r.id === `${EX_ROW_ID}-out`)
      return { inCount: inRow?.count ?? 0, outCount: outRow?.count ?? 0, fill: calc.stackTraversalResult.value?.basicFillBySlot?.[0] ?? 0 }
    }
    const on = run(true)
    const off = run(false)
    expect(on.fill).toBeGreaterThan(0)
    // ① 开兜底池 ⇒ 窗尾那段强特被标成轴内（吃易伤）
    expect(on.inCount).toBeGreaterThan(0)
    // ② 摘掉钩子 ⇒ 同一批强特全部落回轴外（窗尾只补 basic）
    expect(off.inCount).toBe(0)
    // ③ 执行次数守恒：兜底池只改**归属**，不凭空增加强特次数
    expect(on.inCount + on.outCount).toBeCloseTo(off.inCount + off.outCount, 6)
  })

  it('端到端（参数面）：编排层按槽派发格莉丝钩子，展开出 basic/1181006/1181005 三条键', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1181' }, { agentId: '1211' }, { agentId: '1091' }])
    const inputs = roundInputsOf(config, catalog)
    const out = inputs.expandExecutedToCounts({}, { 0: 6.5 }, { 0: { energy: 200, decibel: 3000, exSpecial: 2 } })
    const keys = Object.keys(out).sort()
    expect(keys).toContain('0:basic')
    expect(keys).toContain('0:1181006')
    expect(keys).toContain('0:1181005')
    expect(out['0:1181006'].count).toBeLessThanOrEqual(2)
    // 窗尾填充恒在窗内 ⇒ inAxisCount === count（同 CC-63 口径）
    for (const v of Object.values(out)) expect(v.inAxisCount).toBeCloseTo(v.count, 9)
  })
})
