/**
 * 额外能力门控簇回归：
 *
 * ① CC-203：硬门控表 `additionalGateBuffTable` 从 catalog 分组派生（来源「额外能力」+ 拥有者有 additionalAbility 声明，
 *    外加跨来源登记）。断言：表内 id 全部可解析回拥有者分组、拥有者都有声明；来源「额外能力」的 buff 全员在表
 *    （豁免仅 AA_OWNER_EXEMPT）；store 默认门控不勾 ⇐ 引擎硬门控关（两道门同口径，不会出现「默认勾上、引擎静默丢弃」）。
 * ② evalAdditionalAbilityBuffGates 的专属语义：凯撒 1071「有任意队友」近似、菲欧妮 1641 tier3 异常数≥3（含影画6 修正）、
 *    不在队 = 全关、未入表 buff 不受门控。
 *
 * 全部走 setupHarness（AGENTS §3：禁止自造 fetch stub）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import {
  additionalGateBuffTable,
  buildMechanicTeamMembers,
  evalAdditionalAbilityBuffGates,
} from '@/composables/resourceCalc/helpers'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { deriveTeammateBuffEnabled } from '@/stores/config'

/** 按队伍装配门控 Map（与 computePanelPhases 的调用路径同参数形态） */
async function gatesFor(team: Array<{ agentId: string; cinemaLevel?: number } | ''>) {
  const { catalog, config } = await setupHarness(team)
  const members = buildMechanicTeamMembers(config, catalog)
  return evalAdditionalAbilityBuffGates(members, id => catalog.getAgent(id) ?? null, catalog.teammateBuffGroups)
}

const aaLabel = (b: { source?: { zhCN?: string }; sourceLabel?: { zhCN?: string } }) => b.source?.zhCN ?? b.sourceLabel?.zhCN ?? ''

describe('CC-203 额外能力硬门控表：从数据派生、与 store 默认门控同口径', () => {
  it('表内 id 全部可解析回拥有者分组；拥有者都有 additionalAbility；来源「额外能力」的 buff 全员在表（豁免见 AA_OWNER_EXEMPT）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    const table = additionalGateBuffTable(catalog.teammateBuffGroups)
    for (const [agentId, ids] of Object.entries(table)) {
      const known = new Set((catalog.teammateBuffGroups.find(g => g.id === agentId)?.buffs ?? []).map(b => b.id))
      expect(ids.filter(id => !known.has(id)), `${agentId} 的门控 id 在分组中不存在（跨来源登记陈旧？）`).toEqual([])
      expect(getAgentSpec(agentId)?.additionalAbility, `${agentId} 入表但 spec 无 additionalAbility`).toBeTruthy()
    }
    const missing: string[] = []
    for (const g of catalog.teammateBuffGroups) {
      if (AA_OWNER_EXEMPT[g.id]) continue
      for (const b of g.buffs ?? []) if (aaLabel(b) === '额外能力' && !(table[g.id] ?? []).includes(b.id)) missing.push(`${g.id}:${b.id}`)
    }
    expect(missing).toEqual([])
    // CC-203 前只有 store 软门控的代表：莱卡恩 / 柚叶 / 蕾米埃尔
    expect(table['1141']).toContain('lycaon.additional_graceful_pack_stun_multiplier')
    expect(table['1411']).toContain('1411.additional_ability.anomaly_damage_bonus')
    expect(table['1581']).toContain('1581.additional_ability.prismatic_buildup')
  })

  it('莱卡恩 1141：额外能力未触发时强行勾上也被引擎拦住；触发时放行', async () => {
    const off = await gatesFor([{ agentId: '1141' }, { agentId: '1071' }, ''])
    expect(off.get('lycaon.additional_graceful_pack_stun_multiplier')).toBe(false)
    const on = await gatesFor([{ agentId: '1141' }, { agentId: '1091' }, ''])
    expect(on.get('lycaon.additional_graceful_pack_stun_multiplier')).toBe(true)
  })

  it('全员 × 任一队友：引擎硬门控关 ⇒ store 默认不勾（不会默认勾上却被引擎静默丢弃）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    const table = additionalGateBuffTable(catalog.teammateBuffGroups)
    const getA = (id: string) => catalog.getAgent(id) ?? null
    const ids = [...catalog.agentsMap.keys()]
    // 已知的有意偏差：菲欧妮 tier3 另需异常数≥3（引擎侧 adjustAdditionalAbilityGates），store 默认只看额外能力。
    // CC-203 前另有跨来源条目（席德核心被动 / 潘引壶影画一 / 波可娜影画六）store 默认勾上、引擎丢弃——现 store 共读同一张表。
    const KNOWN_STRICTER: ReadonlySet<string> = new Set(['phoenix.weakness_anomaly_crit_dmg_tier3'])
    const bad: string[] = []
    let n = 0
    for (const owner of Object.keys(table)) {
      for (const mate of ['', ...ids]) for (const cin of [0, 6]) {
        if (mate === owner) continue
        const team = [owner, mate, ''].map((agentId, slot) => ({
          slot, agentId, cinemaLevel: slot === 0 ? cin : 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1, agent: agentId ? getA(agentId) : null,
        }))
        const gates = evalAdditionalAbilityBuffGates(team.filter(m => m.agentId) as never, getA, catalog.teammateBuffGroups)
        const store = new Map(deriveTeammateBuffEnabled(team, catalog.teammateBuffGroups, getA).map(r => [r.id, r.enabled]))
        for (const id of table[owner]) {
          if (KNOWN_STRICTER.has(id)) continue
          if (gates.get(id) === false && store.get(id) === true) bad.push(`${owner}c${cin}+${mate || '-'}:${id}`)
        }
        n++
      }
    }
    expect(n).toBeGreaterThan(1000)
    expect(bad).toEqual([])
  }, 120000)
})

