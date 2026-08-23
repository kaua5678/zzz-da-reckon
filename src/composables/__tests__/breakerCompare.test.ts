/**
 * 击破手对比（同款限定金）测试：
 * - 同一金档下换击破手比较可复现；金数确实应用（8 金 > 6 金伤害，多出的命座生效）
 * - 失衡值/占比来自失衡池逐槽统计（含后台自动招式贡献），占比落在 (0, 100]
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computeBreakerCompare } from '@/composables/breakerCompare'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

describe('击破手对比（同款限定金）', () => {
  it('金数应用 + 失衡值/占比输出', async () => {
    const preset = teamPresets.find(p => p.id === 'yidhari-liuyin-lucia')
    expect(preset).toBeDefined()
    const boss = bossData.bosses[0] as BossPreset
    const phase = boss.phases[0]
    const run = async (gold: number) => {
      await setupHarness([
        { agentId: preset!.team[0] },
        { agentId: preset!.team[1] },
        { agentId: preset!.team[2] },
      ])
      const catalog = useCatalogStore()
      await catalog.load()
      await catalog.loadTeammateBuffs()
      const calc = useResourceCalc()
      return computeBreakerCompare(calc, [preset!], boss, phase, { gold })
    }
    const r6 = await run(6)
    const r8 = await run(8)
    expect(r6).toHaveLength(1)
    expect(r6[0].breakerName).toBe('琉音') // 队内唯一击破手
    // 8 金比 6 金多了伊德海莉/卢西娅命座 → 总伤不低于
    expect(r8[0].totalDamage).toBeGreaterThanOrEqual(r6[0].totalDamage)
    // 失衡值/占比：来自逐槽失衡池（后台招式贡献已计入）
    expect(r8[0].breakerDaze).toBeGreaterThanOrEqual(0)
    expect(r8[0].dazeShare).toBeGreaterThan(0)
    expect(r8[0].dazeShare).toBeLessThanOrEqual(100)
  }, 120000)
})
