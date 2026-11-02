/**
 * 结果页「伤害 → 分数」卡的接线锁（用户 2026-10-28）。
 *
 * 为什么需要源码锁（而不是只测纯函数）：
 * 曲线本身已经由 `core/__tests__/deadlyAssaultScore.test.ts` 钉住，但**页面漏接**这种缺陷纯函数测不出来——
 * 卡没挂进结果页 / 页面自己写了一份 60000·5000 / 木桩模式没进下拉，全都「函数是绿的、页面是错的」。
 * 三条判据：
 *  ① 结果页「伤害池」页签真的渲染这张卡，并把 `teamTotalDamage` 传进去（不另算一份伤害）；
 *  ② 卡片与换算模块**不写** 60000 / 5000 / 87.4 / 158 这类曲线字面量（一律取数据模块）；
 *  ③ 木桩模式在 UI 选项里（`SCORE_MODE_OPTIONS` 三条），且卡片的操作分上限按模式取。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SCORE_MODE_OPTIONS, SCORE_MODE_OPERATION_CAP } from '@/data/deadlyAssaultScore'

const code = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf-8')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('伤害 → 分数卡 · 接线与单一来源', () => {
  it('① 结果页挂上资源池共享视图，卡在其中且伤害来自 teamTotalDamage', () => {
    /**
     * T188（2026-11-03）：卡随资源块搬进 `components/ResourcePoolView.vue`（ResultPage 与各比较入口
     * **同一个组件**）；原先的「必须在「伤害池」页签内」随页签一并消失，改成更强的形态——
     * 卡在共享视图里 + **结果页必须真的把这个视图挂上**（两段都要红，不能只红一半）。
     */
    const poolView = code('components/ResourcePoolView.vue')
    expect(poolView).toContain("import DeadlyAssaultScoreCard from '@/components/charts/DeadlyAssaultScoreCard.vue'")
    expect(poolView).toMatch(/<DeadlyAssaultScoreCard[^>]*:team-damage="teamTotalDamage"/)
    const resultPage = code('views/ResultPage.vue')
    expect(resultPage).toContain("import ResourcePoolView from '@/components/ResourcePoolView.vue'")
    expect(resultPage).toMatch(/<ResourcePoolView/)
  })

  it('② 卡片 / 换算模块 / 结果页都不手抄曲线字面量', () => {
    const card = code('components/charts/DeadlyAssaultScoreCard.vue')
    for (const literal of ['60000', '5000', '87.4', '158']) {
      expect(card.includes(literal), `卡片出现曲线字面量 ${literal} ⇒ 应改取 data/deadlyAssaultScore`).toBe(false)
    }
    const convert = code('composables/substatScoreConvert.ts')
    expect(convert).not.toMatch(/\b5000\b/)
    expect(convert).not.toMatch(/\b87\.4\b|\b158\b/)
  })

  it('③ 木桩是第三个可选项，且它的操作分上限是 0（危局两档是 5000）', () => {
    expect(SCORE_MODE_OPTIONS.map(o => o.value)).toEqual(['defense', 'critical_assault', 'training_dummy'])
    expect(SCORE_MODE_OPERATION_CAP.training_dummy).toBe(0)
    expect(SCORE_MODE_OPERATION_CAP.defense).toBe(SCORE_MODE_OPERATION_CAP.critical_assault)
    // 卡片必须按模式取上限（不是写死 5000，也不是只给危局两档做分支）
    const card = code('components/charts/DeadlyAssaultScoreCard.vue')
    expect(card).toContain('operationScoreCapOf(mode.value)')
  })
})
