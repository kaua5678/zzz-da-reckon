/**
 * CC-63：roundInputs#expandExecutedToCounts 的平A兜底改走模块钩子 expandBasicFill，
 * 与原编排层写死（伊德海莉 1051 / 「11号」1041 / 其余 basic）逐值相等（Object.is 精确比较）。
 */
import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs } from '@/composables/resourceCalc/roundInputs'
import { findMoveById } from '@/composables/resourceCalc/skillRows'
import type { AgentSkills } from '@/types/catalog'

type Out = Record<string, { slot: number; moveId: string; count: number }>
// 对照基准：照抄原 roundInputs.ts 的 if/else（只含平A兜底部分）
function legacy(agentIdOf: (slot: number) => string, skillsOf: (id: string) => AgentSkills | undefined, fill: Record<number, number>): Out {
  const out: Out = {}
  const add = (slot: number, moveId: string, count: number) => {
    if (count <= 0) return
    const key = `${slot}:${moveId}`
    const cur = out[key]
    if (cur) cur.count += count
    else out[key] = { slot, moveId, count }
  }
  for (const [slotStr, fillSec] of Object.entries(fill)) {
    const slot = Number(slotStr)
    const fillerAgentId = agentIdOf(slot)
    if (fillerAgentId === '1051') {
      const skills = skillsOf(fillerAgentId)
      const slam = findMoveById(skills, '1051007')
      const follow = findMoveById(skills, '1051003')
      const loopTime = 1 + (slam?.actionTime ?? 0) + (follow?.actionTime ?? 0)
      const loops = loopTime > 0 ? fillSec / loopTime : 0
      add(slot, '1051007', loops)
      add(slot, '1051003', loops)
    } else if (fillerAgentId === '1041') {
      const skills = skillsOf(fillerAgentId)
      const rep = findMoveById(skills, '1041008')
      const repT = rep?.actionTime ?? 1.828
      const reps = repT > 0 ? fillSec / repT : 0
      add(slot, '1041008', reps)
    } else {
      add(slot, 'basic', fillSec)
    }
  }
  return out
}

describe('CC-63 平A兜底 → 模块钩子 expandBasicFill', () => {
  it('全 catalog 角色轮流放 0 槽 + 伊德海莉 / 11号 固定槽：展开结果与原写死逐值相等', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1051' }, { agentId: '1041' }, { agentId: '1211' }])
    const calc = useResourceCalc()
    const inputs = createConvergenceRoundInputs({ configStore: config, catalogStore: catalog,
      panels: calc.panels, resourceConfig: calc.resourceConfig, globalAnomalyMultiplier: computed(() => 1) })
    const skillsOf = (id: string) => catalog.agentSkillsByAgentMap.get(id)
    const agentIdOf = (slot: number) => config.team[slot]?.agentId ?? ''
    const fill = { 0: 7.37, 1: 5.1, 2: 4.2 }
    // 固定队：两个声明者都命中
    const fixed = inputs.expandExecutedToCounts({}, fill)
    expect(fixed).toEqual(legacy(agentIdOf, skillsOf, fill))
    expect(Object.keys(fixed).sort()).toEqual(['0:1051003', '0:1051007', '1:1041008', '2:basic'])
    expect(fixed['0:1051007'].count).toBeGreaterThan(0)
    expect(fixed['1:1041008'].count).toBeGreaterThan(0)
    // 已有连段展开的 executed 与兜底叠加（同 key 累加顺序不变）
    const ex = { a: { slot: 0, moveId: '1051007', count: 2 } }
    const legacyEx = legacy(agentIdOf, skillsOf, fill)
    legacyEx['0:1051007'] = { slot: 0, moveId: '1051007', count: 2 + legacyEx['0:1051007'].count }
    expect(inputs.expandExecutedToCounts(ex, fill)['0:1051007']).toEqual(legacyEx['0:1051007'])
    // 全 catalog 角色轮流放 0 槽（查别名误报）
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    for (const id of ids) {
      config.team[0].agentId = id
      expect(inputs.expandExecutedToCounts({}, { 0: 6.5 }), id).toEqual(legacy(agentIdOf, skillsOf, { 0: 6.5 }))
    }
  }, 120000)
})
