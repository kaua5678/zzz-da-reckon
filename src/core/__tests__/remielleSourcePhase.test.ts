/**
 * R5 D25（`sourceStat`）：1581 蕾米埃尔 corePassive 两个 formula 效果的 x（sourceStat = anomalyProficiency）
 * 在引擎里取的是「效果应用时刻」的面板值。因为 `collectAllBuffs` 把角色自身 buff 排在局内列表最前，
 * 这个时刻的异常精通**恰好等于局外面板值**（不含音擎 / 驱动盘 4pc / 队友的局内异常精通）。
 * 数据没有写 `sourcePanelPhase`，原文「自身异常精通的0.02% / 0.2%」未写「初始」，口径未定（见账本 D25）。
 * 本测试钉住**当前口径**：coef = 0.02 × 局外 AP、bonus = 0.2 × 局外 AP，即使存在局内 AP 加成。
 * 用途：有人调整 buff 顺序时会静默改变数值——本测试让它显式失败。若日后拍板改为局内口径，
 * 按账本 D25 的方案改代码并改写本测试。
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

describe('R5 D25 蕾米埃尔 sourceStat 口径（当前 = 局外异常精通）', () => {
  for (const [wid, disc] of [[undefined, ''], ['14150', ''], ['14150', '34100']] as const) {
    it(`音擎 ${wid ?? '无'} / 4pc ${disc || '无'}`, () => {
      const p = panel(wid, disc)
      const outAp = p.outOfCombat.anomalyProficiency
      expect(p.inCombat.remielleRefringeCoefficient).toBeCloseTo(outAp * 0.02, 9)
      expect(p.inCombat.remielleLuminizeMultiplierBonus).toBeCloseTo(outAp * 0.2, 9)
      if (wid) expect(p.inCombat.anomalyProficiency).toBeGreaterThan(outAp) // 确有局内 AP 加成未计入
    })
  }
})
