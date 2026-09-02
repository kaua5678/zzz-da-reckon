/**
 * 探针：低金顶分前沿（最低金+3）× 真引擎批跑，找出「计算器伤害过低」的队伍。
 *
 * 背景：实战对比页 RunArchivePage 的「仅看低金顶分」筛选 = lowGoldFrontier(killedOnly, goldWindow)。
 * 用户口径（2026-09）：对照最低金+3 的实战表现，计算器伤害过低的队伍大概率是**关键招式没录入**。
 * 本探针把该前沿整批喂给真引擎，按「预测伤害 / Boss 血量」升序输出低估队伍清单，
 * 并对最被低估（实战击杀但预测远低于击杀线 = fn）的队伍铺开每角色招式执行计划，
 * 用于人工比对「哪个关键招式整行缺失」。
 *
 * 跑法：PROBE_LOWGOLD=1 npx vitest run src/composables/__tests__/lowGoldFrontierProbe.test.ts
 * 可选：PROBE_LOWGOLD_GOLDWINDOW=3（默认3=最低金+3）、PROBE_LOWGOLD_TOP=40（默认40=铺开前40队）
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

describe('探针：最低金+3 前沿 × 真引擎，找伤害过低（招式丢失）队伍', () => {
  it.runIf(process.env.PROBE_LOWGOLD)('前沿批跑，按伤害/血量比升序输出低估清单 + 最差队伍招式计划', async () => {
    const goldWindow = Number(process.env.PROBE_LOWGOLD_GOLDWINDOW ?? 3)
    const topN = Number(process.env.PROBE_LOWGOLD_TOP ?? 40)
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as {
      runs: ArchiveRun[]
      rooms: Record<string, ArchiveRoom & { seasonStart?: string; bossNameZh?: string }>
    }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { teamTotalDamage, resourceResult } = useResourceCalc()

    const nameOf = (id?: string) => (id ? (catalog.getAgent(id)?.name?.zhCN ?? id) : '?')
    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const frontier = lowGoldFrontier(usable, { killedOnly: true, goldWindow })
    console.log('\n=== 前沿 ===')
    console.log('归档', archive.runs.length, '→ 可跑', usable.length, '→ 最低金+', goldWindow, '前沿（击杀顶分）', frontier.length, '队')

    interface Row {
      run: ArchiveRun
      ratio: number
      hp: number
      damage: number
      predictedKill: boolean
      gold: number
      team: string
    }
    const rows: Row[] = []
    const t0 = Date.now()
    for (const run of frontier) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const damage = teamTotalDamage.value ?? 0
      const ratio = hp > 0 ? damage / hp : 0
      rows.push({
        run, ratio, hp, damage,
        predictedKill: damage >= hp && hp > 0,
        gold: runLimitedGold(run.team),
        team: run.team.map(m => `${nameOf(m.agentId)}M${m.mindscape}`).join('/'),
      })
    }
    const elapsed = (Date.now() - t0) / 1000
    rows.sort((a, b) => a.ratio - b.ratio)

    const fn = rows.filter(r => !r.predictedKill && r.run.bossKilled)
    const underHalf = rows.filter(r => r.ratio < 0.5)
    console.log('\n=== 低估概览 ===')
    console.log('伤害/血量比 < 0.5 的队', underHalf.length, '| < 0.75', rows.filter(r => r.ratio < 0.75).length,
      '| fn（实战击杀但预测未达击杀线）', fn.length, '队')
    console.log('批跑耗时', elapsed.toFixed(1), '秒（' + (elapsed / Math.max(1, rows.length) * 1000).toFixed(0) + ' ms/队）')

    console.log('\n=== 最被低估的队（按 伤害/血量比 升序，前 ' + topN + '）===')
    console.log('比率    金  击杀 分数    用时    队伍（主C↑）')
    for (const r of rows.slice(0, topN)) {
      console.log(
        (r.ratio * 100).toFixed(0).padStart(3) + '%  ',
        String(r.gold).padStart(2),
        r.run.bossKilled ? '杀' : '未',
        String(r.run.score).padStart(6),
        String(r.run.timeSeconds).padStart(4) + 's ',
        r.team,
        '→', nameOf(r.run.primaryAgentId),
      )
    }

    // 铺开最差 fn 队的招式计划
    const dump = rows.filter(r => !r.predictedKill && r.run.bossKilled).slice(0, topN)
    console.log('\n=== fn 队招式执行计划（moveName × 次数 × 伤害倍率%）===')
    for (const r of dump) {
      const room = archive.rooms[r.run.targetId]
      const deploy = submissionToDeploy(r.run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      void teamTotalDamage.value
      const chars = resourceResult.value?.characters ?? []
      console.log(`\n## ${r.team} | 比率 ${(r.ratio * 100).toFixed(0)}% | ${room?.bossNameZh ?? r.run.targetId} | 实战 ${r.run.score}分 ${r.run.timeSeconds}s`)
      for (const c of chars) {
        const execs = (c.executions ?? []).filter(e => (e.count ?? 0) > 0)
        if (!execs.length) {
          console.log(`  [${nameOf(c.agentId)}] 无招式行`)
          continue
        }
        console.log(`  [${nameOf(c.agentId)}]`)
        for (const e of execs) {
          console.log(`    - ${e.moveName} ×${e.count} (${(e.damageMultiplier ?? 0).toFixed(0)}%) ${e.category}`)
        }
      }
    }

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.run.bossKilled)).toBe(true)
  }, 3600000)
})
