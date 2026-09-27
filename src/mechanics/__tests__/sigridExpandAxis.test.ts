/**
 * CC-43f：希格莉德破阵伪块展开钩子 `expandAxisAction`（原在 roundInputs.ts 内联）。
 * 锁：伪块 → 三段真实 id、C6 时长 ×0.75、免费、非本伪块返回 undefined（交还通用路径）、模块已挂钩子。
 */
import { describe, expect, it } from 'vitest'
import { expandSigridAxisAction, sigridMechanic, SIGRID_LANCE_SEGMENT_IDS, SIGRID_POZHEN_MOVE_ID } from '@/mechanics/agents/sigrid'

const times: Record<string, number> = { '1591007': 1, '1591008': 2, '1591022': 4 }
const base = { slot: 2, moveId: SIGRID_POZHEN_MOVE_ID, count: 3, startTime: 1.5, cinemaLevel: 0, actionTimeOf: (id: string) => times[id] ?? 0 }

describe('CC-43f 希格莉德 expandAxisAction', () => {
  it('C0：展开成三段真实 id，时长取技能表、免费、沿用 slot/count/startTime', () => {
    const out = expandSigridAxisAction(base)!
    expect(out.map(a => a.moveId)).toEqual([...SIGRID_LANCE_SEGMENT_IDS])
    expect(out.map(a => a.actionTime)).toEqual([1, 2, 4])
    for (const a of out) {
      expect(a).toMatchObject({ slot: 2, count: 3, startTime: 1.5, energyCost: 0, decibelCost: 0 })
    }
  })
  it('C6：时长 ×0.75', () => {
    expect(expandSigridAxisAction({ ...base, cinemaLevel: 6 })!.map(a => a.actionTime)).toEqual([0.75, 1.5, 3])
  })
  it('非破阵伪块：返回 undefined（走通用路径）', () => {
    expect(expandSigridAxisAction({ ...base, moveId: '1591015' })).toBeUndefined()
  })
  it('模块已挂钩子（编排层按 agentId 派发的前提）', () => {
    expect(sigridMechanic.expandAxisAction).toBe(expandSigridAxisAction)
  })
})
