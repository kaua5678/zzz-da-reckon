/**
 * CC-193（lead 2026-09-28）：汇总平A行携带基准段 `benchmarkMoveId`，模块经 `execMatchesMove` 按普攻段匹配。
 * 背景（第 216 轮 moveId 普查）：普攻恒为一条 moveId = 'basic_attack' 的汇总行，模块 `SET.has(exec.moveId)`
 * 永远碰不到普攻段 ⇒ 安东打桩 +24% / C6、振斗耗血暴伤 +50% 在生产路径恒不生效；单测手工构造行，一直是绿的。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { execMatchesMove } from '@/types/resource'
import { useCatalogStore } from '@/stores/catalog'
import { getBasicComboMoves } from '@/composables/resourceCalc/skillRows'

type Row = { moveId: string; benchmarkMoveId?: string; dmgBonus?: number; critDmgBonus?: number; damageMultiplier?: number }
const basicRow = (slot: number): Row | undefined => {
  const ch = (useResourceCalc().resourceResult.value?.characters ?? []).find(c => c.slot === slot) as unknown as { executions?: Row[] } | undefined
  return ch?.executions?.find(e => e.moveId === 'basic_attack')
}

describe('CC-193 execMatchesMove', () => {
  const ids = new Set(['1111008'])
  it('普通行按 moveId；汇总平A行按基准段；无基准段不命中', () => {
    expect(execMatchesMove({ moveId: '1111008' }, ids)).toBe(true)
    expect(execMatchesMove({ moveId: 'basic_attack', benchmarkMoveId: '1111008' }, ids)).toBe(true)
    expect(execMatchesMove({ moveId: 'basic_attack', benchmarkMoveId: '1111003' }, ids)).toBe(false)
    expect(execMatchesMove({ moveId: 'basic_attack' }, ids)).toBe(false)
    // 只有汇总平A行才借基准段：别的行即使带了该字段也不借
    expect(execMatchesMove({ moveId: '1111011', benchmarkMoveId: '1111008' }, ids)).toBe(false)
  })
})

describe('CC-193 生产路径：汇总平A行命中模块普攻段', () => {
  it('安东：用户 2026-08 裁决爆发状态不建模 ⇒ 基准段保持常态 #3，打桩集合不命中平A行（裁决反锁）', async () => {
    // 见 docs/MECHANICS_IMPLEMENTATION.md 安东段「已知缺口」与 cinemaAxisBatchA.test.ts 边界反锁；
    // 若日后裁决改为建模：catalog 配 basicBenchmarkMoveId = 1111008 即可（execMatchesMove 已接好），同时改本条与反锁测试。
    await setupHarness(['1111', '1181', '1191'].map(agentId => ({ agentId })), { recommendedBuild: true })
    useConfigStore().setActionCount(0, 'basicAttackTimeWeight', 3)
    const row = basicRow(0)
    expect(row?.benchmarkMoveId).toBe('1111003')
    expect(row?.dmgBonus ?? 0).toBe(0)
  }, 60000)

  it('振斗：基准段 = 炽风·胧切 #1，耗血暴伤 +50% 落到平A行', async () => {
    await setupHarness(['1441', '1181', '1191'].map(agentId => ({ agentId })), { recommendedBuild: true })
    useConfigStore().setActionCount(0, 'basicAttackTimeWeight', 3)
    const row = basicRow(0)
    expect(row?.benchmarkMoveId).toBe('1441009')
    expect(row?.critDmgBonus ?? 0).toBeGreaterThanOrEqual(50)
  }, 60000)

  it('赛维里安 / 菲欧妮：普攻段名不带 #N 时数据配置仍生效，汇总平A行有倍率（修复前恒无倍率 ⇒ 普攻伤害 0）', async () => {
    for (const [aid, bench] of [['1631', '1631003'], ['1641', '1641003']] as const) {
      await setupHarness([aid, '1181', '1311'].map(agentId => ({ agentId })), { recommendedBuild: true })
      useConfigStore().setActionCount(0, 'basicAttackTimeWeight', 3)
      const row = basicRow(0)
      expect(row?.benchmarkMoveId, aid).toBe(bench)
      expect(row?.damageMultiplier ?? 0, aid).toBeGreaterThan(0)
    }
  }, 60000)

  it('赛维里安 C1：普攻暴伤 +60% 落到平A行', async () => {
    await setupHarness(['1631', '1181', '1311'].map(agentId => ({ agentId })), { recommendedBuild: true })
    const config = useConfigStore()
    config.setActionCount(0, 'basicAttackTimeWeight', 3)
    config.setCinemaLevel(0, 1)
    expect(basicRow(0)?.critDmgBonus ?? 0).toBeGreaterThanOrEqual(60)
  }, 60000)
})

describe('CC-193 结构守卫：每个角色都能解析普攻基准段', () => {
  it('catalog 全部角色 getBasicComboMoves 非空（否则汇总平A行无倍率、普攻伤害恒 0）', async () => {
    await setupHarness(['', '', ''], { recommendedBuild: false })
    const catalog = useCatalogStore()
    const agents = [...catalog.agentsMap.values()]
    const missing = agents
      .filter(a => catalog.getAgentSkills(a.id))
      .filter(a => !getBasicComboMoves(catalog.getAgentSkills(a.id), a.id, catalog))
      .map(a => a.id)
    expect(agents.length).toBeGreaterThan(50)
    expect(missing).toEqual([])
  }, 60000)
})
