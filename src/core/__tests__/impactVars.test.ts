import { describe, expect, it } from 'vitest'
import { IMPACT_VARIABLES } from '@/core/impactVars'

/** 最小 configStore 桩：team + setActionCount（平A时间权重）；enemy 按 ImpactVarConfig 给全必填字段（值同 store defaultEnemy） */
function makeStore() {
  const team = [
    { slot: 0, agentId: '1471', basicAttackTimeWeight: 3 },
    { slot: 1, agentId: '1481', basicAttackTimeWeight: 2 },
    { slot: 2, agentId: '1451', basicAttackTimeWeight: 1 },
  ]
  return {
    team,
    enemy: { stunValue: 0, invincibleTime: 0, battleTime: 180, stunVuln: 1.5, anomalyCoeff: 1, damageResistances: {} },
    setEnemy(patch: any) { Object.assign(this.enemy, patch) },
    setActionCount(slot: number, field: string, count: number) {
      if (field === 'basicAttackTimeWeight' && team[slot]) team[slot].basicAttackTimeWeight = Math.max(0, Math.min(99, count))
    },
  }
}

describe('伤害影响分析变量 slot1TimeWeight（2号队友 平A战场时间占比）', () => {
  const slot1 = IMPACT_VARIABLES.find(x => x.id === 'slot1TimeWeight')!
  it('注册在 IMPACT_VARIABLES 中', () => {
    const v = IMPACT_VARIABLES.find(x => x.id === 'slot1TimeWeight')
    expect(v).toBeDefined()
    expect(v!.label).toContain('2号队友')
    expect(v!.defaultRange).toEqual([0, 99])
  })

  it('读取：返回 2号队友（slot1）当前 basicAttackTimeWeight', () => {
    const store = makeStore()
    expect(slot1.read(store)).toBe(2)
  })

  it('写入：setActionCount(1, basicAttackTimeWeight, v) 生效并触发响应式链', () => {
    const store = makeStore()
    slot1.write(store, 50)
    expect(store.team[1].basicAttackTimeWeight).toBe(50)
    expect(slot1.read(store)).toBe(50)
    // 越界按 store 收敛到 [0, 99]
    slot1.write(store, 999)
    expect(store.team[1].basicAttackTimeWeight).toBe(99)
  })
})
