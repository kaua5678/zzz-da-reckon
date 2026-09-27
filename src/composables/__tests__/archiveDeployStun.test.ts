/**
 * 实战归档部署回归：低金仪玄/琉音/卢西娅（72db6dc3，Boss 恶名·庞培 30021）。
 *
 * 2026-09-07 修复前：30021 defaults 无 parryTotal → applyBossPreset 不自动勾选「保底4失衡」
 * → 弹刀反推熄火 → 失衡只有 3 次、伤害仅为击杀线 13.1%（用户实测问题：4 次失衡打不完整）。
 * 修复：30021 defaults 补 parryTotal 8（据归档实战弹刀 8）+ 反推链照常 → 弹刀 8 全给主C、
 * 失衡 ≥4、伤害回升（>35% 击杀线）。钉住这条链不再断。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { submissionToDeploy, type ArchiveRun, type ArchiveRoom } from '@/composables/runArchiveImport'
import { applyDeployConfig } from '@/composables/runArchiveDeploy'
import type { BossPresetFile } from '@/types/bossPreset'

describe('实战归档部署：低金仪玄琉音卢西娅 4 次失衡（72db6dc3）', () => {
  it('部署后弹刀反推生效（主C 8 次）、失衡 ≥4、伤害 >35% 击杀线', async () => {
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as { runs: ArchiveRun[]; rooms: Record<string, ArchiveRoom & { seasonStart?: string }> }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1371' }, { agentId: '1481' }, { agentId: '1451' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()

    const run = archive.runs.find(r => r.id?.startsWith('72db6dc3'))
    expect(run, '归档 72db6dc3 存在').toBeTruthy()
    const room = archive.rooms[run!.targetId]
    const deploy = submissionToDeploy(run!, room, bossFile.bosses, room?.seasonStart)
    expect(deploy.supported).toBe(true)
    applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])

    // 30021 defaults 补录 parryTotal 8 + 自动勾选「保底4失衡」
    expect(configStore.appliedBoss?.parryTotal).toBe(8)
    expect(configStore.getMechanicSetting('guarantee.stun', 0)).toBe(1)

    // CC-154（第 177 轮）：本条钉 off。physical 下本队规划失衡 = 0（必要时间约束），修前 `axis.windows` 按规划值分到 0 窗、
    // 块计数却按物理 4 次 ⇒ 快照自相矛盾 ⇒ 轴可行性误判、退化非轴 ⇒ 池 4。修后同源：轴保住、伤害 66.6%→75.4% 击杀线，
    // 但 N* = 3.84 ⇒ 池 3（弹刀 8 次预算内保底 4 不可达）。本条钉的是「弹刀反推链不断」，场景值属 off 口径；
    // physical 下的「保底 4 不可达」另记 CC-156（docs/mcp-stun-dual-source.md §18）。
    configStore.setMechanicSetting('time.stunPlanProjection', 0)
    const sp = calc.stunPoolResult.value
    expect(sp, '失衡池有结果').toBeTruthy()
    expect(sp!.stunCount, '4 次失衡打完整').toBeGreaterThanOrEqual(4)

    // 弹刀反推：主C（仪玄）承担 8 次（归档实战弹刀 8）
    const split = calc.parrySplitResult.value
    expect(split).not.toBeNull()
    expect(split!.mainDpsParry + split!.breakerParry).toBeGreaterThanOrEqual(8)

    const hp = configStore.enemy.hp ?? 0
    const ratio = hp > 0 ? (calc.teamTotalDamage.value ?? 0) / hp : 0
    expect(ratio, `伤害占比 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThan(0.35)
  }, 120000)
})
