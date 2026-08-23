/**
 * 队伍级钩子（`applyTeamConfig`）的接线测试。
 *
 * 为什么必须单独有这个文件：迁移前这 5 条队伍级机制由 useResourceCalc 手工 import + 手工调用，
 * 而 lucy/rina/soukaku/yaojiayin/lighter 各自的单测**都只测纯函数、不跑全管线**——也就是说
 * 「钩子到底有没有被派发」在原有测试网里完全不可见：dispatcher 写错/漏调，5 个单测照样全绿。
 * 这正是本项目最怕的死数据形态，所以钩子自己也必须有生效测试。
 *
 * 断言用的观测口是 `energySource.crossAgent`（队友联动回能明细）——它同时也是
 * 「展示口径 = 计算口径」那次修复的产物，两个改动在此互相验证。
 *
 * 数值口径（实测且可推导，非快照）：
 * - 丽娜/苍角/露西 终结邻位回能 = 终结次数 × 30（邻位）/ × 10（隔位）
 * - 莱特影画4 喷发：后场角色各 +4/次 × 7 次 = 28；莱特本人不吃。
 *   7 次推导（2026-08-23）：士气 = 2.9/s×180 + 0.26×全队强特耗能；该队耗能
 *   = 莱特40×8 + 11号80×4 + 科琳60×6 = 1000 → 士气 782 → floor(782/100)=7 次。
 *   （1b91d58 把 11号快速A4/A5 计入必要时间后其强特次数下降，队伍耗能跌破 8 次阈值 1069。）
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'

async function run(team: Array<{ agentId: string; cinemaLevel?: number } | ''>) {
  await setupHarness(team)
  const calc = useResourceCalc()
  const out = calc.resourceResult.value
  expect(out).not.toBeNull()
  return out!
}

describe('队伍级钩子 applyTeamConfig 接线', () => {
  it('5 个已迁移角色都声明了 applyTeamConfig（防迁移后忘记挂钩子）', () => {
    for (const [agentId, name] of [
      ['1151', '露西'], ['1211', '丽娜'], ['1131', '苍角'],
      ['1311', '耀嘉音'], ['1161', '莱特'],
    ] as const) {
      expect(
        typeof getAgentMechanic(agentId)?.applyTeamConfig,
        `${name}(${agentId}) 未声明 applyTeamConfig —— 队伍级机制会静默失效`,
      ).toBe('function')
    }
  })

  it('丽娜/露西/苍角：终结邻位回能经钩子写入各槽 cfg，并出现在 crossAgent 明细里', async () => {
    // 槽位：0 丽娜(1211) / 1 露西(1151) / 2 苍角(1131)，三人互为邻位/隔位
    const out = await run([{ agentId: '1211' }, { agentId: '1151' }, { agentId: '1131' }])
    const bySlot = new Map(out.characters.map(c => [c.slot, c]))
    const ults = new Map(out.characters.map(c => [c.agentId, c.ultimateCount ?? 0]))

    // 每人都拿到「另外两位支援」的邻位回能，且合计 = 30/次 + 10/次 分配
    for (const slot of [0, 1, 2]) {
      const cross = bySlot.get(slot)!.energySource.crossAgent
      expect(
        cross.rinaUltEnergy + cross.soukakuUltEnergy + cross.lucyEnergy,
        `槽${slot} 未收到任何邻位回能 —— 队伍级钩子没被派发`,
      ).toBeGreaterThan(0)
    }

    // 丽娜在槽0、终结 N 次 → 邻位得 30N、隔位得 10N（口径 assignRinaUltNeighborEnergy）
    const rinaUlt = ults.get('1211') ?? 0
    expect(rinaUlt).toBeGreaterThan(0)
    const rinaGiven = [0, 1, 2]
      .map(s => bySlot.get(s)!.energySource.crossAgent.rinaUltEnergy)
      .reduce((a, b) => a + b, 0)
    expect(rinaGiven).toBe(rinaUlt * 30 + rinaUlt * 10)

    // 自己不给自己回能
    expect(bySlot.get(0)!.energySource.crossAgent.rinaUltEnergy).toBe(0)
    expect(bySlot.get(1)!.energySource.crossAgent.lucyEnergy).toBe(0)
    expect(bySlot.get(2)!.energySource.crossAgent.soukakuUltEnergy).toBe(0)
  })

  it('莱特影画4：后场喷发回能只给队友（28 = 4/次 × 7 次），莱特本人为 0', async () => {
    const out = await run([{ agentId: '1161', cinemaLevel: 4 }, { agentId: '1041' }, { agentId: '1101' }])
    const bySlot = new Map(out.characters.map(c => [c.slot, c]))
    expect(bySlot.get(0)!.energySource.crossAgent.lighterC4Energy).toBe(0)
    expect(bySlot.get(1)!.energySource.crossAgent.lighterC4Energy).toBe(28)
    expect(bySlot.get(2)!.energySource.crossAgent.lighterC4Energy).toBe(28)
  })

  it('莱特 0 命：不触发影画4 喷发回能（钩子按命座门控，不是无条件写）', async () => {
    const out = await run([{ agentId: '1161', cinemaLevel: 0 }, { agentId: '1041' }, { agentId: '1101' }])
    for (const c of out.characters) {
      expect(c.energySource.crossAgent.lighterC4Energy).toBe(0)
    }
  })

  it('耀嘉音：入场次数（全队快支+招架+连携）经 converge 阶段汇总 → 咏叹资源非零', async () => {
    const out = await run([{ agentId: '1311' }, { agentId: '1041' }, { agentId: '1101' }])
    const yj = out.characters.find(c => c.agentId === '1311')!
    const chord = yj.specResources?.['yaojiayin_chord']
    expect(chord, '耀嘉音咏叹资源缺失').toBeTruthy()
    expect(
      chord!.totalGain,
      '咏叹获取为 0 —— 入场次数没被队伍级钩子汇总（converge 阶段未派发）',
    ).toBeGreaterThan(0)
  })
})
