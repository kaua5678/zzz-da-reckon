import { describe, expect, it } from 'vitest'
import { effectScope, reactive } from 'vue'
import { getActivePinia, setActivePinia } from 'pinia'
import { setupHarness } from '@/test/harness'
import { createConfigModel, type ConfigCatalogReader } from '@/stores/config'

/** 捕获 readonly 输入；查询只读这份数据，不绑定任何 Pinia action。 */
async function fixture() {
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const agents = catalog.agentsMap
  const engines = catalog.wEnginesMap
  const recommendations = catalog.buildRecommendations
  const reader: ConfigCatalogReader = {
    ready: catalog.ready,
    teammateBuffsReady: catalog.teammateBuffsReady,
    teammateBuffsLoaded: catalog.teammateBuffsLoaded,
    buildRecsLoaded: catalog.buildRecsLoaded,
    teammateBuffGroups: catalog.teammateBuffGroups,
    displayAgents: catalog.displayAgents,
    displayWEngines: catalog.displayWEngines,
    displayDriveDiscSets: catalog.displayDriveDiscSets,
    driveDiscSetsMap: catalog.driveDiscSetsMap,
    statRules: catalog.statRules,
    getAgent: id => agents.get(id),
    getWEngine: id => engines.get(id),
    getBuildRecommendation: id => recommendations?.characters[id],
  }
  return { config, reader }
}

describe('显式配置 Model', () => {
  it('没有 active Pinia 时仍能装配，且不改变 UI store 或全局 Pinia', async () => {
    const { config, reader } = await fixture()
    const sourceBefore = JSON.stringify(config.$state)
    const previous = getActivePinia()
    const scope = effectScope()
    try {
      setActivePinia(undefined)
      const draft = scope.run(() => reactive(createConfigModel(reader)))!
      draft.setAgent(0, reader.displayAgents[0]!.id)
      draft.setCinemaLevel(0, 2)
      draft.setMechanicSetting('test.scenario-sentinel', 37)
      expect(draft.team[0]!.agentId).toBe(reader.displayAgents[0]!.id)
      expect(draft.team[0]!.cinemaLevel).toBe(2)
      expect(draft.getMechanicSetting('test.scenario-sentinel', 0)).toBe(37)
      expect(getActivePinia()).toBeUndefined()
      expect(JSON.stringify(config.$state)).toBe(sourceBefore)
    } finally {
      scope.stop()
      setActivePinia(previous)
    }
  })
})

describe('setAgent 清空槽位', () => {
  it('setAgent(slot, "") 必须同步清空该槽音擎（搬自 configSnapshot.test.ts，r372 S3）', async () => {
    // 原判据在 configSnapshot.test.ts 的 CC-340 用例里；模块删除后搬来此处——它测的是 store 行为，与快照无关。
    const { config } = await setupHarness([{ agentId: '1191' }, { agentId: '1371', wEngineId: '14137' }, { agentId: '1311' }])
    expect(config.team[1].wEngineId).toBe('14137')
    config.setAgent(1, '')
    expect(config.team[1].agentId).toBe('')
    expect(config.team[1].wEngineId, '清空角色槽位时必须同步清空 wEngineId').toBe('')
  })
})
