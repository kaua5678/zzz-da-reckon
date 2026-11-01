/**
 * 挽昼/知更鸟 (Test1) spec 级 teamBuff 生效判据（2026-10-24 增量录入）。
 *
 * 覆盖三面（SOP 铁律 1：录入 = spec 字段 + 生效测试）：
 * ① 合并面：spec teamBuffs 经 mergeSpecTeamBuffs 进队友 Buff 组（组 id = agentId，条目按 id 落位）。
 * ② 门控面：影画 source 标签自动按拥有者命座门控（C0 不启用 / C2 启用）；额外能力条件
 *    （1601 众愿一心：队里有击破/防护/其他锋御）随 deriveTeammateBuffEnabled 生效。
 * ③ 数值面：enabled 条目经 resolveTeammateBuffsOnEmptyPanel 落到面板字段（dmgBonus 25 /
 *    sharpCritDmg 20 / enemyResReduction 12——stat→面板字段的消费端证明）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHarness, newPinia, resolveTeammateBuffsOnEmptyPanel } from '@/test/harness'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import type { TeammateBuffGroup } from '@/types/catalog'

beforeEach(() => { newPinia() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

type DeriveTeam = Parameters<typeof deriveTeammateBuffEnabled>[0]
/** 槽位必须逐位不同：额外能力条件求值把 ownSlot 上的成员排除（全填 0 ⇒ 谁都当「自己」）。 */
const member = (slot: number, agentId: string, cinemaLevel = 0): DeriveTeam[number] =>
  ({ slot, agentId, cinemaLevel, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 } as DeriveTeam[number])
const teamOf = (...entries: Array<[string, number?]>) =>
  entries.map(([id, cinema = 0], i) => member(i, id, cinema))

function enabledOf(team: DeriveTeam, groups: readonly TeammateBuffGroup[]) {
  const catalog = useCatalogStore()
  return new Set(deriveTeammateBuffEnabled(team, groups, id => catalog.getAgent(id) ?? null)
    .filter(x => x.enabled).map(x => x.id))
}

/** 空面板字段基线（sharpCritDmg 基础 50% ≠ 0）——teamBuff 断言只认增量。 */
function basePanel() {
  return resolveTeammateBuffsOnEmptyPanel([], 0)
}

describe('(Test1) 知更鸟 1661 spec teamBuffs', () => {
  it('合并面：三条件目按 id 落进 1661 组，数值面：resolve 到面板字段', async () => {
    const { catalog } = await setupHarness([{ agentId: '1661', cinemaLevel: 2 }, { agentId: '1011' }, { agentId: '1011' }])
    const groups = catalog.teammateBuffGroups
    const robin = groups.find(g => g.id === '1661')
    expect(robin).toBeDefined()
    expect(robin!.buffs.map(b => b.id)).toEqual(expect.arrayContaining([
      'robin_guard_shield_team_dmg', 'robin_c1_team_def_ignore', 'robin_c2_enemy_res',
    ]))
    const base = basePanel()
    expect(base.sharpCritDmg, '基线前提：锐暴基础 50%（不是 0）').toBeCloseTo(50, 6)
    const panel = resolveTeammateBuffsOnEmptyPanel(
      ['robin_guard_shield_team_dmg', 'robin_c1_team_def_ignore', 'robin_c2_enemy_res'], 0)
    expect(panel.dmgBonus - base.dmgBonus).toBeCloseTo(25, 6)
    expect(panel.enemyDefReduction - base.enemyDefReduction).toBeCloseTo(20, 6) // v2 影画1 = 无视20%防御
    expect(panel.enemyResReduction - base.enemyResReduction).toBeCloseTo(15, 6) // v2 影画2 = 无视15%抗性
  })

  it('门控面：影画1/2 条目在拥有者 C0 不启用、C2 启用；核心被动条不受命座门控', async () => {
    const { catalog } = await setupHarness([{ agentId: '1661' }, { agentId: '1011' }, { agentId: '1011' }])
    const groups = catalog.teammateBuffGroups
    const c0 = enabledOf(teamOf(['1661', 0], ['1011'], ['1011']), groups)
    expect(c0.has('robin_guard_shield_team_dmg')).toBe(true) // 核心被动 source → 命座需求 0
    expect(c0.has('robin_c1_team_def_ignore')).toBe(false)
    expect(c0.has('robin_c2_enemy_res')).toBe(false)

    const c2 = enabledOf(teamOf(['1661', 2], ['1011'], ['1011']), groups)
    expect(c2.has('robin_c1_team_def_ignore')).toBe(true)
    expect(c2.has('robin_c2_enemy_res')).toBe(true)
  })
})

describe('(Test1) 挽昼 1601 众愿一心 teamBuff', () => {
  it('合并面：条目落进 1601 组，数值面：sharpCritDmg 25', async () => {
    const { catalog } = await setupHarness([{ agentId: '1601' }, { agentId: '1251' }, { agentId: '1011' }])
    const wanzhou = catalog.teammateBuffGroups.find(g => g.id === '1601')
    expect(wanzhou).toBeDefined()
    expect(wanzhou!.buffs.map(b => b.id)).toContain('sunbringer_unity_sharp_crit')
    const base = basePanel()
    const panel = resolveTeammateBuffsOnEmptyPanel(['sunbringer_unity_sharp_crit'], 0)
    expect(panel.sharpCritDmg - base.sharpCritDmg).toBeCloseTo(25, 6)
  })

  it('门控面：额外能力三臂之一——击破（1251 青衣）/防护（1661 知更鸟）/其他锋御（1611 克拉蕾）各放行，三者皆无则拦', async () => {
    const { catalog } = await setupHarness([{ agentId: '1601' }, { agentId: '1011' }, { agentId: '1011' }])
    const groups = catalog.teammateBuffGroups
    // ⚠ 中性陪跑用「异常 + 支援」：1011 安比是 [击破]，当陪跑会误触发门控（本节曾因此假红）。
    const neutral = enabledOf(teamOf(['1601'], ['1091'], ['1411']), groups)
    expect(neutral.has('sunbringer_unity_sharp_crit'), '异常 1091 + 支援 1411 ⇒ 三臂皆不满足').toBe(false)

    for (const [label, mate] of [['击破', '1251'], ['防护', '1661'], ['其他锋御', '1611']] as const) {
      const enabled = enabledOf(teamOf(['1601'], [mate], ['1411']), groups)
      expect(enabled.has('sunbringer_unity_sharp_crit'), `${label} ${mate} 在场 ⇒ 众愿一心应启用`).toBe(true)
    }
  })
})
