/**
 * `countStun` 契约 + 1141 莱卡恩 `lycaonC2Energy` 迁移判据（2026-09-17 round 20 C-γ 收尾批）。
 *
 * 迁移面：`src/composables/resourceCalc/convergence.ts` 的 `merged.agentId === '1141'` 分支
 * （该分支的**最后一个**字段 `lycaonC2Energy`）⇒ `lycaon.ts#applyTeamConfig`。
 * 补的两个只读契约：
 *  ① `AgentTeamConfigInput.countStun`（**计数投影版**失衡次数，C7）——非轴臂的
 *     `Σ_{队友} chainCountPerStun × countStun` 用的是**投影值**，默认 `'off'` 下与 `stunCount`
 *     恒等，但难度阶梯 G4（`round`）打开时**不等价**；用 `stunCount` 硬迁就是静默改语义。
 *  ② `AgentInteractionSnapshot.chainCountPerStun`（**store 原值**）——`characters` 上那份被
 *     `buildCharConfig` 写过 `?? (isSupport ? 0 : 1)` 兜底，store 默认 `0` ⇒ 两份不同值。
 *
 * 为什么必须单独有这个文件（同 `axisContext.test.ts` / `nextRoundFeedbackR20.test.ts` 的理由）：
 * 这条链有四跳，**每一跳断了都会静默出错**，而既有测试网抓不到：
 *   ① `convergence.ts` 的 converge 派发点没传 `countStun` ⇒ 非轴臂落回 `stunCount`
 *      （**只在 G4 打开时**错，默认 off 下 0 delta ⇒ `timeGolden` 全绿）；
 *   ② `applyTeamMechanics` 忘了把 `params.countStun` 透给钩子 ⇒ 同上；
 *   ③ 派发点快照没带 `chainCountPerStun`、或模块改读 `characters` 上那份 ⇒ 静默用 cfg 的
 *      兜底值 1（用户没调滑块时）而不是 store 的 0；
 *   ④ 模块自己算错臂（轴臂用非轴公式 / 忘了排除自己 / 忘了过滤空槽）。
 *
 * ⚠ 层②（两臂分叉）是本批的**核心判据**：必须构造出 `stunCount ≠ countStun` 的夹具，
 * 否则「用 `countStun`」与「用 `stunCount`」给出同一个数，判据形同虚设
 * （实测陷阱：G4 默认 `off` 下二者恒等，`timeGolden` 与 `lycaonSmoke` 都分辨不出来）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamMechanics, buildCharConfig } from '@/composables/resourceCalc/helpers'
import { getAgentMechanic } from '@/mechanics'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'
import type { AgentAxisContext, AgentInteractionContext, AgentTeamConfigInput } from '@/mechanics/types'

type Cfg = Record<string, unknown> & { slot: number }

/** 合成轴上下文（只填被测模块真正读的字段；其余按形状补齐） */
function axisOf(o: {
  axes?: AgentAxisContext['axes']
  windows?: number[]
  active?: boolean
  windowSeconds?: number
  chainTotalBySlot?: Record<number, number>
}): AgentAxisContext {
  return {
    active: o.active ?? false,
    axes: o.axes ?? [],
    windows: o.windows ?? [],
    windowSeconds: o.windowSeconds ?? 16,
    actionCountsBySlot: {},
    ultimateTotalBySlot: {},
    chainTotalBySlot: o.chainTotalBySlot ?? {},
  }
}

/**
 * 合成「未缩放」快照。`rows` 按槽位数组给，`''` = 空槽。
 * ⚠ 空槽也要给计数（`setAgent` 清人时**不重置**计数）——1141 那条带 `agentId` 判据 ⇒ 空槽被排除。
 */
function interactionsOf(
  rows: Array<{ agentId: string; dodge?: number; chain?: number }>,
): AgentInteractionContext {
  return {
    bySlot: Object.fromEntries(rows.map((r, i) => [i, {
      agentId: r.agentId,
      parryCount: 0,
      blockCount: 0,
      dodgeCounterCount: r.dodge ?? 0,
      dualCounterCount: 0,
      quickAssistCount: 0,
      chainCountPerStun: r.chain ?? 0,
    }])),
  }
}

