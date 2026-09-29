/**
 * CC-294：赠送行落点与引擎时间预留同源（core/resource/crossAgentSupply#supplyTargetTeamSlot）。
 * 修前 chainGift 直读 `liuyin.ultimateTargetSlot`，诺姆 cfg 上却没有这个键（buildCharConfig 只写本模块设置）
 * ⇒ 设置 = 1 时引擎在槽 2（上一位）物化赠链行并预留时间，编排层又在槽 1 追加一份：两名队友各 6 次。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('CC-294 诺姆赠链落点与引擎预留同源', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })
  for (const stale of [-1, 1, 2]) {
    it(`残留 liuyin.ultimateTargetSlot=${stale}（琉音不在队）⇒ 赠链只落在上一位（槽 2）`, async () => {
      const catalog = useCatalogStore(); await catalog.load(); await catalog.loadTeammateBuffs()
      const config = useConfigStore()
      config.team[0] = { slot: 0, agentId: '1571', cinemaLevel: 0, ...baseConfig } as any
      config.team[1] = { slot: 1, agentId: '1191', cinemaLevel: 0, ...baseConfig } as any
      config.team[2] = { slot: 2, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
      config.syncTeammateBuffsFromTeam()
      config.enemy.stunCountLock = 4
      config.setMechanicSetting('liuyin.ultimateTargetSlot', stale)
      const rr = useResourceCalc().resourceResult.value!
      const giftBySlot = rr.characters.map(c => ({
        slot: c.slot,
        count: c.executions.filter(e => e.chainGift).reduce((sum, e) => sum + e.count, 0),
      })).filter(g => g.count > 0)
      expect(giftBySlot.map(g => g.slot)).toEqual([2])
      expect(giftBySlot[0].count).toBeGreaterThan(0)
    })
  }
})
