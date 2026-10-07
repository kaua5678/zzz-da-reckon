/**
 * CC-341：全局 Buff 行上的危局 buff 牌条件（特性限定 / 特性人数分档）由管线按**当前队伍**解析。
 *
 * 修前只有队伍对比在写入前按预设队伍解析（`teamCompare#resolveBuffEffect`），应用 Boss 写的关卡固有 buff
 * （`applyBossLayerBuffs`）与实战部署页的当期牌（`applyPeriodBuff`）写行时丢掉 `cond` ⇒ 对任何队都满额生效。
 * 现在写入方只带 `cond`，`resolveSlotPanelBuffInputs` 是唯一解析点；本文件断言的是引擎实际收下的条目。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness, setTeam } from '@/test/harness'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'
import { applyPeriodBuff } from '@/composables/runArchiveDeploy'
import { applyBossLayerBuffs } from '@/composables/bossRoom'
import type { GlobalBuffRow, useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import type { BossPresetFile, PhaseBuffCard } from '@/types/bossPreset'

const bp = JSON.parse(
  readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'),
) as BossPresetFile

/** 引擎实际收下的全局 Buff（1 号位面板输入）：stat → Σvalue */
function engineGlobals(
  config: ReturnType<typeof useConfigStore>,
  catalog: ReturnType<typeof useCatalogStore>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of resolveSlotPanelBuffInputs(0, config, catalog).teammateBuffs) {
    if (b.sourceKind !== 'global') continue
    for (const e of b.effects) if (e.type === 'fixed') out[e.stat] = (out[e.stat] ?? 0) + e.value
  }
  return out
}

function setRows(config: ReturnType<typeof useConfigStore>, rows: GlobalBuffRow[]) {
  config.globalBuffs.splice(0, config.globalBuffs.length, ...rows.map(r => ({ ...r })))
}

const ROWS: GlobalBuffRow[] = [
  {
    id: 'r-tier', name: '异常分档', stat: 'atkPct', value: 70, enabled: true, targetSkillType: 'all',
    cond: { countTier: { specialty: '异常', thresholds: [2, 3], values: [10, 70] } },
  },
  { id: 'r-spec', name: '强攻限定', stat: 'critDmg', value: 30, enabled: true, targetSkillType: 'all', cond: { specialty: '强攻' } },
  { id: 'r-plain', name: '无条件', stat: 'dmgBonus', value: 5, enabled: true, targetSkillType: 'all' },
]

// 测试队与 CC-341 前 teamCompare.test「buff 条件（resolveBuffEffect）」同一组：1561 / 1261（异常）+ 1411（支援）
const TWO_ANOMALY = [{ agentId: '1561' }, { agentId: '1261' }, { agentId: '1411' }]
const THREE_ANOMALY = [{ agentId: '1561' }, { agentId: '1261' }, { agentId: '1171' }]
const WITH_ATTACK = [{ agentId: '1241' }, { agentId: '1561' }, { agentId: '1411' }]

describe('CC-341 全局 Buff 行的 cond 由管线按当前队伍解析', () => {
  it('2 异常 + 支援：分档取低档、强攻限定不生效、无条件行原样', async () => {
    const { config, catalog } = await setupHarness(TWO_ANOMALY)
    setRows(config, ROWS)
    const g = engineGlobals(config, catalog)
    expect(g.atkPct).toBe(10)
    expect(g.critDmg).toBeUndefined()
    expect(g.dmgBonus).toBe(5)
  })

  it('同一组行、换成 3 异常：自动取满编档（写入方不需要知道队伍）', async () => {
    const { config, catalog } = await setupHarness(TWO_ANOMALY)
    setRows(config, ROWS)
    setTeam(config, THREE_ANOMALY)
    expect(engineGlobals(config, catalog).atkPct).toBe(70)
  })

  it('队里有强攻、异常只有 1 名：强攻限定生效、分档不生效', async () => {
    const { config, catalog } = await setupHarness(WITH_ATTACK)
    setRows(config, ROWS)
    const g = engineGlobals(config, catalog)
    expect(g.critDmg).toBe(30)
    expect(g.atkPct).toBeUndefined()
    expect(g.dmgBonus).toBe(5)
  })

  it('applyPeriodBuff（实战部署页当期牌）写行带 cond：2 异常队取低档', async () => {
    const { config, catalog } = await setupHarness(TWO_ANOMALY)
    setRows(config, [])
    const card: PhaseBuffCard = {
      title: '分档牌', testOnly: false, unparsed: [],
      effects: [{ stat: 'anomalyProficiency', value: 60, cond: { countTier: { specialty: '异常', thresholds: [2, 3], values: [20, 60] } } }],
    }
    expect(applyPeriodBuff(config, '690000', card)).toBe(true)
    expect(config.globalBuffs[0].cond?.countTier?.values).toEqual([20, 60])
    expect(engineGlobals(config, catalog).anomalyProficiency).toBe(20)
  })
})

describe('CC-341 真数据：40003 在 690431 期的关卡固有 buff（强攻限定 4 条）', () => {
  function room() {
    const boss = bp.bosses.find(x => x.id === '40003')
    const phase = boss?.phases.find(x => x.phaseId === '690431')
    if (!boss || !phase) throw new Error('boss-presets.json 缺 40003 / 690431')
    return { boss, phase }
  }

  it('applyBossLayerBuffs 带上 cond；非强攻队不吃、强攻队吃满（修前两队都吃满）', async () => {
    const { boss, phase } = room()
    const limited = (phase.layerBuffs ?? []).flatMap(c => c.effects).filter(e => e.cond?.specialty === '强攻')
    expect(limited.map(e => e.stat).sort()).toEqual(['atkPct', 'critDmg', 'enemyResReduction', 'penRatio'])
    const expectedDiff: Record<string, number> = {}
    for (const e of limited) expectedDiff[e.stat] = (expectedDiff[e.stat] ?? 0) + e.value

    const { config, catalog } = await setupHarness(TWO_ANOMALY)
    setRows(config, [])
    applyBossLayerBuffs(config, boss, phase)
    expect(config.globalBuffs.filter(r => r.cond?.specialty === '强攻').length).toBe(limited.length)
    const nonAttack = engineGlobals(config, catalog)
    setTeam(config, WITH_ATTACK)
    const attack = engineGlobals(config, catalog)
    for (const [stat, diff] of Object.entries(expectedDiff)) {
      expect((attack[stat] ?? 0) - (nonAttack[stat] ?? 0), stat).toBeCloseTo(diff, 9)
    }
  })
})
