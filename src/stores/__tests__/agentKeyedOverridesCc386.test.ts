/**
 * CC-386 锁：随角色的用户覆盖（资源利用率 / 异常积蓄利用率 / 异常结算份额）键 = agentId，不是槽位。
 *
 * 修前三张表按槽位存（`anomalyUtilizationRates[slot]`、`"元素:槽位"`、`"槽位:动作ID"`），
 * 引擎按槽位直读；`setAgent` 换人不清 ⇒ 上一个角色的覆盖原样作用到新角色（实测：槽 0 设 0.3 后换人，
 * 新角色积蓄仍 ×0.3）。正确性只靠「每条换人路径都记得清表」的同步保证——预设 / 独立场景直写 team 时无人清。
 * 修法：store 内唯一的键构造点按 `team[slot].agentId` 取键 ⇒ 换人后旧键天然读不到；换回 / 挪槽时设置跟着角色走。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const TEAM = [
  { agentId: '1211', cinemaLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  { agentId: '1181', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  { agentId: '1031', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
]

async function setup(team = TEAM) {
  const result = await setupHarness(team.map(m => ({ ...m })))
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

const tick = () => new Promise(r => setTimeout(r, 50))

function slotBuildUp(calc: ReturnType<typeof useResourceCalc>, slot: number): number {
  const ap = (calc as unknown as { anomalyPoolResult?: { value?: { perElement: { contributions: { slot: number, totalBuildUp: number }[] }[] } } })
    .anomalyPoolResult?.value
  let sum = 0
  for (const p of ap?.perElement ?? []) for (const c of p.contributions) if (c.slot === slot) sum += c.totalBuildUp
  return sum
}

describe('CC-386 随角色的用户覆盖按 agentId 存', () => {
  it('store：换人后三张表对新角色回到默认；换回原角色设置恢复', async () => {
    const { config } = await setup()
    config.setAnomalyUtilizationRate(0, 0.3)
    config.setAnomalySettlementShare('electric', 0, 0.2)
    config.setResourceUtilization(0, 'act', { rate: 0.4, cap: 5 })
    expect(config.getAnomalyUtilizationRate(0)).toBeCloseTo(0.3)

    config.setAgent(0, '1311')
    expect(config.getAnomalyUtilizationRate(0)).toBe(1)
    expect(config.getAnomalySettlementShare('electric', 0)).toBeNull()
    expect(config.getResourceUtilization(0, 'act')).toEqual({ rate: 1, cap: null })
    expect(config.resourceUtilizationOf(0)).toEqual({})

    config.setAgent(0, '1211')
    expect(config.getAnomalyUtilizationRate(0)).toBeCloseTo(0.3)
    expect(config.getAnomalySettlementShare('electric', 0)).toBeCloseTo(0.2)
    expect(config.resourceUtilizationOf(0)).toEqual({ act: { rate: 0.4, cap: 5 } })
  })

  it('store：重置本角色只清该角色，不误伤别的槽', async () => {
    const { config } = await setup()
    config.setResourceUtilization(0, 'a', { rate: 0.5 })
    config.setResourceUtilization(1, 'a', { rate: 0.6 })
    config.resetResourceUtilization(0)
    expect(config.resourceUtilizationOf(0)).toEqual({})
    expect(config.resourceUtilizationOf(1)).toEqual({ a: { rate: 0.6, cap: null } })
  })

  it('store：空槽读默认、写入无效', async () => {
    const { config } = await setup()
    config.team[2].agentId = ''
    config.setAnomalyUtilizationRate(2, 0.1)
    config.setResourceUtilization(2, 'a', { rate: 0.1 })
    expect(config.getAnomalyUtilizationRate(2)).toBe(1)
    expect(config.resourceUtilizationOf(2)).toEqual({})
    expect(Object.keys(config.anomalyUtilizationRates)).toEqual([])
  })

  it('引擎：资源利用率覆盖经 resourceUtilizationOf 生效（丽娜 EX cap=1 ⇒ 次数 ≤ 1）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    await tick()
    const exCount = () => calc.resourceResult.value!.characters.find(c => c.agentId === '1211')!
      .executions.filter(e => e.moveId === '1211009').reduce((s, e) => s + e.count, 0)
    expect(exCount()).toBeGreaterThan(1)
    config.setResourceUtilization(0, '1211009', { cap: 1 })
    await tick()
    expect(exCount()).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('引擎：槽 0 设异常利用率 0.3 后换人，新角色积蓄 = 显式设 1 时的值（修前仍 ×0.3）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    await tick()
    config.setAnomalyUtilizationRate(0, 0.3)
    config.setAgent(0, '1311')
    await tick()
    const afterSwap = slotBuildUp(calc, 0)
    config.setAnomalyUtilizationRate(0, 1)
    await tick()
    const explicitFull = slotBuildUp(calc, 0)
    expect(explicitFull).toBeGreaterThan(0)
    expect(afterSwap).toBeCloseTo(explicitFull, 3)
  })
})

/**
 * CC-388 锁：合轴率覆盖同属「随角色的用户覆盖」，键 = agentId。
 * 修前按「槽位 → moveId」存；招式 id 跨角色共用（`basic_attack` 52 人、`evade_assist` 4 人，r414 探针）
 * ⇒ 槽 0 给 A 的普攻设合轴率，换成 B 后 B 的普攻直接继承。
 */
describe('CC-388 合轴率覆盖按 agentId 存', () => {
  it('换人后共用招式 id 的覆盖对新角色回到默认；换回恢复', async () => {
    const { config } = await setup()
    config.setComboAlignOverride(0, 'basic_attack', 0.7)
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBeCloseTo(0.7)
    config.setAgent(0, '1311')
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBe(-1)
    config.setAgent(0, '1211')
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBeCloseTo(0.7)
  })

  it('整表快照 / 还原往返不丢值（难度天梯试开回滚走这对接口，不按键形态自己拼）', async () => {
    const { config } = await setup()
    config.setComboAlignOverride(0, 'basic_attack', 0.4)
    config.setComboAlignOverride(1, 'evade_assist', 0.6)
    const snap = config.getComboAlignState()
    config.clearComboAlignOverrides(0)
    config.setComboAlignOverride(1, 'evade_assist', 0.1)
    config.setComboAlignState(snap)
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBeCloseTo(0.4)
    expect(config.getComboAlignOverride(1, 'evade_assist', -1)).toBeCloseTo(0.6)
    // 快照是拷贝：还原后再改不回写快照
    config.setComboAlignOverride(0, 'basic_attack', 0.9)
    config.setComboAlignState(snap)
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBeCloseTo(0.4)
  })

  it('空槽读默认、写无效', async () => {
    const { config } = await setup()
    config.team[2].agentId = ''
    config.setComboAlignOverride(2, 'basic_attack', 0.5)
    expect(config.getComboAlignOverride(2, 'basic_attack', -1)).toBe(-1)
    expect(Object.keys(config.comboAlignOverrides)).toEqual([])
  })
})
