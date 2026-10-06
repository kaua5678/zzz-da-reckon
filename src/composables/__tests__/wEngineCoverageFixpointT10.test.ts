/**
 * T10 事实锁（arena-F r447 立，CC-420；r702 按第⑥步改写）：音擎叠层覆盖率的自动折算不再写回 state。
 *
 * r702 前：calcOutput → wEngineStackAutoCoverages ──watch──▶ configStore.wEngineEffectCoverages（state 表）
 *   ──▶ resourcePanels ──▶ calcOutput，一个绕 store 的环：`useResourceCalc()` 一创建就跑两遍整条管线，
 *   靠「执行次数不依赖面板量」才一步收敛（巧合性不动点）。
 * r702 起：state 表只存手调值；自动值由 calc 同步并入结算侧（`effectiveWEngineCoverages`），另由 watch 写进
 *   store 的**非 state** 展示缓存（不进 memo 键）供界面显示；资源侧只读手调表 ⇒ 环不存在。
 *
 * 第一个 describe 钉结构：创建 + 首读只 1 次 calcOutput miss、之后 flush 不再 miss、自动值不进 state 表但界面读得到。
 * 变成 2 次 miss = 有人又把派生值写回了 state（memo 键变 ⇒ 重算），先读 docs/mcp-wengine-coverage-timing.md §8。
 * 第二个 describe 钉 r701 的修复：同步读（队伍对比 / 难度曲线的读法）== flush 后再读。
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useResourceCalc, getCalcOutputMemoStats } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'

const EFFECT_ID = 'effect_wiki_214_self_ap' // 嵌合编译器 14118：唯一已登记折算器的叠层效果

describe('T10：自动折算不写回 state（创建只算一遍管线）', () => {
  it('格莉丝主C 带嵌合编译器：1 次 miss 后稳定，自动值只进展示缓存', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1221' }])
    config.team[0].wEngineId = '14118'
    const m0 = getCalcOutputMemoStats().misses
    const calc = useResourceCalc()
    // immediate watch 在创建时同步跑完整条管线
    expect(getCalcOutputMemoStats().misses - m0).toBe(1)
    // 首读命中 memo：展示缓存不是 state，不改 memo 键
    const rr = calc.resourceResult.value
    expect(rr).not.toBeNull()
    expect(getCalcOutputMemoStats().misses - m0).toBe(1)
    await nextTick(); await nextTick(); await nextTick()
    expect(calc.resourceResult.value).toBe(rr)
    expect(getCalcOutputMemoStats().misses - m0).toBe(1)
    // state 表只存手调值；界面读到自动折算值，与结算侧同步表一致
    expect(config.wEngineEffectCoverages[EFFECT_ID]).toBeUndefined()
    const shown = config.getWEngineEffectCoverage(EFFECT_ID)
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThan(100)
    expect(calc.effectiveWEngineCoverages.value[EFFECT_ID]).toBe(shown)
  })
})

describe('结算侧同步读不依赖展示缓存的写入时序（r701）', () => {
  it('auto-1221-1511-1211：套预设后同步读的伤害 == flush 后再读', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1221-1511-1211')!)
    const syncRead = calc.teamTotalDamage.value
    // 展示缓存尚未更新 = 分析循环（同步换队、同步读）的处境
    expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBe(100)
    await nextTick(); await nextTick(); await nextTick()
    // 自动折算确实生效（否则本例比的是两个满层值，空转）
    expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBeLessThan(100)
    expect(calc.teamTotalDamage.value).toBe(syncRead)
  })
})
