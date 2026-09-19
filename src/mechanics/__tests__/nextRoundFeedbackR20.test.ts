/**
 * `nextRoundFeedback` 钩子 C-β 批判据（2026-09-17 round 20）。
 *
 * 迁移面（自 `src/composables/resourceCalc/convergence.ts` 迁出）：
 * · 目标 1 的一半：仪玄 1371「符法千重次数」→ `yixuanFuFaForJufufu`
 *   （落点 `yixuan.ts#yixuanNextRoundFeedback`）；
 * · 目标 2：莱特 1161「下一轮全队普通能量消耗」→ `lighterTeamEnergy`
 *   （落点 `lighter.ts#lighterNextRoundFeedback`）。
 *
 * ⚠ **刻意留在编排层的那一半**：橘福福的「全队终结总次数」`teamUltimateForJufufu`
 * （= 全队 `ultimateCount` 之和 + 符法千重分量）。它不是本文件的钩子判据，而是**管线判据**
 * ——留在编排层的理由是「与 1371/1391 在不在队都无关」，而 `collectNextRoundFeedback` 按槽位只对
 * 在队模块派发 ⇒ 挂进任一角色模块都会让缺那一方的队伍静默归零。本文件用
 * 「有 1391 无 1371」与「有 1371 无 1391」两支队把它钉住（缺失任一侧 ⇒ 精确值红）。
 *
 * 四层判据（缺一不可，照 `nextRoundFeedbackR19.test.ts` 的结构）：
 * ① 精确值（禁 `> 0` / 禁 `toBeGreaterThan`）：本文件全部 `toBe` 精确值。
 * ② 来源隔离：`teamResult` / `adjustedResult` / `displayResult` 给不同数字，确认读的是指定那份。
 * ③ 真派发器接线：调 `collectNextRoundFeedback`（不是直接调钩子），含**乱序槽位**与
 *    **前导空槽**（经 `runCalcRound` 的真实 cfg.slot 钉住，规则「槽位号 ≠ 下标」）。
 * ④ 两轮消费：下游（`specPanelBuffs` / `yixuan` / `lighter`）真吃到值，且**跨轮不翻倍**。
 */
import { describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs, createRunCalcRound } from '@/composables/resourceCalc/convergence'
import { getAgentMechanic } from '@/mechanics'
import { setupHarness } from '@/test/harness'
import { collectNextRoundFeedback } from '@/composables/resourceCalc/helpers'
import { initialCalcRoundThreads } from '@/composables/resourceCalc/roundThreads'
import type { AgentNextRoundFeedbackInput, AgentTeamConfigInput } from '@/mechanics/types'

/** 直接调某个角色的钩子（层①②的最小复现；层③另走真派发器） */
function feedback(agentId: string, overrides: Partial<AgentNextRoundFeedbackInput> = {}) {
  const cfg = { agentId, slot: 2 } as AgentNextRoundFeedbackInput['cfg']
  const hook = getAgentMechanic(agentId)?.nextRoundFeedback
  expect(hook, `${agentId}: feedback hook must be registered`).toBeTypeOf('function')
  return hook!({
    slot: 2, cfg, characters: [cfg],
    teamResult: { characters: [] } as never,
    anomalyPool: null, prevThreads: initialCalcRoundThreads(),
    combatTime: 180, getAgentSkills: () => undefined,
    ...overrides,
  })
}

const rows = (chars: unknown[]) => ({ characters: chars }) as never

