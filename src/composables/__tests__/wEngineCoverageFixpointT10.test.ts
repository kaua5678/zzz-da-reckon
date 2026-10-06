/**
 * T10 事实锁（arena-F r447 立，CC-420；r702 按第⑥步改写；r706 删展示缓存后再改写）：音擎叠层覆盖率的自动折算不写回 store。
 *
 * r702 前：calcOutput → wEngineStackAutoCoverages ──watch──▶ configStore.wEngineEffectCoverages（state 表）
 *   ──▶ resourcePanels ──▶ calcOutput，一个绕 store 的环：`useResourceCalc()` 一创建就跑两遍整条管线，
 *   靠「执行次数不依赖面板量」才一步收敛（巧合性不动点）。
 * r702–r705：state 表只存手调值；自动值由 calc 同步并入（`effectiveWEngineCoverages`），另由 immediate watch 写进
 *   store 的非 state 展示缓存 ⇒ 每个实例创建即算、此后每次状态变化都算（不论有没有人读）。
 * r706 起：展示缓存与 watch 删除，界面读所在页面 calc 的 `effectiveWEngineCoverages` ⇒ calc 不写 store，实例纯惰性。
 *
 * 第一个 describe 钉结构：创建 0 次 miss（惰性）、首读 1 次、flush 后不再 miss、自动值不进 state 表。
 * 创建就 miss = 有人又给实例加了主动求值（watch / immediate）；flush 后多 miss = 有人又把派生值写回了 state
 * （memo 键变 ⇒ 重算）。先读 docs/mcp-wengine-coverage-timing.md 末节（r706）。
 * 第二个 describe 钉 r701 的修复：同步读（队伍对比 / 难度曲线的读法）== flush 后再读。
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useResourceCalc, getCalcOutputMemoStats } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'

const EFFECT_ID = 'effect_wiki_214_self_ap' // 嵌合编译器 14118：唯一已登记折算器的叠层效果

describe('T10：自动折算不写回 store（实例惰性，一次读只算一遍管线）', () => {
  it('格莉丝主C 带嵌合编译器：创建不算、首读 1 次 miss 后稳定，自动值不进 state 表', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1221' }])
    config.team[0].wEngineId = '14118'
    const m0 = getCalcOutputMemoStats().misses
    const calc = useResourceCalc()
    expect(getCalcOutputMemoStats().misses - m0).toBe(0)
    const rr = calc.resourceResult.value
    expect(rr).not.toBeNull()
    expect(getCalcOutputMemoStats().misses - m0).toBe(1)
    await nextTick(); await nextTick(); await nextTick()
    expect(calc.resourceResult.value).toBe(rr)
    expect(getCalcOutputMemoStats().misses - m0).toBe(1)
    // state 表只存手调值；自动折算值只在 calc 的有效表里
    expect(config.wEngineEffectCoverages[EFFECT_ID]).toBeUndefined()
    const effective = calc.effectiveWEngineCoverages.value[EFFECT_ID]
    expect(effective).toBeGreaterThan(0)
    expect(effective).toBeLessThan(100)
  })
})

describe('结算侧同步读不依赖任何写回时序（r701）', () => {
  it('auto-1221-1511-1211：套预设后同步读的伤害 == flush 后再读', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1221-1511-1211')!)
    const syncRead = calc.teamTotalDamage.value
    // 自动折算在同步读里就已生效（否则本例比的是两个满层值，空转）
    expect(calc.effectiveWEngineCoverages.value[EFFECT_ID]).toBeLessThan(100)
    await nextTick(); await nextTick(); await nextTick()
    expect(calc.teamTotalDamage.value).toBe(syncRead)
  })
})