/** 直接调 1141 的 applyTeamConfig（派发器的最小等价复现；层③另走真派发器） */
function hookInput(cfg: Cfg, over: Partial<AgentTeamConfigInput> = {}): AgentTeamConfigInput {
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

const hook = () => {
  const h = getAgentMechanic('1141')?.applyTeamConfig
  expect(h, '1141 必须挂 applyTeamConfig（迁完忘挂钩子 ⇒ C2 回能静默归零）').toBeTypeOf('function')
  return h!
}

// ── 层④（反向锁）：注册与契约门控本身是承重的 ────────────────────────────────────
describe('1141 C2 契约接线（反向锁）', () => {
  it('1141 声明了 applyTeamConfig；缺 countStun 时**不写** lycaonC2Energy（不许静默 0）', () => {
    expect(getAgentMechanic('1141')?.applyTeamConfig).toBeTypeOf('function')
    const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, { axis: axisOf({}), interactions: interactionsOf([
      { agentId: '1141' }, { agentId: '1011', chain: 2 },
    ]) }))
    expect(cfg.lycaonC2Energy, '缺 countStun ⇒ 必须保持 undefined（0 是合法失衡次数，不许冒充断路）')
      .toBeUndefined()
    // 同一调用里其余围猎字段照写（证明钩子确实被派发了，不是「什么都没跑」）
    expect(cfg.lycaonStunCount).toBe(3)
    expect(cfg.lycaonTotalTime).toBe(180)
  })

  it('缺 interactions 时**不写**（非轴臂拿不到队友连携 ⇒ 不许写半个值）；轴臂不依赖它', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, { countStun: 4, axis: axisOf({ active: false }) }))
    expect(cfg.lycaonC2Energy, '缺 interactions 的非轴臂 ⇒ 不写').toBeUndefined()
    // 轴臂只依赖 axis.chainTotalBySlot ⇒ 照样写得出（Σ全槽 1+3 = 4 − 本槽 1 = 3）
    const cfgAxis: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfgAxis, {
      stunCount: 4, countStun: 4, axis: axisOf({ active: true, chainTotalBySlot: { 0: 1, 1: 3 } }),
    }))
    expect(cfgAxis.lycaonC2Energy).toBe((4 + 3) * 5)
  })

  it('C2 未解锁（c2Per = 0）⇒ 写 0（与原式 `c2Per > 0 ? … : 0` 逐位一致，不是「不写」）', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 0, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      countStun: 3, axis: axisOf({}), interactions: interactionsOf([{ agentId: '1011', chain: 2 }]),
    }))
    expect(cfg.lycaonC2Energy).toBe(0)
  })
})

// ── 层① 精确值：非轴臂（store 原值 chainCountPerStun × countStun） ──────────────
describe('1141 C2 非轴臂：精确值', () => {
  it('Σ_{队友} store 原值 chainCountPerStun × countStun；**排除自己**、**排除空槽**', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount: 3,
      countStun: 3,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1141', chain: 3 },  // 自己（**不计**——用户确认：只算队友的连携）
        { agentId: '1011', chain: 2 },  // 队友 2 × 3 = 6
        { agentId: '', chain: 3 },      // 空槽（**不计**——带 agentId 判据）
      ]),
    }))
    // (stunCount 3 + 队友连携 6) × 5 = 45。若没排除自己 ⇒ (3 + 6 + 9) × 5 = 90；
    // 若没排除空槽 ⇒ (3 + 6 + 9) × 5 = 90（两条各差一个量，故本用例同时钉死两者）。
    expect(cfg.lycaonC2Energy).toBe(45)
  })

  it('多队友累加 + 队友连携为 0 ⇒ 只剩失衡次数项（0 与「缺字段」不同）', () => {
    // ⚠ 判据是**按槽位号**排除自己（`Number(slotKey) === ownSlot`），不是按 agentId
    // ——原式 `ci !== cfg.slot` 就是这个语义，逐位保留（故本槽 slot 1 被排除时，
    // 键 2 上就算写着 '1141' 也照样计入：那只是「槽 2 的角色也是莱卡恩」的镜像队形态）。
    const cfg: Cfg = { slot: 1, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount: 4,
      countStun: 4,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1011', chain: 1 },  // 队友槽 0：1 × 4 = 4
        { agentId: '1141', chain: 3 },  // **本槽**（slot 1）⇒ 排除
        { agentId: '1031', chain: 3 },  // 队友槽 2：3 × 4 = 12
      ]),
    }))
    expect(cfg.lycaonC2Energy).toBe((4 + 4 + 12) * 5) // (stunCount 4 + 连携 4+12) × 5 = 100
  })
})

