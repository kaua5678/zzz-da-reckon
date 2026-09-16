/**
 * 轴上下文契约（`AgentTeamConfigInput.axis`）的接线与消费测试。
 *
 * 为什么必须单独有这个文件（同 `teamHook.test.ts` / `nextRoundFeedback.test.ts` 头注的理由）：
 * round 11 把 `convergence.ts` 里两处 `merged.agentId === '1201' / '1241'` 的**轴内块计数**迁进了
 * 各角色模块的 `applyTeamConfig`，靠新增的 `axis` 快照取数。这条链有三跳，**每一跳断了都不会
 * 被既有测试网抓到**：
 *   ① `convergence.ts` 的 converge 派发点没传 `axis` ⇒ 模块拿不到轴 ⇒ 轴内计数恒 0；
 *   ② `applyTeamMechanics` 忘了把 `params.axis` 透给钩子 ⇒ 同上；
 *   ③ 模块自己把轴内计数算错（白名单/窗口乘数/槽位过滤）⇒ 只在轴模式、且只有这两个角色身上错。
 *
 * **实测背景（决定了本文件的存在必要性，不是「补测试」的仪式）**：
 * `timeGolden` 对 1201/1241 的轴模式**完全没有覆盖**——105 个预设里按槽位通配自动开轴的 36 队中，
 * 1201 = 0 队、1241 = 0 队（设计卡 §4.2 实测）。1241 原本是**零测试覆盖**：把 `convergence.ts` 那处
 * 分支整段删掉，`npm run check` 与 `timeGolden` **全绿**（设计卡 §4.2 亲测）——即「迁移成功」与
 * 「静默失效」在此处**不可区分**。所以本文件用三条腿把三跳分别钉死：
 *   - **跳③** 直接调模块钩子（合成轴，纯函数级）：计数 = 块数 × 窗口数、白名单、槽位过滤、相位门控；
 *   - **跳②** 经真实派发器 `applyTeamMechanics` 调一次（真 cfg + 真 store，只有 axis 是合成的）；
 *   - **跳①** 跑真管线（`useResourceCalc`，真轴预设），并用**钩子探针**记录三相位实际收到的 `axis`。
 *
 * ⚠ 相位语义是本契约的一半：`axis` **只在 converge 有值**（build 相位轴还没解析、postRound 相位
 * 语义是「为下一轮」）。本文件用探针逐相位断言，不能只测「converge 有值」——那样「三相位都传」
 * 也会绿（而那是错的：postRound 拿到的是**本轮**轴，会让模块对下一轮的 cfg 写本轮结论）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { applyTeamMechanics, buildCharConfig } from '@/composables/resourceCalc/helpers'
import { getAgentMechanic } from '@/mechanics'
import type { AgentAxisContext, AgentTeamConfigInput } from '@/mechanics/types'
import type { StunAxis } from '@/types/resource'

type Cfg = Record<string, unknown> & { slot: number }

/** 合成轴上下文（只填被测模块真正读的字段；其余按形状补齐） */
function axisOf(o: {
  axes: StunAxis[]
  windows: number[]
  active?: boolean
  windowSeconds?: number
}): AgentAxisContext {
  return {
    active: o.active ?? true,
    axes: o.axes,
    windows: o.windows,
    windowSeconds: o.windowSeconds ?? 16,
    actionCountsBySlot: {},
    ultimateTotalBySlot: {},
    chainTotalBySlot: {},
  }
}

/** 直接调某个角色的 applyTeamConfig（派发器的最小等价复现） */
function hookInput(
  cfg: Cfg,
  over: Partial<AgentTeamConfigInput> = {},
): AgentTeamConfigInput {
  return {
    slot: cfg.slot,
    cfg: cfg as never,
    characters: [cfg as never],
    team: [],
    settings: {},
    phase: 'converge',
    combatTime: 180,
    exCounts: [0],
    stunCount: 3,
    teamEnergyConsumed: 0,
    ...over,
  } as AgentTeamConfigInput
}

// ── 接线：两个角色都必须挂 applyTeamConfig（防「迁完忘了挂」） ────────────────────────
describe('axis 契约接线', () => {
  it('★ 1201/1241 都声明了 applyTeamConfig（迁完忘挂钩子 ⇒ 轴内计数静默归零）', () => {
    for (const [agentId, name] of [['1201', '悠真'], ['1241', '朱鸢']] as const) {
      expect(
        typeof getAgentMechanic(agentId)?.applyTeamConfig,
        `${name}(${agentId}) 未声明 applyTeamConfig —— 轴内计数会静默归零`,
      ).toBe('function')
    }
  })
})

