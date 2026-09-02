/**
 * 倍率融合（src/data/moveFusions.ts + resourceCalc/helpers.ts fusedRowValue）护栏。
 *
 * 口径（用户 2026-09）：nanoka 原文 param.desc 用 `{Skill:A}+{Skill:B}*n` 编码
 * 「哪些段属于同一次动作」。同一招式名下多个 param = 多个独立动作，不能混加。
 * 星见雅强化特殊技·飞雪：斩击(#1+#2)=第一次 E，追击(#3+#4)=第二次 E（再耗 40 能量，通常不打）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { fusedRowValue, getRowValue, findMoveById } from '@/composables/resourceCalc/helpers'
import { moveFusionByMoveId } from '@/data/moveFusions'

describe('倍率融合：fusedRowValue（单一事实源 moveFusions）', () => {
  it('星见雅·斩击 = 飞雪#1 + 飞雪#2 = 788.3%（第一次 E）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091009', 'damage')).toBeCloseTo(315.8 + 472.5, 6)
    // 未登记融合的段仍走单段值
    expect(getRowValue(findMoveById(skills, '1091009'), 'damage')).toBeCloseTo(315.8, 6)
  })

  it('星见雅·追击 = 飞雪#3 + 飞雪#4 = 967.2%（第二次 E，独立动作）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091011', 'damage')).toBeCloseTo(386.9 + 580.3, 6)
    // 斩击(#1+#2)与追击(#3+#4)是两个组，不能混加
    expect(fusedRowValue(skills, '1091009', 'damage')).not.toBeCloseTo(315.8 + 472.5 + 386.9 + 580.3, 6)
  })

  it('星见雅·连携技春临 = #1+#2+#3 = 1258.3%（一次连携全打）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1091' }])
    const skills = catalog.getAgentSkills('1091')
    expect(fusedRowValue(skills, '1091015', 'damage')).toBeCloseTo(377.6 + 377.6 + 503.1, 6)
  })

  it('加权融合：希希芙·毒牙 = #1×3 + #2', async () => {
    const { catalog } = await setupHarness([{ agentId: '1521' }])
    const skills = catalog.getAgentSkills('1521')
    const g = moveFusionByMoveId.get('1521008')!
    expect(g.terms).toEqual([
      { moveId: '1521008', count: 3 },
      { moveId: '1521009', count: 1 },
    ])
    const expected = getRowValue(findMoveById(skills, '1521008'), 'damage') * 3
      + getRowValue(findMoveById(skills, '1521009'), 'damage')
    expect(fusedRowValue(skills, '1521008', 'damage')).toBeCloseTo(expected, 6)
  })

  it('珂蕾妲·沸腾熔炉 = 打击(#1) + 引爆(#2)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1101' }])
    const skills = catalog.getAgentSkills('1101')
    expect(fusedRowValue(skills, '1101104', 'damage')).toBeCloseTo(305.2 + 1212.1, 6)
  })

  it('月城柳·月华流转 = 突刺(#1) + 下砸(#2)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1221' }])
    const skills = catalog.getAgentSkills('1221')
    expect(fusedRowValue(skills, '1221022', 'damage')).toBeCloseTo(327.7 + 756.2, 6)
  })

  it('简·萨霍夫跳 = 连续攻击(#1+#2) + 终结一击(#3)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1261' }])
    const skills = catalog.getAgentSkills('1261')
    expect(fusedRowValue(skills, '1261007', 'damage')).toBeCloseTo(602.2 + 965 + 323, 6)
  })

  it('照·兔兔连斩 = #1 + #2 = 4375.2%（终结技一次全打）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1341' }])
    const skills = catalog.getAgentSkills('1341')
    expect(fusedRowValue(skills, '1341014', 'damage')).toBeCloseTo(3499.9 + 875.3, 6)
  })

  it('真斗·孤影·断獠（连打最大） = #1 + #2 = 1141.0%', async () => {
    const { catalog } = await setupHarness([{ agentId: '1441' }])
    const skills = catalog.getAgentSkills('1441')
    expect(fusedRowValue(skills, '1441024', 'damage')).toBeCloseTo(333.9 + 807.1, 6)
  })

  it('千夏·泡泡糖轰炸 = #1 + #2 = 1827.4%（完整强特）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1491' }])
    const skills = catalog.getAgentSkills('1491')
    expect(fusedRowValue(skills, '1491007', 'damage')).toBeCloseTo(1588.3 + 239.1, 6)
  })

  it('千夏·特别拍照技巧（协同） = #1 + #2——仅登记口径（引擎不选 0 能耗强特）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1491' }])
    const skills = catalog.getAgentSkills('1491')
    expect(fusedRowValue(skills, '1491008', 'damage')).toBeCloseTo(1656.4 + 248.6, 6)
  })

})

describe('倍率融合：真引擎回填（enrichExecutionPlan）', () => {
  it('部署星见雅后，飞雪执行行倍率 = 斩击 788.3%、春临 = 1258.3%', async () => {
    await setupHarness([{ agentId: '1091' }, { agentId: '1031' }, { agentId: '1131' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    const ex = exs.find(e => e.moveId === '1091009')
    const chain = exs.find(e => e.moveId === '1091015')
    expect(ex).toBeTruthy()
    expect(ex?.damageMultiplier).toBeCloseTo(788.3, 3)
    expect(ex?.dazeMultiplier).toBeCloseTo(
      getRowValue(findMoveById(useCatalogStore().getAgentSkills('1091'), '1091009'), 'daze')
      + getRowValue(findMoveById(useCatalogStore().getAgentSkills('1091'), '1091010'), 'daze'),
      3,
    )
    expect(chain?.damageMultiplier).toBeCloseTo(1258.3, 3)
  })

  it('部署照后，终结技执行行倍率 = 兔兔连斩 4375.2%', async () => {
    await setupHarness([{ agentId: '1341' }, { agentId: '1091' }, { agentId: '1031' }])
    const { resourceResult } = useResourceCalc()
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1341')?.executions ?? []
    const ex = exs.find(e => e.moveId === '1341014')
    expect(ex).toBeTruthy()
    expect(ex?.damageMultiplier).toBeCloseTo(4375.2, 3)
    // 引擎只物化主段：#2 不再单独成行，避免双计
    expect(exs.some(e => e.moveId === '1341023')).toBe(false)
  })
})

// 探针：只做诊断，PROBE_FUSION=1 时打印雅队伍飞雪/春临的融合后倍率与总伤害
describe('探针：融合生效后雅队伤害', () => {
  it.runIf(process.env.PROBE_FUSION)('打印融合后倍率', async () => {
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as any
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as any
    await setupHarness([{ agentId: '1091' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { resourceResult, teamTotalDamage } = useResourceCalc()
    const { submissionToDeploy } = await import('@/composables/runArchiveImport')
    const { applyDeployConfig } = await import('@/composables/runArchiveDeploy')
    const run = archive.runs.find((r: any) => r.team.some((m: any) => m.agentId === '1091') && r.bossKilled)
    const room = archive.rooms[run.targetId]
    applyDeployConfig(configStore, submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart), bossFile.bosses, bossFile.phaseViews ?? [])
    const hp = configStore.enemy.hp ?? 0
    const dmg = teamTotalDamage.value ?? 0
    const exs = resourceResult.value?.characters.find(c => c.agentId === '1091')?.executions ?? []
    console.log('\n融合探针：', run.id, 'boss', room?.bossNameZh, 'HP', Math.round(hp), 'DMG', Math.round(dmg), 'ratio', (dmg / hp * 100).toFixed(1) + '%')
    for (const e of exs) {
      if (['1091009', '1091015'].includes(e.moveId)) console.log('  ', e.moveName, '×' + e.count, 'mult', e.damageMultiplier)
    }
    expect(exs.find(e => e.moveId === '1091009')?.damageMultiplier).toBeCloseTo(788.3, 3)
  }, 120000)
})
