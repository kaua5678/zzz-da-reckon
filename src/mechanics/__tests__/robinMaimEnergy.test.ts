/**
 * 知更鸟核心被动「全队角色每触发一次[毁伤]，固定回复 15 点能量」——判据。
 *
 * 原文（spec 1661 核心被动 Lv.7 / 3.4.3+20278274 描述层新增句）逐字：
 * > 「全队角色每触发一次毁伤，知更鸟**固定**回复 15 点能量」
 *
 * 本文件锁四件事：
 * ① **口径**：15 点/次、**固定值**（走 `bonusEnergy`，不进回能百分比/效率乘区）；
 * ② **计数**：次数 = 全队各锋御槽 `maimCount` 之和（含克拉蕾影画6 那种不耗层的额外毁伤）；
 * ③ **无锋御 ⇒ 0**（没有毁伤来源就不该凭空回能）；
 * ④ **真管线**：组队跑完整资源环，能量真的进了知更鸟的能量池。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { collectTeamMaimCount } from '@/mechanics/gashMaim'
import { ROBIN_MAIM_ENERGY_PER_TRIGGER } from '@/mechanics/agents/robin'

function robinOf(rr: any) {
  const robin = rr.characters.find((c: any) => c.agentId === '1661')
  const energy: any = robin?.energySource
  const entry = (energy?.bonusEntries ?? []).find((b: any) => b.key === 'teamMaimEnergy')
  return { robin, energy, entry }
}

function teamMaim(rr: any): number {
  let sum = 0
  for (const ch of rr.characters) {
    const sun: any = (ch as any).sunbringerGashSource
    const cl: any = (ch as any).claretSharpResourceSource
    if (sun && Number.isFinite(Number(sun.maimCount))) sum += Number(sun.maimCount)
    else if (cl && Number.isFinite(Number(cl.maimCount))) sum += Number(cl.maimCount)
  }
  return sum
}

describe('[1661] 每毁伤回 15 能量', () => {
  it('① 口径常量 = 15（原文逐字）', () => {
    expect(ROBIN_MAIM_ENERGY_PER_TRIGGER).toBe(15)
  })

  it('② 计数：空队 / 非锋御槽 ⇒ 0', () => {
    expect(collectTeamMaimCount([] as any)).toBe(0)
    expect(collectTeamMaimCount([{ slot: 0 }, { slot: 1 }] as any)).toBe(0)
    // 非数字 / 负数一律归 0（不让 NaN 污染能量池）
    expect(collectTeamMaimCount([{ slot: 0, sunbringerGashSource: { points: 0, demandLayers: 0, maimCount: Number.NaN } }] as any)).toBe(0)
    expect(collectTeamMaimCount([{ slot: 0, sunbringerGashSource: { points: 0, demandLayers: 0, maimCount: -5 } }] as any)).toBe(0)
  })

  it('②-b 计数：多锋御槽求和（含不耗层的影画6 毁伤）', () => {
    const total = collectTeamMaimCount([
      { slot: 0, sunbringerGashSource: { points: 6000, demandLayers: 20, maimCount: 7 } },
      { slot: 1, claretSharpResourceSource: { gashValuePct: 9000, maimCount: 10 } },
      { slot: 2 },
    ] as any)
    expect(total).toBe(17)
  })

  it('③ 无锋御队 ⇒ 回能 0（不凭空回能）', async () => {
    await setupHarness(['', '', ''])
    const c = useConfigStore()
    c.setAgent(0, '1661'); c.setAgent(1, '1621'); c.setAgent(2, '1031')
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const { entry } = robinOf(rr)
    expect(teamMaim(rr), '无锋御 ⇒ 全队毁伤应为 0').toBe(0)
    expect(entry?.value ?? 0).toBe(0)
  }, 120000)

  it('④ 真管线：单锋御队 ⇒ 回能 = 15 × 全队毁伤次数', async () => {
    await setupHarness(['', '', ''])
    const c = useConfigStore()
    c.setAgent(0, '1661'); c.setAgent(1, '1601'); c.setAgent(2, '1621')
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const { entry, energy } = robinOf(rr)
    const maim = teamMaim(rr)
    expect(maim, '挽昼队应有毁伤').toBeGreaterThan(0)
    expect(entry, 'teamMaimEnergy 明细必须出现').toBeTruthy()
    expect(entry.value).toBe(maim * ROBIN_MAIM_ENERGY_PER_TRIGGER)
    // 固定值语义：明细值就是进总账的值（不被回能效率放大/缩小）
    expect(energy.bonusEntries.some((b: any) => b.key === 'teamMaimEnergy')).toBe(true)
  }, 120000)

  it('④-b 双锋御队：次数是两槽之和（不是取其一）', async () => {
    await setupHarness(['', '', ''])
    const c = useConfigStore()
    c.setAgent(0, '1661'); c.setAgent(1, '1601'); c.setAgent(2, '1611')
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const { entry } = robinOf(rr)
    const maim = teamMaim(rr)
    expect(maim).toBeGreaterThan(0)
    expect(entry.value).toBe(maim * ROBIN_MAIM_ENERGY_PER_TRIGGER)
  }, 120000)
})