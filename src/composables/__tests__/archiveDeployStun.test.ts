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
import { guaranteeStunShortfall } from '@/core/parrySplit'
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

    // 30021 defaults 补录 parryTotal 8 + 自动勾选「保底4失衡」
    expect(configStore.bossParryTotals.parryTotal).toBe(8)
    expect(configStore.getMechanicSetting('guarantee.stun', 0)).toBe(1)

    // CC-156（第 190 轮）：原 off 钉已去掉。第 177 轮 physical 下 N*=3.84 ⇒ 池 3（保底 4 不可达）；
    // 此后 CC-158…CC-147 的修复使本队缺省口径下池 = 4（有效失衡 66829 ≥ 4×16647）、伤害 66.6% 击杀线。
    // 本条回到缺省（physical）口径钉「弹刀反推链不断」；保底不可达的诊断见文末 parryTotal=6 一段。
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
    expect(guaranteeStunShortfall(sp!.stunCount, split), '保底已达成 ⇒ 无未达成提示').toBeNull()

    // CC-156：弹刀预算压到 5 次 ⇒ 5 次全部反推给击破位仍只有 3 次失衡 ⇒ 诊断为「预算用满」（此前静默降级）
    // 2026-10-03 第 427 轮 CC-402：卢西娅终结技并入 #2 段（失衡倍率随之并入）后，6 次弹刀已够 4 次失衡（实测 8/6 ⇒ 4，5…1 ⇒ 3），
    // 原「6 次仍只有 3 次」不再成立 ⇒ 预算改压到 5（锁的是诊断链，不是具体门槛）。
    // r652 CC-469′（轴态逐招份额与未覆盖窗口份额复合扣除 + 轴态 N 二分自洽）后本队 0 弹刀也有 4 次（eff 71.8k ≥ 4×16647），
    // 弹刀预算已压不出「保底不可达」⇒ 改抬 boss 失衡阈值制造场景（实测 r652，parryTotal=5：17800–18400 ⇒ 反推 2 次给击破位仍 4 次；
    // ≥19000 ⇒ 5 次全给击破位仍 3 次）。锁的仍是诊断链两态：反推在工作 / 预算用满；门槛变了照此重探，不改判据。
    configStore.appliedBoss!.presetParryTotal = 5
    configStore.enemy.stunValue = 18000
    const spA = calc.stunPoolResult.value!
    const splitA = calc.parrySplitResult.value
    expect(splitA?.breakerParry, '阈值抬高后反推应把部分弹刀给击破位').toBeGreaterThanOrEqual(1)
    expect(spA.stunCount, '反推生效 ⇒ 仍 4 次').toBeGreaterThanOrEqual(4)
    expect(guaranteeStunShortfall(spA.stunCount, splitA)).toBeNull()
    configStore.enemy.stunValue = 24000
    const sp6 = calc.stunPoolResult.value!
    const split6 = calc.parrySplitResult.value
    expect(split6?.breakerParry).toBe(5)
    expect(guaranteeStunShortfall(sp6.stunCount, split6)).toEqual({ target: 4, stunCount: 3, cause: 'parry-exhausted' })
  }, 120000)
})
