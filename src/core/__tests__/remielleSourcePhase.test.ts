/**
 * 1581 蕾米埃尔 corePassive 两个 formula 效果的 x（sourceStat = anomalyProficiency）口径。
 *
 * **2026-10-20 定案（用户裁决「肯定按照真实的来啊」）**：取**局内最终异常精通**。
 * 原文「自身异常精通的 0.02% / 0.2%」没有「初始」限定 ⇒ 应按角色成型的实际异常精通折算。
 *
 * 修前（R5 D25，2026-09-27）：x 取「效果应用那一刻」的面板值，而 `collectAllBuffs` 把角色自身 buff
 * 排在局内列表最前 ⇒ 恰好等于**局外** AP（音擎 14158 +96、驱动盘 34100 4pc +50 都还没进面板）。
 * 实测 3 异常队 + 推荐配装：局外 502 / 局内 648 ⇒ 异化系数 10.04%（应 12.96%）、耀变倍率提升 100.4%（应 129.6%）；
 * 资源卡展示走 `cfg.panel`（局内）⇒ 同一角色的两个面板/两张卡**互相打架**，这就是用户看到的现象。
 *
 * 修法（根因层，不是打补丁）：`core/buff.ts#applyBuffs` 改为**两批求值**——先落全部 fixed/derived/stacked，
 * 再统一求 formula。这条口径对所有「按自身属性转模」的 formula 效果一致成立，不针对 1581 特判。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel } from '@/core/panel'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any
const setsMap = new Map<string, any>(cat.driveDiscSets.map((s: any) => [String(s.id), s]))
const agent = cat.agents.find((x: any) => x.id === '1581')
const wEngine = (id?: string) => (id ? cat.wEngines.find((x: any) => x.id === id) : undefined)

function panel(wid?: string, fourPieceSetId = '') {
  return calcPanel(agent, wEngine(wid), { fourPieceSetId, twoPieceSetId: '', mainStats: {}, subStatAllocation: {} } as any, setsMap, [], cat.statRules, {
    cinemaLevel: 0,
    wEngineModLevel: 1,
  }) as any
}

describe('蕾米埃尔 sourceStat 口径（局内最终异常精通）', () => {
  for (const [wid, disc] of [[undefined, ''], ['14150', ''], ['14150', '34100']] as const) {
    it(`音擎 ${wid ?? '无'} / 4pc ${disc || '无'}`, () => {
      const p = panel(wid, disc)
      const inAp = p.inCombat.anomalyProficiency
      expect(p.inCombat.remielleRefringeCoefficient).toBeCloseTo(inAp * 0.02, 9)
      expect(p.inCombat.remielleLuminizeMultiplierBonus).toBeCloseTo(inAp * 0.2, 9)
    })
  }

  it('局内 AP 确实高于局外（否则上面两条测不出两批求值）', () => {
    const p = panel('14150', '34100')
    expect(p.inCombat.anomalyProficiency).toBeGreaterThan(p.outOfCombat.anomalyProficiency)
    // 负控：若 applyBuffs 退回单批顺序求值，系数会落回局外口径 ⇒ 与上面断言差 ~2.9 点
    expect(p.inCombat.remielleRefringeCoefficient)
      .toBeGreaterThan(p.outOfCombat.anomalyProficiency * 0.02 + 1)
  })
})