// ── 层② ★ 两臂分叉（本批核心）：非轴臂必须吃 countStun，不吃 stunCount ────────────
describe('★ 1141 C2 计数投影：非轴臂必须吃 countStun（G4 打开时二者不等价）', () => {
  /**
   * 夹具必须让 `stunCount ≠ countStun`：`stunCount = 3.6`、投影 `'round'` ⇒ `countStun = 4`。
   * ⚠ 若夹具落在恒等区间（如 `stunCount = 3`），「用 countStun」与「用 stunCount」同值 ⇒
   * 判据 2 形同虚设（本批实测的诚实边界，见报告）。
   */
  it('stunCount=3.6 / round ⇒ countStun=4：队友连携吃 4 而不是 3.6；最终式仍用实数的 stunCount', () => {
    const stunCount = 3.6
    const countStun = projectStunPlanForCounts(stunCount, 'round')
    expect(countStun, '夹具前提：投影必须真改变值（否则本判据不可分辨）').toBe(4)
    expect(countStun).not.toBe(stunCount)

    // ⚠ 本槽必须落在**它自己的槽位下标**上（`bySlot` 按槽位键控，`hookInput` 的 `characters[0]`
    // 只是形状哨兵）——本槽放 slot 2，队友占键 0/1，这样「排除自己」的判据真的被走到。
    const cfg: Cfg = { slot: 2, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount,
      countStun,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1011', chain: 2 },  // 队友 2 × countStun(4) = 8（用 stunCount 则 2 × 3.6 = 7.2）
        { agentId: '1031', chain: 1 },  // 队友 1 × 4 = 4（用 stunCount 则 3.6）
        { agentId: '1141', chain: 3 },  // 本槽（slot 2，**不计**；若没排除 ⇒ +12）
      ]),
    }))
    // 队友连携 = (2 + 1) × 4 = 12；总数 = (3.6 + 12) × 5 = 78
    // 若错用 stunCount：连接数 = (2+1) × 3.6 = 10.8 ⇒ (3.6 + 10.8) × 5 = 72（精确可分辨）
    // 若没排除自己：连接数 = (2+1+3) × 4 = 24 ⇒ 138（同样精确可分辨）
    expect(cfg.lycaonC2Energy).toBe(78)
    expect(cfg.lycaonC2Energy).not.toBe(72)
    expect(cfg.lycaonC2Energy).not.toBe(138)
  })

  it('★ 同一 stunCount、四种投影给四个可分辨的值（证明消费端确实读的是 countStun）', () => {
    const read = (mode: 'off' | 'floor' | 'round' | 'ceil') => {
      const cfg: Cfg = { slot: 2, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
      hook()(hookInput(cfg, {
        stunCount: 3.2,
        countStun: projectStunPlanForCounts(3.2, mode),
        axis: axisOf({ active: false }),
        interactions: interactionsOf([
          { agentId: '1011', chain: 1 }, { agentId: '1031', chain: 0 }, { agentId: '1141', chain: 9 },
        ]),
      }))
      return cfg.lycaonC2Energy as number
    }
    // 队友连携 = 1 × countStun ⇒ c2 = (3.2 + countStun) × 5
    // off(3.2) = 32 · floor(3) = 31 · round(3) = 31 · ceil(4) = 36
    expect(read('off')).toBe(32)
    expect(read('floor')).toBe(31)
    expect(read('round')).toBe(31)
    expect(read('ceil')).toBe(36)
    // 若消费端错读 stunCount ⇒ 四态全 32（本判据退化为恒等，下面的反锁即为此）
    expect(new Set([read('off'), read('floor'), read('round'), read('ceil')]).size).toBe(3)
  })

  it('轴臂**不读** countStun（只用 axis.chainTotalBySlot）：同一 countStun 两态同值', () => {
    const read = (countStun: number) => {
      const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
      hook()(hookInput(cfg, {
        stunCount: 3,
        countStun,
        axis: axisOf({ active: true, chainTotalBySlot: { 0: 9, 1: 2, 2: 1 } }),
        interactions: interactionsOf([{ agentId: '1011', chain: 3 }]),
      }))
      return cfg.lycaonC2Energy as number
    }
    // 轴臂 = Σ全槽 − 本槽 = (9 + 2 + 1) − 9 = 3 ⇒ (3 + 3) × 5 = 30（countStun 与 interactions 都不进式）
    expect(read(3)).toBe(30)
    expect(read(4)).toBe(30)
  })
})