// ── 跳③：模块消费（合成轴，纯函数级） ───────────────────────────────────────────────
describe('1201 悠真：轴内飞弦·斩/甲乙矢计数 = 轴块数 × 窗口数', () => {
  const axes: StunAxis[] = [{
    name: '合成轴',
    count: 2,
    actions: [
      { slot: 0, moveId: '1201020', count: 1 },   // 飞弦·斩第一段（白名单）
      { slot: 0, moveId: '1201022', count: 2 },   // 飞弦·斩第三段（白名单）
      { slot: 0, moveId: '1201008', count: 3 },   // 甲乙矢（白名单）
      { slot: 0, moveId: '1201014', count: 5 },   // 终结技（**不在**白名单 ⇒ 不计）
      { slot: 1, moveId: '1201020', count: 4 },   // 别的槽位（**不计**）
    ],
  }]

  it('窗口乘数生效、白名单外与别的槽位不计', () => {
    const cfg: Cfg = { slot: 0, agentId: '1201', harumasaStunCoverage: 0.5 }
    const hook = getAgentMechanic('1201')!.applyTeamConfig!
    hook(hookInput(cfg, { axis: axisOf({ axes, windows: [3] }) }))
    // 斩 = (1 + 2) × 3 = 9；矢 = 3 × 3 = 9；终结 5×3 与槽1 4×3 都不计
    expect(cfg.harumasaAxisSlash).toBe(9)
    expect(cfg.harumasaAxisArrow).toBe(9)
    expect(cfg.harumasaAxisActive).toBe(true)
    // 非轴臂：active=false ⇒ 计数沿用（原实现 `axisActive ? 累加 : 0` = 0）且 active=false
    const cfg2: Cfg = { slot: 0, agentId: '1201' }
    hook(hookInput(cfg2, { axis: axisOf({ axes, windows: [3], active: false }) }))
    expect(cfg2.harumasaAxisActive).toBe(false)
  })

  it('多轴各自窗口数按轴下标对齐（不是拿第一个轴乘所有块）', () => {
    const multi: StunAxis[] = [
      { name: '轴1', count: 2, actions: [{ slot: 0, moveId: '1201020', count: 1 }] },
      { name: '轴2', count: 1, actions: [{ slot: 0, moveId: '1201008', count: 2 }] },
    ]
    const cfg: Cfg = { slot: 0, agentId: '1201' }
    getAgentMechanic('1201')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes: multi, windows: [2, 1] }) }),
    )
    expect(cfg.harumasaAxisSlash).toBe(2)  // 1 × 2 窗
    expect(cfg.harumasaAxisArrow).toBe(2)  // 2 × 1 窗（若错用首窗会得 4）
  })

  it('相位门控：build/postRound 不写轴字段；converge 缺 axis 时也不写（缺就是缺，不许伪造）', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1201' }
      getAgentMechanic('1201')!.applyTeamConfig!(
        hookInput(cfg, { phase, axis: axisOf({ axes, windows: [3] }) }),
      )
      expect(cfg.harumasaAxisSlash, `${phase} 相位不该写轴内计数`).toBeUndefined()
      expect(cfg.harumasaAxisActive, `${phase} 相位不该写轴模式标志`).toBeUndefined()
    }
    // converge 但契约缺 axis（= 派发器没接上）：字段保持缺省，而不是写一个看着合法的 0
    const cfg: Cfg = { slot: 0, agentId: '1201' }
    getAgentMechanic('1201')!.applyTeamConfig!(hookInput(cfg))
    expect(cfg.harumasaAxisSlash).toBeUndefined()
    // 但同一相位下「非轴模式」是**有值**的：active=false ⇒ 计 0、标志 false
    // （⇒ 字段 undefined 唯一编码「契约没接上」，测试可据此分辨静默失效）
    const cfgOff: Cfg = { slot: 0, agentId: '1201' }
    getAgentMechanic('1201')!.applyTeamConfig!(
      hookInput(cfgOff, { axis: axisOf({ axes: [], windows: [], active: false }) }),
    )
    expect(cfgOff.harumasaAxisActive).toBe(false)
    expect(cfgOff.harumasaAxisSlash).toBe(0)
  })
})

