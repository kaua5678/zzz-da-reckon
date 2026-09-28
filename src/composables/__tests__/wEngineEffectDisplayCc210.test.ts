/**
 * CC-210：展示层音擎精炼取值统一走引擎 `applyWEngineModLevel`（经 composables/wEngineEffectDisplay）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { effectAtModLevel } from '@/composables/wEngineEffectDisplay'
import type { BuffEffect } from '@/types/catalog'

describe('CC-210 音擎精炼取值与引擎同源', () => {
  it('按精炼变每层值的效果：精炼 5 取 valuePerStack 第 5 档（旧 DebugPage 口径只替换 value，会显示原值）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1191' }, '', ''])
    const perStack: BuffEffect[] = []
    for (const w of catalog.wEnginesMap.values()) {
      for (const g of [w.effect?.selfBuff, w.effect?.teamBuff]) {
        for (const e of g?.effects ?? []) if (Array.isArray((e as any).modificationValues?.valuePerStack)) perStack.push(e)
      }
    }
    expect(perStack.length).toBeGreaterThan(0)
    let differs = 0
    for (const e of perStack) {
      const series = (e as any).modificationValues.valuePerStack as number[]
      const at5 = effectAtModLevel(e, 5)
      if (series.length >= 5) expect(at5.valuePerStack).toBe(series[4])
      if (series.length >= 5 && series[4] !== e.valuePerStack) differs++
    }
    expect(differs).toBeGreaterThan(0) // 判别力：确有条目精炼 5 与原值不同
  })

  it('modLevel 缺省 ⇒ 原样返回（驱动盘 / 角色来源）', () => {
    const e = { id: 'x', stat: 'atkPct', type: 'fixed', value: 3, modificationValues: { value: [3, 4, 5, 6, 7] } } as unknown as BuffEffect
    expect(effectAtModLevel(e, undefined)).toBe(e)
    expect(effectAtModLevel(e, 4).value).toBe(6)
  })

  it('源码锁：展示点不再自己索引 modificationValues', () => {
    for (const rel of ['views/DebugPage.vue', 'views/TeamConfigPage.vue', 'composables/hpSourceBreakdown.ts']) {
      const src = readFileSync(new URL('../../' + rel, import.meta.url), 'utf8')
      expect({ rel, indexes: /modificationValues\?\.(value|valuePerStack)/.test(src) }).toEqual({ rel, indexes: false })
      expect({ rel, usesShared: /effectAtModLevel\(/.test(src) }).toEqual({ rel, usesShared: true })
    }
  })
})
