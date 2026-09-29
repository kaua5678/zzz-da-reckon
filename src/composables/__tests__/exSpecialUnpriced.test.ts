/**
 * 「强特有招式却无价」名单锁（第 339 轮，§24.163）。
 *
 * `findExSpecial` 在 catalog 的强特招式没有 energyCost 时记 `costType='free'`、`energyConsume=0`；
 * `resolveExSpecialCount`（core/resource/helpers.ts）对 `exSpecialEnergyConsume <= 0` 直接返回 0 次。
 * 也就是说「缺耗能数据」在引擎里等价于「这招永远不放」——且没有任何提示。
 * 同类角色的耗能都来自用户口径并由模块写入（1461 铁萼雨幕 60 / 1571 嗯呢弹幕 40+20×hold /
 * 1531 闪能），或由模块整体接管（skipGenericExSpecial）/ 走替代资源（costType='resource'）。
 *
 * 本测试锁住「剩下没人接」的名单。当前 = [1551]（佩洛伊斯·日华：原文「能量足够时发动」，
 * 但 catalog / nanoka energy_cost / gachabase sp_consume 均无数值；R5 不许自编 ⇒ 数据缺口，强特恒 0）。
 * - 新角色进来名单变长：先查耗能来源（catalog 补 energyCost 或用户口径进模块），再更新名单。
 * - 1551 拿到耗能（catalog 补上即自动生效，零代码）后名单变短：删掉它，并按数值卡解释 golden。
 */
import { describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { buildCharConfig } from '@/composables/resourceCalc/helpers'

describe('强特有招式却无价（缺耗能 ⇒ 静默 0 次）', () => {
  it('没有模块接管、也非替代资源的无价强特角色 == [1551]', async () => {
    newPinia(); mockStaticFetch()
    const c0 = useCatalogStore(); await c0.load()
    const ids = [...c0.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(50)
    const unpriced: string[] = []
    for (const id of ids) {
      newPinia(); mockStaticFetch()
      const catalog = useCatalogStore(); await catalog.load(); await catalog.loadBuildRecommendations()
      const config = useConfigStore()
      config.team[0] = { ...config.team[0], slot: 0, agentId: id } as any
      try { config.applyBuildRecommendationForSlot(0) } catch { /* 无推荐配装不影响耗能字段 */ }
      const cfg = buildCharConfig(0, config, catalog)
      if (!cfg || !cfg.exSpecialMoveId) continue
      if (cfg.skipGenericExSpecial) continue
      if (cfg.exSpecialCostType === 'resource') continue
      if ((cfg.exSpecialEnergyConsume ?? 0) > 0) continue
      unpriced.push(id)
    }
    expect(unpriced.sort()).toEqual(['1551'])
  }, 120000)
})