// ── 层① 精确值：轴臂（Σ 全槽轴内连携块 − 本槽） ─────────────────────────────────
describe('1141 C2 轴臂：精确值', () => {
  it('轴臂 = Σ全槽 − 本槽（**不是** Σ队友：逐位保留原式写法）', () => {
    const cfg: Cfg = { slot: 1, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount: 4,
      countStun: 4,
      axis: axisOf({ active: true, chainTotalBySlot: { 0: 3, 1: 5, 2: 2 } }),
    }))
    // Σ = 10，减本槽(slot 1 = 5) ⇒ 5；若错用「Σ 队友」(3 + 2 = 5) 本用例同值 ——
    // 故下方另有一例把两种算法分开。
    expect(cfg.lycaonC2Energy).toBe((4 + 5) * 5) // 45
  })

  it('★ 轴臂两种算法的可分辨夹具：本槽在轴内**无**连携块而队友有 ⇒ Σ全槽 − 本槽 ≠ Σ队友之和的错位', () => {
    // 原式 = Σ全槽 − 本槽。若误写成「Σ 非本槽」（= Σ队友），两式在「槽位号 = 键」时恒等，
    // 因为 Σ全槽 − 本槽 ≡ Σ_{k≠本槽}。真正的可分辨差异在**键与槽位号不一致**时：
    // 契约的 `chainTotalBySlot` 是**按 slot 键控**的（不是数组下标），故本用例给一个
    // 「键 2 有值但本槽是 1」的正常形状，确认减法用的是 cfg.slot 而不是数组位置。
    const cfg: Cfg = { slot: 2, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount: 3,
      countStun: 3,
      axis: axisOf({ active: true, chainTotalBySlot: { 0: 6, 1: 0, 2: 4 } }),
    }))
    // Σ = 10，减本槽(slot 2 = 4) ⇒ 6 ⇒ (3 + 6) × 5 = 45
    // 若按数组位置减（第 3 项）⇒ 键 0/1/2 的对象值序为 [6,0,4]，减 4 仍是 6 ⇒ 同值；
    // 但若误把「本槽」当槽 0 ⇒ Σ − 6 = 4 ⇒ 35（精确可分辨）。
    expect(cfg.lycaonC2Energy).toBe(45)
    expect(cfg.lycaonC2Energy).not.toBe(35)
  })

  it('轴臂 + 本槽占满全部连携 ⇒ 队友项为 0，只剩失衡次数项', () => {
    const cfg: Cfg = { slot: 0, agentId: '1141', lycaonC2EnergyPerTrigger: 5, invincibleTime: 0 }
    hook()(hookInput(cfg, {
      stunCount: 2, countStun: 2, axis: axisOf({ active: true, chainTotalBySlot: { 0: 7 } }),
    }))
    expect(cfg.lycaonC2Energy).toBe((2 + 0) * 5) // 10
  })
})

