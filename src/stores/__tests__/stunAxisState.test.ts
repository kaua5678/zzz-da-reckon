/**
 * 失衡轴状态唯一读写入口（config store：getAxisState / setAxisState / applyStunAxisPreset，arena-D 第 368 轮）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { stunAxisPresets } from '@/data/stunAxisPresets'
import type { StunAxis, StunAxisPlan } from '@/types/resource'

const AXIS: StunAxis = { name: '轴A', actions: [{ slot: 0, moveId: '1191011', count: 1 }] } as StunAxis
const PLAN = { when: [], axes: [AXIS] } as unknown as StunAxisPlan

describe('config store 轴状态', () => {
  it('getAxisState / setAxisState 深拷贝：同一份快照可反复恢复，store 编辑不改快照', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    config.setAxisState({ stunAxes: [AXIS], stunAxisPlans: [], useStunAxis: true })
    const snap = config.getAxisState()
    config.stunAxes[0].name = '改过'
    expect(snap.stunAxes[0].name).toBe('轴A')
    config.setAxisState(snap)
    config.stunAxes[0].name = '再改'
    expect(snap.stunAxes[0].name).toBe('轴A')
    config.setAxisState(snap)
    expect(config.stunAxes[0].name).toBe('轴A')
    expect(config.useStunAxis).toBe(true)
    expect(AXIS.name).toBe('轴A')
  })

  it('applyStunAxisPreset：方案与固定轴互斥写入、打开总开关；两者皆空不改动', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    config.setAxisState({ stunAxes: [AXIS], stunAxisPlans: [], useStunAxis: false })
    expect(config.applyStunAxisPreset({ plans: [PLAN], axes: [AXIS] })).toBe(true)
    expect(config.stunAxisPlans.length).toBe(1)
    expect(config.stunAxes.length).toBe(0)
    expect(config.useStunAxis).toBe(true)
    expect(config.applyStunAxisPreset({ axes: [AXIS] })).toBe(true)
    expect(config.stunAxisPlans.length).toBe(0)
    expect(config.stunAxes.length).toBe(1)
    const before = JSON.stringify(config.getAxisState())
    config.useStunAxis = false
    expect(config.applyStunAxisPreset({ axes: [], plans: [] })).toBe(false)
    expect(config.useStunAxis).toBe(false)
    expect(JSON.stringify(config.stunAxes)).toBe(JSON.stringify(JSON.parse(before).stunAxes))
  })

  it('内置轴预设全部非空（applyStunAxisPreset 的「皆空」分支对内置数据不可达）', () => {
    const empty = stunAxisPresets.filter(p => !(p.plans?.length) && !(p.axes?.length)).map(p => p.id)
    expect(empty).toEqual([])
  })
})

/**
 * 写入口的**动作规范序**（用户口径 2026-11-03）：预设 JSON 里怎么写顺序都不再影响结果——
 * store 落盘即按 `startTime` 时间序（乱序预设 `preset-1371-1391-1451` 就是实例）。
 */
describe('setAxisState 规范化动作顺序', () => {
  it('乱序轴 + 方案轴 ⇒ 落盘即时间序，且不改快照本体', async () => {
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1211' }, { agentId: '1311' }])
    const messy = { name: '轴1', actions: [
      { slot: 0, moveId: 'm0', count: 1, startTime: 0 },
      { slot: 0, moveId: 'm5', count: 1, startTime: 5 },
      { slot: 0, moveId: 'm3', count: 1, startTime: 3 },
    ] } as StunAxis
    const plan = { when: [], axes: [messy] } as unknown as StunAxisPlan
    config.setAxisState({ stunAxes: [messy], stunAxisPlans: [plan], useStunAxis: true })
    expect(config.stunAxes[0].actions.map(a => a.moveId)).toEqual(['m0', 'm3', 'm5'])
    expect(config.stunAxisPlans[0].axes![0]!.actions.map(a => a.moveId)).toEqual(['m0', 'm3', 'm5'])
    expect(messy.actions.map(a => a.moveId), '快照本体不动').toEqual(['m0', 'm5', 'm3'])
  })
})
