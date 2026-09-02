import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamVeilCountTotal } from '@/mechanics/teamVeil'
import { computeZhaoVeilCount } from '@/mechanics/agents/zhao'
import {
  QIANXIA_SCRATCHER_PER_VEIL,
  QIANXIA_SCRATCHER_PER_ULT,
  QIANXIA_SCRATCHER_CD_SECONDS,
} from '@/mechanics/agents/qianxia'

describe('computeTeamVeilCountTotal（全队帷幕通道纯函数）', () => {
  it('照霜寒开帷幕 + 爱芮/叶瞬光终结技 + 千夏强特 汇总', () => {
    // 照 ex=1/ult=1 → 霜寒 100+20+20+60×6=500 → 开帷幕 5 次
    expect(computeZhaoVeilCount(1, 1, 180)).toBe(5)
    const characters = [
      { agentId: '1341' }, // 照
      { agentId: '1501' }, // 爱芮
      { agentId: '1431' }, // 叶瞬光
      { agentId: '1491' }, // 千夏
    ] as any[]
    // 照 5 + 爱芮终结 2 + 叶瞬光终结 1 + 千夏强特 3 = 11
    expect(computeTeamVeilCountTotal(characters, [1, 0, 0, 3], [1, 2, 1, 0], 180)).toBe(11)
  })

  it('无帷幕角色返回 0', () => {
    expect(computeTeamVeilCountTotal([{ agentId: '1011' }] as any[], [0], [0], 180)).toBe(0)
  })
})

describe('全队帷幕通道端到端（2026-09 修复：teamVeilCountTotal 收敛线程注入，此前 postRound 写克隆永不生效）', () => {
  it('千夏+叶瞬光：千夏磨爪器吃到 teamVeilCountTotal×2（千夏强特 + 叶瞬光终结技）', async () => {
    const { config } = await setupHarness([
      { agentId: '1491', cinemaLevel: 0 },
      { agentId: '1431', cinemaLevel: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    const qx = calc.resourceResult.value!.characters.find(c => c.agentId === '1491')!
    const ys = calc.resourceResult.value!.characters.find(c => c.agentId === '1431')!
    const qxCycle = (qx.specResources as any).qianxia_gaze

    // 全队帷幕 = 千夏强特 + 叶瞬光终结技（照不在队）
    const veil = qx.exSpecialCount + ys.ultimateCount
    expect(veil).toBeGreaterThan(0)

    // 磨爪器 = 帷幕×2 + 异常施加×1(0, 无异常角色) + 帷幕内每10s×1 + 大招重击×6
    const expectedScratcher = veil * QIANXIA_SCRATCHER_PER_VEIL
      + Math.floor(180 / QIANXIA_SCRATCHER_CD_SECONDS)
      + qx.ultimateCount * QIANXIA_SCRATCHER_PER_ULT
    expect(qxCycle.scratcherTotal).toBe(expectedScratcher)
  })

  it('千夏+叶瞬光：叶瞬光局外剑势吃到帷幕×3（溯影惊鸿，队友千夏为支援）', async () => {
    const { config } = await setupHarness([
      { agentId: '1491', cinemaLevel: 0 },
      { agentId: '1431', cinemaLevel: 0 },
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    const qx = calc.resourceResult.value!.characters.find(c => c.agentId === '1491')!
    const ys = calc.resourceResult.value!.characters.find(c => c.agentId === '1431')!
    const sword = (ys.specResources as any).yeshuguang_sword_momentum
    const veil = qx.exSpecialCount + ys.ultimateCount

    // 溯影惊鸿：队友开帷幕 +3 局外剑势/次；帷幕贡献 ≥ veil×3（其余来源 ≥ 0）
    expect(sword.gains?.outside_total).toBeGreaterThanOrEqual(veil * 3)
  })
})