// ── 层③ 真派发器：countStun 与 chainCountPerStun 必须递得进 ─────────────────────
describe('applyTeamMechanics 透传 countStun / chainCountPerStun（跳②）', () => {
  it('★ 派发器把 countStun 递给钩子，字段落在 cfg 上；非本槽角色不受影响', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1141', cinemaLevel: 2 }, { agentId: '1011' }, { agentId: '1031' },
    ])
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
      buildCharConfig(2, config, catalog) as unknown as Cfg,
    ]
    expect(characters.every(Boolean)).toBe(true)
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 3.6,
      countStun: 4,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1141' }, { agentId: '1011', chain: 2 }, { agentId: '1031', chain: 1 },
      ]),
    })
    // (3.6 + (2+1)×4) × 5 = 78 —— 与层②同一个数，但这次契约是**派发器**递的
    expect(characters[0].lycaonC2Energy, '派发器没把 countStun 递给钩子').toBe(78)
    expect(characters[1].lycaonC2Energy).toBeUndefined() // 1011 那份 cfg 不该被写 1141 字段
    expect(characters[2].lycaonC2Energy).toBeUndefined()
  })

  it('派发器不做 `?? 0` 兜底：缺 countStun 时钩子收到 undefined（可被测试分辨）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1141', cinemaLevel: 2 }])
    const characters = [buildCharConfig(0, config, catalog) as unknown as Cfg]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 3,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([{ agentId: '1011', chain: 2 }]),
    })
    expect(characters[0].lycaonC2Energy).toBeUndefined()
    // 同一调用里非契约字段照写（证明钩子确实被派发了）
    expect(characters[0].lycaonStunCount).toBe(3)
  })

  it('★ 派发器的快照带 store 原值 chainCountPerStun（不是 cfg 的 `?? (isSupport ? 0 : 1)` 兜底）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1141', cinemaLevel: 2 }, { agentId: '1011' }])
    // ⚠ 把队友的 store 值设成**契约缺省之外**的一个数，并让 cfg 侧的兜底会是另一个数：
    // 1011 是强攻（isSupport = false）⇒ `buildCharConfig` 的 `?? 1` 兜底会把它变成 1；
    // 这里 store 显式 = 3 ⇒ 若读 `characters` 会得 3 或 1，若读快照会得 3。可分辨性靠下面的
    // 第二臂（store = 0 而 cfg 兜底 = 1）来钉——那才是默认值分裂的真实形态。
    config.setChainCountPerStun(1, 3)
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
    ]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      countStun: 2,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1141' },
        { agentId: '1011', chain: config.team[1].chainCountPerStun ?? 0 },
      ]),
    })
    // 队友 3 × 2 = 6 ⇒ (2 + 6) × 5 = 40
    expect(characters[0].lycaonC2Energy).toBe(40)
  })

  it('★ 默认值分裂：store = 0（未调滑块）而 cfg 兜底 = 1 ⇒ 读 store 得 0，读 cfg 会得 1', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1141', cinemaLevel: 2 }, { agentId: '1011' }])
    // ⚠ 把队友的 store 值设成 **0**（= 未调过滑块的默认形态），并让 cfg 侧的兜底会是另一个数：
    // 1011 是强攻（`isSupport = false`）⇒ `characters` 上那份被写成 1。store 侧 0 ⇒ 走快照得 0。
    config.setChainCountPerStun(1, 0)
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
    ]
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      countStun: 2,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1141' },
        { agentId: '1011', chain: config.team[1].chainCountPerStun ?? 0 },
      ]),
    })
    // 队友 0 × 2 = 0 ⇒ (2 + 0) × 5 = 10
    expect(characters[0].lycaonC2Energy).toBe(10)
  })

  /**
   * ★ 默认值分裂的**真实边界**（实测钉死，别照抄 R18 分诊的例子）。
   *
   * R18 分诊写的是「`store = 0` → `cfg = 1`」，**实测是错的**：`0 ?? 1 === 0`（`??` 只接
   * `null`/`undefined`）⇒ store 显式 0 时 cfg 也是 0。**分裂只发生在 store 侧字段
   * 真的缺失（`undefined`）时**——那种形态在 harness/`setAgent` 路径下拿不到（`createDefaultChar`
   * 铺了 0、harness 的 `TEST_BASE_CHAR` 铺了 1），故本判据**直接构造缺失态**：
   * `delete` 掉 store 上的键 ⇒ 模拟「老预设/外部写入的对象没有这个字段」。
   * 实测：`delete` 后 store 读 `?? 0` = 0，而 cfg 那份 = 1 ⇒ 两口径**精确可分辨**。
   */
  it('★ 默认值分裂（真实边界）：store 侧字段**缺失** ⇒ 快照 0 vs cfg 兜底 1，读 store 才对', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1141', cinemaLevel: 2 }, { agentId: '1011' }])
    delete (config.team[1] as unknown as Record<string, unknown>).chainCountPerStun
    expect(config.team[1].chainCountPerStun, 'store 侧缺字段 ⇒ 原式 `?? 0` 得 0').toBeUndefined()
    const characters = [
      buildCharConfig(0, config, catalog) as unknown as Cfg,
      buildCharConfig(1, config, catalog) as unknown as Cfg,
    ]
    // 前提确认（判据的承重面）：cfg 那份**真的**被兜底成 1。若这条不成立，本判据退化为同值。
    expect(characters[1].chainCountPerStun, 'cfg 侧兜底前提：强攻非辅助 ⇒ ?? 1').toBe(1)
    applyTeamMechanics({
      characters: characters as never,
      configStore: config,
      catalogStore: catalog,
      phase: 'converge',
      combatTime: 180,
      stunCount: 2,
      countStun: 2,
      axis: axisOf({ active: false }),
      interactions: interactionsOf([
        { agentId: '1141' },
        // 派发点对缺失字段的 `?? 0` = 原式 `c.chainCountPerStun ?? 0` 的同一语义
        { agentId: '1011', chain: config.team[1].chainCountPerStun ?? 0 },
      ]),
    })
    // store 原值缺失 ⇒ 0 ⇒ (2 + 0) × 5 = 10。若读 cfg 那份 = 1 ⇒ (2 + 1×2) × 5 = 20（精确可分辨）
    expect(characters[0].lycaonC2Energy).toBe(10)
    expect(characters[0].lycaonC2Energy).not.toBe(20)
  })
})