describe('C-β next-round feedback', () => {
  // ── 层④（反向锁）：注册本身是承重的 ──────────────────────────────────────────
  it('unregistered modules contribute nothing (reverse: registration is load-bearing)', () => {
    expect(getAgentMechanic('1311')?.nextRoundFeedback).toBeUndefined()
    expect(getAgentMechanic('1371')?.nextRoundFeedback).toBeTypeOf('function')
    expect(getAgentMechanic('1161')?.nextRoundFeedback).toBeTypeOf('function')
  })

  // ── 层① 精确值：仪玄符法千重 ────────────────────────────────────────────────
  it('C6: OR match counts once, name-only and id-only both hit, fractional/negative/missing pass through', () => {
    const yixuan = { agentId: '1371', executions: [
      { moveId: '1371020', moveName: '终结技：符法千重', count: 2 },        // 两条件都成立 ⇒ 只算一次
      { moveId: '1371999', moveName: '强化特殊技：符法千重-破', count: 1.5 }, // 只有 name 命中
      { moveId: '1371020', moveName: '别的名字', count: 3 },                // 只有 moveId 命中
      { moveId: '1371009', moveName: '强化特殊技：墨痕化形', count: 1000 },  // 都不命中
      { moveId: '1371020', moveName: '符法千重' },                          // 缺 count ⇒ 0
      { moveId: '1371020', moveName: '符法千重', count: -0.25 },            // 负值原样（不 clamp）
    ] }
    const other = { agentId: '1481', executions: [{ moveId: '1371020', moveName: '符法千重', count: 999 }] }
    expect(feedback('1371', { teamResult: rows([other, yixuan]) }))
      .toEqual({ yixuanFuFaForJufufu: 2 + 1.5 + 3 + 0 - 0.25 })
  })

  it('C6: no 1371 row ⇒ 0 (never其他角色的同名行)', () => {
    expect(feedback('1371', { teamResult: rows([
      { agentId: '1391', executions: [{ moveId: '1371020', moveName: '符法千重', count: 7 }] },
    ]) })).toEqual({ yixuanFuFaForJufufu: 0 })
    expect(feedback('1371', { teamResult: rows([]) })).toEqual({ yixuanFuFaForJufufu: 0 })
  })

  // ── 层② 来源隔离：仪玄读 `teamResult`，**不读** adjusted/display ──────────────
  it('C6: source is teamResult — adjustedResult / displayResult are NOT read', () => {
    const teamResult = rows([{ agentId: '1371', executions: [{ moveId: '1371020', count: 6.25 }] }])
    const adjustedResult = rows([{ agentId: '1371', executions: [{ moveId: '1371020', count: 111 }] }])
    const displayResult = rows([{ agentId: '1371', executions: [{ moveId: '1371020', count: 222 }] }])
    // 三份都给 → 取 teamResult（原式读 `rr`，不是 `(adj2 ?? rr)`——与 C-α 叶瞬光刻意不同）
    expect(feedback('1371', { teamResult, adjustedResult, displayResult }))
      .toEqual({ yixuanFuFaForJufufu: 6.25 })
    // 只给 adjusted ⇒ 仍是 teamResult 那份的 0（不是回落到 adjusted 的 111）
    expect(feedback('1371', { teamResult: rows([]), adjustedResult, displayResult }))
      .toEqual({ yixuanFuFaForJufufu: 0 })
  })

  // ── 层① 精确值：莱特全队普通能量消耗 ────────────────────────────────────────
  it('C9: exact Σ(cost × count); flash users excluded; negative counts clamped to 0', () => {
    const characters = [
      { agentId: '1041', slot: 0, isFlashUser: false, exSpecialEnergyConsume: 60 },
      { agentId: '1161', slot: 1, isFlashUser: false, exSpecialEnergyConsume: 40 },
      { agentId: '1371', slot: 2, isFlashUser: true, exSpecialEnergyConsume: 20 }, // 闪能用户 ⇒ 不计
    ] as unknown as AgentNextRoundFeedbackInput['characters']
    const teamResult = rows([
      { agentId: '1041', exSpecialCount: 2.75 },  // 60 × 2.75 = 165
      { agentId: '1161', exSpecialCount: 3 },     // 40 × 3    = 120
      { agentId: '1371', exSpecialCount: 9 },     // 闪能用户  = 0
    ])
    expect(feedback('1161', { cfg: characters[1]!, characters, teamResult }))
      .toEqual({ lighterTeamEnergy: 165 + 120 })
    // 负 count ⇒ `Math.max(0, …)` 归零（原式同款 clamp）；缺 count ⇒ 0
    expect(feedback('1161', { cfg: characters[1]!, characters, teamResult: rows([
      { agentId: '1041', exSpecialCount: -5 }, { agentId: '1161' },
    ]) })).toEqual({ lighterTeamEnergy: 0 })
  })

  it('C9: absent lighter row ⇒ 0 (guard自然满足于「不在队不派发」)', () => {
    const characters = [{ agentId: '1041', slot: 0, isFlashUser: false, exSpecialEnergyConsume: 60 }] as unknown as AgentNextRoundFeedbackInput['characters']
    expect(feedback('1161', { cfg: characters[0]!, characters, teamResult: rows([
      { agentId: '1041', exSpecialCount: 5 },
    ]) })).toEqual({ lighterTeamEnergy: 0 })
  })

  // ── 层② 来源隔离：莱特 cost 读 `characters`（cfg 数组）、count 读 `teamResult` ──
  it('C9: cost comes from the cfg array, counts from teamResult — adjusted/display ignored', () => {
    const characters = [
      { agentId: '1161', slot: 1, isFlashUser: false, exSpecialEnergyConsume: 40 },
      { agentId: '1041', slot: 0, isFlashUser: false, exSpecialEnergyConsume: 60 },
    ] as unknown as AgentNextRoundFeedbackInput['characters']
    // teamResult 的 count 与 cfg 的 cost 相乘；adjusted/display 的 count 是干扰项（99）
    const teamResult = rows([
      { agentId: '1041', exSpecialCount: 1 }, { agentId: '1161', exSpecialCount: 2 },
    ])
    const adjustedResult = rows([
      { agentId: '1041', exSpecialCount: 99 }, { agentId: '1161', exSpecialCount: 99 },
    ])
    const displayResult = rows([
      { agentId: '1041', exSpecialCount: 77 }, { agentId: '1161', exSpecialCount: 77 },
    ])
    expect(feedback('1161', { cfg: characters[0]!, characters, teamResult, adjustedResult, displayResult }))
      .toEqual({ lighterTeamEnergy: 60 * 1 + 40 * 2 })
  })

  // ── 层③ 真派发器：乱序槽位 + 空队 ───────────────────────────────────────────
  it('real dispatcher: disordered slot array is派发 by slot order, and空队 returns {}', async () => {
    const { catalog } = await setupHarness([])
    const yixuan = { agentId: '1371', slot: 2 }
    const lighter = { agentId: '1161', slot: 1, isFlashUser: false, exSpecialEnergyConsume: 30 }
    const filler = { agentId: '1041', slot: 0, isFlashUser: false, exSpecialEnergyConsume: 60 }
    const characters = [yixuan, filler, lighter] as unknown as AgentNextRoundFeedbackInput['characters'] // 槽位乱序 2,0,1
    const teamResult = rows([
      { agentId: '1371', executions: [{ moveId: '1371020', count: 2.5 }] },
      { agentId: '1041', exSpecialCount: 4 },
      { agentId: '1161', exSpecialCount: 3 },
    ])
    expect(collectNextRoundFeedback({
      characters, teamResult, anomalyPool: null,
      prevThreads: initialCalcRoundThreads(), catalogStore: catalog,
    })).toEqual({ yixuanFuFaForJufufu: 2.5, lighterTeamEnergy: 60 * 4 + 30 * 3 })
    expect(collectNextRoundFeedback({
      characters: [], teamResult, anomalyPool: null,
      prevThreads: initialCalcRoundThreads(), catalogStore: catalog,
    })).toEqual({})
  })

  // ── 层③+④ 真管线：前导空槽（槽位号 ≠ 下标）+ 三条线程值 + 跨轮不翻倍 ──────────
  it('real runCalcRound with a leading empty slot: all three threads land, and a second round does not double them', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '' }, { agentId: '1161', cinemaLevel: 4 }, { agentId: '1371', cinemaLevel: 6 }])
    config.autoYidhariAxis = false
    config.useStunAxis = false
    const calc = useResourceCalc()
    const inputs = createConvergenceRoundInputs({ configStore: config, catalogStore: catalog,
      panels: calc.panels, resourceConfig: calc.resourceConfig, remielleAnomalyMultiplier: computed(() => 1) })
    const run = createRunCalcRound({
      configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig,
      resourceResult: { value: null }, adjustedResourceResult: { value: null },
      inStunAnomalyState: { value: null }, bossAnomalyState: { value: null }, stunCoverage: { value: 0 },
      matchedPlanName: { value: null }, banyueInteractionTopUp: { value: null },
      windowDuration: { value: 10 }, computeWindowDuration: () => 10, computeStunCoverage: () => 0,
      ...inputs,
    })
    // 哨兵 = 模块缝上的已知值：把「管线接线」与「领域算式」隔离（算式本身在层①精确测过）。
    // 派发器按槽位序派发 ⇒ 前导空槽时 1161 在 slot 1、1371 在 slot 2（**不是**下标 0/1）。
    const yx = vi.spyOn(getAgentMechanic('1371')!, 'nextRoundFeedback').mockReturnValue({ yixuanFuFaForJufufu: 2.5 })
    const lt = vi.spyOn(getAgentMechanic('1161')!, 'nextRoundFeedback').mockReturnValue({ lighterTeamEnergy: 111 })
    try {
      const r1 = run(2, initialCalcRoundThreads())
      expect(yx.mock.calls[0]![0].cfg.slot).toBe(2)
      expect(lt.mock.calls[0]![0].cfg.slot).toBe(1)
      expect(r1?.threadsNext.yixuanFuFaForJufufu).toBe(2.5)
      expect(r1?.threadsNext.lighterTeamEnergy).toBe(111)
      // 全队汇总 = Σ ultimateCount（编排层，与队伍组成无关）**加上**模块产出的符法千重分量。
      // 期望值从同一份结果自算（不抄常数），并额外钉「分量真被加上」这一条。
      const base = r1!.resourceResult.characters.reduce((a, c) => a + (c.ultimateCount ?? 0), 0)
      expect(r1?.threadsNext.teamUltimateForJufufu).toBe(base + 2.5)
      expect(base).toBeGreaterThan(0) // 前提前置：否则「加上分量」不可判
      // 第二轮：把第一轮的线程喂回去 ⇒ 三条值逐位不变（跨轮不翻倍 / 不累积）
      const r2 = run(2, r1!.threadsNext)
      expect(r2?.threadsNext.yixuanFuFaForJufufu).toBe(2.5)
      expect(r2?.threadsNext.lighterTeamEnergy).toBe(111)
      const base2 = r2!.resourceResult.characters.reduce((a, c) => a + (c.ultimateCount ?? 0), 0)
      expect(r2?.threadsNext.teamUltimateForJufufu).toBe(base2 + 2.5)
      // 第三轮同款（防「只在偶数轮翻倍」这类相位错）
      const r3 = run(2, r2!.threadsNext)
      expect(r3?.threadsNext.teamUltimateForJufufu).toBe(
        r3!.resourceResult.characters.reduce((a, c) => a + (c.ultimateCount ?? 0), 0) + 2.5)
      expect(r3?.threadsNext.lighterTeamEnergy).toBe(111)
    } finally { yx.mockRestore(); lt.mockRestore() }
  })

  // ── 层④ 下游消费：三个消费者真吃到值 + 幂等（`+=` 的那条单独说明）────────────────
  it('downstream consumers eat the values exactly; repeat converge does not double', async () => {
    const { catalog } = await setupHarness([])
    const threads = {
      ...initialCalcRoundThreads(),
      teamUltimateForJufufu: 14,
      yixuanFuFaForJufufu: 2.5,
      lighterTeamEnergy: 680,
    }
    // ① specPanelBuffs（橘福福 1391）：converge 读 threads 写自己那份 cfg（赋值 ⇒ 幂等）
    const jufufu = { agentId: '1391', slot: 0 } as Record<string, unknown>
    const jInput = {
      slot: 0, cfg: jufufu, characters: [jufufu], team: [], settings: {},
      phase: 'converge', combatTime: 180, threads,
    } as unknown as AgentTeamConfigInput
    getAgentMechanic('1391')!.applyTeamConfig!(jInput)
    expect(jufufu.jufufuTeamUltimateCount).toBe(14)
    getAgentMechanic('1391')!.applyTeamConfig!(jInput)
    expect(jufufu.jufufuTeamUltimateCount).toBe(14) // 二次消费不翻倍

    // ② lighter（1161）：converge 读 threads 写 cfg（赋值 ⇒ 幂等）
    const lighter = { agentId: '1161', slot: 1, lighterCinemaLevel: 0 } as Record<string, unknown>
    const lInput = {
      slot: 1, cfg: lighter, characters: [lighter], team: [], settings: {},
      phase: 'converge', combatTime: 180, threads, teamEnergyConsumed: 0,
    } as unknown as AgentTeamConfigInput
    getAgentMechanic('1161')!.applyTeamConfig!(lInput)
    expect(lighter.lighterTeamEnergyConsumed).toBe(680)
    getAgentMechanic('1161')!.applyTeamConfig!(lInput)
    expect(lighter.lighterTeamEnergyConsumed).toBe(680) // 二次消费不翻倍

    // ③ 仪玄（1371）：`extraSelfDecibelReward` 是**跨角色共享累加通道** ⇒ `+= 次数 × 300`，
    //    且**门控是「橘福福在队且额外能力开启」**（`characters.some(…1391…)` + panel 门控）。
    //    ⚠ 它**刻意不是幂等的**（佩洛伊斯/orphie 各自 += 同一字段，覆盖会静默清零别人那份；
    //    既有 `axisContext.test.ts` 已把该 `+=` 语义锁死）。故这里钉的是**单次精确值**，
    //    并成对给出「无 1391 ⇒ 一项都不加」的负控；「跨轮不翻倍」由上面管线用例承担。
    const jufufuMate = { agentId: '1391', slot: 0, panel: { additionalAbilityActive: 1 } }
    const yixuan = { agentId: '1371', slot: 2, extraSelfDecibelReward: 1500 } as Record<string, unknown>
    const yInput = {
      slot: 2, cfg: yixuan, characters: [jufufuMate, yixuan], team: [], settings: {},
      phase: 'converge', combatTime: 180, threads,
    } as unknown as AgentTeamConfigInput
    getAgentMechanic('1371')!.applyTeamConfig!(yInput)
    expect(yixuan.extraSelfDecibelReward).toBe(1500 + 2.5 * 300) // = 2250（累加，不是覆盖成 750）
    // 负控：橘福福不在队 ⇒ 分量为 0（这一条保证上面的 2250 不是因为「无条件加」而通过）
    const yixuanNoMate = { agentId: '1371', slot: 2, extraSelfDecibelReward: 1500 } as Record<string, unknown>
    getAgentMechanic('1371')!.applyTeamConfig!({
      ...yInput, cfg: yixuanNoMate, characters: [yixuanNoMate],
    } as unknown as AgentTeamConfigInput)
    expect(yixuanNoMate.extraSelfDecibelReward).toBe(1500)
    expect(catalog.ready).toBe(true) // harness 真加载（防「因错误的原因通过」）
  })

  // ── 层③+④ 真管线端到端：橘福福真吃到派发器算出的全队汇总（两个方向都非零）────────
  it('real pipeline: jufufu team-ultimate count is NONZERO both with and without 1371', async () => {
    const build = async (team: Parameters<typeof setupHarness>[0]) => {
      const { config, catalog } = await setupHarness(team)
      config.autoYidhariAxis = false
      config.useStunAxis = false
      const calc = useResourceCalc()
      const inputs = createConvergenceRoundInputs({ configStore: config, catalogStore: catalog,
        panels: calc.panels, resourceConfig: calc.resourceConfig, remielleAnomalyMultiplier: computed(() => 1) })
      const run = createRunCalcRound({
        configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig,
        resourceResult: { value: null }, adjustedResourceResult: { value: null },
        inStunAnomalyState: { value: null }, bossAnomalyState: { value: null }, stunCoverage: { value: 0 },
        matchedPlanName: { value: null }, banyueInteractionTopUp: { value: null },
        windowDuration: { value: 10 }, computeWindowDuration: () => 10, computeStunCoverage: () => 0,
        ...inputs,
      })
      return run(2, initialCalcRoundThreads())!
    }
    // ⚠ 本用例是「teamUltimateForJufufu 留编排层」这一归属判断的**可红性锁**：
    // 若把它挂进 1371 模块 ⇒ 下面第一例（有 1391 无 1371）精确红（0 ≠ 期望）；
    // 若挂进 1391 模块 ⇒ 第二例（有 1371 无 1391）精确红。
    const withJufufuOnly = await build([{ agentId: '1391', cinemaLevel: 2 }, { agentId: '1041' }, { agentId: '1151' }])
    const baseOnlyJufufu = withJufufuOnly.resourceResult.characters.reduce((a, c) => a + (c.ultimateCount ?? 0), 0)
    expect(withJufufuOnly.threadsNext.yixuanFuFaForJufufu).toBe(0) // 无 1371 ⇒ 分量为 0
    expect(withJufufuOnly.threadsNext.teamUltimateForJufufu).toBe(baseOnlyJufufu) // 汇总仍如实产出
    // 本夹具（`[1391 C2, 1041, 1151]`，非轴）实测：三人终结技各 3/3/2 ⇒ Σ = 8（**非零**）。
    // ⚠ 这个 8 是本用例自己夹具的派生值（探针实测），不是从别处抄来的常数。
    expect(withJufufuOnly.threadsNext.teamUltimateForJufufu).toBe(8)
    expect(baseOnlyJufufu).toBe(8) // 前提自证：非零才有判别力

    const withYixuanOnly = await build([{ agentId: '1371', cinemaLevel: 6 }, { agentId: '1041' }, { agentId: '1151' }])
    const baseOnlyYixuan = withYixuanOnly.resourceResult.characters.reduce((a, c) => a + (c.ultimateCount ?? 0), 0)
    // 同夹具换 1371 C6：符法千重 14 次（探针实测），Σ ultimateCount 仍 8 ⇒ 汇总 = 22。
    // 2026-09-19 R37-J5 v2（动态合轴）：该非轴队 Σ净必要 > 预算，队友前台按溢出量被合轴吸收、不再降配 ⇒ 仪玄时间/闪能
    // 收入上升 → 符法千重 14→18（探针实测）；Σ ultimateCount 与汇总按同一恒等式重锚（下两条）。
    expect(withYixuanOnly.threadsNext.yixuanFuFaForJufufu).toBe(18)
    expect(withYixuanOnly.threadsNext.teamUltimateForJufufu).toBe(baseOnlyYixuan + 18)
    expect(withYixuanOnly.threadsNext.teamUltimateForJufufu).toBe(26) // Σ ultimateCount 仍 8
    // ★ 两条线程值**各自独立**：无 1371 时汇总非零（8）、有 1371 时分量非零（14）
    //   ⇒ 任一「挂错模块」的迁法都会打红上面某一条。
    expect(withJufufuOnly.threadsNext.teamUltimateForJufufu).toBeGreaterThan(0)
  })
})
