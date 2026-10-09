/**
 * 用户记忆 Store 判据（`stores/memory.ts` + config store 的接入面）。
 *
 * 每条对应一条**用户裁决**（2026-10-09），不是我自己定的期望：
 *  ① 记忆模式**关** ⇒ 改动不计入（记忆文件**逐字节不变**）；**开** ⇒ 改动立刻计入并落 localStorage。
 *  ② **自动分层**：队友 buff 覆盖率 → 全局层；开关 → 队伍层。
 *  ③ **解析顺序**：队伍层优先，其次全局层，都没有 = 临时改动（回落派生默认）。
 *  ④ **恢复出厂** = 清空记忆（等价于加载「全为不修改」的记忆文件），并**自动备份**当前记忆到具名槽；
 *     它与「加载某个记忆文件」是两个独立操作。
 *  ⑤ **队伍身份 = 成员 id 集合、顺序无关**：换位不串味、换人不串味。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useMemoryStore } from '@/stores/memory'
import { MEMORY_STORAGE_KEY } from '@/composables/memoryFile'
import { useCatalogStore } from '@/stores/catalog'



const RINA = '1211'
const B_CORE = 'rina.core_pen_ratio'
const B_C6 = 'rina.cinema_6.electric_damage_bonus'

/**
 * 假 localStorage：vitest 环境是 `node`（无 DOM），而记忆的持久化面正是本功能的判据之一。
 * 与 `persistedRef.test.ts` 同款（那边也是自己造一个，仓里没有共享的假存储实现）。
 */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  }
}

const realStorage = (globalThis as { localStorage?: unknown }).localStorage
let storage: ReturnType<typeof fakeStorage>

beforeEach(async () => {
  storage = fakeStorage()
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  newPinia()
  mockStaticFetch()
})
afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = realStorage })

describe('记忆模式开关语义（关 = 不计入 / 开 = 立刻计入）', () => {
  it('关闭时改动配置 ⇒ 记忆文件逐字节不变', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.recording).toBe(false)
    const before = storage.getItem(MEMORY_STORAGE_KEY)

    config.toggleTeammateBuff(B_CORE, false)
    config.setTeammateBuffCoverage(B_CORE, 40)

    expect(storage.getItem(MEMORY_STORAGE_KEY)).toBe(before)
    expect(memory.summary.globalEntries).toBe(0)
    expect(memory.summary.teams).toBe(0)
  })

  it('打开时改动 ⇒ 记忆随之变化并**实时**落 localStorage（不是「改完点保存」）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.toggleTeammateBuff(B_CORE, false)
    await Promise.resolve()   // watch flush（默认 pre）：下一拍落盘

    expect(memory.summary.teams).toBe(1)
    const stored = storage.getItem(MEMORY_STORAGE_KEY)
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored!).teams['1211'].teammateBuffs[B_CORE]).toEqual({ enabled: false })
  })
})

describe('自动分层（覆盖率 → 全局；开关 → 队伍）', () => {
  it('覆盖率记进全局层，开关记进队伍层', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.setTeammateBuffCoverage(B_CORE, 55)
    config.toggleTeammateBuff(B_C6, true)

    expect(memory.file.global.teammateBuffs[B_CORE]).toEqual({ coverage: 55 })
    expect(memory.file.teams['1211'].teammateBuffs[B_C6]).toEqual({ enabled: true })
  })

  it('解析顺序：队伍层优先于全局层', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.toggleTeammateBuff(B_CORE, false)          // 队伍层 enabled=false
    memory.file.global.teammateBuffs[B_CORE] = { enabled: true }   // 全局层 enabled=true（手动构造冲突）

    expect(memory.resolveEnabled('1211', B_CORE)).toBe(false)
    // 队伍层删掉后回落全局层
    delete memory.file.teams['1211'].teammateBuffs[B_CORE]
    expect(memory.resolveEnabled('1211', B_CORE)).toBe(true)
  })

  it('两层都没有 ⇒ undefined（= 临时改动，调用方回落派生默认）', async () => {
    await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.resolveEnabled('1211', B_CORE)).toBeUndefined()
    expect(memory.resolveCoverage('1211', B_CORE)).toBeUndefined()
  })

  it('手动改判：队伍层 → 全局层（自动分层是默认，不是牢笼）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)

    expect(memory.moveBuff('1211', B_CORE, 'global')).toBe(true)
    expect(memory.file.global.teammateBuffs[B_CORE]).toEqual({ enabled: false })
    expect(memory.file.teams['1211']).toBeUndefined()   // 队伍层空 ⇒ 整支消失，不留空壳
  })
})

