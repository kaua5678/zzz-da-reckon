/**
 * 额外能力门控簇回归（规则 6 棘轮 burn-down 第 1 批的护栏）：
 *
 * ① 门控表 ADDITIONAL_GATE_BUFFS 与数据源一一对应——catalog `teammate-buffs.json` 里
 *    `source.zhCN === '额外能力'` 的 buff、spec `teamBuffs[].source === '额外能力'` 的条目
 *    必须都在表里（防「加了 buff 忘了门控 → 额外能力静默失效」），表里的 id 必须能解析回
 *    该角色的 catalog 组或 spec teamBuffs（防手滑 id / 迁移后陈旧 id）。
 * ② evalAdditionalAbilityBuffGates 的三条不可机械等同语义（helpers.ts 表头 ⚠）：
 *    凯撒 1071「有任意队友」近似、菲欧妮 1641 tier3 异常数≥3（含影画6 修正）、
 *    不在队 = 全关、未登记 buff 不受门控。
 *
 * 全部走 setupHarness（AGENTS §3：禁止自造 fetch stub）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import {
  ADDITIONAL_GATE_BUFFS,
  buildMechanicTeamMembers,
  evalAdditionalAbilityBuffGates,
} from '@/composables/resourceCalc/helpers'
import { getAgentSpec } from '@/specs/registry'

/** 按队伍装配门控 Map（与 computePanelPhases 的调用路径同参数形态） */
async function gatesFor(team: Array<{ agentId: string; cinemaLevel?: number } | ''>) {
  const { catalog, config } = await setupHarness(team)
  const members = buildMechanicTeamMembers(config, catalog)
  return evalAdditionalAbilityBuffGates(members, id => catalog.getAgent(id) ?? null)
}

describe('ADDITIONAL_GATE_BUFFS 与 catalog/spec 数据源一一对应', () => {
  it('每个登记角色：数据侧「额外能力」buff ⊆ 门控表；表内 id 全部可解析回该角色', async () => {
    const { catalog } = await setupHarness([{ agentId: '1081' }, '', ''])
    for (const [agentId, tableIds] of Object.entries(ADDITIONAL_GATE_BUFFS)) {
      const catalogBuffs = (catalog.teammateBuffGroups.find(g => g.id === agentId)?.buffs ?? [])
      const specBuffs = getAgentSpec(agentId)?.teamBuffs ?? []
      const knownIds = new Set([...catalogBuffs.map(b => b.id), ...specBuffs.map(b => b.id)])
      const dataSideAA = [
        ...catalogBuffs.filter(b => b.source?.zhCN === '额外能力').map(b => b.id),
        ...specBuffs.filter(b => b.source === '额外能力').map(b => b.id),
      ]
      // 完备性：数据侧新增「额外能力」来源 buff 必须登记进表，否则门控静默失效
      expect(dataSideAA.filter(id => !tableIds.includes(id)),
        `${agentId} 的「额外能力」buff 未登记进 ADDITIONAL_GATE_BUFFS`).toEqual([])
      // 反向：表里不许有解析不到的陈旧/手滑 id
      expect(tableIds.filter(id => !knownIds.has(id)),
        `${agentId} 的门控表 id 在 catalog/spec 中不存在`).toEqual([])
      // 登记角色必须有声明式 additionalAbility（否则 evalAdditionalAbility 返回 undefined = 恒关）
      expect(getAgentSpec(agentId)?.additionalAbility,
        `${agentId} 登记了门控表但 spec 无 additionalAbility 声明`).toBeTruthy()
    }
  })
})

describe('evalAdditionalAbilityBuffGates 门控语义（迁移前散落逻辑的逐位等价面）', () => {
  it('不在队 = 全关；未登记 buff id 不受门控（get 为 undefined）', async () => {
    const gates = await gatesFor([{ agentId: '1081' }, '', ''])
    for (const buffIds of Object.values(ADDITIONAL_GATE_BUFFS)) {
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
