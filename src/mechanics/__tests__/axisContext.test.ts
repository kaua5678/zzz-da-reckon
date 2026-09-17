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
import type { AgentAxisContext, AgentInteractionContext, AgentTeamConfigInput } from '@/mechanics/types'
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

/**
 * 合成「未缩放交互次数」快照。`rows` 按槽位数组给，`''` = 空槽。
 * ⚠ 空槽也要给计数（`setAgent` 清人时**不重置**计数）——两条消费点的过滤口径**不同**，
 * 这正是本契约把 `agentId` 一并递过去的原因（见 `AgentInteractionContext` 头注释）。
 */
function interactionsOf(
  rows: Array<{
    agentId: string; parry?: number; block?: number; dodge?: number; dual?: number; quick?: number
    /** 每次失衡的连携次数（store 原值；供 1141 `lycaonC2Energy` 非轴臂，round 20 C-γ） */
    chain?: number
  }>,
): AgentInteractionContext {
  return {
    bySlot: Object.fromEntries(rows.map((r, i) => [i, {
      agentId: r.agentId,
      parryCount: r.parry ?? 0,
      blockCount: r.block ?? 0,
      dodgeCounterCount: r.dodge ?? 0,
      dualCounterCount: r.dual ?? 0,
      quickAssistCount: r.quick ?? 0,
      chainCountPerStun: r.chain ?? 0,
    }])),
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
  it('★ 1201/1241/1531/1591 都声明了 applyTeamConfig（迁完忘挂钩子 ⇒ 轴内计数静默归零）', () => {
    for (const [agentId, name] of [
      ['1201', '悠真'], ['1241', '朱鸢'], ['1531', '星徽·比利'], ['1591', '希格莉德'],
    ] as const) {
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

// ── 跳③（批次 2）：1531 星徽·比利 —— 轴内捏块含 **combo 展开** ────────────────────────
describe('1531 星徽·比利：轴内 combo 展开（billy-ex-chain → 三子招式）+ 逐键累加', () => {
  /**
   * `billy-ex-chain` = 动力压制(1531006) + 孤轮特技(1531008) + 摇曳步伐(1531011)。
   * 轴编辑器放置的是 **combo 块 id**，轴块计数按 combo 的 `moves[].count` 展开
   * （设计卡 §1.5 点名的「本批最容易写错处」：整块记一次 = 次数少一个量级）。
   */
  const axes: StunAxis[] = [{
    name: '合成轴',
    count: 2,
    actions: [
      { slot: 0, moveId: 'billy-ex-chain', count: 2 },  // combo 块：×2 窗 → 三子招式各 2×1×2 = 4
      { slot: 0, moveId: '1531009', count: 3 },         // 抓地轮毂（真实 id，非 combo）
      { slot: 1, moveId: 'billy-ex-chain', count: 5 },  // 别的槽位（不计）
    ],
  }]

  it('combo 块展开成子招式（×mv.count×窗口数），非 combo 块按原 id 计，别的槽位不计', () => {
    const cfg: Cfg = { slot: 0, agentId: '1531', teamStunCoverage: 0.42 }
    getAgentMechanic('1531')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [3] }) }),
    )
    const ex = cfg.billyAxisEx as Record<string, number>
    // combo 块 2 次 × 3 窗 = 6 块 → 展开后每个子招式 6
    expect(ex['1531006']).toBe(6)
    expect(ex['1531008']).toBe(6)
    expect(ex['1531011']).toBe(6)
    // 非 combo 块：3 × 3 = 9
    expect(ex['1531009']).toBe(9)
    // combo 块 id 本身**不出现**（展开而非原样记录）
    expect(ex['billy-ex-chain']).toBeUndefined()
    // 别的槽位的 combo 块完全不计（否则 1531006 会是 6 + 15 = 21）
    expect(ex['1531006']).toBe(6)
    expect(cfg.billyAxisActive).toBe(true)
    // billyStunCoverage 取派发器通用注入的 teamStunCoverage（与旧 provStunCoverage 同源同值）
    expect(cfg.billyStunCoverage).toBe(0.42)
  })

  it('相位门控：build/postRound 不写；converge 缺 axis 时连非轴字段都不写（缺就是缺）', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1531' }
      getAgentMechanic('1531')!.applyTeamConfig!(
        hookInput(cfg, { phase, axis: axisOf({ axes, windows: [3] }) }),
      )
      expect(cfg.billyAxisEx, `${phase} 相位不该写轴内计数`).toBeUndefined()
      expect(cfg.billyAxisActive, `${phase} 相位不该写轴模式标志`).toBeUndefined()
      expect(cfg.billyStunCoverage, `${phase} 相位不该写覆盖率`).toBeUndefined()
    }
    const cfg: Cfg = { slot: 0, agentId: '1531' }
    getAgentMechanic('1531')!.applyTeamConfig!(hookInput(cfg))
    expect(cfg.billyAxisEx).toBeUndefined()
    // 同一相位下「非轴模式」是**有值**的：active=false ⇒ 空表 + 标志 false
    const cfgOff: Cfg = { slot: 0, agentId: '1531', teamStunCoverage: 0.1 }
    getAgentMechanic('1531')!.applyTeamConfig!(
      hookInput(cfgOff, { axis: axisOf({ axes: [], windows: [], active: false }) }),
    )
    expect(cfgOff.billyAxisActive).toBe(false)
    expect(cfgOff.billyAxisEx).toEqual({})
  })
})

