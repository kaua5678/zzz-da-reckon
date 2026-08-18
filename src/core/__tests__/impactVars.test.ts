import { describe, expect, it } from 'vitest'
import { IMPACT_VARIABLES, readImpactVar, writeImpactVar } from '@/core/impactVars'

/** 最小 configStore 桩：只实现 team + setBasicAttackTimeWeight */
function makeStore() {
  const team = [
    { slot: 0, agentId: '1471', basicAttackTimeWeight: 3 },
    { slot: 1, agentId: '1481', basicAttackTimeWeight: 2 },
    { slot: 2, agentId: '1451', basicAttackTimeWeight: 1 },
  ]
  return {
    team,
    enemy: {},
    setEnemy(patch: any) { Object.assign(this.enemy, patch) },
    setBasicAttackTimeWeight(slot: number, weight: number) {
      if (team[slot]) team[slot].basicAttackTimeWeight = Math.max(0, Math.min(99, weight))
    },
  }
}

describe('伤害影响分析变量 slot1TimeWeight（2号队友 平A战场时间占比）', () => {
  it('注册在 IMPACT_VARIABLES 中', () => {
    const v = IMPACT_VARIABLES.find(x => x.id === 'slot1TimeWeight')
    expect(v).toBeDefined()
    expect(v!.label).toContain('2号队友')
    expect(v!.defaultRange).toEqual([0, 99])
  })

  it('读取：返回 2号队友（slot1）当前 basicAttackTimeWeight', () => {
    const store = makeStore()
    expect(readImpactVar(store, 'slot1TimeWeight')).toBe(2)
  })

  it('读取：槽位为空时回退默认 1', () => {
    const store = makeStore()
    store.team[1] = { slot: 1, agentId: '', basicAttackTimeWeight: 0 } as any
    expect(readImpactVar(store, 'slot1TimeWeight')).toBe(0)
    store.team[1] = undefined as any
    expect(readImpactVar(store, 'slot1TimeWeight')).toBe(1)
  })

  it('写入：setBasicAttackTimeWeight(1, v) 生效并触发响应式链', () => {
    const store = makeStore()
    writeImpactVar(store, 'slot1TimeWeight', 50)
    expect(store.team[1].basicAttackTimeWeight).toBe(50)
    expect(readImpactVar(store, 'slot1TimeWeight')).toBe(50)
    // 越界按 store 收敛到 [0, 99]
    writeImpactVar(store, 'slot1TimeWeight', 999)
    expect(store.team[1].basicAttackTimeWeight).toBe(99)
  })
})
