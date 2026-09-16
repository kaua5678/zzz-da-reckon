/**
 * damagePool 额外能力门控的**角色唯一性锁**（round 10 批次①的验收面）。
 *
 * 立项依据（2026-09-16 本会话实测，非推断）：
 * `damagePool.ts` 里 5 处 `charResult.agentId === '…'` 与 `(execPanel?.additionalAbilityActive ?? 0) > 0`
 * 联立。round 10 交接文档把这批标成「字段判据即可，agentId 判断大概率冗余，可独立成一小批先做」——
 * **实测证伪**：`additionalAbilityActive` 由 `resourceCalc/helpers.ts:649` 写入，判据是
 * `getAgentSpec(agent.id)?.additionalAbility` 存在即求值，而 **53 个 spec 都声明了 additionalAbility**
 * ⇒ 这是一个**全角色共享的面板字段**，「字段非零」只蕴含「本槽角色的额外能力触发了」，
 * **完全不蕴含「本槽角色是般岳/可琳/希格莉德/仪玄」**。删掉 agentId 判断 = 把般岳的明王、
 * 可琳的扫除帮手、希格莉德的天际联军、仪玄的凝神**发给全游戏所有额外能力触发的角色**。
 *
 * 本文件是那条结论的**可红性锁**：删掉任一处 agentId 判断，下面的「锁」用例必须精确变红。
 * 已实测：临时删掉 4 处（保留字段门控）⇒ `timeGolden` 报 **81 条伤害变化、最大 +17.695%**
 * （`auto-1461-1521-1361` = 席德/希希芙/扳机，队里根本没有这四个角色）；
 * 而 `allAgentsSweep`(125) 与四个角色自己的测试文件**全绿**——即**现有测试网对这条缺陷全盲**，
 * 这也是本文件必须存在的原因。
 * ⚠ `timeGolden` 把 dmg 归为「信息项」只断言时间账（EXIT=0 仍打印 delta），**不能**当 dmg 守卫用。
 *
 * 判据（round 9 教训①的移植）：不许只写「不报错」——必须**正控 + 反锁**成对，
 * 否则「分支是死的」与「守卫没生效」不可区分。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

/** 被门控的四个角色（damagePool.ts:441/455/466/484） */
const GATED = ['1471', '1061', '1591', '1371']

/** 通用槽位配置（沿用 banyue.test.ts 的 baseConfig 口径） */
const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

async function setupTeam(ids: [string, string, string]) {
  const catalog = useCatalogStore()
  await catalog.load()
  const config = useConfigStore()
  for (let s = 0; s < 3; s++) {
    config.team[s] = { slot: s, agentId: ids[s], cinemaLevel: 0, ...baseConfig } as any
  }
  return config
}

/** 本队有几个槽的额外能力被判定为触发（证明用例不是空转） */
function activeAaCount(config: ReturnType<typeof useConfigStore>, catalog: ReturnType<typeof useCatalogStore>): number {
  let n = 0
  for (let s = 0; s < 3; s++) {
    if (!config.team[s]?.agentId) continue
    if ((computePanelPhases(s, config, catalog)?.inCombat.additionalAbilityActive ?? 0) > 0) n++
  }
  return n
}

/** 只可能由这四个角色产生的伤害行标记（悠真的「失衡增伤…（轴内直加）」不算——它是第 6 处、形态不同） */
const ROLE_ONLY_MARKERS = [
  '明王+',                                   // 般岳 1471
  '浸染增伤+',                               // 希格莉德 1591
  '凝神暴伤+', '凝神贯穿+',                   // 仪玄 1371
  '失衡增伤+']                               // 可琳 1061（本用例为非轴队，只会出「（覆盖率近似）」）

describe('damagePool 额外能力门控：agentId 判断不可删（字段非角色唯一）', () => {
  it('前提：additionalAbilityActive 是共享面板字段——不含这四人的队里照样会为 1', async () => {
    // 1431 叶瞬光(需要 support/defense 队友) + 1481 琉音 + 1311 耀嘉音：三个都不是被门控角色
    const config = await setupTeam(['1431', '1481', '1311'])
    expect(GATED).not.toContain('1431')
    const catalog = useCatalogStore()
    const n = activeAaCount(config, catalog)
    // 这条是**前提断言**：若它变 0，说明本队没人触发额外能力 ⇒ 下面的锁是空转（假绿），必须先修本用例
    expect(n, '前提失效：本队无额外能力触发，锁用例会空转').toBeGreaterThan(0)
  })

  it('★ 正控：般岳+支援队里，般岳行必须带「明王+」（证明标记可被检出）', async () => {
    const config = await setupTeam(['1471', '1481', ''])
    const catalog = useCatalogStore()
    expect(activeAaCount(config, catalog), '般岳额外能力未触发，正控不成立').toBeGreaterThan(0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const rows = calc.damagePoolRows.value
    const marked = rows.filter(r => (r.note ?? '').includes('明王+'))
    expect(marked.length, '正控失败：般岳队里检不到明王标记 ⇒ 本锁对「分支是死的」不敏感').toBeGreaterThan(0)
    // 标记只应出现在般岳自己的行上
    expect(marked.every(r => r.agentId === '1471')).toBe(true)
  })

  it('★ 锁：不含 1471/1061/1591/1371 的队，额外能力全触发也绝不能出现这四族标记', async () => {
    const config = await setupTeam(['1431', '1481', '1311'])
    const catalog = useCatalogStore()
    expect(activeAaCount(config, catalog), '前提失效：本队无额外能力触发，本锁空转').toBeGreaterThan(0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const rows = calc.damagePoolRows.value
    expect(rows.length, '伤害池为空 ⇒ 本锁空转').toBeGreaterThan(0)
    const leaked = rows
      .filter(r => !GATED.includes(r.agentId))
      .flatMap(r => ROLE_ONLY_MARKERS.filter(m => (r.note ?? '').includes(m)).map(m => `${r.agentId} ${r.moveId} ${m}`))
    expect(leaked, `删掉 damagePool 的 agentId 判断后，这四个角色的专属增伤会漏给全游戏：${leaked.join(' / ')}`).toEqual([])
  })

  it('★ 锁（第二支队）：1561/1521/1461 队同理（覆盖 timeGolden 实测 +17.7% 的那类队）', async () => {
    const config = await setupTeam(['1461', '1521', '1361'])
    const catalog = useCatalogStore()
    expect(activeAaCount(config, catalog), '前提失效：本队无额外能力触发，本锁空转').toBeGreaterThan(0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const rows = calc.damagePoolRows.value
    const leaked = rows
      .filter(r => !GATED.includes(r.agentId))
      .flatMap(r => ROLE_ONLY_MARKERS.filter(m => (r.note ?? '').includes(m)).map(m => `${r.agentId} ${r.moveId} ${m}`))
    expect(leaked, `角色专属增伤泄漏：${leaked.join(' / ')}`).toEqual([])
  })
})
