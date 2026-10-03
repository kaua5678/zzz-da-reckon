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
import { useConfigStore } from '@/stores/config'
import { agentAxisHiddenMoves } from '@/composables/agentMechanicView'
import { axisTableDirectCandidates, VARIANT_TARGETS } from '@/composables/resourceCalc/axisTableDirect'
import { getRegisteredAgentMechanics } from '@/mechanics'
import { BEN_EX_NORMAL_MOVE_IDS, BEN_EX_PARRY_MOVE_IDS, BEN_EX_PARRY_RATE_SETTING } from '@/mechanics/agents/ben'
import { MOVE_FUSION_GROUPS } from '@/data/moveFusions'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import type { StunAxisAction } from '@/types/resource'

const tick = () => new Promise(r => setTimeout(r, 40))
const FUSED_MEMBERS = new Set(MOVE_FUSION_GROUPS.flatMap(g => g.terms.map(t => t.moveId).filter(id => id !== g.moveId)))
const basicOnly = (): StunAxisAction[] => [0, 1, 2].map(slot => ({ slot, moveId: 'basic', count: 1, startTime: slot }))

async function runAxis(
  team: string[],
  actions: StunAxisAction[],
  mutateConfig?: (config: ReturnType<typeof useConfigStore>) => void,
) {
  const { config } = await setupHarness(team.map(agentId => ({ agentId, cinemaLevel: 0 })))
  config.autoYidhariAxis = false
  config.stunAxisPlans = []
  config.stunAxes = [{ name: '轴1', actions }]
  config.useStunAxis = true
  mutateConfig?.(config)
  const calc = useResourceCalc()
  await tick()
  return calc
}

