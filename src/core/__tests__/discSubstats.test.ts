import { beforeAll, describe, expect, it } from 'vitest'
import { applyDriveDiscConfig, emptyPanel } from '@/core/panel'
import { setupHarness } from '@/test/harness'
import type { DriveDiscConfig, PanelValues, StatId, StatRules } from '@/types/catalog'

// R28-J2: mode 对当前合法副词条池不敏感，不应把等价注入误判成测试盲区。
// 使用合成基础面板避免角色/装备特效混入；实际池和步长仍从公共 harness 的 catalog 读取。
const CASES = [
  ['hpFlat', 'hp', false], ['atkFlat', 'atk', false], ['defFlat', 'def', false],
  ['hpPct', 'hp', true], ['atkPct', 'atk', true], ['defPct', 'def', true],
  ['critRate', 'critRate', false], ['critDmg', 'critDmg', false],
  ['anomalyProficiency', 'anomalyProficiency', false], ['penFlat', 'penFlat', false],
] as const
let rules: StatRules
const base = (): PanelValues => ({ ...emptyPanel(), hp: 1000, atk: 200, def: 300,
  impact: 75, anomalyMastery: 90, anomalyProficiency: 80 })
const disc = (overrides: Partial<DriveDiscConfig> = {}): DriveDiscConfig => ({
  fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: '', 5: '', 6: '' }, subStatAllocation: {}, ...overrides,
})
const displayAs = (stat: StatId, display: 'percent' | 'integer', source = rules): StatRules => ({
  ...source, statDisplay: { ...source.statDisplay, [stat]: { ...source.statDisplay[stat], display } },
})
// CC-100（R5 D15）：驱动盘结算口径以 `driveDisc.statModes` 为准，`display` 只在缺失时回退。
const modeAs = (stat: StatId, mode: 'pct' | 'flat', source = rules): StatRules => ({
  ...source, driveDisc: { ...source.driveDisc, statModes: { ...source.driveDisc.statModes, [stat]: mode } },
})
function run(config: DriveDiscConfig, source = rules) {
  return applyDriveDiscConfig(base(), config, source)
}

beforeAll(async () => {
  const { catalog } = await setupHarness(['', '', ''])
  expect(catalog.statRules).toBeTruthy()
  rules = catalog.statRules!
})

describe('驱动盘副词条：可观察的数值与池契约', () => {
  it('当前池和步长表由十个独立观察目标完整覆盖', () => {
    const covered = CASES.map(([stat]) => stat).sort()
    expect([...rules.driveDisc.subStatPool].sort()).toEqual(covered)
    expect(Object.keys(rules.driveDisc.sRankSubStatBaseStep).sort()).toEqual(covered)
  })

  it.each(CASES)('%s：0/1/3 步按字段结算，flat/pct 显示注入不改变结果', (stat, field, percentOfBase) => {
    const step = rules.driveDisc.sRankSubStatBaseStep[stat]!
    expect(step).toBeGreaterThan(0)
    const baseline = run(disc())
    for (const count of [0, 1, 3]) {
      const config = disc({ subStatAllocation: { [stat]: count } })
      const normal = run(config)
      const delta = step * count * (percentOfBase ? base()[field] / 100 : 1)
      expect(normal[field], `${stat} count=${count}`).toBeCloseTo(baseline[field] + delta, 9)
      if (count > 0) expect(normal[field]).toBeGreaterThan(baseline[field])
      expect(run(config, displayAs(stat, 'integer'))).toEqual(normal)
      expect(run(config, displayAs(stat, 'percent'))).toEqual(normal)
    }
  })

  it('主副词条共用原始基础值，固定加点不被百分比再乘一次，条目顺序不影响结果', () => {
    const mainStats = { 4: 'atkPct' as const, 5: '', 6: '' }
    const a = run(disc({ mainStats, subStatAllocation: { atkPct: 3, atkFlat: 2 } }))
    const b = run(disc({ mainStats, subStatAllocation: { atkFlat: 2, atkPct: 3 } }))
    const { sRankMaxMainStat: main, sRankSubStatBaseStep: step } = rules.driveDisc
    const expected = base().atk * (1 + (main.atkPct! + 3 * step.atkPct!) / 100)
      + main.atkFlat! + 2 * step.atkFlat!
    expect(a.atk).toBeCloseTo(expected, 9)
    expect(b).toEqual(a)
  })

  it('池外字段即使有非零步长也不发放；纳入池后才生效', () => {
    const source: StatRules = { ...rules, driveDisc: { ...rules.driveDisc,
      sRankSubStatBaseStep: { ...rules.driveDisc.sRankSubStatBaseStep, anomalyMastery: 10 } } }
    const config = disc({ subStatAllocation: { anomalyMastery: 2 } })
    expect(source.driveDisc.subStatPool).not.toContain('anomalyMastery')
    expect(run(config, source)).toEqual(run(disc(), source))
    const admitted: StatRules = { ...source, driveDisc: { ...source.driveDisc,
      subStatPool: [...source.driveDisc.subStatPool, 'anomalyMastery'] } }
    // statModes.anomalyMastery = pct（源数据百分比口径，CC-100）⇒ 2 步 × 10 = +20%
    expect(run(config, admitted).anomalyMastery).toBeCloseTo(base().anomalyMastery * 1.2, 9)
  })

  // 合成扩展池仅是仪器正控，不新增游戏数据；防“删掉 mode 推导也全绿”。
  it.each(['anomalyMastery', 'energyRegen'] as const)('正控：mode 敏感字段 %s 的扩展池确实能区分两条通道', stat => {
    const source: StatRules = { ...rules, driveDisc: { ...rules.driveDisc,
      subStatPool: [...rules.driveDisc.subStatPool, stat],
      sRankSubStatBaseStep: { ...rules.driveDisc.sRankSubStatBaseStep, [stat]: 10 } } }
    const config = disc({ subStatAllocation: { [stat]: 2 } })
    const flat = run(config, modeAs(stat, 'flat', source))
    const pct = run(config, modeAs(stat, 'pct', source))
    expect(flat).not.toEqual(pct)
    // 显式 statModes 存在时，只改展示字段 display 不得改变结算（防优先级被改回 display）
    expect(run(config, displayAs(stat, 'percent', modeAs(stat, 'flat', source)))).toEqual(flat)
    expect(run(config, displayAs(stat, 'integer', modeAs(stat, 'pct', source)))).toEqual(pct)
    if (stat === 'anomalyMastery') {
      expect(flat.anomalyMastery).toBe(base().anomalyMastery + 20)
      expect(pct.anomalyMastery).toBeCloseTo(base().anomalyMastery * 1.2, 9)
    } else {
      expect(flat.energyRegenBonusFlat).toBe(20)
      expect(flat.energyRegenBonusPct).toBe(0)
      expect(pct.energyRegenBonusPct).toBe(20)
      expect(pct.energyRegenBonusFlat).toBe(0)
    }
  })
})
