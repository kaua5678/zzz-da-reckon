/**
 * 主词条边际效用（composables/mainStatMarginal，CC-346）判据：
 * ① 隔离：跑完（与每个候选读数期间）UI config store 的 $state 逐字不变；
 * ② 单项替换：每行 = 在 UI store 的**原配装**上只把该位置换成该词条、等一拍后读到的总伤；
 * ③ 反证：旧实现的「候选之间不还原」（累积替换）在第一组之后给出不同的数——锁住这次口径修正的理由；
 * ④ 取消 ⇒ complete=false，rows 为已算部分。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { computeMainStatMarginals, mainStatCandidates } from '@/composables/mainStatMarginal'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function source() {
  const h = await setupHarness([{ agentId: '1171' }, { agentId: '1021' }, { agentId: '1131' }], { recommendedBuild: true })
  await tick()
  return h
}

describe('主词条边际效用（独立场景）', () => {
  it('① 不改写 UI store；② 每行 = 原配装上的单项替换', async () => {
    const { config } = await source()
    const before = JSON.stringify(config.$state)
    const res = await withAnalysisScenario(s => computeMainStatMarginals(s))
    expect(JSON.stringify(config.$state)).toBe(before)
    expect(res.complete).toBe(true)
    expect(res.rows.length).toBe(mainStatCandidates(config).length)
    expect(res.rows.length).toBeGreaterThan(6)
    const calc = useResourceCalc()
    await tick()
    expect(calc.teamTotalDamage.value).toBe(res.baseDamage)
    for (const row of res.rows) {
      const mainStats = config.team[row.slot]!.driveDisc.mainStats as Record<number, string | undefined>
      const original = mainStats[row.slotNum]
      mainStats[row.slotNum] = row.statId
      await tick()
      expect(calc.teamTotalDamage.value, row.label).toBe(row.damage)
      mainStats[row.slotNum] = original
    }
    await tick()
    expect(JSON.stringify(config.$state)).toBe(before)
  }, 120000)

  it('③ 反证：累积替换（旧实现）在第一组之后与单项替换不同', async () => {
    const { config } = await source()
    const res = await withAnalysisScenario(s => computeMainStatMarginals(s))
    const calc = useResourceCalc()
    const cumulative: number[] = []
    for (const c of mainStatCandidates(config)) {
      (config.team[c.slot]!.driveDisc.mainStats as Record<number, string>)[c.slotNum] = c.statId
      await tick()
      cumulative.push(calc.teamTotalDamage.value)
    }
    const firstGroup = res.rows.filter(r => r.slot === res.rows[0]!.slot && r.slotNum === res.rows[0]!.slotNum).length
    expect(cumulative.slice(0, firstGroup)).toEqual(res.rows.slice(0, firstGroup).map(r => r.damage))
    expect(cumulative.slice(firstGroup)).not.toEqual(res.rows.slice(firstGroup).map(r => r.damage))
  }, 120000)

  it('④ 取消 ⇒ 已算部分', async () => {
    await source()
    const ac = new AbortController()
    ac.abort()
    const res = await withAnalysisScenario(s => computeMainStatMarginals(s, { control: { signal: ac.signal } }))
    expect(res.complete).toBe(false)
    expect(res.rows).toEqual([])
  }, 60000)
})