/** 本角色命座 0 缺省 cfg 下的 [表] 候选 id 集合 + 执行行集合 */
async function candidatesFor(agentId: string) {
  const calc = await runAxis([agentId, '1211', '1031'], basicOnly())
  const c = calc.resourceResult.value?.characters?.find(ch => ch.agentId === agentId)
  const backed = new Set((c?.executions ?? []).map(e => e.moveId))
  const cands = new Set(
    axisTableDirectCandidates(agentId, useCatalogStore().getAgentSkills(agentId), backed).map(h => h.move.id),
  )
  return { backed, cands }
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
          if (FUSED_MEMBERS.has(move.id) || VARIANT_TARGETS.has(move.id) || hidden.has(move.id) || backed.has(move.id)) bad.push(`${c.agentId}:${move.id}`)
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

  it('卢西娅终结技按两段融合（CC-402）：执行行倍率 = 撞击 #1 + 强力打击 #2，#2 不再作为 [表] 候选', async () => {
    const calc = await runAxis(['1451', '1211', '1031'], basicOnly())
    const skills = useCatalogStore().getAgentSkills('1451')
    const seg = (id: string) => getRowValue(findMoveById(skills, id), 'damage')
    const expected = seg('1451024') + seg('1451017')
    expect(seg('1451017'), '反空洞').toBeGreaterThan(seg('1451024'))
    const row = calc.damagePoolRows.value.find(r => r.slot === 0 && r.moveId === '1451024' && r.type === '直伤')
    expect(row?.multiplier).toBeCloseTo(expected, 6)
    const c = calc.resourceResult.value?.characters?.[0]
    const ids = axisTableDirectCandidates('1451', skills, new Set((c?.executions ?? []).map(e => e.moveId))).map(h => h.move.id)
    expect(ids).not.toContain('1451017')
  })

  it('CC-406 变体协同段：珂蕾妲 1101106 / 1101402 无论本在不在队都不是 [表] 候选；放进轴不出直伤', async () => {
    expect(VARIANT_TARGETS.has('1101106') && VARIANT_TARGETS.has('1101402'), '反空洞：变体表确有这两段').toBe(true)
    for (const mate of ['1121', '1211']) {
      const calc = await runAxis(['1101', mate, '1031'], [
        ...basicOnly(),
        { slot: 0, moveId: '1101106', count: 1, startTime: 10 },
        { slot: 0, moveId: '1101402', count: 1, startTime: 12 },
      ])
      const skills = useCatalogStore().getAgentSkills('1101')
      const c = calc.resourceResult.value?.characters?.[0]
      const ids = axisTableDirectCandidates('1101', skills, new Set((c?.executions ?? []).map(e => e.moveId))).map(h => h.move.id)
      expect(ids, `mate=${mate}`).not.toContain('1101106')
      expect(ids, `mate=${mate}`).not.toContain('1101402')
      // 真正没建模的非强化特殊技协同引爆 1101103 仍可直读（反空洞：排除的是变体段，不是整个角色）
      expect(ids, `mate=${mate}`).toContain('1101103')
      const direct = calc.damagePoolRows.value.filter(r => r.slot === 0 && (r.moveId === '1101106' || r.moveId === '1101402') && r.totalDamage > 0)
      expect(direct, `mate=${mate}`).toEqual([])
      // 终结技执行行本身仍在结算（本在队 = 协同倍率）
      const ult = calc.damagePoolRows.value.find(r => r.slot === 0 && r.moveId === '1101401' && r.totalDamage > 0)
      expect(ult, `mate=${mate} 反空洞：终结技执行行`).toBeTruthy()
    }
  })

  it('莱卡恩点按段 1141016 不作为 [表] 候选（CC-394：模块按点按次数出行）', async () => {
    const calc = await runAxis(['1141', '1211', '1031'], [{ slot: 0, moveId: '1141016', count: 1, startTime: 0 }])
    expect(tableRows(calc, 0).map(r => r.moveId)).toEqual([])
  })

  /**
   * CC-402：cfg 二选一分支（`moveBranchGroups`）——模块按 cfg / 失衡态 / 长按 / 风眼数只发射一个分支，
   * 另一分支既无执行行、又不在静态 `axisHiddenMoves` 名单 ⇒ 会以 [表] 出现、放进轴即双计。
   * 锁「两个方向都隐藏」：组内任一成员有执行行 ⇒ 组内其余成员不可为 [表] 候选。
   */
  it('CC-402 分支组：缺省 cfg 下每个带 moveBranchGroups 的模块，组内非执行行成员不在 [表] 候选', async () => {
    const mods = getRegisteredAgentMechanics().filter(m => (m.moveBranchGroups?.length ?? 0) > 0)
    expect(mods.length, '反空洞：确有模块声明 moveBranchGroups').toBeGreaterThanOrEqual(4)
    for (const mod of mods) {
      const agentId = mod.agentIds[0]
      const { backed, cands } = await candidatesFor(agentId)
      for (const group of mod.moveBranchGroups ?? []) {
        const executed = group.filter(id => backed.has(id))
        expect(executed.length, `${agentId} 分支组 ${group.join('/')} 应恰有一个分支在执行`).toBeGreaterThan(0)
        for (const id of group) {
          if (backed.has(id)) continue
          expect(cands.has(id), `${agentId} 非执行分支 ${id} 不应为 [表] 候选`).toBe(false)
        }
      }
    }
  })

  it('CC-402 分支组：本切到未招架 cfg（ben.exParrySuccessRate=0）后，招架两段 1121010/1121011 也不在候选', async () => {
    const calc = await runAxis(
      ['1121', '1211', '1031'],
      basicOnly(),
      config => config.setMechanicSetting(BEN_EX_PARRY_RATE_SETTING, 0),
    )
    const c = calc.resourceResult.value?.characters?.find(ch => ch.agentId === '1121')
    const backed = new Set((c?.executions ?? []).map(e => e.moveId))
    // 反空洞：切到未招架后确实由 1121008/1121009 出行
    for (const id of BEN_EX_NORMAL_MOVE_IDS) expect(backed.has(id), `${id} 应有执行行`).toBe(true)
    for (const id of BEN_EX_PARRY_MOVE_IDS) expect(backed.has(id), `${id} 不应有执行行`).toBe(false)
    const cands = new Set(
      axisTableDirectCandidates('1121', useCatalogStore().getAgentSkills('1121'), backed).map(h => h.move.id),
    )
    for (const id of BEN_EX_PARRY_MOVE_IDS) expect(cands.has(id), `招架分支 ${id} 不应为 [表] 候选`).toBe(false)
    for (const id of BEN_EX_NORMAL_MOVE_IDS) expect(cands.has(id), `执行分支 ${id} 不应为 [表] 候选`).toBe(false)
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