// ── 跳③（批次 2）：1591 希格莉德 —— 破阵套数 + **Σwindows 前封顶** ────────────────────
describe('1591 希格莉德：轴内破阵套数（含 gift 块，C6 门槛）+ Σwindows 封顶', () => {
  const pz = (slot: number, count: number): StunAxis['actions'][number] =>
    ({ slot, moveId: 'sigrid-pozhen', count })
  const gift = (slot: number, count: number): StunAxis['actions'][number] =>
    ({ slot, moveId: '1591015', count, sourceTag: 'gift' })

  it('非 C6：破阵块 × 窗口数，且**封顶 Σwindows**（不是 windows.length）', () => {
    // 故意让块数（4×2=8）超过窗口总数（2+1=3）⇒ 封顶生效后必须是 3
    const axes: StunAxis[] = [{
      name: '双轴', count: 2,
      actions: [pz(0, 4)],
    }, {
      name: '轴2', count: 1,
      actions: [],
    }]
    const cfg: Cfg = { slot: 0, agentId: '1591' }
    getAgentMechanic('1591')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [2, 1] }), cinemaLevel: 0 }),
    )
    // Σwindows = 3；若误用 windows.length = 2 ⇒ 得 2（精确红）
    expect(cfg.sigridAxisPozhenSets).toBe(3)
    expect(cfg.sigridAxisActive).toBe(true)
    // 破阵前的 stunCount 仍照写（非轴口径字段，与轴无关）
    expect(cfg.sigridStunCount).toBe(3)
  })

  it('非 C6：未超封顶时按块数×窗口数原样（封顶不得顺手压小正常值）', () => {
    const axes: StunAxis[] = [{ name: '轴', count: 2, actions: [pz(0, 1)] }]
    const cfg: Cfg = { slot: 0, agentId: '1591' }
    getAgentMechanic('1591')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [2] }), cinemaLevel: 0 }),
    )
    expect(cfg.sigridAxisPozhenSets).toBe(2) // 1 × 2 窗 ≤ Σwindows 2
  })

  it('C6：gift 连携块（1591015）也算一套破阵，且**不封顶**（可超 Σwindows）', () => {
    const axes: StunAxis[] = [{
      name: '轴', count: 2,
      actions: [pz(0, 1), gift(0, 2)],
    }]
    const cfg: Cfg = { slot: 0, agentId: '1591' }
    getAgentMechanic('1591')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [2] }), cinemaLevel: 6 }),
    )
    // 破阵 1×2 + gift 2×2 = 6 ⇒ C6 不封顶（Σwindows = 2）；封顶若误留 ⇒ 得 2
    expect(cfg.sigridAxisPozhenSets).toBe(6)
  })

  it('C5（<C6）：gift 块**不计**（C6 才解锁「破阵按连携计」）', () => {
    const axes: StunAxis[] = [{
      name: '轴', count: 2,
      actions: [pz(0, 1), gift(0, 2)],
    }]
    const cfg: Cfg = { slot: 0, agentId: '1591' }
    getAgentMechanic('1591')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [2] }), cinemaLevel: 5 }),
    )
    expect(cfg.sigridAxisPozhenSets).toBe(2) // 只破阵块 1×2；gift 不计
  })

  it('相位门控：build/postRound 不写；converge 缺 axis 时不写轴字段但 stunCount 照写', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1591' }
      getAgentMechanic('1591')!.applyTeamConfig!(
        hookInput(cfg, { phase, axis: axisOf({ axes: [{ name: 'a', actions: [pz(0, 1)] }], windows: [1] }) }),
      )
      expect(cfg.sigridAxisPozhenSets, `${phase} 相位不该写轴内套数`).toBeUndefined()
      expect(cfg.sigridAxisActive).toBeUndefined()
      expect(cfg.sigridStunCount, `${phase} 相位不该写失衡次数`).toBeUndefined()
    }
    // converge 缺 axis ⇒ 轴字段保持 undefined（唯一编码「契约没接上」）
    const cfg: Cfg = { slot: 0, agentId: '1591' }
    getAgentMechanic('1591')!.applyTeamConfig!(hookInput(cfg))
    expect(cfg.sigridAxisPozhenSets).toBeUndefined()
    expect(cfg.sigridAxisActive).toBeUndefined()
    expect(cfg.sigridStunCount).toBe(3) // 非轴字段照常
  })
})

