/**
 * A4 性能判据：**小窗打开时，一次配置改动触发的资源管线工作量与关闭时逐位相同**。
 *
 * 为什么这条是本功能最大的风险（prompt §3.1 点名「别跳过」）：
 * `useResourceCalc()` 每次调用都新建一整套 computed 图（r705 事故：`ImpactChart` 为读两个值自建第二个实例
 * ⇒ 资源利用率页每次状态变化**整条管线跑两遍**，探针实测重队每遍 430–506ms）。
 * 小窗是**跨页签常驻**的，一旦自建实例，每一页都多付一遍。
 *
 * ## 判据怎么选（一次口径纠正，2026-10-09 实测驱动）
 * 初版判据用 `getCalcOutputMemoStats().misses`（外层不动点真求值次数）做 A/B——**它没有牙齿**：
 * 负例（故意让小窗自建第二个 `useResourceCalc()`）实测 `misses` 与共享实例**逐位相同**
 * （两者都是 `{misses:2, hits:0}`）。原因写在 `useResourceCalc.ts:70-78`：calcOutput 的 LRU 自 r707 起
 * **跨实例共享**，第二个实例读同一状态只命中、不重算外层不动点。
 * 而 r705 的实测代价（430–506ms）落在**下游** computed（伤害池、结算面板、进场快照面板……）——
 * 那部分 `useResourceCalc.ts:107` 明写「仍按实例各算一份」。
 *
 * ⇒ 判据改成量**下游管线的构建次数**：mock `resourceCalc/panelPhases`（下游最重的构建器之一，
 * 每次求值构建面板阶段）并计数。负例实测 2×（每次状态变化两个实例各构建一遍），
 * 正例 1×——判据有牙齿，且与 r705 的代价口径一致。
 *
 * 计数与机器快慢无关（确定性），不像耗时判据会被并行会话拖成假红。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'

/** 下游构建计数器：`applyTeamMechanics` 每次面板阶段派发一次（每个 calc 实例各一份） */
const panelPhaseCalls = { n: 0 }

vi.mock('@/composables/resourceCalc/panelPhases', async importOriginal => {
  const actual = await importOriginal<typeof import('@/composables/resourceCalc/panelPhases')>()
  return {
    ...actual,
    // 只包 `applyTeamMechanics`（下游面板阶段的派发口）：它每次求值被调用一次，
    // 且**每个 calc 实例各调各的** ⇒ 计数直接反映「下游管线跑了几遍」
    applyTeamMechanics: (...args: Parameters<typeof actual.applyTeamMechanics>) => {
      panelPhaseCalls.n += 1
      return actual.applyTeamMechanics(...args)
    },
  }
})

const { useResourceCalc } = await import('@/composables/useResourceCalc')
const { applyTeamToStore } = await import('@/composables/teamCompare')
const { teamPresets } = await import('@/data/teamPresets')
const { TOTAL_KEY } = await import('@/composables/freeCompare/metrics')
const { useRecordRows } = await import('@/composables/recordWindow')
const { useUiStore } = await import('@/stores/ui')

/** 一屏读数：团队指标 + 分人指标（覆盖 `scope: 'perSlot'` 与向量分量两条路径） */
const PICKS = [
  { metricId: 'teamTotalDamage', slot: TOTAL_KEY },
  { metricId: 'dmgPerSecond', slot: TOTAL_KEY },
  { metricId: 'stunCount', slot: TOTAL_KEY },
  { metricId: 'frontlineTime', slot: '1521' },
  { metricId: 'dmgBySlot', slot: TOTAL_KEY },
]

beforeEach(() => { newPinia(); mockStaticFetch() })
afterEach(() => { vi.clearAllMocks() })

/**
 * 一次配置改动（换机制参数 → 读 → 改回）触发下游面板阶段构建的次数。
 * @param mode `'page-only'` = 小窗关（只有页面实例）；`'shared'` = 小窗开且读页面实例（本仓的正确形态）；
 *             `'separate'` = **负例**：小窗自建第二个实例（r705 的形态，判据必须能区分它）
 */
