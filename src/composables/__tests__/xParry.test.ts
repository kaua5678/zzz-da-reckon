/**
 * x弹刀（基塔布鲁，用户口径 2026-09-02）护栏：
 * 两人同时招架同一攻击——双方 parryCount 各 +xParryTotal（支援突击/喧响/失衡都算两人的），
 * 前台时间只计一份（非主弹窗位的 x 次轻弹刀/支援突击行 totalTime 豁免）。
 * 数据源：boss-presets.json 40006 defaults.xParryTotal=1（scripts/import-nanoka-bosses.mjs BOSS_DEFAULTS）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('x弹刀：双人招架、时间只计一份', () => {
  it('基塔布鲁：双方轻弹刀/支援突击行各 +1，非击破位的行时间豁免', async () => {
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as {
      bosses: { id: string; monster?: { stunVuln: number; stunTime: number }; defaults: { xParryTotal?: number } & Record<string, unknown>; phases: { phaseId: string; hp?: number }[] }[]
    }
    const boss = bossFile.bosses.find(b => b.id === '40006')!
    expect(boss.defaults.xParryTotal).toBe(1)
    await setupHarness([{ agentId: '1301' }, { agentId: '1011' }, { agentId: '1031' }])
    const configStore = useConfigStore()
    configStore.applyBossPreset(boss as never, boss.phases[0] as never, boss.monster as never, boss.defaults as never)
    expect(configStore.appliedBoss?.xParryTotal).toBe(1)

    const { resourceResult } = useResourceCalc()
    const res = resourceResult.value!
    // 双人招架：≥2 个角色有支援突击行
    const assists = res.characters.map(c => ({
      slot: c.slot,
      row: c.executions.find(e => e.category === 'assist' && e.moveName.includes('支援突击')),
    }))
    const withRows = assists.filter(a => a.row && (a.row!.count ?? 0) > 0)
    expect(withRows.length).toBeGreaterThanOrEqual(2)
    // 时间只计一份：恰有一个角色的支援突击行 totalTime < count×actionTime（x 次豁免），另一个照常计满
    const discounted = withRows.filter(a => (a.row!.totalTime ?? 0) < a.row!.count * a.row!.actionTime)
    const charged = withRows.filter(a => Math.abs((a.row!.totalTime ?? 0) - a.row!.count * a.row!.actionTime) < 1e-9)
    expect(discounted.length).toBe(1)
    expect(charged.length).toBeGreaterThanOrEqual(1)
  })
})