describe('记忆粘性（sync 尊重记忆，不再无条件覆盖手关）', () => {
  it('手关 + 记忆开 ⇒ 改命座触发 sync 后仍是关（★ 口径变更）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.toggleTeammateBuff(B_CORE, false)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)

    config.setCinemaLevel(0, 2)
    config.syncTeammateBuffsFromTeam()

    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)   // 记忆优先于派生
  })

  it('手关 + 记忆**关** ⇒ 仍被派生值覆盖（临时改动，用户明示可接受）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.recording).toBe(false)

    config.toggleTeammateBuff(B_CORE, false)
    config.setCinemaLevel(0, 2)
    config.syncTeammateBuffsFromTeam()

    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })

  it('队伍隔离：换到另一支含同角色的队，不再沿用上一支队的开关', async () => {
    const first = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    first.config.toggleTeammateBuff(B_CORE, false)
    expect(memory.resolveEnabled('1211', B_CORE)).toBe(false)

    // 新队伍：丽娜 + 另两人（成员集合不同 ⇒ 不同队伍身份）
    const catalog = useCatalogStore()
    await catalog.load()
    const others = catalog.displayAgents.filter(a => !a.hidden && a.id !== RINA).slice(0, 2).map(a => a.id)
    const second = await setupHarness([{ agentId: RINA }, { agentId: others[0] }, { agentId: others[1] }])
    const key2 = [RINA, others[0], others[1]].sort().join('+')
    expect(memory.resolveEnabled(key2, B_CORE)).toBeUndefined()
    expect(second.config.isTeammateBuffEnabled(B_CORE)).toBe(true)   // 派生值说了算
  })

  it('队伍身份顺序无关：换位不丢记忆', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const others = catalog.displayAgents.filter(a => !a.hidden && a.id !== RINA).slice(0, 2).map(a => a.id)

    const a = await setupHarness([{ agentId: RINA }, { agentId: others[0] }, { agentId: others[1] }])
    const memory = useMemoryStore()
    memory.recording = true
    a.config.toggleTeammateBuff(B_CORE, false)

    // 同一批成员、换槽序 ⇒ 同一队伍身份 ⇒ 记忆仍生效
    const b = await setupHarness([{ agentId: others[1] }, { agentId: RINA }, { agentId: others[0] }])
    expect(b.config.isTeammateBuffEnabled(B_CORE)).toBe(false)
  })

  it('记忆里「开」也能压过派生「关」（影画不够时用户手动打开）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true

    config.toggleTeammateBuff(B_C6, true)   // 命座 0 时派生值是 false
    config.syncTeammateBuffsFromTeam()
    expect(config.isTeammateBuffEnabled(B_C6)).toBe(true)
  })
})

describe('恢复出厂 / 加载记忆（两个独立操作）', () => {
  it('恢复出厂：清空记忆 + 自动备份 + 配置回落派生默认', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    config.setTeammateBuffCoverage(B_CORE, 20)
    expect(memory.summary.teams).toBe(1)

    const backup = memory.factoryReset()
    config.applyMemoryReset()

    expect(backup).toMatch(/^自动备份 /)
    expect(memory.summary.globalEntries).toBe(0)
    expect(memory.summary.teams).toBe(0)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)          // 回到派生默认
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(100)
    // 备份可加载回来（「随时可恢复」）
    expect(memory.loadSlot(backup)).toBe(true)
    config.applyMemoryReset()
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
    expect(config.getTeammateBuffCoverage(B_CORE)).toBe(20)
  })

  it('空记忆恢复出厂：不产生空备份槽', async () => {
    await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.factoryReset()).toBe('')
    expect(memory.slots).toEqual([])
  })

  it('导出 → 导入往返：配置逐位相同（含只改覆盖率/只改开关两种形状）', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    config.setTeammateBuffCoverage(B_C6, 35)
    const exported = memory.exportText()

    memory.factoryReset()
    config.applyMemoryReset()
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(true)

    expect(memory.importText(exported)).toBe(true)
    config.applyMemoryReset()
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
    expect(config.getTeammateBuffCoverage(B_C6)).toBe(35)
    expect(memory.exportText()).toBe(exported)   // 再导出逐字节相同
  })

  it('导入损坏文件 ⇒ 可见报错且**不动**现有记忆', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    const before = memory.exportText()

    expect(memory.importText('{坏文件')).toBe(false)
    expect(memory.error).toMatch(/导入失败/)
    expect(memory.exportText()).toBe(before)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)
  })

  it('缺版本号的记忆文件 ⇒ 可见报错（不是静默回落）', async () => {
    await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.importText(JSON.stringify({ global: { teammateBuffs: {} }, teams: {} }))).toBe(false)
    expect(memory.error).toMatch(/schemaVersion/)
  })

  it('具名记忆：存/加载/删除', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    expect(memory.saveSlot('我的雅队')).toBe(true)
    expect(memory.saveSlot('')).toBe(false)

    config.toggleTeammateBuff(B_CORE, true)
    expect(memory.loadSlot('我的雅队')).toBe(true)
    config.applyMemoryReset()
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)

    expect(memory.loadSlot('不存在')).toBe(false)
    memory.deleteSlot('我的雅队')
    expect(memory.slots).toEqual([])
  })
})