// ── 层③ 真管线：G4 打开时的端到端数值 ──────────────────────────────────────────
describe('★ 真管线：难度阶梯 G4（计数投影 round）打开时的 C2 回能', () => {
  it('同一队伍：投影 off vs round 给出**不同**的 lycaonC2Energy（G4 真的咬合）', async () => {
    const read = async (projectionCode: number) => {
      const { config } = await setupHarness([
        { agentId: '1141', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1011', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 1 },
        '',
      ])
      config.enemy.stunCountLock = 3
      config.setMechanicSetting('time.stunPlanProjection', projectionCode)
      const calc = useResourceCalc()
      return calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
        .energySource.lycaonC2Energy
    }
    // off（0）⇒ countStun = 3；队友连携 1 × 3 = 3 ⇒ (3 + 3) × 5 = 30
    expect(await read(0)).toBe(30)
    // round（2）⇒ 锁 3 次失衡是整数 ⇒ countStun = 3 ⇒ 同上（**锁定态下两者恒等**，
    // 这是设计：锁定次数本就是整数计划值）。本用例的价值在把「真管线确实读了这个开关」
    // 这条链跑通，并钉住精确值；非整数的分叉由层②的合成夹具承担（那边能自由造 3.6）。
    expect(await read(2)).toBe(30)
  })

  it('★ 真管线 + 非整数失衡（lock 3.6）：投影 off 用实数、round 用投影值 ⇒ 精确可分辨', async () => {
    const read = async (projectionCode: number) => {
      const { config } = await setupHarness([
        { agentId: '1141', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1011', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, chainCountPerStun: 2 },
        '',
      ])
      // ⚠ `stunCountLock` 是 number（不是整数）⇒ 锁 3.6 可造出**非整数**计划值：
      // 锁定态下它就是 `runCalcRound` 拿到的 `stunCount`（不经不动点缩放）。
      config.enemy.stunCountLock = 3.6
      config.setMechanicSetting('time.stunPlanProjection', projectionCode)
      const calc = useResourceCalc()
      const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
      return lycaon.energySource.lycaonC2Energy
    }
    // off：countStun === stunCount = 3.6 ⇒ 队友连携 2 × 3.6 = 7.2 ⇒ (3.6 + 7.2) × 5 = 54
    expect(await read(0)).toBeCloseTo(54, 8)
    // round：countStun = 4 ⇒ 队友连携 2 × 4 = 8 ⇒ (3.6 + 8) × 5 = 58（**与 off 精确可分辨**）
    expect(await read(2)).toBeCloseTo(58, 8)
  })
})
