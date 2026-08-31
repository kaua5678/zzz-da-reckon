/**
 * 引擎确定性回归（2026-08）：
 * 根因——teammate-buffs 异步竞态：useResourceCalc 工厂不 await 地触发 loadTeammateBuffs，
 * 面板在数据未就绪时照算（无队友 buff），fetch 返回后数值漂移；setAgent 的 buff 同步
 * 同样时机敏感（数据晚到 = 整队漏 buff）。同配置两次全新计算曾给出 12/3,9/1 vs 12/4,8/1。
 * 修复——resourceConfig 就绪门（teammateBuffsReady）+ 数据晚到自动重同步（config store watch）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

beforeEach(() => {
  mockStaticFetch()
})

function setupTeam() {
  const config = useConfigStore()
  config.setAgent(0, '1051'); config.setWEngine(0, '14105'); config.setCinemaLevel(0, 1)
  config.setAgent(1, '1141')
  config.setAgent(2, '1451'); config.setWEngine(2, '14145'); config.setCinemaLevel(2, 1)
  return useResourceCalc()
}

function snapshot(calc: ReturnType<typeof useResourceCalc>) {
  const rr = calc.resourceResult.value!
  return {
    dmg: calc.teamTotalDamage.value,
    counts: rr.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`),
  }
}

describe('引擎确定性', () => {
  it('就绪门：teammate-buffs 未就绪时 resourceResult=null（不再产出半载错值），就绪后恢复', async () => {
    newPinia()
    const catalog = useCatalogStore()
    await catalog.load() // 只加载 catalog——teammate-buffs 仍在途
    const calc = setupTeam()
    expect(calc.resourceResult.value).toBeNull()

    await catalog.loadTeammateBuffs()
    await nextTick() // 让「晚到重同步」watch 跑完
    expect(calc.resourceResult.value).not.toBeNull()
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
  })

  it('双全新会话（各自完整加载）：同配置结果逐位一致', async () => {
    const run = async () => {
      newPinia()
      const catalog = useCatalogStore()
      await catalog.load()
      await catalog.loadTeammateBuffs()
      const calc = setupTeam()
      await nextTick()
      return snapshot(calc)
    }
    const a = await run()
    const b = await run()
    expect(b.counts).toEqual(a.counts)
    expect(b.dmg).toBe(a.dmg)
  })
})
