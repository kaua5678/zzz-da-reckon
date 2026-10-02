/**
 * CC-393 锁：轴内「[表]」技能表直读的判定只有一份（`resourceCalc/axisTableDirect.ts`），
 * 编辑器候选池与伤害结算都走它；已被建模的招式（融合并入段 / 模块隐藏招式）不可直读。
 * 改动前先读 docs/mcp-calc-core-architecture.md CC-393。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { agentAxisHiddenMoves } from '@/composables/agentMechanicView'
import { axisTableDirectCandidates } from '@/composables/resourceCalc/axisTableDirect'
import { MOVE_FUSION_GROUPS } from '@/data/moveFusions'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import type { StunAxisAction } from '@/types/resource'

const tick = () => new Promise(r => setTimeout(r, 40))
const FUSED_MEMBERS = new Set(MOVE_FUSION_GROUPS.flatMap(g => g.terms.map(t => t.moveId).filter(id => id !== g.moveId)))
const basicOnly = (): StunAxisAction[] => [0, 1, 2].map(slot => ({ slot, moveId: 'basic', count: 1, startTime: slot }))

async function runAxis(team: string[], actions: StunAxisAction[]) {
  const { config } = await setupHarness(team.map(agentId => ({ agentId, cinemaLevel: 0 })))
  config.autoYidhariAxis = false
  config.stunAxisPlans = []
  config.stunAxes = [{ name: '轴1', actions }]
  config.useStunAxis = true
  const calc = useResourceCalc()
  await tick()
  return calc
}
const tableRows = (calc: ReturnType<typeof useResourceCalc>, slot: number) =>
  calc.damagePoolRows.value.filter(r => r.slot === slot && r.source === '轴内·技能表直读')

describe('CC-393 轴内 [表] 直读判定（编辑器与结算同源）', () => {
  it('普查（命座 0）：全部角色的 [表] 候选不含融合并入段、模块隐藏招式与有执行行的招式', async () => {
    const first = await setupHarness([{ agentId: '1211' }, { agentId: '1181' }, { agentId: '1031' }])
    const ids = [...first.catalog.agentsMap.keys()].sort()
    let total = 0
    const bad: string[] = []
    for (let i = 0; i < ids.length; i += 3) {
      const team = ids.slice(i, i + 3)
      while (team.length < 3) team.push(ids[team.length])
      const calc = await runAxis(team, basicOnly())
      const catalog = useCatalogStore()
      for (const c of calc.resourceResult.value?.characters ?? []) {
        const backed = new Set(c.executions.map(e => e.moveId))
        const hidden = new Set(agentAxisHiddenMoves(c.agentId))
        for (const { move } of axisTableDirectCandidates(c.agentId, catalog.getAgentSkills(c.agentId), backed)) {
          total++
          if (FUSED_MEMBERS.has(move.id) || hidden.has(move.id) || backed.has(move.id)) bad.push(`${c.agentId}:${move.id}`)
        }
      }
    }
    expect(total, '反空洞：普查确有 [表] 候选').toBeGreaterThanOrEqual(150)
    expect(bad).toEqual([])
  })

  it('结算：融合并入段（希希芙毒牙 #2 1521009）放进轴不再按 [表] 加直伤——毒牙执行行已按 #1×3+#2 融合', async () => {
    const calc = await runAxis(['1521', '1211', '1031'], [
      { slot: 0, moveId: '1521008', count: 1, startTime: 0 },
      { slot: 0, moveId: '1521009', count: 3, startTime: 0.6 },
    ])
    expect(calc.damagePoolRows.value.some(r => r.slot === 0 && r.moveId === '1521008' && r.totalDamage > 0), '反空洞：毒牙执行行').toBe(true)
    expect(tableRows(calc, 0).map(r => r.moveId)).toEqual([])
  })

  it('结算：模块隐藏招式放进轴不出 [表] 直伤（伊德海莉连携 #1 1051015 / 雨果强特终结 1291010）', async () => {
    // 1051015：连携无条件固定用 #2 1051025；1291010：模块用合成行补齐终结一击（按决算与否拆分）
    const calc = await runAxis(['1051', '1291', '1031'], [
      { slot: 0, moveId: '1051015', count: 1, startTime: 0 },
      { slot: 1, moveId: '1291010', count: 1, startTime: 1 },
    ])
    expect(tableRows(calc, 0).map(r => r.moveId)).toEqual([])
    expect(tableRows(calc, 1).map(r => r.moveId)).toEqual([])
  })

  it('结算：真正没建模的融合主段（星见雅追击 1091011）可直读，倍率 = 整组求和（#3 + #4）', async () => {
    const calc = await runAxis(['1091', '1211', '1031'], [{ slot: 0, moveId: '1091011', count: 1, startTime: 0 }])
    const rows = tableRows(calc, 0)
    expect(rows.map(r => r.moveId)).toEqual(['1091011'])
    const skills = useCatalogStore().getAgentSkills('1091')
    const expected = getRowValue(findMoveById(skills, '1091011'), 'damage') + getRowValue(findMoveById(skills, '1091012'), 'damage')
    expect(expected, '反空洞').toBeGreaterThan(0)
    expect(rows[0].multiplier).toBeCloseTo(expected, 6)
  })

  it('青衣强化特殊技按三段融合（CC-394）：执行行倍率 = #1 + #2 + #3，#2 / #3 不再作为 [表] 候选', async () => {
    const calc = await runAxis(['1251', '1211', '1031'], basicOnly())
    const skills = useCatalogStore().getAgentSkills('1251')
    const seg = (id: string) => getRowValue(findMoveById(skills, id), 'damage')
    const expected = seg('1251011') + seg('1251021') + seg('1251022')
    expect(seg('1251021'), '反空洞').toBeGreaterThan(0)
    const row = calc.damagePoolRows.value.find(r => r.slot === 0 && r.moveId === '1251011' && r.type === '直伤')
    expect(row?.multiplier).toBeCloseTo(expected, 6)
    const c = calc.resourceResult.value?.characters?.[0]
    const ids = axisTableDirectCandidates('1251', skills, new Set((c?.executions ?? []).map(e => e.moveId))).map(h => h.move.id)
    expect(ids).not.toContain('1251021')
    expect(ids).not.toContain('1251022')
  })

  it('莱卡恩点按段 1141016 不作为 [表] 候选（CC-394：模块按点按次数出行）', async () => {
    const calc = await runAxis(['1141', '1211', '1031'], [{ slot: 0, moveId: '1141016', count: 1, startTime: 0 }])
    expect(tableRows(calc, 0).map(r => r.moveId)).toEqual([])
  })

  it('源码：编辑器与结算都调用 axisTableDirect，不各自重写判定', () => {
    const page = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    const pool = readFileSync(resolve(__dirname, '../resourceCalc/damagePoolDirect.ts'), 'utf8')
    expect(page).toMatch(/axisTableDirectCandidates\(/)
    expect(pool).toMatch(/axisTableDirectMove\(/)
    expect(page).not.toMatch(/\['special', 'assist', 'ultimate', 'chain'\]/)
    expect(pool).not.toMatch(/backed\.has\(mid\)/)
  })
})
