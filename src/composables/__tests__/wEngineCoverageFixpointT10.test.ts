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
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useResourceCalc, getCalcOutputMemoStats } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { stackEnergyEvents, stackDurationSeconds, stacksToCoverage } from '@/data/wEngineStackCoverage'

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
