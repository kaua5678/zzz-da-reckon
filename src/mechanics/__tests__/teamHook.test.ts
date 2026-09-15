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
import { initialCalcRoundThreads } from '@/composables/resourceCalc/roundThreads'

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

  // 时间守恒口径（用户 2026-09-01）后：失衡次数下降 → 窗口占用时间变少 → 后场时间变多 →
  // 喷发次数 7 → 8（32 = 4/次 × 8 次）。变化来自「非失衡时间变多」这个正确方向，不是回归。
  it('莱特影画4：后场喷发回能只给队友（32 = 4/次 × 8 次），莱特本人为 0', async () => {
    const out = await run([{ agentId: '1161', cinemaLevel: 4 }, { agentId: '1041' }, { agentId: '1101' }])
    const bySlot = new Map(out.characters.map(c => [c.slot, c]))
    expect(bySlot.get(0)!.energySource.crossAgent.lighterC4Energy).toBe(0)
    expect(bySlot.get(1)!.energySource.crossAgent.lighterC4Energy).toBe(32)
    expect(bySlot.get(2)!.energySource.crossAgent.lighterC4Energy).toBe(32)
  })

  it('莱特 0 命：不触发影画4 喷发回能（钩子按命座门控，不是无条件写）', async () => {
    const out = await run([{ agentId: '1161', cinemaLevel: 0 }, { agentId: '1041' }, { agentId: '1101' }])
    for (const c of out.characters) {
      expect(c.energySource.crossAgent.lighterC4Energy).toBe(0)
    }
  })

  it('席德：为正兵回能（2 能量/秒 × 席德前台时间），正兵槽位吃到、席德本人不吃', async () => {
    // 槽0 席德（1461）、槽1 比利（1081 强攻 = 正兵）、槽2 空
    const out = await run([{ agentId: '1461' }, { agentId: '1081' }, ''])
    const bySlot = new Map(out.characters.map(c => [c.slot, c]))
    const vanguard = bySlot.get(1)!
    expect(vanguard.energySource.crossAgent.xideVanguardEnergy).toBeGreaterThan(0)
    // 席德本人（槽0）不是正兵，不吃
    expect(bySlot.get(0)!.energySource.crossAgent.xideVanguardEnergy).toBe(0)
    // 无强攻队友时（槽1 改为击破）正兵槽位 = -1，无回能
    const outNoVanguard = await run([{ agentId: '1461' }, { agentId: '1621' }, ''])
    const bySlot2 = new Map(outNoVanguard.characters.map(c => [c.slot, c]))
    expect(bySlot2.get(1)!.energySource.crossAgent.xideVanguardEnergy).toBe(0)
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

  // ── 2026-09-15 arch 棘轮第 2 批：跨轮反馈改走 AgentTeamConfigInput.threads ──────────────
  // 这 9 处原先在 convergence.ts 的 characters.map 里逐 `merged.agentId === '…'` 分支写 cfg。
  // 迁进各自模块后，「钩子有没有读快照」在单测网里同样不可见（同本文件头注的理由），
  // 故这里钉住两条：① 9 个模块都声明了钩子；② 喂一个可辨识的线程快照，模块必须把它写进 cfg。
  it('★ 跨轮反馈 9 个模块都声明 applyTeamConfig（防迁移后钩子丢失 → 反馈静默归零）', () => {
    for (const [agentId, name] of [
      ['1381', '零号·安比'], ['1391', '橘福福'], ['1431', '叶瞬光'], ['1151', '露西'],
      ['1541', '普罗米娅'], ['1331', '薇薇安'], ['1161', '莱特'], ['1181', '格莉丝'], ['1191', '艾莲'],
    ] as const) {
      expect(
        typeof getAgentMechanic(agentId)?.applyTeamConfig,
        `${name}(${agentId}) 未声明 applyTeamConfig —— 跨轮反馈会静默断链`,
      ).toBe('function')
    }
  })

  it('★ converge 阶段递入的 threads 快照被模块读进自己那份 cfg（契约生效，非只声明）', () => {    // 用一份「每个字段都是可辨识哨兵值」的快照；模块只应写自己那个字段。
    const sentinel = { ...initialCalcRoundThreads(), anbyZeroTeammateWl: 7, ellenFreezeCount: 5 }
    const mk = (agentId: string, slot = 0) => ({ agentId, slot } as any)
    const probe = (agentId: string, field: string, expectVal: unknown) => {
      const characters = [mk(agentId)]
      getAgentMechanic(agentId)!.applyTeamConfig!({
        slot: 0, agent: null, cinemaLevel: 6, potentialLevel: 6, characters,
        team: [{ slot: 0, agentId, agent: null, cinemaLevel: 6, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }],
        settings: {}, phase: 'converge', combatTime: 180, exCounts: [0], stunCount: 0,
        teamEnergyConsumed: 0, threads: sentinel,
      } as any)
      expect((characters[0] as any)[field], `${agentId} 的 converge 钩子没把 ${field} 写进 cfg`).toEqual(expectVal)
    }
    probe('1381', 'anbyZeroTeammateWhiteLightning', 7)
    probe('1191', 'ellenFreezeCount', 5)
    probe('1431', 'yeshuguangGiftUltCount', sentinel.yeshuguangGiftUlt)
    probe('1331', 'vivianTeamExTotal', sentinel.vivianTeamEx)
  })

  // 2026-09-15 arch 棘轮第 4 小簇：诺姆(1571)/青衣(1251) 的失衡次数注入从 convergence.ts 的
  // `merged.agentId === '…'` 分支迁进模块 applyTeamConfig（读 hook 入参 stunCount/combatTime）。
  // 判据同 T6：三类字段的消费方只有本模块 ⇒ 不需要在编排层认人。
  it('★ 诺姆/青衣的 converge 钩子把失衡次数（与覆盖率/战斗时间）写进本槽 cfg', () => {
    const mkProbe = (agentId: string) => {
      const characters = [{ agentId, slot: 0, teamStunCoverage: 0.42 } as any]
      getAgentMechanic(agentId)!.applyTeamConfig!({
        slot: 0, agent: null, cinemaLevel: 0, potentialLevel: 6, characters,
        team: [{ slot: 0, agentId, agent: null, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }],
        settings: {}, phase: 'converge', combatTime: 210, exCounts: [0], stunCount: 7,
        teamEnergyConsumed: 0,
      } as any)
      return characters[0] as any
    }
    const norma = mkProbe('1571')
    expect(norma.normaStunCount, '诺姆失衡次数未注入').toBe(7)
    expect(norma.normaStunCoverage, '诺姆失衡覆盖率未注入（应取通用 teamStunCoverage）').toBe(0.42)
    expect(norma.normaBattleTime, '诺姆战斗时间未注入').toBe(210)
    const qingyi = mkProbe('1251')
    expect(qingyi.qingyiStunCount, '青衣失衡次数未注入').toBe(7)
  })

  // 2026-09-15 arch 棘轮第 5 小簇：佩洛伊斯(1551) 的 peiluoVerdictCount / extraSelfDecibelReward
  // 从 convergence.ts 的 `merged.agentId === '1551'` 分支迁进 specPanelBuffs 的 applyTeamConfig。
  // ⚠ 逐位等价要点：原分支**无条件**写 peiluoVerdictCount（含轴模式）——本用例显式覆盖这一点。
  it('★ 佩洛伊斯 converge 钩子：连携×300 + 影画2 1500 累加进 extraSelfDecibelReward；verdict=失衡次数', () => {
    const run = (opts: { cinema: number; chainPerStun?: number; chainOverride?: number; extra?: number }) => {
      const characters = [{
        agentId: '1551', slot: 0, chainCountPerStun: opts.chainPerStun ?? 2,
        ...(opts.chainOverride !== undefined ? { chainCountTotalOverride: opts.chainOverride } : {}),
        ...(opts.extra !== undefined ? { extraSelfDecibelReward: opts.extra } : {}),
      } as any]
      getAgentMechanic('1551')!.applyTeamConfig!({
        slot: 0, agent: null, cinemaLevel: opts.cinema, potentialLevel: 6, characters,
        team: [{ slot: 0, agentId: '1551', agent: null, cinemaLevel: opts.cinema, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }],
        settings: {}, phase: 'converge', combatTime: 180, exCounts: [0], stunCount: 5,
        teamEnergyConsumed: 0,
      } as any)
      return characters[0] as any
    }
    // C0：连携 2/失衡 × 5 失衡 = 10 次 × 300 = 3000；无影画2 加成
    const c0 = run({ cinema: 0 })
    expect(c0.extraSelfDecibelReward, 'C0 连携回喧响').toBe(3000)
    expect(c0.peiluoVerdictCount, 'C0 决算次数=失衡次数').toBe(5)
    // C2：额外 +1500
    expect(run({ cinema: 2 }).extraSelfDecibelReward, 'C2 影画2 开局 +1500').toBe(3000 + 1500)
    // 轴模式覆盖值优先（chainCountTotalOverride 走轴内加权，不再乘失衡次数）
    expect(run({ cinema: 0, chainOverride: 7 }).extraSelfDecibelReward, '轴覆盖值优先').toBe(7 * 300)
    // 累加而非覆盖（共享通道，橘福福/蕾米埃尔等也会 +=）
    expect(run({ cinema: 0, extra: 500 }).extraSelfDecibelReward, '必须累加共享通道').toBe(500 + 3000)
    // ⚠ 轴模式**也必须**写 verdict（原分支无门控）——加 `if (!cfg.axisMode)` 门控即红
    const axisCfg = {
      agentId: '1551', slot: 0, chainCountPerStun: 2, axisMode: true,
    } as any
    getAgentMechanic('1551')!.applyTeamConfig!({
      slot: 0, agent: null, cinemaLevel: 0, potentialLevel: 6, characters: [axisCfg],
      team: [{ slot: 0, agentId: '1551', agent: null, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }],
      settings: {}, phase: 'converge', combatTime: 180, exCounts: [0], stunCount: 5,
      teamEnergyConsumed: 0,
    } as any)
    expect(axisCfg.peiluoVerdictCount, '轴模式也必须写 verdict（原分支无门控，加门控=行为静默改变）').toBe(5)
  })
})