/**
 * CC-199：拥有者未声明 additionalAbility 会整片漏网（1351 波可娜困迹 +30% 曾无条件生效）。
 * 通用门控在 stores/config.ts#deriveTeammateBuffEnabled：来源「额外能力」的 buff 按拥有者 spec.additionalAbility
 * 求值——拥有者无声明 ⇒ aaActive 为 undefined ⇒ 恒开。故全员断言：拥有「额外能力」buff ⇒ spec 必须声明。
 */
const AA_OWNER_EXEMPT: Record<string, string> = {
  // 南宫羽：teammate-buffs 原文没有触发条件（只写效果）；
  // R5 硬约束「不引入实测、不猜数据」⇒ 不编造条件。补数据时删掉本条即可被本测试接管。
  '1511': 'catalog 原文无触发条件',
}

describe('CC-199 全员：「额外能力」buff 的拥有者必须声明触发条件', () => {
  it('catalog teammate-buffs 与 spec teamBuffs 中来源为「额外能力」的 buff，其拥有者（组 id）spec 必有 additionalAbility', async () => {
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    const missing: string[] = []
    for (const g of catalog.teammateBuffGroups) {
      if (AA_OWNER_EXEMPT[g.id]) continue
      for (const b of g.buffs ?? []) {
        const label = b.source?.zhCN ?? b.sourceLabel?.zhCN ?? ''
        if (label !== '额外能力') continue
        if (!getAgentSpec(g.id)?.additionalAbility) missing.push(`${g.id}:${b.id}`)
      }
    }
    for (const agentId of catalog.agentsMap.keys()) {
      if (AA_OWNER_EXEMPT[agentId]) continue
      for (const b of getAgentSpec(agentId)?.teamBuffs ?? []) {
        if (b.source === '额外能力' && !getAgentSpec(agentId)?.additionalAbility) missing.push(`${agentId}:${b.id}`)
      }
    }
    expect(missing, '拥有「额外能力」buff 却无 spec.additionalAbility ⇒ deriveTeammateBuffEnabled 恒开').toEqual([])
  })

  it('catalog combatBuffs.additionalAbility.effects 全员为空（core/buff.ts#collectAgentBuffs 对其无门控施加）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    const withEffects = [...catalog.agentsMap.values()]
      .filter(a => (a.combatBuffs?.additionalAbility?.effects?.length ?? 0) > 0)
      .map(a => a.id)
    // 若数据侧开始给额外能力填数值：先给 collectAgentBuffs 接上 evalAdditionalAbility 门控，再改本断言
    expect(withEffects).toEqual([])
  })

  it('波可娜 1351：同阵营/强攻/命破队友 → 困迹两条开；异阵营击破队友 → 关', async () => {
    const off = await gatesFor([{ agentId: '1351' }, { agentId: '1011' }, ''])
    expect(off.get('pulchra_extra_trap_followup')).toBe(false)
    expect(off.get('pulchra_cinema_6_trap_all')).toBe(false)
    const attack = await gatesFor([{ agentId: '1351' }, { agentId: '1191' }, ''])
    expect(attack.get('pulchra_extra_trap_followup')).toBe(true)
    expect(attack.get('pulchra_cinema_6_trap_all')).toBe(true)
    const faction = await gatesFor([{ agentId: '1351' }, { agentId: '1071' }, ''])
    expect(faction.get('pulchra_extra_trap_followup')).toBe(true)
  })

  it('柚叶 1411（ownerId 为 slug \'youye\'）：store 通用门控按组 id 生效——异常队友开、无触发条件队友关', async () => {
    const enabledFor = async (mate: string) => {
      const { catalog, config } = await setupHarness([{ agentId: '1411' }, { agentId: mate }, ''])
      const rows = deriveTeammateBuffEnabled(config.team, catalog.teammateBuffGroups, id => catalog.getAgent(id))
      return rows.find(r => r.id === '1411.additional_ability.anomaly_damage_bonus')?.enabled
    }
    expect(await enabledFor('1261')).toBe(true) // 简：异常
    expect(await enabledFor('1011')).toBe(false) // 安比：击破、狡兔屋
  })

  it('莱卡恩 1141：同属性（冰）队友 → 触发；异属性异阵营非异常队友 → 不触发', async () => {
    const evalFor = async (mate: string) => {
      const { catalog, config } = await setupHarness([{ agentId: '1141' }, { agentId: mate }, ''])
      const members = buildMechanicTeamMembers(config, catalog)
      return evalAdditionalAbility(members, 0, catalog.getAgent('1141') ?? null, getAgentSpec('1141')?.additionalAbility)
    }
    expect(await evalFor('1091')).toBe(true)
    expect(await evalFor('1071')).toBe(false)
  })
})

