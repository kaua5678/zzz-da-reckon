/**
 * CC-109（R5 D28）：洛克茜强特耗能 = 小心风寒启动 + 自旋每秒 × 自旋秒（catalog 1621007 energyCost 两项）。
 *
 * 修前通用 findExSpecial 只取「Energy Cost」10，自旋 30/s 零扣费 ⇒ 强特次数按 能量/10 推（默认预设约 80 发 / 180s），
 * 而风能账本按 10 + 30×秒 记耗能 ⇒ 账本耗能远超能量总收入。本文件钉住：
 *   ① 解析值来自数据（10 / 30），② 管线里 cfg 耗能 = 10 + 30 × spinSeconds，
 *   ③ 执行行耗能合计 = 强特次数 × 单发耗能，且不超过能量总收入（账本闭合）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { roxyExEnergyCost, ROXY_FULL_SPIN_SECONDS } from '@/mechanics/agents/roxy'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
function move(id: string): any {
  for (const s of cat.agentSkills) for (const c of s.categories) for (const m of c.moves) if (m.id === id) return m
  return undefined
}

describe('洛克茜强特耗能（CC-109）', () => {
  it('① 解析：catalog 1621007 = 启动 10 + 每秒 30；缺字段回落 10 / 30', () => {
    expect(roxyExEnergyCost(move('1621007'))).toEqual({ start: 10, perSecond: 30 })
    expect(roxyExEnergyCost(undefined)).toEqual({ start: 10, perSecond: 30 })
  })

  it('②③ 管线：单发耗能 = 10 + 30 × 满自旋秒，执行行耗能合计 = 能量总收入（放完能量）', async () => {
    const rich = { agentId: '1621', cinemaLevel: 0 } as HarnessTeamSlot
    // ⚠ 2026-10-19 用户裁决：自旋秒数**不再是滑块**（「自动把能量放完，多次满秒数 + 1 次零散」）
    // ⇒ 本用例不再扫 spin 档位，改为验证「满发 + 零散」把能量用到最后一滴。
    const spin = ROXY_FULL_SPIN_SECONDS
    for (const _ of [0]) {
      const { catalog } = await setupHarness([rich, { agentId: '1371', cinemaLevel: 0 } as HarnessTeamSlot, { agentId: '1431', cinemaLevel: 0 } as HarnessTeamSlot])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const c = (calc.resourceResult.value?.characters ?? []).find(x => x.agentId === '1621') as any
      expect(c, '资源结果里应有 1621').toBeTruthy()
      expect(c.exSpecialEnergyConsume, `spin=${spin}`).toBeCloseTo(10 + 30 * spin, 9)
      const ex = Math.floor(Number(c.exSpecialCount ?? 0))
      expect(ex, '强特次数应 >0').toBeGreaterThan(0)
      const rows = (c.executions ?? c.executionPlan ?? []).filter((e: any) => e.moveId === '1621007' || e.moveId === '1621008')
      const spent = rows.reduce((a: number, e: any) => a + Number(e.totalEnergyConsume ?? 0), 0)
      // 2026-10-19 用户口径：自旋秒数**自动放完能量**（多次满发 + 1 次零散）⇒ 最后一发可能不满。
      // 故判据从「= 次数 × 满发耗能」改为「≤ 次数 × 满发耗能 且 把能量用到底」。
      const budget = Number(c.energySource?.total ?? 0)
      expect(spent, '耗能不超过次数 × 满发耗能').toBeLessThanOrEqual(ex * (10 + 30 * spin) + 1e-6)
      expect(spent, '耗能不超过能量总收入').toBeLessThanOrEqual(budget + 1e-6)
      // 「放完」判据：剩余能量不足再打一发零散发（< 启动 10 点），否则说明少打了
      expect(budget - spent, '剩余能量应不足再打一发（否则少算了次数）').toBeLessThan(10 + 1e-6)
    }
  }, 120000)
})
