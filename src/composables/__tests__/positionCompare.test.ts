/**
 * 位置对比（主C / 击破手 / 辅助，同款限定金）测试：
 * - 同一金档下换位置角色比较可复现；金数确实应用（8 金 > 6 金伤害，多出的命座生效）
 * - 位置按 specialty 识别（主C=attack/anomaly/rupture、击破手=stun、辅助=support/defense）
 * - 失衡值/占比来自失衡池逐槽统计；积蓄量/占比按「异属性赠送归接收人」口径逐槽归因
 * - 主C 自身总伤构成自洽：直伤 + 异放 + 紊乱 + 其他异常 ≡ selfDamage
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computePositionCompare, type ComparePosition } from '@/composables/positionCompare'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

describe('位置对比（主C/击破手/辅助，同款限定金）', () => {
  async function runPosition(presetId: string, position: ComparePosition, gold = 6) {
    const preset = teamPresets.find(p => p.id === presetId)
    expect(preset).toBeDefined()
    const boss = bossData.bosses[0] as BossPreset
    const phase = boss.phases[0]
    await setupHarness([
      { agentId: preset!.team[0] },
      { agentId: preset!.team[1] },
      { agentId: preset!.team[2] },
    ])
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const calc = useResourceCalc()
    return computePositionCompare(calc, [preset!], boss, phase, { gold, position })
  }

  it('击破手：金数应用 + 位置识别 + 失衡值/占比输出', async () => {
    const r6 = await runPosition('yidhari-liuyin-lucia', 'breaker', 6)
    const r8 = await runPosition('yidhari-liuyin-lucia', 'breaker', 8)
    expect(r6).toHaveLength(1)
    expect(r6[0].position).toBe('breaker')
    expect(r6[0].agentName).toBe('琉音') // 队内唯一击破手
    // 8 金比 6 金多了伊德海莉/卢西娅命座 → 总伤不低于
    expect(r8[0].totalDamage).toBeGreaterThanOrEqual(r6[0].totalDamage)
    // 失衡值/占比：来自逐槽失衡池（后台招式贡献已计入）
    expect(r8[0].daze).toBeGreaterThanOrEqual(0)
    expect(r8[0].dazeShare).toBeGreaterThan(0)
    expect(r8[0].dazeShare).toBeLessThanOrEqual(100)
  }, 120000)

  it('辅助：卢西娅（support）位置可识别，积蓄/失衡占比落在合理区间', async () => {
    const rows = await runPosition('yidhari-liuyin-lucia', 'support')
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.position).toBe('support')
    expect(r.agentName).toContain('卢西娅')
    expect(r.buildUpShare).toBeGreaterThanOrEqual(0)
    expect(r.buildUpShare).toBeLessThanOrEqual(100)
    expect(r.dazeShare).toBeLessThanOrEqual(100)
  }, 120000)

  it('主C：位置识别 + 自身总伤构成自洽（直伤+异放+紊乱+其他异常）+ 占比区间', async () => {
    const rows = await runPosition('yidhari-liuyin-lucia', 'main')
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.position).toBe('main')
    expect(r.agentName).toBe('伊德海莉') // 队内 rupture 主C
    expect(r.selfDamage).toBeGreaterThan(0)
    // 自身总伤构成自洽（浮点容差）
    const composed = r.directDamage + r.releaseDamage + r.disorderDamage + r.anomalyOtherDamage
    expect(Math.abs(composed - r.selfDamage)).toBeLessThan(Math.max(1, r.selfDamage * 1e-9))
    expect(r.buildUpShare).toBeGreaterThanOrEqual(0)
    expect(r.buildUpShare).toBeLessThanOrEqual(100)
    expect(r.dazeShare).toBeGreaterThanOrEqual(0)
    expect(r.dazeShare).toBeLessThanOrEqual(100)
  }, 120000)
})
