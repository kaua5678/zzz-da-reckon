/**
 * 队友 buff 选择表：**现状语义特征测试**（characterization test，2026-09-12 评审 #9 前置）。
 *
 * 为什么先写这个：`setTeammateBuffEnabled`（用户手动开关）在补本文件前**全仓零测试覆盖**
 * （既有引用都是 `isTeammateBuffEnabled: () => false` 这类 stub）。而 #9 的下一步
 * （把 `enabled` 改成纯派生 + 覆盖层）会**改变**「用户开关 vs 队伍变化」的相互作用语义——
 * 动手前必须先把现状钉成可执行的断言，否则「改了之后行为是否如预期」无从判断。
 *
 * 本文件**只描述现状、不主张它是期望行为**。特别是下面标 ★ 的那条：
 *   用户手关某 buff 后，只要队伍变化触发一次 sync，手关就被派生值覆盖（开关不粘性）。
 * 这条正是需要用户裁决的点（要粘性 = 方案 A；保持现状 = 方案 B）。
 * 将来若按 A 改，本文件对应断言应**显式改写并注明口径变更**，而不是删掉了事。
 *
 * ============================ ★ 口径变更（2026-10-09，方案 A 落地） ============================
 * **用户裁决**（原话）：「我希望每个用户有自己的记忆文件……他觉得他的某个角色玩的不好，就把这个角色
 * 某些数值调低，这个应该持久记忆」＋「如果都没有记忆，那他就是临时修改，被默认值覆盖也无所谓」。
 *
 * 新语义（**本文件的 ★ 断言已按此显式改写**，不是删除）：
 *   - **记忆模式打开 + 该条已记进记忆** ⇒ 手关**粘**：队伍变化触发的 sync 不再覆盖它
 *     （记忆优先于派生值）。承载 = `stores/memory.ts` 的两层记忆（开关记队伍层、覆盖率记全局层），
 *     经 `stores/config.ts#createConfigModel` 的 `memoryPort` 注入（独立分析场景不注入 ⇒ 无记忆）。
 *   - **记忆模式关闭，或该条没有记忆记录** ⇒ 语义**与改写前逐位相同**：手关仍被派生值覆盖
 *     （用户明示「临时修改被覆盖也无所谓」）——下面标 ★ 的用例保留并断言这条**现状仍在**。
 *
 * 两条断言成对：只留新语义会掩盖「记忆关闭时行为被顺手改坏」，只留旧语义则等于没做这个功能。
 * ==============================================================================================
 *
 * 数据用真实 catalog（setupHarness），因为影画门槛解析与额外能力门控都依赖真实数据形状。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useMemoryStore } from '@/stores/memory'
import { teamKeyOf } from '@/composables/memoryFile'

/** 丽娜(1211)：核心被动无影画门槛；影画一/影画六分别要求 1/6 命座 */
const RINA = '1211'
const B_CORE = 'rina.core_pen_ratio'          // 核心被动 → 门槛 0
const B_C1 = 'rina.cinema_1.core_pen_ratio_amplify'  // 影画一 → 门槛 1
const B_C6 = 'rina.cinema_6.electric_damage_bonus'   // 影画六 → 门槛 6

describe('队友 buff 选择：派生（在队 × 影画门槛）', () => {
  it('在队 → 无门槛 buff 启用；不在队 → 全关', async () => {
    const a = await setupHarness([{ agentId: RINA }, '', ''])
    expect(a.config.isTeammateBuffEnabled(B_CORE)).toBe(true)
    expect(a.config.isTeammateBuffEnabled(B_C1)).toBe(false)   // 命座 0 < 1

    const b = await setupHarness(['', '', ''])
    expect(b.config.isTeammateBuffEnabled(B_CORE)).toBe(false)
  })

  it('影画门槛随命座放开（1 → 影画一开；6 → 影画六开）', async () => {
    const c1 = await setupHarness([{ agentId: RINA, cinemaLevel: 1 }, '', ''])
    expect(c1.config.isTeammateBuffEnabled(B_C1)).toBe(true)
    expect(c1.config.isTeammateBuffEnabled(B_C6)).toBe(false)

    const c6 = await setupHarness([{ agentId: RINA, cinemaLevel: 6 }, '', ''])
    expect(c6.config.isTeammateBuffEnabled(B_C6)).toBe(true)
  })

  it('覆盖率默认 100，且与启用状态解耦', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(100)
    config.setTeammateBuffCoverage(B_CORE, 50)
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(50)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)   // 改覆盖率不影响开关
  })
})

