/**
 * 探针：单队行级审计（PROBE_AUDIT=1）——找「算的伤害少」的系统性根因。
 *
 * 背景：damageSplitFrontierProbe 定位到异常队直伤侧 4-5 倍弱；用户 2026-09-02 裁决：
 * 跨队对比无效（每队属性不同），伤害少应另有原因。本探针做**队内**审计：
 * 每行输出 multiplier/count/perDamage/区值（每 100% 倍率 → 伤害），
 * 同一 slot 的「标准直伤行」区值一致 = 乘区管线自洽（无断链）；
 * 区值异常的孤立行（与同 slot 标准差 >2 倍）标 ⚠ 供人工核对。
 * 另输出每队 直伤/异常 的总倍率吞吐（Σ count×multiplier）与面板关键值。
 *
 * 跑法：PROBE_AUDIT=1 npx vitest run src/composables/__tests__/damageAuditProbe.test.ts
 * 可选：PROBE_AUDIT_TOP=10（默认 10 队按比率最差排）、PROBE_AUDIT_GOLDWINDOW=3
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { submissionToDeploy, type ArchiveRun, type ArchiveRoom } from '@/composables/runArchiveImport'
import { applyDeployConfig } from '@/composables/runArchiveDeploy'
import { lowGoldFrontier } from '@/composables/limitedGold'
import type { BossPresetFile } from '@/types/bossPreset'

const ANOMALY_TYPES = new Set(['异放', '乱流', '耀变', '灼烧', '感电', '侵蚀', '风化', '强击', '极性紊乱', '极性强击', '碎冰', '简6命附伤', '紊乱', '爱丽丝6命附伤', '畏缩 DOT'])
/** 标准直伤行：排除平A汇总（秒均折算行）与模块合成行（霜灼·破等自带行级加成） */
const NON_STANDARD = [/平A汇总/, /霜灼·破/]

describe('探针：单队行级审计（乘区管线自洽性）', () => {
  it.runIf(process.env.PROBE_AUDIT)('批跑最差 N 队，行级区值校验 + 总倍率吞吐', async () => {
    const goldWindow = Number(process.env.PROBE_AUDIT_GOLDWINDOW ?? 3)
    const topN = Number(process.env.PROBE_AUDIT_TOP ?? 10)
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as { runs: ArchiveRun[]; rooms: Record<string, ArchiveRoom & { seasonStart?: string }> }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const nameOf = (id?: string) => (id ? (catalog.getAgent(id)?.name?.zhCN ?? id) : '?')
    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const frontier = lowGoldFrontier(usable, { killedOnly: true, goldWindow })
    const rows: { run: ArchiveRun; ratio: number }[] = []
    for (const run of frontier) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      rows.push({ run, ratio: hp > 0 ? (calc.teamTotalDamage.value ?? 0) / hp : 0 })
    }
    rows.sort((a, b) => a.ratio - b.ratio)

    for (const { run, ratio } of rows.slice(0, topN)) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const total = calc.teamTotalDamage.value ?? 0
      console.log(`\n### ${ratio * 100 > 9 ? (ratio * 100).toFixed(0) : ratio.toFixed(2)}% | score=${run.score} t=${run.timeSeconds}s | HP=${(hp / 1e6).toFixed(1)}M 模型=${(total / 1e6).toFixed(1)}M | ${run.team.map(m => `${nameOf(m.agentId)}M${m.mindscape}`).join('/')}`)
      const pool = calc.damagePoolRows.value ?? []
      const standardRegion = new Map<number, number>()
      for (const r of pool) {
        const region = r.multiplier && r.multiplier > 0 && r.count > 0 ? r.totalDamage / (r.multiplier * r.count / 100) : 0
        if (region > 0 && !ANOMALY_TYPES.has(r.type) && !NON_STANDARD.some(re => re.test(r.name))) {
          const prev = standardRegion.get(r.slot)
          if (prev === undefined) standardRegion.set(r.slot, region)
        }
      }
      const perSlotThroughput = new Map<number, { directMult: number; anomalyMult: number }>()
      for (const r of pool) {
        const s = perSlotThroughput.get(r.slot) ?? { directMult: 0, anomalyMult: 0 }
        const m = (r.multiplier ?? 0) * (r.count ?? 0)
        if (ANOMALY_TYPES.has(r.type)) s.anomalyMult += m
        else s.directMult += m
        perSlotThroughput.set(r.slot, s)
      }
      for (const r of pool) {
        const region = r.multiplier && r.multiplier > 0 && r.count > 0 ? r.totalDamage / (r.multiplier * r.count / 100) : 0
        const std = standardRegion.get(r.slot)
        const flag = region > 0 && std && !ANOMALY_TYPES.has(r.type) && (region / std > 2 || region / std < 0.5) ? ' ⚠' : ''
        console.log(`  s${r.slot} ${r.type.padEnd(3)} ${r.name.slice(0, 22).padEnd(24)} ×${r.count.toFixed(1).padStart(5)} mult=${String(r.multiplier ?? 0).padStart(7)} per=${(r.perDamage / 1e3).toFixed(1).padStart(8)}K 区=${(region / 1e3).toFixed(1).padStart(7)}K${flag}`)
      }
      console.log('  吞吐(Σ count×mult%): ' + [...perSlotThroughput.entries()].map(([s, v]) => `s${s} 直${(v.directMult / 100).toFixed(0)}K% 异${(v.anomalyMult / 100).toFixed(0)}K%`).join(' | '))
    }
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.run.bossKilled)).toBe(true)
  }, 3600000)
})