// ── 跳③（批次 2）：1141 莱卡恩 —— windowSeconds（分支已于 round 20 C-γ 迁空） ────────
describe('1141 莱卡恩：lycaonWindowDuration ← axis.windowSeconds（棘轮 −1，分支已删）', () => {
  it('窗口时长取契约值（不是本槽可自行推导的量）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', invincibleTime: 0 }
    getAgentMechanic('1141')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes: [], windows: [], windowSeconds: 19.5 }) }),
    )
    expect(cfg.lycaonWindowDuration).toBe(19.5)
    expect(cfg.lycaonStunCount).toBe(3)
    expect(cfg.lycaonTotalTime).toBe(180)
    // ⚠ round 20 C-γ：C2 回能**已迁入本钩子**（见 `lycaonC2Contract.test.ts` 的四层判据）。
    // 本用例不再断言它「不得写」——那条反锁是迁移前的形态，留着会与新契约自相矛盾。
    // 缺 `countStun` 时仍不写（契约门控，由 C2 契约文件钉住）。
    expect(cfg.lycaonC2Energy, '缺 countStun ⇒ 不写').toBeUndefined()
    expect(cfg.lycaonBackstageDodgeCount).toBeUndefined()
  })

  it('相位门控：build/postRound 不写本轮围猎字段；converge 缺 axis 时 windowDuration 不写', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1141' }
      getAgentMechanic('1141')!.applyTeamConfig!(
        hookInput(cfg, { phase, axis: axisOf({ axes: [], windows: [], windowSeconds: 19.5 }) }),
      )
      expect(cfg.lycaonWindowDuration, `${phase} 相位不该写窗口时长`).toBeUndefined()
      expect(cfg.lycaonStunCount).toBeUndefined()
    }
    // converge 但缺 axis：非轴三字段照写，windowDuration 不写（缺就是缺，不伪造默认 16）
    const cfg: Cfg = { slot: 0, agentId: '1141' }
    getAgentMechanic('1141')!.applyTeamConfig!(hookInput(cfg))
    expect(cfg.lycaonWindowDuration).toBeUndefined()
    expect(cfg.lycaonStunCount).toBe(3)
  })

  /**
   * 端到端可观测口（⚠ 这条是本处迁移**唯一**能把「接上了」与「静默回落」分开的断言）。
   *
   * 为什么必须写精确值：`lycaon.ts` 的消费端是 `cfg.lycaonWindowDuration ?? 16`，而
   * 战斗默认 `enemy.stunTime = 12` ⇒ `windowSeconds = 12 + 4 = 16`，**恰好等于兜底值**
   * ⇒ 实测：短路 `axis.windowSeconds` 后 `lycaonSmoke.test.ts` **13 passed 全绿**
   * （假阴性，不是分支死的；这正是任务卡说的「短路后不红 ⇒ 先怀疑选错覆盖文件」的反例：
   *   文件选对了，是**数值巧合**掩盖了断路）。
   * 故本用例把 `stunTime` 抬到 20（`windowSeconds = 24`），并锁 3 次失衡：
   * 围猎可用后台时间 = 180 − 3×24(失衡) − 莱卡恩前台 − 闪反时间(6×0.6s) ⇒ 平A被压到 **21.2465s**。
   * 实测两态：**接上 = 21.2465…**；短路（回落 `?? 16` ⇒ 只扣 3×16）= **24**（= 每次围猎 8s 封顶全用满）。
   * ⇒ 两者相差 2.7535s，且都不是 0（`?? 16` 兜底把断路伪装成合法值——正是本批反复强调的形态）。
   */
  it('★ 端到端：窗口时长经真管线落到围猎平A预算（短路 ⇒ 回落 ?? 16 得 24，不是 0）', async () => {
    await setupHarness([
      { agentId: '1141', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1011', dodgeCounterCount: 6 },
      '',
    ])
    const config = useConfigStore()
    config.enemy.stunCountLock = 3
    config.enemy.stunTime = 20 // windowSeconds = 20 + 4 = 24（≠ 兜底 16）
    const calc = useResourceCalc()
    const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    const huntBasic = lycaon.executions.find(e => e.moveId === 'basic_attack' && e.moveName?.includes('围猎'))
    expect(huntBasic, '围猎后台平A行必须存在').toBeTruthy()
    // 精确值（实测）：180 − 3×24(失衡) − 前台 − 闪反 ⇒ 平A预算 21.2465s
    expect(huntBasic!.totalTime, '围猎平A预算没吃 axis.windowSeconds（短路 ⇒ 回落 ?? 16 得 24）')
      .toBeCloseTo(21.2465, 4)
  })
})

