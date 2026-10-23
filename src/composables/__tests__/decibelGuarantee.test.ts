/**
 * CC-229 锁：保底4喧响提示直读引擎决策（convergence → CalcRoundResult.decibelGuarantee）。
 * 旧页面用收敛后主C喧响（已含注入弹刀）重算 ⌈缺口/215⌉ ⇒ 1291-1481-1161 引擎补 7 次、页面显示「已够」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('CC-229 decibelGuarantee 引擎直出', () => {
  /**
   * 真队：**保底 4 喧响的决策自洽性**（2026-10-23 重写）。
   *
   * 修前断言写死 `parry > 0`，隐含「有缺口就必须补弹刀」。**那是错的**：
   * 目标是 4 次大招 = `4 × ULTIMATE_COST_DEFAULT(3000) = 12000`，本队主C 喧响约 8038
   * ⇒ 缺口 **3962**（≈ 少一个大招再多缺 962），远超四舍五入阈值 1500
   * ⇒ 引擎**主动放弃硬凑**（要补 19 次弹刀，代价远超收益）⇒ `parry = 0` 是正确决策。
   * 页面文案同源：「缺口 3962 > 1500，实战打不出下一次大 → 不硬凑」。
   *
   * 现在断言决策规则本身（两条互斥分支）：
   *   ① 缺口 ≤ 阈值 ⇒ 必须补，且 `parry = ⌈缺口/perParry⌉`
   *   ② 缺口 > 阈值 ⇒ 必须不补（`parry = 0`），缺口如实上报
   */
  it('真队：保底 4 喧响决策自洽（可凑则补 ⌈缺口/215⌉，缺口过大则不硬凑）', async () => {
    const { config } = await setupHarness([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }], { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', 1)
    const g = useResourceCalc().decibelGuaranteeResult.value!
    expect(g.active).toBe(true)
    // CC-425：roundable 与阈值同源（页面提示插值 roundThreshold，不再手写 1500）
    expect(g.roundThreshold).toBe(1500)
    expect(g.roundable).toBe(g.residualShort <= g.roundThreshold)
    if (g.roundable) {
      expect(g.parry, '缺口可凑 ⇒ 必须补弹刀').toBeGreaterThan(0)
      expect(g.parry, 'parry = ⌈缺口 / 每次弹刀喧响⌉').toBe(Math.ceil(g.residualShort / g.perParry))
      expect(g.basisShort, '可凑时 basisShort 就是当时的缺口').toBe(g.residualShort)
    } else {
      expect(g.parry, '缺口 > 阈值 ⇒ 主动放弃硬凑（补弹刀代价远超收益）').toBe(0)
      expect(g.residualShort, '放弃时缺口必须如实上报（页面用它提示用户）').toBeGreaterThan(g.roundThreshold)
    }
  })
  it('补齐角色（般岳）在队 ⇒ active=false、parry=0', async () => {
    const { config } = await setupHarness([{ agentId: '1371' }, { agentId: '1471' }, { agentId: '1311' }], { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', 1)
    const g = useResourceCalc().decibelGuaranteeResult.value!
    expect(g.active).toBe(false)
    expect(g.parry).toBe(0)
  })
  it('源码锁：TeamConfigPage 不再自算缺口 / 次数', () => {
    const src = readFileSync(resolve(__dirname, '../../views/TeamConfigPage.vue'), 'utf-8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(src).not.toMatch(/\/\s*215\b/)
    expect(src).not.toMatch(/÷\s*215\b/)
    expect(src).not.toMatch(/ULTIMATE_COST_DEFAULT/)
    expect(src).not.toMatch(/\b1500\b/) // CC-425：阈值由 decibelGuarantee.roundThreshold 提供
    expect(src).toMatch(/decibelGuaranteeResult/)
  })
})
