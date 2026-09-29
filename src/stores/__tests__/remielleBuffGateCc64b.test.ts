/**
 * CC-64b：deriveTeammateBuffEnabled 的蕾米埃尔档位门控改走模块钩子 teammateBuffGate，
 * 与原 store 写死（getRemielleAdditionalState + 5 个 buff id 分支）逐值相等——用**真实 catalog 角色**组队穷举。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import type { Agent, TeammateBuff, TeammateBuffGroup } from '@/types/catalog'

const GATED = [
  '1581.additional_ability.atk_1_anomaly',
  '1581.additional_ability.atk_2_anomaly',
  '1581.additional_ability.atk_3_anomaly',
  '1581.core_passive.refringe_3_anomaly',
  '1581.additional_ability.prismatic_buildup',
]
const CONTROL = '1581.core_passive.control'
// 照抄原 store 逻辑（teamAgents = 查得到 Agent 的队员，槽位顺序）
function legacyGate(team: Agent[], buffId: string, base: boolean): boolean {
  const remielleItem = team.find(agent => agent?.id === '1581')
  let st = { active: false, anomalyCount: 0, tier: 0 }
  if (remielleItem) {
    const remielleFaction = remielleItem.faction
    const otherAgents = team.filter(item => item !== remielleItem)
    const active = otherAgents.some(agent => agent?.specialty === 'anomaly' || (!!remielleFaction && agent?.faction === remielleFaction))
    const anomalyCount = team.filter(agent => agent?.specialty === 'anomaly').length
    st = { active, anomalyCount, tier: active ? Math.max(1, Math.min(3, anomalyCount)) : 0 }
  }
  if (buffId === GATED[0]) return base && st.active && st.tier === 1
  if (buffId === GATED[1]) return base && st.active && st.tier === 2
  if (buffId === GATED[2]) return base && st.active && st.tier === 3
  if (buffId === GATED[3]) return base && st.tier === 3
  if (buffId === GATED[4]) return base && st.active
  return base
}
const mkBuff = (id: string): TeammateBuff =>
  ({ id, sourceLabel: { zhCN: '核心被动' }, source: { zhCN: '核心被动' }, ownerId: '' }) as unknown as TeammateBuff
const mkGroup = (id: string, ids: string[]): TeammateBuffGroup =>
  ({ id, buffs: ids.map(mkBuff), name: { zhCN: id }, attribute: 'atk', specialty: 'attack' }) as unknown as TeammateBuffGroup
const slot = (agentId: string, i: number) => ({ slot: i, agentId, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 })

describe('CC-64b 蕾米埃尔档位门控 → 模块钩子 teammateBuffGate', () => {
  it('真实角色组队穷举（有 / 无蕾米埃尔，含「组在队但蕾米埃尔不在」）逐值相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1581' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    const ids2 = ids.filter(id => id !== '1581')
    const pairs: string[][] = []
    for (let a = 0; a < ids2.length; a++) for (let b = a + 1; b < ids2.length; b++) pairs.push([ids2[a], ids2[b]])
    let checked = 0
    let trues = 0
    const run = (team: string[], groupId: string) => {
      const out = deriveTeammateBuffEnabled(team.map(slot), [mkGroup(groupId, [...GATED, CONTROL])], getAgent)
      const agents = team.map(getAgent).filter((x): x is Agent => !!x)
      const base = agents.some(a => a.id === groupId)
      for (const o of out) {
        expect(o.enabled, `${team.join(',')}/${groupId}/${o.id}`).toBe(legacyGate(agents, o.id, base))
        checked++
        if (o.enabled) trues++
      }
    }
    for (const [x, y] of pairs) {
      run(['1581', x, y], '1581')
      run([x, '1581', y], '1581')
    }
    // 蕾米埃尔不在队、但 buff 组所属角色在队（base 真）⇒ 门控条必须 false（原 store 口径）
    for (const [x, y] of pairs.slice(0, 200)) run([x, y, ''], x)
    expect(checked).toBeGreaterThan(1000)
    expect(trues).toBeGreaterThan(0)
  }, 120000)
})