// ── 批次 3：1051 伊德海莉 —— 轴内连段反推（条件写）+ stunCount 恒写 ─────────────────
describe('1051 伊德海莉：轴内连段反推 yidhariInStunExCount / EnergyCost（条件写）', () => {
  /** 单次碾 = 1 重碾 / 50-60 闪能；双次碾 = 2 重碾 / 85 闪能（模块 combos 的两把键） */
  const axes: StunAxis[] = [{
    name: '合成轴',
    count: 2,
    actions: [
      { slot: 0, moveId: 'yidhari-heavy-single', count: 3 },   // 1 重碾 × 3 = 3
      { slot: 0, moveId: 'yidhari-heavy-double', count: 2 },   // 2 重碾 × 2 = 4
      { slot: 0, moveId: '1051012', count: 99 },               // 裸 id（**不计**：白名单只认连段键）
      { slot: 1, moveId: 'yidhari-heavy-single', count: 7 },   // 别的槽位（**不计**）
    ],
  }]

  it('轴内单/双次碾 × 窗口数：次数与闪能成本逐位精确（0 命 = 60/次）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [2] }),
      team: [{ slot: 0, agentId: '1051', cinemaLevel: 0 } as never],
    }))
    // 次数 = (1×3 + 2×2) × 2 窗 = 7 × 2 = 14
    expect(cfg.yidhariInStunExCount).toBe(14)
    // 闪能 = (60×3 + 85×2) × 2 窗 = (180 + 170) × 2 = 700
    expect(cfg.yidhariInStunEnergyCost).toBe(700)
    // stunCount 恒写（与轴无关；轴/非轴都要，供非轴拆分上限）
    expect(cfg.yidhariStunCount).toBe(3)
  })

  it('1 命（槽 0 cinema≥1）：单次碾成本档 60 → 50（双次碾恒 85，不受命座影响）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [2] }),
      team: [{ slot: 0, agentId: '1051', cinemaLevel: 1 } as never],
    }))
    expect(cfg.yidhariInStunExCount).toBe(14) // 次数与命座无关
    // 闪能 = (50×3 + 85×2) × 2 = (150 + 170) × 2 = 640（≠ 0 命的 700，精确可分辨）
    expect(cfg.yidhariInStunEnergyCost).toBe(640)
  })

  it('多轴各自窗口数按轴下标对齐（不是拿第一个轴乘所有块）', () => {
    const twoAxes: StunAxis[] = [
      { name: 'A', count: 1, actions: [{ slot: 0, moveId: 'yidhari-heavy-single', count: 1 }] },
      { name: 'B', count: 1, actions: [{ slot: 0, moveId: 'yidhari-heavy-double', count: 1 }] },
    ]
    const cfg: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: twoAxes, windows: [3, 1] }),
      team: [{ slot: 0, agentId: '1051', cinemaLevel: 0 } as never],
    }))
    // A: 1×3 = 3；B: 2×1 = 2 ⇒ 合计 5（若错用 windows[0] 乘两者 = 1×3+2×3 = 9）
    expect(cfg.yidhariInStunExCount).toBe(5)
    expect(cfg.yidhariInStunEnergyCost).toBe(60 * 3 + 85 * 1) // 265
  })

  /**
   * ★ 条件写形态（本处迁移的**头号**风险，round 13 批次 3）。
   *
   * `core/resource/helpers.ts#resolveExSpecialCount` 用 `cfg.yidhariInStunExCount !== undefined`
   * 判「走哪条通路」：有该字段 = 失衡内次数已知（按 `(总闪能 − 失衡内成本)/消耗` 反推非失衡次数）；
   * 缺 = 纯能量预算口径（`floor(总闪能/消耗)`）。⇒ **恒写 0 与不写是两种语义**，不能图省事。
   */
  it('★ 轴内合计为 0（或缺轴）时**不写**这两字段（≠ 写 0——消费端按 `!== undefined` 选通路）', () => {
    // 轴开、但本槽没有连段块（章鱼 0 命轴预设实测就是这种形态：裸 id 1051011/1051012）
    const cfg: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [{ name: '裸id轴', count: 1, actions: [{ slot: 0, moveId: '1051012', count: 4 }] }], windows: [2] }),
      team: [{ slot: 0, agentId: '1051', cinemaLevel: 0 } as never],
    }))
    expect(cfg.yidhariInStunExCount, '合计 0 时不得写 0（消费端按 !== undefined 选通路）').toBeUndefined()
    expect(cfg.yidhariInStunEnergyCost).toBeUndefined()
    expect(cfg.yidhariStunCount, 'stunCount 与轴无关，照写').toBe(3)

    // 轴退化（active=false，axes 仍非空——契约递的是局部未清空版）：模块自判 active ⇒ 不写
    const cfg2: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg2, {
      axis: axisOf({ axes, windows: [2], active: false }),
      team: [{ slot: 0, agentId: '1051', cinemaLevel: 0 } as never],
    }))
    expect(cfg2.yidhariInStunExCount, '轴退化时不得按未清空的 axes 算（模块必须自判 active）').toBeUndefined()

    // 缺 axis（契约没接上）：同样不写，但 stunCount 照写
    const cfg3: Cfg = { slot: 0, agentId: '1051' }
    getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg3))
    expect(cfg3.yidhariInStunExCount).toBeUndefined()
    expect(cfg3.yidhariStunCount).toBe(3)
  })

  it('相位门控：build/postRound 相位连 stunCount 都不写（双判据）', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1051' }
      getAgentMechanic('1051')!.applyTeamConfig!(hookInput(cfg, {
        phase, axis: axisOf({ axes, windows: [2] }),
        team: [{ slot: 0, agentId: '1051', cinemaLevel: 0 } as never],
      }))
      expect(cfg.yidhariStunCount, `${phase} 相位不该写`).toBeUndefined()
      expect(cfg.yidhariInStunExCount, `${phase} 相位不该写`).toBeUndefined()
    }
  })
})

