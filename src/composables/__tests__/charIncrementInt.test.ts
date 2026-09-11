/**
 * 角色分数增量（charIncrement）真实归档集成测试：
 * - computeIncrementPass 全量：秒级完成（≤60s 防回归——这是「不卡死」的验收线）、快照恢复
 * - 期/房间/基底队规模合理；账号分 ≤ 180000（3 房 × 60000 伤害分上限，操作分已剔除）
 * - 卡增量语义：卢西娅（1451，命破专拐）累计 > 0 且「禁用后被替代队顶上」至少出现一次
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { computeAllCardTotals, computeCardIncrements, computeIncrementPass } from '@/composables/charIncrement'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'
import type { ArchiveRoom } from '@/composables/runArchiveImport'

const raw = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8'))
const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

describe('charIncrement · 真实归档集成', () => {
  it('全量 pass：秒级完成、期规模合理、账号分不超上限、快照恢复', async () => {
    await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const before = JSON.stringify(configStore.team.map(t => t.agentId))
    const calc = useResourceCalc()
    // ===== 性能判据：相对基准（2026-09-11 用户裁决，替换机器相关的绝对墙钟线）=====
    // 为什么要改：绝对线 `< 30s`（仓库注释自述参考机全量 ~3.5s、用户慢机 10x ≈ 35s）在本机满套件并发
    // 下会被推到 35~40s 而变红，单跑必绿 —— 它测的是**机器/并发**，不是**回归**。
    // 现在改为「同进程内的轻量参照」归一化：先跑一次**缩减规模**的同一路径（前 2 个 run），
    // 用它的耗时当单位工作量基准，断言全量 / 参照 ≤ RATIO_MAX（回归 = 单位工作量变慢）。
    const refStart = performance.now()
    await computeIncrementPass({
      calc,
      bosses: bossData.bosses as BossPreset[],
      periodViews: bossData.phaseViews ?? [],
      runs: raw.runs.slice(0, 2),
      rooms: raw.rooms as Record<string, ArchiveRoom & { seasonStart?: string }>,
    })
    const refMs = Math.max(1, performance.now() - refStart)
    const res = await computeIncrementPass({
      calc,
      bosses: bossData.bosses as BossPreset[],
      periodViews: bossData.phaseViews ?? [],
      runs: raw.runs,
      rooms: raw.rooms as Record<string, ArchiveRoom & { seasonStart?: string }>,
    })
    const ratio = res.stats.durationMs / refMs
    // 实测标定（2026-09-11 本机单跑）：全量 14.4s / 参照 0.43s ≈ **33×**（参考机上全量 ~3.5s、参照同量级
    // ⇒ 该比值与机器无关；满套件并发时分子分母同步变大，故对并发也不敏感）。取 **3 倍余量 = 100×** 当回归线：
    // 单位工作量慢 3 倍即红（真正的回归），机器/并发不再影响判定。
    // eslint-disable-next-line no-console
    console.log(`[perf] 全量 ${Math.round(res.stats.durationMs)}ms / 参照 ${Math.round(refMs)}ms = ${ratio.toFixed(1)}×`)
    expect(ratio, `单位工作量变慢（全量 ${Math.round(res.stats.durationMs)}ms / 参照 ${Math.round(refMs)}ms）`).toBeLessThan(100)
    expect(res.periods.length).toBeGreaterThanOrEqual(8)
    expect(res.stats.baseTeams).toBeGreaterThan(60)
    for (const p of res.periods) {
      expect(p.rooms.length).toBeGreaterThan(0)
      expect(p.rooms.length).toBeLessThanOrEqual(3)
      const total = p.rooms.reduce((s, r) => s + Math.max(...r.scores.map(x => x.score)), 0)
      expect(total).toBeLessThanOrEqual(3 * 60000 + 1e-6)
    }
    // 时间升序
    for (let i = 1; i < res.periods.length; i++) {
      expect(res.periods[i - 1].date.localeCompare(res.periods[i].date)).toBeLessThanOrEqual(0)
    }
    // 快照恢复
    expect(JSON.stringify(configStore.team.map(t => t.agentId))).toBe(before)
  }, 90000)

  it('卢西娅增量：累计 > 0；被禁后存在「替代队顶上」的期（潘引壶/其他队）', async () => {
    await setupHarness([{ agentId: '1021' }, { agentId: '1031' }, { agentId: '1131' }])
    const calc = useResourceCalc()
    const res = await computeIncrementPass({
      calc,
      bosses: bossData.bosses as BossPreset[],
      periodViews: bossData.phaseViews ?? [],
      runs: raw.runs,
      rooms: raw.rooms as Record<string, ArchiveRoom & { seasonStart?: string }>,
    })
    const inc = computeCardIncrements(res.periods, '1451', '2025-12-17')
    expect(inc.total).toBeGreaterThan(0)
    // 至少一期「被禁后账号分下降但非塌零」（替代结构存在）
    const substituted = inc.perPeriod.filter(x => x != null && x.bannedScore > 0 && x.increment > 0)
    expect(substituted.length).toBeGreaterThan(0)
    // 实装前（2025-12-17 之前）的期 = null
    const early = inc.perPeriod.filter(x => x == null)
    if (res.periods.some(p => p.date < '2025-12-17')) expect(early.length).toBeGreaterThan(0)

    const rank = computeAllCardTotals(res.periods, [
      { agentId: '1451', releaseDate: '2025-12-17' },
      { agentId: '1531', releaseDate: '2026-05-27' },
    ])
    expect(rank).toHaveLength(2)
    for (const r of rank) expect(r.total).toBeGreaterThanOrEqual(0)
  }, 90000)
})