describe('刷新后记忆仍在（localStorage 自动存）', () => {
  it('重开 store（新 pinia）读回同一份记忆，并作用到配置上', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    config.setTeammateBuffCoverage(B_CORE, 45)
    await Promise.resolve()

    // 「刷新页面」= 新 pinia + 同一 localStorage
    newPinia()
    mockStaticFetch()
    const { config: config2 } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory2 = useMemoryStore()
    expect(memory2.summary.teams).toBe(1)
    expect(config2.isTeammateBuffEnabled(B_CORE)).toBe(false)
    expect(memory2.resolveCoverage('1211', B_CORE)).toBe(45)
  })

  it('本地记忆损坏 ⇒ 载入时报错可见（不静默当成空记忆）', async () => {
    storage.setItem(MEMORY_STORAGE_KEY, '{坏文件')
    newPinia()
    mockStaticFetch()
    await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    expect(memory.error).toMatch(/本地记忆读取失败/)
  })
})

describe('回归：新建 store 实例不得继承上一实例的记忆（实测抓到的坑）', () => {
  it('上一实例写入记忆后，同模块新建实例（新 pinia + 空 localStorage）必须从零开始', async () => {
    const first = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    first.config.toggleTeammateBuff(B_CORE, false)
    expect(Object.keys(memory.file.teams)).toHaveLength(1)

    // ⚠ 先让自动存落盘（watch 默认 pre-flush，是**下一拍**写）再清存储：
    // 否则旧实例的待落盘回调会在 `await` 期间把记忆写回刚清空的存储，测到的是「自己写回去的」而不是继承。
    await nextTick()
    // 「换了个存储 / 另一个会话」：新 pinia + 空 localStorage。
    // ⚠ 必须 `resetModules`：Pinia 的 `defineStore` 在**首次调用**时把 setup 与当时的 activePinia 绑定，
    // 同模块内 `useMemoryStore()` 会一直返回**同一个** store 实例（新 pinia 也不会重建它）
    // ⇒ 不重置模块就测不到「载入读盘」这条路径，测到的是 Pinia 的实例缓存。
    // 本用例真正要钉的是：**载入必须在 store setup 内读盘**，不能做成模块级常量
    // （模块级对象会被 store 原地改写 ⇒ 第二个实例继承前一个的记忆，记忆模式关闭也照样串味——实测抓到）。
    vi.resetModules()
    newPinia()
    mockStaticFetch()
    storage.clear()
    const { useMemoryStore: freshMemoryStore } = await import('@/stores/memory')
    const { setupHarness: freshHarness } = await import('@/test/harness')
    const second = await freshHarness([{ agentId: RINA }, '', ''])
    const memory2 = freshMemoryStore()
    expect(Object.keys(memory2.file.teams)).toHaveLength(0)
    expect(memory2.recording).toBe(false)
    expect(second.config.isTeammateBuffEnabled(B_CORE)).toBe(true)
  })
})

describe('独立分析场景不读记忆（隔离）', () => {
  it('场景内的 config 无记忆端口：派生值说了算，与本次改动前逐位相同', async () => {
    const { config } = await setupHarness([{ agentId: RINA }, '', ''])
    const memory = useMemoryStore()
    memory.recording = true
    config.toggleTeammateBuff(B_CORE, false)
    expect(config.isTeammateBuffEnabled(B_CORE)).toBe(false)

    const { createAnalysisScenario } = await import('@/composables/analysisScenario')
    const scenario = createAnalysisScenario()
    try {
      // 场景从源现场拷贝（拷贝到的是「关」），随后 sync 按**派生值**重算 ⇒ 回到「开」
      scenario.config.syncTeammateBuffsFromTeam()
      expect(scenario.config.isTeammateBuffEnabled(B_CORE)).toBe(true)
    } finally {
      scenario.dispose()
    }
  })
})