// ── 跳③（批次 2 可选第三处）：1511 南宫羽 —— 单 moveId 轴内计数 + 线程值双路 ─────────
describe('1511 南宫羽：轴内 1511013 快支块计数（axis）+ inStunWindowTriggers（threads）', () => {
  const axes: StunAxis[] = [{
    name: '合成轴',
    count: 2,
    actions: [
      { slot: 0, moveId: '1511013', count: 2 },  // 快速支援（白名单）
      { slot: 0, moveId: '1511006', count: 9 },  // 地雷撞（**不计**）
      { slot: 1, moveId: '1511013', count: 5 },  // 别的槽位（不计）
    ],
  }]

  it('只数本槽 1511013 × 窗口数；别的 moveId 与别的槽位不计', () => {
    const cfg: Cfg = { slot: 0, agentId: '1511' }
    getAgentMechanic('1511')!.applyTeamConfig!(
      hookInput(cfg, { axis: axisOf({ axes, windows: [3] }) }),
    )
    expect(cfg.nangongQuickAssistPlaced).toBe(6) // 2 × 3 窗
    // 非轴：写 0（不是 undefined——契约已接上）
    const cfgOff: Cfg = { slot: 0, agentId: '1511' }
    getAgentMechanic('1511')!.applyTeamConfig!(
      hookInput(cfgOff, { axis: axisOf({ axes: [], windows: [], active: false }) }),
    )
    expect(cfgOff.nangongQuickAssistPlaced).toBe(0)
  })

  it('inStunWindowTriggers 走 `threads` 契约（不是 axis）：有线程值即写、负值钳 0', () => {
    const cfg: Cfg = { slot: 0, agentId: '1511' }
    getAgentMechanic('1511')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [3] }),
      threads: { inStunWindowTriggers: 2.5 } as never,
    }))
    expect(cfg.inStunWindowTriggers).toBe(2.5)
    // 负值钳到 0（原式 `Math.max(0, …)`）
    const cfgNeg: Cfg = { slot: 0, agentId: '1511' }
    getAgentMechanic('1511')!.applyTeamConfig!(hookInput(cfgNeg, {
      axis: axisOf({ axes, windows: [3] }),
      threads: { inStunWindowTriggers: -3 } as never,
    }))
    expect(cfgNeg.inStunWindowTriggers).toBe(0)
  })

  it('相位门控：build/postRound 不写；converge 缺 axis 时快支计数不写（但线程值仍写）', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1511' }
      getAgentMechanic('1511')!.applyTeamConfig!(hookInput(cfg, {
        phase, axis: axisOf({ axes, windows: [3] }), threads: { inStunWindowTriggers: 2 } as never,
      }))
      expect(cfg.nangongQuickAssistPlaced, `${phase} 相位不该写轴内计数`).toBeUndefined()
      expect(cfg.nangongStunCount).toBeUndefined()
    }
    // converge 缺 axis：轴字段不写（唯一编码「契约没接上」），线程字段照写
    const cfg: Cfg = { slot: 0, agentId: '1511' }
    getAgentMechanic('1511')!.applyTeamConfig!(hookInput(cfg, {
      threads: { inStunWindowTriggers: 2 } as never,
    }))
    expect(cfg.nangongQuickAssistPlaced).toBeUndefined()
    expect(cfg.inStunWindowTriggers).toBe(2)
    expect(cfg.nangongStunCount).toBe(3)
  })
})

