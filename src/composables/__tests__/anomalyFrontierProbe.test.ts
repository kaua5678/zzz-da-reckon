/**
 * 探针：低金前沿 × 异常/紊乱积储分层（PROBE_ANOMALY=1）。
 *
 * 背景：lowGoldFrontierProbe 显示前沿 80% fn；账本 Next 判定的「更大的低估主因」=
 * 异常/紊乱积储不足（雅 8% 队 anomaly 8.3M vs 南宫羽 21.7M 但主C偏低）、面板/拐力口径。
 * 本探针把「最低金+3 前沿」喂给真引擎，按队输出 元素积储进度/异常触发/紊乱伤/乱流伤/DOT伤，
 * 并按「队内异常角色」分组聚合（队数/平均比率/平均异常伤占比）——人工比对哪组异常角色的
 * 积储通道显著偏弱（= 积储口径缺口候选）。
 *
 * 跑法：PROBE_ANOMALY=1 npx vitest run src/composables/__tests__/anomalyFrontierProbe.test.ts
 * 可选：PROBE_ANOMALY_TOP=80（默认 60 = 只对比率最差的 N 队铺明细）、
 *       PROBE_ANOMALY_GOLDWINDOW=3（默认=最低金+3）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { submissionToDeploy, type ArchiveRun, type ArchiveRoom } from '@/composables/runArchiveImport'
import { applyDeployConfig } from '@/composables/runArchiveDeploy'
import { lowGoldFrontier, runLimitedGold } from '@/composables/limitedGold'
import type { BossPresetFile } from '@/types/bossPreset'

describe('探针：前沿异常/紊乱积储分层', () => {
  it.runIf(process.env.PROBE_ANOMALY)('批跑前沿队，按队输出积储/紊乱/乱流/DOT + 按异常角色分组聚合', async () => {
    const goldWindow = Number(process.env.PROBE_ANOMALY_GOLDWINDOW ?? 3)
    const topN = Number(process.env.PROBE_ANOMALY_TOP ?? 60)
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as {
      runs: ArchiveRun[]
      rooms: Record<string, ArchiveRoom & { seasonStart?: string; bossNameZh?: string }>
    }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { teamTotalDamage, anomalyPoolResult } = useResourceCalc()

    const nameOf = (id?: string) => (id ? (catalog.getAgent(id)?.name?.zhCN ?? id) : '?')
    const specialtyOf = (id: string) => catalog.getAgent(id)?.specialty ?? ''
    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const frontier = lowGoldFrontier(usable, { killedOnly: true, goldWindow })

    interface Row {
      run: ArchiveRun
      ratio: number
      hp: number
      damage: number
      gold: number
      team: string
      anomalyChars: string
      perElement: { element: string; buildup: number; cap: number; triggers: number }[]
      triggerTotal: number
      disorderCount: number
      disorderDamage: number
      turbulenceDamage: number
      dotDamage: number
      disorderShare: number
    }
    const rows: Row[] = []
    const t0 = Date.now()
    for (const run of frontier) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const damage = teamTotalDamage.value ?? 0
      const ap = anomalyPoolResult.value
      const perElement = (ap?.perElement ?? []).map(p => ({ element: p.element, buildup: p.totalBuildUp, cap: p.buildUpCap, triggers: p.triggerCount }))
      const disorderDamage = ap?.disorderDamage?.totalDamage ?? 0
      const turbulenceDamage = ap?.turbulenceDamage?.totalDamage ?? 0
      const dotDamage = ap?.standardDotDamage?.totalDamage ?? 0
      const anomalyDamageTotal = disorderDamage + turbulenceDamage + dotDamage
      rows.push({
        run,
        ratio: hp > 0 ? damage / hp : 0,
        hp, damage,
        gold: runLimitedGold(run.team),
        team: run.team.map(m => `${nameOf(m.agentId)}M${m.mindscape}`).join('/'),
        anomalyChars: run.team.map(m => m.agentId).filter(id => specialtyOf(id) === 'anomaly').map(id => nameOf(id)).join('+') || '（无异常）',
        perElement,
        triggerTotal: ap?.totalTriggerCount ?? 0,
        disorderCount: ap?.disorderCount ?? 0,
        disorderDamage,
        turbulenceDamage,
        dotDamage,
        disorderShare: damage > 0 ? anomalyDamageTotal / damage : 0,
      })
    }
    const elapsed = (Date.now() - t0) / 1000
    rows.sort((a, b) => a.ratio - b.ratio)
    const fn = rows.filter(r => !(r.damage >= r.hp && r.hp > 0) && r.run.bossKilled)

    console.log('\n=== 前沿异常/紊乱分层 ===')
    console.log('前沿', frontier.length, '队 | fn', fn.length, '| 批跑', elapsed.toFixed(1), 's')
    console.log('比率    金 异常角色 | 异常触发Σ 紊乱(次/伤) 乱流伤 DOT伤 异常伤占比 | 队伍')

    // 明细：比率最差 topN 队（含每元素进度）
    for (const r of rows.slice(0, topN)) {
      const el = r.perElement.map(p =>
        `${p.element}:${Math.round(p.buildup).toLocaleString()}/${p.cap}(${p.triggers})`).join(' ')
      console.log(
        (r.ratio * 100).toFixed(0).padStart(3) + '% ',
        String(r.gold).padStart(2),
        r.anomalyChars.padEnd(14),
        String(r.triggerTotal).padStart(5),
        `${r.disorderCount}/${Math.round(r.disorderDamage / 1e6).toFixed(1)}M`.padStart(12),
        (r.turbulenceDamage / 1e6).toFixed(1) + 'M'.padStart(8),
        (r.dotDamage / 1e6).toFixed(1) + 'M'.padStart(7),
        (r.disorderShare * 100).toFixed(0) + '%'.padStart(7),
        '|', r.team,
      )
      if (r.ratio < 0.5) console.log(`        └ 元素积储: ${el}`)
    }

    // 按异常角色分组聚合（层诊断）
    console.log('\n=== 按队内异常角色分组（平均比率 / 平均异常伤占比 / 平均紊乱伤）===')
    const groups = new Map<string, { n: number; ratioSum: number; shareSum: number; disorderSum: number; triggerSum: number }>()
    for (const r of rows) {
      const g = groups.get(r.anomalyChars) ?? { n: 0, ratioSum: 0, shareSum: 0, disorderSum: 0, triggerSum: 0 }
      g.n++; g.ratioSum += r.ratio; g.shareSum += r.disorderShare; g.disorderSum += r.disorderDamage; g.triggerSum += r.triggerTotal
      groups.set(r.anomalyChars, g)
    }
    const gs = [...groups.entries()].sort((a, b) => a[1].ratioSum / a[1].n - b[1].ratioSum / b[1].n)
    console.log('异常角色组        队数  平均比率 平均异常伤占比 平均紊乱伤 平均触发')
    for (const [key, g] of gs) {
      console.log(
        (key || '（无异常队）').padEnd(16),
        String(g.n).padStart(4),
        (g.ratioSum / g.n * 100).toFixed(0).padStart(6) + '%',
        (g.shareSum / g.n * 100).toFixed(0).padStart(8) + '%',
        (g.disorderSum / g.n / 1e6).toFixed(1).padStart(9) + 'M',
        (g.triggerSum / g.n).toFixed(0).padStart(9),
      )
    }

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.run.bossKilled)).toBe(true)
  }, 3600000)
})