describe('evalAdditionalAbilityBuffGates 门控语义（迁移前散落逻辑的逐位等价面）', () => {
  it('不在队 = 全关；未入表 buff id 不受门控（get 为 undefined）', async () => {
    const gates = await gatesFor([{ agentId: '1081' }, '', ''])
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    for (const buffIds of Object.values(additionalGateBuffTable(catalog.teammateBuffGroups))) {
      for (const id of buffIds) expect(gates.get(id), `${id} 应被门控关闭`).toBe(false)
    }
    expect(gates.get('some.unregistered.buff')).toBeUndefined()
  })

  it('凯撒 1071：无队友 → 关；有任意队友（非同阵营也算）→ 开（「可招架支援」近似）', async () => {
    const alone = await gatesFor([{ agentId: '1071' }, '', ''])
    expect(alone.get('caesar.additional_battle_spirit_dmg')).toBe(false)
    // 安比（1011，狡兔屋/电）与凯撒（卡吕冬之子/物理）不同阵营不同属性——只有「有任意队友」路径可达
    const withMate = await gatesFor([{ agentId: '1071' }, { agentId: '1011' }, ''])
    expect(withMate.get('caesar.additional_battle_spirit_dmg')).toBe(true)
  })

  it('丽娜 1211：同属性（电）队友 → 开；异属性异阵营队友 → 关', async () => {
    const electric = await gatesFor([{ agentId: '1211' }, { agentId: '1011' }, ''])
    expect(electric.get('rina.additional_electric_damage')).toBe(true)
    const off = await gatesFor([{ agentId: '1211' }, { agentId: '1071' }, ''])
    expect(off.get('rina.additional_electric_damage')).toBe(false)
  })

  it('菲欧妮 1641：tier2 由额外能力激活；tier3 另需队伍异常数≥3（影画6 = 需求-1）', async () => {
    // 无触发队友：全关
    const inactive = await gatesFor([{ agentId: '1641' }, { agentId: '1011' }, ''])
    expect(inactive.get('phoenix.weakness_anomaly_crit_dmg_tier2')).toBe(false)
    expect(inactive.get('phoenix.weakness_anomaly_crit_dmg_tier3')).toBe(false)
    // 简（1261，异常）触发额外能力；异常数 = 2 → tier2 开 / tier3 关
    const twoAnomaly = await gatesFor([{ agentId: '1641' }, { agentId: '1261' }, ''])
    expect(twoAnomaly.get('phoenix.weakness_anomaly_crit_dmg_tier2')).toBe(true)
    expect(twoAnomaly.get('phoenix.weakness_anomaly_crit_dmg_tier3')).toBe(false)
    // 三异常 → tier3 开
    const threeAnomaly = await gatesFor([{ agentId: '1641' }, { agentId: '1261' }, { agentId: '1561' }])
    expect(threeAnomaly.get('phoenix.weakness_anomaly_crit_dmg_tier3')).toBe(true)
    // 影画6：2 异常 + 有效数+1 → tier3 开
    const cinema6 = await gatesFor([{ agentId: '1641', cinemaLevel: 6 }, { agentId: '1261' }, { agentId: '1011' }])
    expect(cinema6.get('phoenix.weakness_anomaly_crit_dmg_tier3')).toBe(true)
  })

  it('潘引壶 1421：两条 buff（额外能力 + 影画1）同门控，开/关一致', async () => {
    const gates = await gatesFor([{ agentId: '1421' }, { agentId: '1011' }, ''])
    expect(gates.get('pan_yinhu.additional_stupefaction_dmg'))
      .toBe(gates.get('pan_yinhu.cinema_1_stupefaction_dmg'))
  })

  it('席德 1461：核心被动/影画2 两条 buff 与 additionalAbility 同条件（其他[强攻]在队）', async () => {
    const noAttacker = await gatesFor([{ agentId: '1461' }, { agentId: '1011' }, ''])
    expect(noAttacker.get('seed.core_vanguard_bright_attack')).toBe(false)
    expect(noAttacker.get('seed.cinema_2_encirclement_def_ignore')).toBe(false)
    // 星徽·比利（1081，强攻）在队
    const withAttacker = await gatesFor([{ agentId: '1461' }, { agentId: '1081' }, ''])
    expect(withAttacker.get('seed.core_vanguard_bright_attack')).toBe(true)
    expect(withAttacker.get('seed.cinema_2_encirclement_def_ignore')).toBe(true)
  })
})
