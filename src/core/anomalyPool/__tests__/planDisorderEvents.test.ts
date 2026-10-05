/**
 * CC-487（r672）：紊乱事件分配规则（均分 + 余数前置 + 触发者 = 其他元素里 triggerCount 最大者）只在
 * core/anomalyPool/helpers.ts#planDisorderEvents 写一次；calcPerSlotDisorderTriggers / calcDisorderDamage 都消费它。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { calcPerSlotDisorderTriggers, planDisorderEvents } from '@/core/anomalyPool/helpers'

const E = (element: string, triggerCount: number, applierSlot: number) => ({ element, triggerCount, applierSlot })

describe('planDisorderEvents（CC-487）', () => {
  it('两种元素：均分、余数给前者、触发者互为对方施加者', () => {
    const plan = planDisorderEvents([E('fire', 5, 0), E('ice', 3, 2)], 7)
    expect(plan).toEqual([
      { element: 'fire', applierSlot: 0, triggerSlot: 2, events: 4 },
      { element: 'ice', applierSlot: 2, triggerSlot: 0, events: 3 },
    ])
  })
  it('三种元素：触发者取其他元素里 triggerCount 最大者，并列取先出现者', () => {
    const plan = planDisorderEvents([E('fire', 2, 0), E('ice', 9, 1), E('ether', 9, 2)], 3)
    expect(plan.map(p => p.triggerSlot)).toEqual([1, 2, 1])
    expect(plan.map(p => p.events)).toEqual([1, 1, 1])
  })
  it('不足两种元素或次数 ≤ 0 ⇒ 空计划', () => {
    expect(planDisorderEvents([E('fire', 1, 0)], 5)).toEqual([])
    expect(planDisorderEvents([E('fire', 1, 0), E('ice', 1, 1)], 0)).toEqual([])
  })
  it('calcPerSlotDisorderTriggers = 计划按 triggerSlot 聚合', () => {
    expect(calcPerSlotDisorderTriggers([E('fire', 5, 0), E('ice', 3, 2)], 7, 3)).toEqual([3, 0, 4])
    expect(calcPerSlotDisorderTriggers([E('fire', 1, 0)], 7, 3)).toEqual([0, 0, 0])
  })
  it('源码锁：触发者扫描只在 planDisorderEvents 里出现一次', () => {
    const src = readFileSync('src/core/anomalyPool/helpers.ts', 'utf8')
    expect(src.match(/bestTriggerCount = -1/g)?.length).toBe(1)
    expect(src.match(/eventsPerElement = Math\.floor\(disorderCount/g)?.length).toBe(1)
    expect(src.match(/planDisorderEvents\(elements, disorderCount\)/g)?.length).toBe(2)
  })
})
