/**
 * 第三人海选（computeSlotSweepPoints，队伍对比页「第三人海选」图型）测试：
 * - sweepTeamForCandidate 纯函数：候选补海选槽、固定队友按其余两槽槽位序填充
 * - 候选池：固定成员被剔除（即使显式出现在候选池）；candidateIds 覆盖生效
 * - 集成冒烟：伤害降序、槽位正确、现场快照恢复（跑完不留痕）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computeSlotSweepPoints, slotSweepCandidates, sweepTeamForCandidate } from '@/composables/teamTimeline'
import type { BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const firstBoss = bossData.bosses[0]
const firstPhase = firstBoss.phases[0]

async function boot() {
  const h = await setupHarness([
    { agentId: '1371' },
    { agentId: '1451' },
    { agentId: '1481' },
  ])
  // 与 teamTimeline.test 同因：applyTeamToStore 的推荐配装没加载会静默留在兜底防御套上
  await h.catalog.loadBuildRecommendations()
  return h
}

describe('sweepTeamForCandidate（纯函数）', () => {
  it('候选补海选槽，固定队友按其余两槽的槽位序填充', () => {
    // 海选击破槽（1）→ fixed = [主C, 支援]
    expect(sweepTeamForCandidate(1, ['1371', '1451'], '1481')).toEqual(['1371', '1481', '1451'])
    // 海选主C槽（0）→ fixed = [击破, 支援]
    expect(sweepTeamForCandidate(0, ['1141', '1451'], '1371')).toEqual(['1371', '1141', '1451'])
    // 海选支援槽（2）→ fixed = [主C, 击破]
    expect(sweepTeamForCandidate(2, ['1371', '1141'], '1451')).toEqual(['1371', '1141', '1451'])
  })
})

describe('computeSlotSweepPoints（集成冒烟）', () => {
  it('固定 1371+1451 海选击破槽：降序、槽位正确、排除固定成员、现场恢复', async () => {
    await boot()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const before = JSON.stringify(config.team)
    const res = await computeSlotSweepPoints(calc, {
      slot: 1,
      fixed: ['1371', '1451'],
      boss: firstBoss,
      phase: firstPhase,
      budget: 6,
      candidateIds: ['1481', '1571', '1021'],
    })
    expect(res.slot).toBe(1)
    expect(res.fixed).toEqual(['1371', '1451'])
    // 结果按伤害降序，不保留候选输入序 → 断言集合
    expect([...res.points.map(p => p.candidateId)].sort()).toEqual(['1021', '1481', '1571'])
    for (const p of res.points) {
      expect(p.team[0]).toBe('1371')
      expect(p.team[1]).toBe(p.candidateId)
      expect(p.team[2]).toBe('1451')
      expect(p.damage).toBeGreaterThan(0)
    }
    for (let i = 1; i < res.points.length; i++) {
      expect(res.points[i - 1]!.damage).toBeGreaterThanOrEqual(res.points[i]!.damage)
    }
    // 快照恢复：跑完不留痕
    expect(JSON.stringify(config.team)).toBe(before)
  })

  it('固定成员即使被显式列入候选池也被剔除；shouldAbort 中止后保留已算部分', async () => {
    await boot()
    const calc = useResourceCalc()
    const res = await computeSlotSweepPoints(calc, {
      slot: 1,
      fixed: ['1371', '1451'],
      boss: firstBoss,
      phase: firstPhase,
      budget: 6,
      candidateIds: ['1371', '1481', '1451'],
    })
    expect(res.points.map(p => p.candidateId)).toEqual(['1481'])

    const partial = await computeSlotSweepPoints(calc, {
      slot: 2,
      fixed: ['1371', '1481'],
      boss: firstBoss,
      phase: firstPhase,
      budget: 6,
      candidateIds: ['1451', '1141'],
      shouldAbort: () => true,
    })
    expect(partial.points).toEqual([])
  })

  it('默认候选池 = 目录可见角色 − 固定 2 人（slotSweepCandidates）', async () => {
    await boot()
    const catalog = useCatalogStore()
    const pool = slotSweepCandidates(catalog, ['1371', '1481'])
    expect(pool).not.toContain('1371')
    expect(pool).not.toContain('1481')
    expect(pool.length).toBe(catalog.displayAgents.length - 2)
    // candidateIds 覆盖时同样剔除固定成员
    expect(slotSweepCandidates(catalog, ['1371', '1481'], ['1371', '1451', '1481'])).toEqual(['1451'])
  })
})