describe('1241 朱鸢：轴内压制以太计数 = 轴块数 × 窗口数', () => {
  it('三段轮转白名单 × 窗口数；白名单外与别的槽位不计', () => {
    const axes: StunAxis[] = [{
      name: '合成轴',
      count: 4,
      actions: [
        { slot: 0, moveId: '1241010', count: 3 },
        { slot: 0, moveId: '1241011', count: 1 },
        { slot: 0, moveId: '1241012', count: 2 },
        { slot: 0, moveId: '1241025', count: 7 },   // 自卫还击（不在白名单 ⇒ 不计）
        { slot: 1, moveId: '1241010', count: 5 },   // 别的槽位（不计）
      ],
    }]
    const cfg: Cfg = { slot: 0, agentId: '1241' }
    getAgentMechanic('1241')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [4] }) }),
    )
    // (3 + 1 + 2) × 4 = 24
    expect(cfg.zhuYuanAxisEther).toBe(24)
    expect(cfg.zhuYuanAxisActive).toBe(true)
  })

  it('相位门控：build/postRound/缺 axis 都不写轴字段', () => {
    const axes: StunAxis[] = [{ name: '轴', count: 1, actions: [{ slot: 0, moveId: '1241010', count: 1 }] }]
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1241' }
      getAgentMechanic('1241')!.applyTeamConfig!(
        hookInput(cfg, { phase, axis: axisOf({ axes, windows: [1] }) }),
      )
      expect(cfg.zhuYuanAxisEther, `${phase} 相位不该写轴内计数`).toBeUndefined()
      expect(cfg.zhuYuanAxisActive, `${phase} 相位不该写轴模式标志`).toBeUndefined()
    }
    const cfg: Cfg = { slot: 0, agentId: '1241' }
    getAgentMechanic('1241')!.applyTeamConfig!(hookInput(cfg))
    expect(cfg.zhuYuanAxisEther).toBeUndefined()
  })
})

// ── 跳②：派发器真的把 axis 递给钩子（真 cfg + 真 store，只有 axis 是合成的） ──────────
describe('applyTeamMechanics 透传 axis（跳②）', () => {
  it('轴内以太计数经派发器落到本槽 cfg；非本槽角色不受影响', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1241' }, { agentId: '1201' }, { agentId: '1031' },
    ])
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
      buildCharConfig(2, config, catalog) as unknown as Cfg,
    ]
    expect(characters.every(Boolean)).toBe(true)
    const axes: StunAxis[] = [{ name: '轴', count: 2, actions: [{ slot: 0, moveId: '1241010', count: 3 }] }]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      axis: axisOf({ axes, windows: [2] }),
    })
    expect(characters[0].zhuYuanAxisEther, '派发器没把 axis 递给钩子').toBe(6) // 3 × 2
    expect(characters[1].zhuYuanAxisEther).toBeUndefined() // 1201 那份 cfg 不该被写朱鸢字段
  })

  it('派发器不做 `?? {}` 兜底：缺 axis 时钩子收到的是 undefined（可被测试分辨）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1241' }])
    const characters = [buildCharConfig(0, config, catalog) as unknown as Cfg]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
    })
    expect(characters[0].zhuYuanAxisEther).toBeUndefined()
    // 同一调用的非轴字段仍照常写入（证明钩子确实被派发了，不是「什么都没跑」）
    expect(characters[0].zhuYuanStunCoverage).toBeGreaterThan(0)
  })
})