async function measure(mode: 'page-only' | 'shared' | 'separate'): Promise<{ panelPhases: number; rows: number }> {
  newPinia()
  mockStaticFetch()
  const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
  await catalog.loadBuildRecommendations()
  applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
  config.timeWeightStrategy = 'static'
  const ui = useUiStore()

  // 页面实例（唯一求值入口）
  const pageCalc = useResourceCalc()
  void pageCalc.teamTotalDamage.value

  const scope = effectScope(true)
  // 小窗读数（`null` = 小窗关）
  let readRows: (() => number) | null = null
  if (mode !== 'page-only') {
    ui.recordWindowOpen = true
    // 负例：小窗自建第二个实例（**这正是被禁止的写法**，此处只为给判据做对照）
    const windowCalc = mode === 'separate' ? useResourceCalc() : pageCalc
    let read: () => number = () => 0
    scope.run(() => {
      const api = useRecordRows(() => windowCalc, () => ({ hp: config.enemy.hp }), () => PICKS)
      read = () => api.rows.value.length
    })
    read()
    readRows = read
  }

  // 一次配置改动：改机制参数 → 读 → 改回（搜索型调用方的典型形态）
  const before = panelPhaseCalls.n
  config.setMechanicSetting('time.stunPlanProjection', 3)
  readRows?.()
  void pageCalc.teamTotalDamage.value
  config.setMechanicSetting('time.stunPlanProjection', 2)
  readRows?.()
  void pageCalc.teamTotalDamage.value
  const panelPhases = panelPhaseCalls.n - before
  const rows = readRows ? readRows() : 0
  scope.stop()
  return { panelPhases, rows }
}

describe('A4：小窗不引入额外管线求值', () => {
  it('小窗开（读页面实例）与关：下游面板阶段构建次数逐位相同', async () => {
    const off = await measure('page-only')
    const on = await measure('shared')
    expect(on.panelPhases).toBe(off.panelPhases)
    // 反空洞：本次改动确实触发了求值（两边都是 0 的话这条判据什么也没测到）
    expect(off.panelPhases).toBeGreaterThan(0)
    // 小窗确实读满了读数（不是「没挂上所以没差别」）
    expect(on.rows).toBe(PICKS.length)
  }, 300_000)

  it('★ 判据有牙齿：负例（小窗自建第二实例）必须被这条判据区分出来', async () => {
    const off = await measure('page-only')
    const bad = await measure('separate')
    // r705 的形态：第二个实例的下游各算一份 ⇒ 计数翻倍。若这条不成立，上面那条判据是空的。
    expect(bad.panelPhases).toBeGreaterThan(off.panelPhases)
  }, 300_000)

  it('小窗挂载本身不触发求值（挂载前后下游构建次数不变）', async () => {
    newPinia()
    mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
    config.timeWeightStrategy = 'static'
    const ui = useUiStore()
    const calc = useResourceCalc()
    void calc.teamTotalDamage.value

    const before = panelPhaseCalls.n
    ui.recordWindowOpen = true
    const scope = effectScope(true)
    scope.run(() => {
      const api = useRecordRows(() => calc, () => ({ hp: config.enemy.hp }), () => PICKS)
      expect(api.rows.value.length).toBe(PICKS.length)
    })
    const after = panelPhaseCalls.n
    scope.stop()
    // 读数全部走记忆化命中 ⇒ 零额外构建（小窗是纯读方，不是第二个计算入口）
    expect(after - before).toBe(0)
  }, 300_000)

  it('小窗跨页签常驻：切页签/拖动/收起不触发求值（界面态不进 calcOutput 记忆化键）', async () => {
    newPinia()
    mockStaticFetch()
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1521-1481-1311')!)
    config.timeWeightStrategy = 'static'
    const ui = useUiStore()
    const calc = useResourceCalc()
    void calc.teamTotalDamage.value

    const before = panelPhaseCalls.n
    for (const tab of ['attribute', 'resource', 'result', 'team']) ui.activeTab = tab
    ui.recordWindowCollapsed = true
    ui.recordWindowPos = { x: 0.5, y: 0.5 }
    void calc.teamTotalDamage.value
    expect(panelPhaseCalls.n - before).toBe(0)
  }, 300_000)
})
