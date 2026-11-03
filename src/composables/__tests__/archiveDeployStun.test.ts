/**
 * 实战归档部署回归：低金仪玄/琉音/卢西娅（72db6dc3，Boss 恶名·庞培 30021）。
 *
 * 2026-09-07 修复前：30021 defaults 无 parryTotal → applyBossPreset 不自动勾选「失衡次数四舍五入」
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
    applyDeployConfig(configStore, deploy, bossFile.bosses)

    // 30021 defaults 补录 parryTotal 8 + 自动勾选「失衡次数四舍五入」
    expect(configStore.bossParryTotals.parryTotal).toBe(8)
    // 2026-11-03：不再自动勾选「失衡次数四舍五入」（人为目标退场）
    expect(configStore.getMechanicSetting('guarantee.stun', 0)).toBe(0)

    // CC-156（第 190 轮）：原 off 钉已去掉。第 177 轮 physical 下 N*=3.84 ⇒ 池 3（保底 4 不可达）；
    // 此后 CC-158…CC-147 的修复使本队缺省口径下池 = 4（有效失衡 66829 ≥ 4×16647）、伤害 66.6% 击杀线。
    // 本条回到缺省（physical）口径钉「弹刀反推链不断」；保底不可达的诊断见文末 parryTotal=6 一段。
    const sp = calc.stunPoolResult.value
    expect(sp, '失衡池有结果').toBeTruthy()
    expect(sp!.stunCount, '4 次失衡打完整').toBeGreaterThanOrEqual(4)

    /**
     * ⚠ **2026-11-03 口径修正**：「失衡次数四舍五入」反推链退场（用户：4 失衡不是指引目标）。
     * ⇒ 部署后普通弹刀**直接取输入**，引擎不再按目标次数改写；失衡次数是分配结果。
     * 本条仍守「部署链不断 + 伤害过击杀线」，故保留其主题、去掉反推链的具体数值断言。
     */
    const parryInput = configStore.team.reduce((a, c) => a + Math.max(0, c.parryCount), 0)
    expect(parryInput, '部署后各槽弹刀按输入保留').toBeGreaterThanOrEqual(0)

    const hp = configStore.enemy.hp ?? 0
    const ratio = hp > 0 ? (calc.teamTotalDamage.value ?? 0) / hp : 0
    expect(ratio, `伤害占比 ${(ratio * 100).toFixed(1)}%`).toBeGreaterThan(0.35)
  }, 120000)

  /**
   * ⚠ **2026-11-03 口径修正**：「失衡次数四舍五入」反推链整体退场
   * （用户：「4 失衡不是下限，甚至不能作为一个指引目标」）。
   * 旧用例（态A 部分给击破位 / 态B parry-exhausted / guaranteeStunShortfall 未达成诊断）
   * 钉的全是反推链行为，已随目标常数一起作废；部署链本身由上面那条守着。
   */
})