describe('队友 buff 选择：用户手动开关（现状语义）', () => {
  it('手关 → 读回 false；手开 → 读回 true（不触发队伍变化时保持）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    config.toggleTeammateBuff(B_CORE, false)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
    config.toggleTeammateBuff(B_CORE, true)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })

  it('★ 现状（记忆关闭时）：手关后**只要队伍变化触发 sync，手关就被派生值覆盖**（无记忆 = 临时改动）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.recording).toBe(false)   // 记忆模式关闭 = 改动不计入记忆

    config.toggleTeammateBuff(B_CORE, false)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)

    // 队伍变化（换命座即可触发 sync 的派生输入变化；丽娜仍在队 → 派生值仍为 true）
    config.setCinemaLevel(0, 2)
    config.syncTeammateBuffsFromTeam()

    // 无记忆 ⇒ 行为与 2026-10-09 之前逐位相同：手关丢失，回到派生值 true
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })

  it('★ 新语义（记忆打开时）：手关记进队伍记忆 ⇒ 队伍变化触发的 sync 不再覆盖（口径变更 2026-10-09）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true   // 打开记忆模式：改动立刻计入

    config.toggleTeammateBuff(B_CORE, false)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
    expect(memory.resolveEnabled(teamKeyOf(config.team), B_CORE)).toBe(false)

    config.setCinemaLevel(0, 2)
    config.syncTeammateBuffsFromTeam()

    // 记忆优先于派生值：手关粘住（这是本次口径变更的判据）
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
  })

  it('★ 新语义边界：记忆里记的是「开」时，派生「关」也压不动它', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.toggleTeammateBuff(B_C6, true)   // 命座 0 时派生值是 false，用户手动打开并记忆
    config.syncTeammateBuffsFromTeam()
    expect(config.isTeammateBuffEnabled(B_C6)).toBe(true)
  })

  it('手关后**离队** → 派生值也是 false（此路径与手关不可区分）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    config.toggleTeammateBuff(B_CORE, false)
    config.setAgent(0, '')
    config.syncTeammateBuffsFromTeam()
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
  })

  it('覆盖率跨「队伍变化 + sync」保留（与开关不同：覆盖率不被派生覆盖）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    config.setTeammateBuffCoverage(B_CORE, 30)
    config.setCinemaLevel(0, 4)
    config.syncTeammateBuffsFromTeam()
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(30)   // ★ 覆盖率粘性（开关不粘）
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })

  it('覆盖率越界钳到 0..100', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    config.setTeammateBuffCoverage(B_CORE, 999)
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(100)
    config.setTeammateBuffCoverage(B_CORE, -5)
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(0)
  })
})

describe('队友 buff 选择：数据晚到（竞态修复的现状）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('先组队后到数据：buff 数据到达时自动补同步（watcher 生效）', async () => {
    const catalog = useCatalogStore()
    const config = useConfigStore()
    // 真实时序：catalog（角色表）先到；**队友 buff 数据**后到。
    // （若连 catalog 都没载，getAgent 返回 undefined → 该角色视为不在队 —— 这是另一条路径，
    //   不是本测试要钉的「buff 数据晚到」。）
    await catalog.load()
    // buff 数据未载入时先组队（模拟「存档恢复/预设应用先于 fetch 返回」）
    config.setAgent(0, RINA)
    config.setAgent(1, '')
    config.setAgent(2, '')
    config.syncTeammateBuffsFromTeam()          // 无 groups → 早退
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)

    await catalog.loadTeammateBuffs()           // 数据到达
    await nextTick()                            // watcher flush

    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })
})

describe('队友 buff 选择：改命座后同一 tick 内即生效（批量路径依赖）', () => {
  it('setCinemaLevel 之后不 await、不手动 sync，读到的就是新命座的 buff 选择', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    expect(config.isTeammateBuffEnabled(B_C6)).toBe(false)
    config.setCinemaLevel(0, 6)
    // 回归（2026-09-23）：watch 曾是 pre-flush ⇒ 此处仍为 false，最优加金/难度曲线的同步读全部读到旧 buff
    expect(config.isTeammateBuffEnabled(B_C6)).toBe(true)
    config.setCinemaLevel(0, 0)
    expect(config.isTeammateBuffEnabled(B_C6)).toBe(false)
  })
})
