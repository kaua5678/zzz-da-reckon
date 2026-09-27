/**
 * CC-71：core/anomalyPool.ts 两条维琳娜风蚀气旋异放事件 → 模块能力 anomalyCorrosionEvents。
 * 对照 = 原 core 写死对象（逐字复刻）；集成面由既有 core/__tests__/anomalyPool.test.ts（withVelina / withoutVelina）承担。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import { resolveAnomalyCorrosionEvents } from '@/core/anomalyPool/corrosion'
import type { CorrosionSource } from '@/types/resource'

function legacy(src: CorrosionSource | undefined) {
  return [
    {
      id: 'velina-corrosion-condensed-cyclone',
      type: 'release',
      label: '维琳娜微域气旋风异放',
      source: '0或1个风蚀时，触发乱流获得1点风蚀并触发 Condensed Cyclone',
      count: src?.microCycloneCount ?? 0,
      formula: 'microCount = 风蚀状态机中“0或1风蚀触发乱流”的次数；每次微域气旋触发一次145%倍率风属性异放',
      fields: ['corrosion<2', 'turbulenceCount', 'Condensed Cyclone', 'releaseMultiplier=145%'],
      note: '0或1个风蚀时，再次触发乱流会获得1点风蚀，并伴随触发微域气旋；微域气旋触发一次145%倍率风属性异放。',
    },
    {
      id: 'velina-corrosion-broad-cyclone',
      type: 'release',
      label: '维琳娜风蚀替换广域气旋',
      source: '2个风蚀时，再次触发乱流清空风蚀，微域气旋替换为广域气旋',
      count: src?.broadCycloneCount ?? 0,
      formula: 'broadCount = 风蚀状态机中“2风蚀触发乱流”的次数；本次微域气旋替换为广域气旋，触发255%风异放，并使本次乱流倍率区 += 150%',
      fields: ['corrosion=2', 'Sweeping Cyclone #1×10 + #2×2', 'releaseMultiplier=255', 'turbulenceMultiplier+150%'],
      note: '2个风蚀时，再次触发乱流会清空风蚀；本该触发的微域气旋替换为广域气旋，同时把这次触发的乱流倍率提高150%。强化次数会继续分配到各个非风属性乱流伤害事件。',
    },
  ]
}

describe('CC-71 风蚀气旋事件 → anomalyCorrosionEvents', () => {
  it('仅维琳娜声明；输出 == 原 core 写死对象（多组次数）', () => {
    const owners = getRegisteredAgentMechanics().filter(m => !!m.anomalyCorrosionEvents).flatMap(m => m.agentIds)
    expect(owners).toEqual(['1561'])
    const velina = getAgentMechanic('1561')!
    for (const [micro, broad] of [[0, 0], [3, 0], [0, 2], [7, 4]]) {
      const src = { microCycloneCount: micro, broadCycloneCount: broad } as unknown as CorrosionSource
      expect(resolveAnomalyCorrosionEvents([velina], src)).toEqual(legacy(src))
      expect(resolveAnomalyCorrosionEvents([getAgentMechanic('1211')!, velina], src)).toEqual(legacy(src))
    }
    expect(resolveAnomalyCorrosionEvents(undefined, {} as CorrosionSource)).toEqual([])
  })

  it('源码锁：core/anomalyPool.ts 不再含维琳娜事件文案', () => {
    const src = readFileSync(resolve(__dirname, '../../core/anomalyPool.ts'), 'utf-8')
    expect(src).not.toContain('维琳娜微域气旋风异放')
    expect(src).not.toContain('维琳娜风蚀替换广域气旋')
    expect(src).toContain('resolveAnomalyCorrosionEvents(input.agentMechanics, corrosionSource)')
  })
})
