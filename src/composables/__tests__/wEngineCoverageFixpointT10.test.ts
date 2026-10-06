/**
 * T10 事实锁（arena-F r447，CC-420）：音擎叠层覆盖率自动回填的「隐藏不动点」。
 *
 * 数据流（实测，不是注释里写的那样）：
 *   calcOutput → adjustedResourceResult → wEngineStackAutoCoverages ──watch──▶ configStore.wEngineEffectCoverages
 *        ▲                                                                              │
 *        └── runCalcRound(deps.panels) ← panels ← computePanel → resolveSlotPanelBuffInputs ◀┘
 * 即资源迭代**经 panels 间接读**了回填值（`useResourceCalc.ts` 该段旧注释「资源迭代不读 wEngineEffectCoverages」
 * 只在直接读的意义上成立）。于是 `useResourceCalc()` 一创建就跑两遍整条管线：
 *   pass 1：immediate watch 用 store 默认覆盖（100）算一遍 ⇒ 回填值写 store；
 *   pass 2：store 变 ⇒ panels 失效 ⇒ 第一次读 resourceResult 时整条重算。
 * 它**不会**跑第三遍，是因为回填值只改面板数值（精通/攻击），而执行行次数 / 强特次数不依赖这些面板量
 * ⇒ pass 2 算出的回填值 == pass 1 的，store 写同值不触发。**这是一个靠「当前没有角色让面板量影响次数」
 * 成立的巧合性不动点**，不是结构保证。
 *
 * 本锁钉住三件事（任一变红 = 隐藏不动点被打破或结构已变，去读 docs/mcp-worker-task-queue.md §3 T10 卡再动）：
 *   ① 创建 + 首读恰好 2 次 calcOutput miss（多了 = 出现第三遍 / 震荡；少了 = 有人改了数据流，T10 卡要同步改）；
 *   ② 之后 nextTick 不再产生 miss（不动点一步到达）；
 *   ③ 用 pass 2 的资源结果重新折算的回填值 == store 里的值（一步不动点的直接表达）。
 *
 * r701 起结算侧不再经 store 读回填值：`panels`（伤害 / 异常 / 进场快照）用「store 表 ⊕ 本次资源结果的自动折算」
 * 同步求值，只有资源侧 `resourcePanels` 仍读 store 表 ⇒ 上面的环与两遍管线还在（①–③ 不变），但伤害不再取决于
 * flush:'post' 回填是否已跑。第二个 describe 钉的就是这件事：修前同步读（队伍对比 / 难度曲线的读法）按满层 100 算，
 * 7 支带嵌合编译器的预设比回填后高 1.8–5.8%。
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useResourceCalc, getCalcOutputMemoStats } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { stackEnergyEvents, stackDurationSeconds, stacksToCoverage } from '@/data/wEngineStackCoverage'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'

const EFFECT_ID = 'effect_wiki_214_self_ap' // 嵌合编译器 14118：唯一已登记折算器的叠层效果

const TEAMS: Array<Array<{ agentId: string; cinemaLevel?: number }>> = [
  [{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1221' }],                 // 格莉丝主C（与异常队友分平A池）
  [{ agentId: '1221', cinemaLevel: 6 }, { agentId: '1411' }, { agentId: '1211' }], // 柳 C6 追加戳
  [{ agentId: '1171' }, { agentId: '1561' }, { agentId: '1181' }],                 // 柏妮思双喷
]

describe('T10 事实锁：叠层覆盖率回填是一步到达的隐藏不动点（创建即两遍管线）', () => {
  for (const team of TEAMS) {
    it(`${team.map(t => t.agentId).join('-')}：2 次 miss 后稳定，pass 2 重折算 == store`, async () => {
      const { config } = await setupHarness(team)
      config.team[0].wEngineId = '14118'
      const m0 = getCalcOutputMemoStats().misses
      const calc = useResourceCalc()
      // pass 1：immediate watch 在创建时同步跑完整条管线
      expect(getCalcOutputMemoStats().misses - m0).toBe(1)
      const stored = config.getWEngineEffectCoverage(EFFECT_ID)
      expect(stored).toBeGreaterThan(0)
      expect(stored).toBeLessThan(100)
      // pass 2：store 已变 ⇒ panels 失效 ⇒ 首读重算
      const rr = calc.resourceResult.value
      expect(rr).not.toBeNull()
      expect(getCalcOutputMemoStats().misses - m0).toBe(2)
      // 不动点一步到达：后续 flush 不再触发第三遍
      await nextTick(); await nextTick(); await nextTick()
      expect(calc.resourceResult.value).toBe(rr)
      expect(getCalcOutputMemoStats().misses - m0).toBe(2)
      expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBe(stored)
      // 用 pass 2 的结果重折算 == store（与 useResourceCalc#wEngineStackAutoCoverages 同一公式）
      const catalog = useCatalogStore()
      const ch = rr!.characters.find(c => c.slot === 0)!
      const wEngine = catalog.wEnginesMap.get('14118')
      const eff = (wEngine?.effect?.selfBuff?.effects ?? []).find(e => e.id === EFFECT_ID)!
      const stacks = stackEnergyEvents(EFFECT_ID, { agentId: ch.agentId ?? team[0].agentId, exSpecialCount: ch.exSpecialCount ?? 0, executions: ch.executions ?? [] })
      const cov = stacksToCoverage(stacks!, stackDurationSeconds(EFFECT_ID)!, effectiveBattleTime(config.enemy), eff.maxStacks ?? eff.defaultStacks ?? 1)
      expect(cov).toBeCloseTo(stored, 9)
    })
  }
})

describe('结算侧同步读不依赖回填时序（r701）', () => {
  it('auto-1221-1511-1211：套预设后同步读的伤害 == 回填落 store 后再读', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    applyTeamToStore(config, teamPresets.find(p => p.id === 'auto-1221-1511-1211')!)
    const syncRead = calc.teamTotalDamage.value
    // 回填尚未落 store = 分析循环（同步换队、同步读）的处境
    expect(config.wEngineEffectCoverages[EFFECT_ID]).toBeUndefined()
    await nextTick(); await nextTick(); await nextTick()
    // 自动折算确实生效（否则本例比的是两个满层值，空转）
    expect(config.getWEngineEffectCoverage(EFFECT_ID)).toBeLessThan(100)
    expect(calc.teamTotalDamage.value).toBe(syncRead)
  })
})
