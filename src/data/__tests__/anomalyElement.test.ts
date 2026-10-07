/**
 * CC-223：元素限定异常积蓄效率单一来源（src/data/anomalyElement.ts）。
 * 结构锁：面板上每个 `<元素>AnomalyBuildUpEfficiency` 字段都必须被 elementAnomalyBuildUpEfficiency 读到——
 * 新增元素字段而忘改函数 ⇒ 引擎积蓄与 StatPanel 展示同时漏读，本测试变红。
 */
import { describe, it, expect } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { elementAnomalyBuildUpEfficiency, getBaseElement } from '@/data/anomalyElement'
import * as helpers from '@/core/anomalyPool/helpers'

describe('元素限定异常积蓄效率（CC-223）', () => {
  const fields = Object.keys(emptyPanel()).filter(k => /^[a-z]+AnomalyBuildUpEfficiency$/.test(k))
  it('面板上的元素积蓄效率字段全部被读到', () => {
    expect(fields.length).toBeGreaterThanOrEqual(3)
    for (const f of fields) {
      const element = f.replace('AnomalyBuildUpEfficiency', '')
      const p = emptyPanel() as unknown as Record<string, number>
      p[f] = 17
      expect(elementAnomalyBuildUpEfficiency(p as never, element), f).toBe(17)
    }
  })
  it('变种元素按基础元素读取；无字段元素为 0', () => {
    const p = emptyPanel()
    p.physicalAnomalyBuildUpEfficiency = 25
    p.etherAnomalyBuildUpEfficiency = 9
    expect(elementAnomalyBuildUpEfficiency(p, 'physical_polar_assault')).toBe(25)
    expect(elementAnomalyBuildUpEfficiency(p, 'ether_ink')).toBe(9)
    expect(elementAnomalyBuildUpEfficiency(p, 'fire')).toBe(0)
    expect(getBaseElement('ether_ink')).toBe('ether')
  })
  it('core helpers 转出的是同一对象（不是副本）', () => {
    expect(helpers.getBaseElement).toBe(getBaseElement)
  })
})
