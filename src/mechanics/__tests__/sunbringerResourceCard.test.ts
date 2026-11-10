/**
 * 挽昼（1601）**资源卡展示**判据（2026-11-10 用户报：「挽昼资源池没展示残痕积蓄，毁伤次数和自身那个
 * 特殊条子的数量呢」）。
 *
 * 口径：卡片读数必须**等于循环解**（`result.sunbringerLoopSource` = `buildResourceResult` 每轮算的那份
 * `solveSunbringerLoops`），不允许展示层另算一份——那样一旦引擎改了来源（如 2026-11-10 新补的
 * 支援突击残痕），卡片会静默停在旧数上。
 *
 * 覆盖：① 三张卡（残痕·毁伤 / 愿火循环 / 锐能）都在，且不是空卡；
 *       ② 残痕点数的来源拆分**闭合**（各来源之和 = 总点数，误差 = 折层 floor）；
 *       ③ 毁伤次数 / 愿火条 / 聚锋·链齿·旗令·愿核 四个专属计数与循环解逐位相同；
 *       ④ 双锋御队：卡片如实写「团队池核定份额」（不是各算各的）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { agentResourceSections } from '@/composables/agentMechanicView'

interface SunbringerLoopLike {
  gash: number
  gashLayers: number
  maimDemand: number
  maimCount: number
  gashFromBasic: number
  gashFromEx: number
  gashFromChain: number
  gashFromParry: number
  gashFromAssistFollowUp: number
  gashFromCounterGift: number
  teamGranted: number | null
  jufengCount: number
  changanCount: number
  ultACount: number
  torchCount: number
  wishTotal: number
  wishSpent: number
  sharpPool: number
  sharpUsed: number
  exCount: number
}

async function slot0With(slot1: string) {
  await setupHarness(['', '', ''])
  const c = useConfigStore()
  c.setAgent(0, '1601'); c.setAgent(1, slot1); c.setAgent(2, '1661')
  const rr = useResourceCalc().resourceResult.value!
  const ch = rr.characters.find(x => x.agentId === '1601')!
  const loop = (ch as unknown as { sunbringerLoopSource?: SunbringerLoopLike }).sunbringerLoopSource
  const sections = agentResourceSections('1601', { result: ch })
  return { ch, loop, sections }
}

describe('1601 挽昼 · 资源卡（残痕积蓄 / 毁伤次数 / 专属条）', () => {
  it('① 三张卡都在，且残痕/毁伤/愿火都有读数（不是空卡）', async () => {
    const { loop, sections } = await slot0With('1621')
    expect(loop, '资源结果必须暴露循环解（展示层唯一来源）').toBeTruthy()
    expect(sections.map(s => s.id)).toEqual(['sunbringer-gash-maim', 'sunbringer-wish', 'sunbringer-sharpness'])
    for (const s of sections) {
      expect(s.rows.length, `${s.id} 不能是空卡`).toBeGreaterThan(1)
      expect(s.summary.length).toBeGreaterThan(0)
    }
    // 残痕与毁伤必须出现在摘要里（用户点名要看的两项）
    expect(sections[0]!.summary).toContain('残痕')
    expect(sections[0]!.summary).toContain('毁伤')
  }, 120000)

  it('② 残痕点数的来源拆分闭合：各来源之和 = 总点数（含灯塔白送层，不含折层）', async () => {
    const { loop } = await slot0With('1621')
    const parts = loop!.gashFromBasic + loop!.gashFromEx + loop!.gashFromChain
      + loop!.gashFromParry + loop!.gashFromAssistFollowUp + loop!.gashFromCounterGift
    expect(parts).toBeCloseTo(loop!.gash, 6)
    expect(loop!.gashLayers).toBe(Math.floor(loop!.gash / 600))
  }, 120000)

  it('③ 毁伤次数 / 愿火条 / 链齿·旗令·愿核 与循环解逐位一致', async () => {
    const { loop, sections } = await slot0With('1621')
    const gashRow = sections[0]!.rows.find(r => r.label.includes('毁伤触发'))
    expect(gashRow?.value).toBe(`${loop!.maimCount} 次`)
    const wish = sections[1]!
    const rowOf = (label: string) => wish.rows.find(r => r.label.includes(label))?.value ?? ''
    expect(rowOf('聚锋')).toContain(`${loop!.jufengCount} 次`)
    expect(rowOf('长暗终焉')).toContain(`${loop!.changanCount} 次`)
    expect(rowOf('此行')).toContain(`${loop!.ultACount} 次`)
    expect(rowOf('永昼之炬')).toContain(`${loop!.torchCount} 次`)
    expect(rowOf('愿核')).toContain(`${loop!.ultACount} 次`)
    // 锐能卡：池 / 消耗 / 发数同源
    const sharp = sections[2]!
    expect(sharp.summary).toContain(String(loop!.exCount))
  }, 120000)

  it('④ 双锋御队：卡片写明「团队残痕池核定份额」，不是各算各的', async () => {
    const { loop, sections } = await slot0With('1611')
    expect(loop!.teamGranted, '双锋御队必须拿到团队池核定份额').not.toBeNull()
    const maimRow = sections[0]!.rows.find(r => r.label.includes('毁伤触发'))!
    expect(maimRow.detail ?? '').toContain('核定份额')
    expect(maimRow.detail ?? '').toContain('双锋御队')
  }, 120000)
})