// ── 跳①：真管线（真 convergence 派发点 + 真轴预设），并用探针记录三相位的 axis ─────────
describe('真管线：converge 有值、build/postRound 为 undefined（跳①）', () => {
  /** 用钩子探针跑一次真管线，记录每个相位实际收到的 `axis` */
  async function probePhases(): Promise<Array<{ phase: string; axis: unknown }>> {
    const { config } = await setupHarness([
      { agentId: '1201', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1141', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: '契约探针轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1201020', count: 1 },
        { slot: 0, moveId: '1201008', count: 2 },
      ],
      basicFillerSlot: 0,
    }]
    const mech = getAgentMechanic('1201')!
    const original = mech.applyTeamConfig!
    const seen: Array<{ phase: string; axis: unknown }> = []
    // 探针：只记录、不改语义（原钩子照调）
    mech.applyTeamConfig = (input: AgentTeamConfigInput) => {
      seen.push({ phase: input.phase, axis: input.axis })
      return original(input)
    }
    try {
      const calc = useResourceCalc()
      expect(calc.resourceResult.value, '管线没出结果').not.toBeNull()
    } finally {
      mech.applyTeamConfig = original
    }
    return seen
  }

  it('★ 三相位逐相位钉死：build=undefined / converge=有值 / postRound=undefined', async () => {
    const seen = await probePhases()
    const phases = seen.map(s => s.phase)
    expect(phases, '钩子必须被派发到 build/converge/postRound 三相位').toContain('build')
    expect(phases).toContain('converge')
    expect(phases).toContain('postRound')
    for (const s of seen) {
      if (s.phase === 'converge') {
        const axis = s.axis as AgentAxisContext | undefined
        expect(axis, 'converge 相位必须带 axis（派发点漏传 = 轴内计数静默归零）').toBeTruthy()
        expect(axis!.active).toBe(true)
        expect(axis!.axes.length).toBe(1)
        expect(axis!.windows).toEqual([2])
        expect(axis!.windowSeconds).toBeGreaterThan(0)
        expect(axis!.axes[0].actions.length).toBe(2)
      } else {
        expect(s.axis, `${s.phase} 相位不该带 axis（会写错轮次的轴结论）`).toBeUndefined()
      }
    }
  })

  it('★ 轴模式端到端生效：悠真 cycle.axisActive = true 且逐雷按轴内飞弦·斩计', async () => {
    await setupHarness([
      { agentId: '1201', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1141', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const config = useConfigStore()
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    // 轴内飞弦·斩 5 刀/窗 × 2 窗 = 10（**故意多于**平A池能打出的刀数，这样若轴内计数为 0，
    // 逐雷数会落到非轴值——实测非轴口径下 thunderCount=0、轴内口径下 =10，见下方断言来源）
    config.stunAxes = [{
      name: '契约端到端轴',
      count: 2,
      actions: [{ slot: 0, moveId: '1201020', count: 5 }],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const cyc = calc.resourceResult.value!.characters
      .find(c => c.agentId === '1201')!.specResources!.harumasa_cycle as {
        axisActive: boolean; thunderCount: number; slashCount: number
      }
    expect(cyc.axisActive, '轴模式没接上 ⇒ 逐雷/影画6电抗会静默回落到并集近似').toBe(true)
    // 逐雷 = min(平A池刀数, 轴内飞弦·斩 10)。轴内计数为 0 时 = 0（实测非轴口径 = 0）
    expect(cyc.thunderCount, '逐雷没吃轴内飞弦·斩计数（axis 通路断了）').toBe(10)
  })

  it('★ 朱鸢：轴内以太占比喂进核心被动增伤（端到端可观测的唯一口）', async () => {
    await setupHarness([
      { agentId: '1241', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1031', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const config = useConfigStore()
    config.enemy.stunCountLock = 2
    config.useStunAxis = true
    config.stunAxes = [{
      name: '朱鸢契约轴',
      count: 2,
      actions: [
        { slot: 0, moveId: '1241010', count: 3 },
        { slot: 0, moveId: '1241011', count: 3 },
        { slot: 0, moveId: '1241012', count: 3 },
      ],
      basicFillerSlot: 0,
    }]
    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    const zy = out.characters.find(c => c.agentId === '1241')!
    const etherRows = zy.executions.filter(r => ['1241010', '1241011', '1241012'].includes(String(r.moveId)))
    expect(etherRows.length, '朱鸢压制以太行必须存在').toBe(3)
    // 轴内以太 = 3×3×2 = 18 枚；弹数 ~71 ⇒ 占比 18/71 = 0.2535 ⇒ +40% × 0.2535 = 10.1 → round = 10
    // ⚠ 这条断言**必须**与「非轴口径」区分开：非轴读 `zhuYuanStunCoverage`（失衡次数反推 = 0.1778），
    // 得 round(40 × 0.1778) = 7。实测：轴内 10 / 非轴 7（探针，见本文件头注释的取证）。
    // ⇒ `dmgBonus === 10` 唯一编码「走了 axis 通路」；axis 断了会得 7（而不是 0，伪装成正常值）。
    expect(etherRows.every(r => r.dmgBonus === 10), '核心被动增伤没走轴内占比（axis 通路断了 → 回落非轴 7）').toBe(true)
  })
})
