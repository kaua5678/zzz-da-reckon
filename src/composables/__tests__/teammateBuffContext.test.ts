/** CC-49：teammateBuffSourceContextFromStores 与原展示层内联组装逐值一致 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { teammateBuffSourceContextFromStores } from '@/composables/teammateBuffContext'

describe('teammateBuffSourceContextFromStores', () => {
  it('与原 TeamConfigPage/ImpactChart 内联依赖组装的结果逐值相等（含来源面板）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    const inline = buildTeammateBuffSourceContext(config.team, {
      teammateBuffGroups: catalog.teammateBuffGroups,
      driveDiscSetsMap: catalog.driveDiscSetsMap,
      statRules: catalog.statRules,
      getAgent: (id) => catalog.getAgent(id),
      getWEngine: (id) => catalog.getWEngine(id),
      isTeammateBuffEnabled: (id) => config.isTeammateBuffEnabled(id),
      enemyWeakness: config.enemy.weakness,
    })
    const got = teammateBuffSourceContextFromStores(config, catalog)
    expect(Object.keys(got.sourcePanelsByOwner).length).toBeGreaterThan(0)
    expect(got).toEqual(inline)
  }, 60000)
})