// ── 批次 4：1371 仪玄 —— 8 字段整条迁移（interactions 契约的解锁点） ────────────────
describe('1371 仪玄：8 字段（axis 4 + threads 2 + interactions 1 + interactions 复合 1）', () => {
  const axes: StunAxis[] = [{
    name: '仪玄轴',
    count: 2,
    actions: [
      { slot: 0, moveId: '1371022', count: 1, duration: 1.2 },  // 凝云术（带 duration 覆盖）
      { slot: 0, moveId: '1371022', count: 1 },                 // 凝云术（无 duration ⇒ 默认 2）
      { slot: 0, moveId: '1371009', count: 3 },                 // 墨痕化形#1
      { slot: 1, moveId: '1371022', count: 9, duration: 5 },    // 别的槽位（不计）
    ],
  }]

  it('轴内：yixuanAxisEx / CloudSeconds（duration 加权，无权重写 2）/ AxisActive', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 0 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [2] }),
    }))
    // 块 × 窗口数：凝云 2 块 × 2 窗 = 4；墨痕#1 3 × 2 = 6；槽 1 的 9×2 不计
    expect(cfg.yixuanAxisEx).toEqual({ '1371022': 4, '1371009': 6 })
    // duration 加权 = (1.2×1×2 + 2×1×2) / (1×2 + 1×2) = (2.4 + 4) / 4 = 1.6
    expect(cfg.yixuanAxisCloudSeconds).toBe(1.6)
    expect(cfg.yixuanAxisActive).toBe(true)
  })

  it('★ 凝云术无任何 weight 时写 2（**不是 0**）——「无权重写 2」这条口径的精确编码', () => {
    const noCloud: StunAxis[] = [{
      name: '无凝云轴', count: 1,
      actions: [{ slot: 0, moveId: '1371009', count: 1 }],
    }]
    const cfg: Cfg = { slot: 0, agentId: '1371' }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: noCloud, windows: [1] }),
    }))
    // 权重为 0 ⇒ 走 `: 2` 分支（写 0 会让消费端 `?? CLOUD_MAX_SECONDS` 之外的口径分叉）
    expect(cfg.yixuanAxisCloudSeconds).toBe(2)
  })

  it('非轴臂：axis.active=false ⇒ AxisEx 空、CloudSeconds 仍写 2、AxisActive=false（恒写）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 0 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [2], active: false }),
      interactions: interactionsOf([{ agentId: '1371' }]),
    }))
    expect(cfg.yixuanAxisEx).toEqual({})
    expect(cfg.yixuanAxisCloudSeconds).toBe(2)
    expect(cfg.yixuanAxisActive).toBe(false)
  })

  it('threads：yixuanAnomalyTriggerFlash = min(18, max(0, floor(auricInkFlash)))', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371' }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [] }),
      threads: { auricInkFlash: 25.7 } as never,
      interactions: interactionsOf([{ agentId: '1371' }]),
    }))
    expect(cfg.yixuanAnomalyTriggerFlash).toBe(18) // floor(25.7)=25 → 封顶 18（不是 25）
    const cfg2: Cfg = { slot: 0, agentId: '1371' }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg2, {
      axis: axisOf({ axes: [], windows: [] }),
      threads: { auricInkFlash: -3 } as never,
      interactions: interactionsOf([{ agentId: '1371' }]),
    }))
    expect(cfg2.yixuanAnomalyTriggerFlash).toBe(0) // 负值钳 0
  })

  it('★ interactions：yixuanExtremeAssistCap = Σ**队友**弹刀（未缩放、**不过滤空槽**）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371' }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [] }),
      interactions: interactionsOf([
        { agentId: '1371', parry: 99 },  // 本槽（不计）
        { agentId: '1481', parry: 4 },   // 队友
        { agentId: '', parry: 2 },       // 空槽**也算**（原式只看 `ci !== cfg.slot`）
      ]),
    }))
    expect(cfg.yixuanExtremeAssistCap).toBe(6) // 4 + 2（99 不计）
  })

  it('★ yixuanFlashBonus 是 `+=`：在 buildCharConfig 已写值之上累加（不是覆盖）', () => {
    // ⚠ `teamUltimateFlashBonus` 读的是**本槽 cfg**（buildCharConfig 按队伍职业写），不是 characters
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 1, yixuanFlashBonus: 70, battleTime: 60, invincibleTime: 0, teamUltimateFlashBonus: 20 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [] }),          // 轴内时间 0 ⇒ 非轴臂
      threads: { auricInkFlash: 4 } as never,
      interactions: interactionsOf([{ agentId: '1371' }, { agentId: '1481', parry: 3 }]),
    }))
    // 落雷 = floor((60 − 0)/6) = 10；极限支援 = min(默认取上限 3, 3) = 3
    // += 4×10(玄墨) + 3×5(极限支援) + 10×5(C1) = 40 + 15 + 50 = 105 ⇒ 70 + 105 = 175
    expect(cfg.yixuanC1LightningCount).toBe(10)
    expect(cfg.yixuanFlashBonus).toBe(175)
  })

  it('★ yixuanFlashBonus 的轴/非轴两臂：轴内时间 vs 有效战斗时间（60/6=10 ⇒ 轴内 24/6=4）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 1, yixuanFlashBonus: 0, battleTime: 60, invincibleTime: 12, teamUltimateFlashBonus: 20 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      // 轴内时间 = Σwindows(2) × windowSeconds(12) = 24 ⇒ floor(24/6) = 4
      axis: axisOf({ axes: [], windows: [2], windowSeconds: 12 }),
      threads: { auricInkFlash: 0 } as never,
      interactions: interactionsOf([{ agentId: '1371' }, { agentId: '1481', parry: 2 }]),
    }))
    // 轴臂 = floor(24/6) = 4（**不是**非轴臂 floor((60−12)/6) = 8）
    expect(cfg.yixuanC1LightningCount).toBe(4)
    // 0 + 0 + 2×5(极限支援) + 4×5(C1) = 30
    expect(cfg.yixuanFlashBonus).toBe(30)
  })

  it('★ yixuanCinemaLevel < 1 ⇒ C1 落雷恒 0（即使轴内时间很长）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 0, yixuanFlashBonus: 0, battleTime: 180 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [10], windowSeconds: 20 }),
      threads: { auricInkFlash: 0 } as never,
      interactions: interactionsOf([{ agentId: '1371' }]),
      characters: [{ slot: 0, agentId: '1371' } as never],
    }))
    expect(cfg.yixuanC1LightningCount).toBe(0)
    expect(cfg.yixuanFlashBonus).toBe(0)
  })

  it('★ extraSelfDecibelReward 是 `+=`：橘福福在队（额外能力开启）+ 上一轮符法千重>0 才加', () => {
    const withJufufu: Cfg = { slot: 0, agentId: '1371', extraSelfDecibelReward: 1500 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(withJufufu, {
      axis: axisOf({ axes: [], windows: [] }),
      threads: { auricInkFlash: 0, yixuanFuFaForJufufu: 3 } as never,
      interactions: interactionsOf([{ agentId: '1371' }]),
      // 橘福福 1391 且额外能力开启（`additionalAbilityActive > 0`）
      characters: [{ slot: 0, agentId: '1371' }, { slot: 1, agentId: '1391', panel: { additionalAbilityActive: 1 } }] as never,
    }))
    expect(withJufufu.extraSelfDecibelReward).toBe(1500 + 3 * 300) // 累加，不是覆盖成 900
  })

  it('★ 橘福福不在队 / 额外能力关 / 上一轮次数为 0 ⇒ 一项都不加（但字段仍写回原值）', () => {
    const cases: Array<[string, Array<Record<string, unknown>>, number]> = [
      ['无橘福福', [{ slot: 0, agentId: '1371' }], 0],
      ['橘福福额外能力关', [{ slot: 0, agentId: '1371' }, { slot: 1, agentId: '1391', panel: { additionalAbilityActive: 0 } }], 0],
    ]
    for (const [label, chars, prev] of cases) {
      const cfg: Cfg = { slot: 0, agentId: '1371', extraSelfDecibelReward: 40 }
      getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
        axis: axisOf({ axes: [], windows: [] }),
        threads: { auricInkFlash: 0, yixuanFuFaForJufufu: prev } as never,
        interactions: interactionsOf([{ agentId: '1371' }]),
        characters: chars as never,
      }))
      expect(cfg.extraSelfDecibelReward, `${label}：不该加`).toBe(40)
    }
    // 橘福福在队且开启，但上一轮符法千重 = 0 ⇒ 同样不加
    const cfg: Cfg = { slot: 0, agentId: '1371', extraSelfDecibelReward: 40 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [] }),
      threads: { auricInkFlash: 0, yixuanFuFaForJufufu: 0 } as never,
      interactions: interactionsOf([{ agentId: '1371' }]),
      characters: [{ slot: 0, agentId: '1371' }, { slot: 1, agentId: '1391', panel: { additionalAbilityActive: 1 } }] as never,
    }))
    expect(cfg.extraSelfDecibelReward).toBe(40)
  })

  it('★ 相位门控：build/postRound 一个字段都不写（含 AxisActive 与线程值）', () => {
    for (const phase of ['build', 'postRound'] as const) {
      const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 6, battleTime: 180 }
      getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
        phase,
        axis: axisOf({ axes, windows: [2] }),
        threads: { auricInkFlash: 5, yixuanFuFaForJufufu: 2 } as never,
        interactions: interactionsOf([{ agentId: '1371' }, { agentId: '1481', parry: 4 }]),
        characters: [{ slot: 0, agentId: '1371' }, { slot: 1, agentId: '1391', panel: { additionalAbilityActive: 1 } }] as never,
      }))
      for (const f of [
        'yixuanAxisEx', 'yixuanAxisCloudSeconds', 'yixuanAxisActive', 'yixuanAnomalyTriggerFlash',
        'yixuanExtremeAssistCap', 'yixuanC1LightningCount', 'yixuanFlashBonus', 'extraSelfDecibelReward',
      ]) {
        expect(cfg[f], `${phase} 相位不该写 ${f}`).toBeUndefined()
      }
    }
  })

  it('★ 缺 interactions ⇒ 依赖它的两字段不写（缺就是缺，不伪造 0）；但不依赖它的字段照写', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 1, yixuanFlashBonus: 70, battleTime: 60 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes, windows: [2] }),
      threads: { auricInkFlash: 4 } as never,
      // 不传 interactions
    }))
    // ⚠ 这两个字段是**整条链唯一**依赖 `interactions` 的：缺契约 ⇒ 钩子提前 return、
    // 它们停在 `buildCharConfig` 写下的基线值上（`extremeAssists` 无法求值 ⇒ 不许伪造 0 参与求和）。
    // 注：`yixuanFlashBonus` 的 build 基线非 0（完美格挡/极限闪避/玄墨三项），故断言的是
    // **「基线 70 原样保留」**而不是 undefined——即增量项一个都没加（不是「加了 0」）。
    expect(cfg.yixuanExtremeAssistCap, '缺 interactions ⇒ 不许写（否则断路伪装成 0）').toBeUndefined()
    expect(cfg.yixuanFlashBonus, '缺 interactions ⇒ 增量项不许加（基线原样保留）').toBe(70)
    expect(cfg.extraSelfDecibelReward, 'extraSelfDecibelReward 只依赖 threads+characters ⇒ 照写').toBe(0)
    // 不依赖 interactions 的字段必须仍然落盘（证明钩子跑了，不是「什么都没跑」）
    expect(cfg.yixuanAxisActive).toBe(true)
    expect(cfg.yixuanAnomalyTriggerFlash).toBe(4)
    // 本用例传了 `axis`（windows=[2]、默认 windowSeconds=16）⇒ 走**轴臂**：
    // floor(2×16/6) = floor(5.33) = 5（不是非轴臂的 floor(60/6)=10）
    expect(cfg.yixuanC1LightningCount, 'C1 落雷只需 axis+cfg ⇒ 缺 interactions 也要写').toBe(5)
  })

  it('★ 缺 axis ⇒ 轴字段不写；缺 threads ⇒ 线程字段与非轴 C1 照算（三通道各自独立门控）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 1, yixuanFlashBonus: 70, battleTime: 60 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(cfg, {
      // **不传 threads**（也不传 axis）
      interactions: interactionsOf([{ agentId: '1371' }, { agentId: '1481', parry: 3 }]),
      characters: [{ slot: 0, agentId: '1371' }] as never,
    }))
    expect(cfg.yixuanAxisEx).toBeUndefined()
    expect(cfg.yixuanAxisCloudSeconds).toBeUndefined()
    expect(cfg.yixuanAxisActive).toBeUndefined()
    expect(cfg.yixuanAnomalyTriggerFlash).toBeUndefined()
    // 缺 threads ⇒ 玄墨项按 0 计（`?? 0`）；本槽未设 `teamUltimateFlashBonus` ⇒ 极限支援恒 0。
    // ⇒ flashBonus = 70(基线) + 0(玄墨) + 0(极限支援) + floor(60/6)×5(C1 非轴臂) = 70 + 50 = 120
    expect(cfg.yixuanC1LightningCount, '缺 axis ⇒ 非轴臂 floor(有效战斗时间/6)').toBe(10)
    expect(cfg.yixuanFlashBonus).toBe(120)
  })
})

// ── 批次 4：1141 莱卡恩 —— lycaonBackstageDodgeCount ← interactions（未缩放） ────────
describe('1141 莱卡恩：lycaonBackstageDodgeCount ← interactions（未缩放闪反）', () => {
  it('★ Σ**队友**闪反（未缩放）；**过滤空槽**（带 agentId 判据，与仪玄那条刻意不同）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', invincibleTime: 0 }
    getAgentMechanic('1141')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [], windowSeconds: 16 }),
      interactions: interactionsOf([
        { agentId: '1141', dodge: 99 },  // 本槽（不计）
        { agentId: '1011', dodge: 6 },   // 队友
        { agentId: '', dodge: 5 },       // 空槽（**不计**——本条带 agentId 判据）
      ]),
    }))
    expect(cfg.lycaonBackstageDodgeCount).toBe(6) // 6（99 与空槽的 5 都不计）
  })

  it('★ 与仪玄的口径差异是**有意**的：同一份快照两条消费点得不同值', () => {
    const snap = interactionsOf([
      { agentId: '1371', parry: 3, dodge: 7 },
      { agentId: '', parry: 2, dodge: 5 },
    ])
    // 仪玄（slot 0，只看槽位号）⇒ 队友 = 槽 1 空槽：parry 2
    const yx: Cfg = { slot: 0, agentId: '1371', yixuanCinemaLevel: 0 }
    getAgentMechanic('1371')!.applyTeamConfig!(hookInput(yx, {
      axis: axisOf({ axes: [], windows: [] }), threads: { auricInkFlash: 0 } as never, interactions: snap,
    }))
    expect(yx.yixuanExtremeAssistCap).toBe(2)
    // 莱卡恩（slot 0，带 agentId 判据）⇒ 队友 = 槽 1 但空槽被排除：0
    const ly: Cfg = { slot: 0, agentId: '1141', invincibleTime: 0 }
    getAgentMechanic('1141')!.applyTeamConfig!(hookInput(ly, {
      axis: axisOf({ axes: [], windows: [] }), interactions: snap,
    }))
    expect(ly.lycaonBackstageDodgeCount).toBe(0)
  })

  it('★ 缺 interactions ⇒ 不写（不伪造 0）；其余围猎字段照写', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', invincibleTime: 0 }
    getAgentMechanic('1141')!.applyTeamConfig!(hookInput(cfg, {
      axis: axisOf({ axes: [], windows: [], windowSeconds: 19.5 }),
    }))
    expect(cfg.lycaonBackstageDodgeCount, '缺 interactions ⇒ 不许写').toBeUndefined()
    expect(cfg.lycaonWindowDuration).toBe(19.5)
    expect(cfg.lycaonStunCount).toBe(3)
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

  it('★ 派发器透传 interactions：store 口径**未缩放**值落到本槽 cfg（跳②）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1371' }, { agentId: '1481', parryCount: 4 }, { agentId: '1451', parryCount: 3 },
    ])
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
      buildCharConfig(2, config, catalog) as unknown as Cfg,
    ]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      axis: axisOf({ axes: [], windows: [] }),
      interactions: interactionsOf([
        { agentId: '1371', parry: 9 }, { agentId: '1481', parry: 4 }, { agentId: '1451', parry: 3 },
      ]),
    })
    // 队友 Σ = 4 + 3 = 7（本槽 9 不计）
    expect(characters[0].yixuanExtremeAssistCap, '派发器没把 interactions 递给钩子').toBe(7)
  })

  it('派发器不做 `?? {}` 兜底：缺 interactions 时钩子收到的是 undefined（可被测试分辨）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1371' }])
    const characters = [buildCharConfig(0, config, catalog) as unknown as Cfg]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      axis: axisOf({ axes: [], windows: [] }),
    })
    expect(characters[0].yixuanExtremeAssistCap).toBeUndefined()
    // 同一调用的轴字段仍照常写入（证明钩子确实被派发了，不是「什么都没跑」）
    expect(characters[0].yixuanAxisActive).toBe(true)
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


  /**
   * ★ 端到端（跳①）：`interactions` 契约经**真 convergence 派发点**落到仪玄的极限支援落雷次数。
   *
   * 这是本处迁移**唯一**能把「契约真接上了」与「静默回落」分开的断言：
   * `yixuanExtremeAssistCap` 的消费端是 `Math.floor(Number(record.yixuanExtremeAssistCap ?? 0))`
   * ⇒ 契约漏传时落到 **0**（落雷行整个消失），是个**看着合法**的值（正是任务卡反复强调的
   * 「断路值伪装成合法值」形态）。
   *
   * ⚠ 为什么用 `dodgeCounterCount` 造分化而不靠预设：`interactionScale` 只缩放
   * parry/block/dual/**dodge** —— 本用例显式传 `interactionScale` 之外还让队友**只有闪反**，
   * 于是「store Σ = 7」与「缩放后 characters Σ」可被同时观测。
   */
  it('★ 端到端：未缩放队友弹刀 → 仪玄极限支援落雷次数（短路 ⇒ 恒 0，不是别的值）', async () => {
    await setupHarness([
      { agentId: '1371', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1481', parryCount: 4 },
      { agentId: '1451', parryCount: 3 },
    ])
    const config = useConfigStore()
    config.enemy.stunCountLock = 2
    const calc = useResourceCalc()
    const yx = calc.resourceResult.value!.characters.find(c => c.agentId === '1371')!
    // 极限支援换场落雷 = 独立假 id 行（不进失衡/异常池）
    const lightning = yx.executions.find(e => e.moveId === '1371_extreme_assist_lightning')
    expect(lightning, '极限支援落雷行必须存在（默认次数 = 队友弹刀和上限）').toBeTruthy()
    // store Σ 队友弹刀 = 4 + 3 = 7；契约短路 ⇒ 0（行消失）
    expect(lightning!.count, '队友弹刀和没经 interactions 契约递进来（短路 ⇒ 恒 0）').toBe(7)
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
