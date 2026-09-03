/**
 * 探针：低金前沿 × 直伤/异常伤拆分分层（PROBE_DMGSPLIT=1）。
 *
 * 背景：anomalyFrontierProbe 已证伪「积储不足」——最低金+3 前沿里低估最重的
 * 星见雅组（平均比率 32%）/普罗米娅组（39%）异常伤占比反而最高（57%/61%）→
 * 缺口在主C直伤（招式缺失/面板/拐力）。本探针按队拆分 伤害池行（damagePoolRows：
 * 直伤/异常各 type 分列 + moveId），输出每角色直伤/异常伤与主C直伤 top 招式行，
 * 并按「队内异常角色」分组聚合主C直伤量——人工比对哪组的直伤招式行偏弱/缺失。
 *
 * 跑法：PROBE_DMGSPLIT=1 npx vitest run src/composables/__tests__/damageSplitFrontierProbe.test.ts
 * 可选：PROBE_DMGSPLIT_TOP=40（默认 40 = 比率最差铺明细）、PROBE_DMGSPLIT_GOLDWINDOW=3
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

const ANOMALY_TYPES = new Set(['异放', '乱流', '耀变', '灼烧', '感电', '侵蚀', '风化', '强击', '极性紊乱', '极性强击', '碎冰', '简6命附伤', '紊乱', '爱丽丝6命附伤', '畏缩 DOT'])

describe('探针：前沿直伤/异常伤拆分', () => {
  it.runIf(process.env.PROBE_DMGSPLIT)('批跑前沿队，按角色拆直伤/异常 + 主C直伤 top 招式 + 分组聚合', async () => {
    const goldWindow = Number(process.env.PROBE_DMGSPLIT_GOLDWINDOW ?? 3)
    const topN = Number(process.env.PROBE_DMGSPLIT_TOP ?? 40)
    const archive = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as {
      runs: ArchiveRun[]
      rooms: Record<string, ArchiveRoom & { seasonStart?: string; bossNameZh?: string }>
    }
    const bossFile = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
    await setupHarness([{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1131' }])
    const configStore = useConfigStore()
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations()
    const { teamTotalDamage, damagePoolRows, resourceResult } = useResourceCalc()

    const nameOf = (id?: string) => (id ? (catalog.getAgent(id)?.name?.zhCN ?? id) : '?')
    const usable = archive.runs.filter((run) => {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      if (!deploy.supported || !deploy.boss?.phaseId) return false
      return (run.team ?? []).length === 3 && run.team.every(m => catalog.getAgent(m.agentId))
    })
    const frontier = lowGoldFrontier(usable, { killedOnly: true, goldWindow })

    interface TeamSplit {
      run: ArchiveRun
      ratio: number
      hp: number
      damage: number
      gold: number
      team: string
      anomalyChars: string
      primary: string
      perSlot: { agentId: string; direct: number; anomaly: number; basicTime: number; basicDmg: number; topRows: { name: string; count: number; dmg: number; moveId?: string }[] }[]
    }
    const rows: TeamSplit[] = []
    const t0 = Date.now()
    for (const run of frontier) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      const damage = teamTotalDamage.value ?? 0
      const pool = damagePoolRows.value ?? []
      const res = resourceResult.value
      const bySlot = new Map<number, { agentId: string; direct: number; anomaly: number; basicTime: number; basicDmg: number; rows: { name: string; count: number; dmg: number; moveId?: string }[] }>()
      for (const r of pool) {
        const s = bySlot.get(r.slot) ?? { agentId: r.agentId, direct: 0, anomaly: 0, basicTime: 0, basicDmg: 0, rows: [] }
        if (ANOMALY_TYPES.has(r.type)) s.anomaly += r.totalDamage
        else s.direct += r.totalDamage
        if (r.type === '直伤' && r.moveId) s.rows.push({ name: r.name, count: r.count, dmg: r.totalDamage, moveId: r.moveId })
        if (r.moveId === 'basic_attack') s.basicDmg += r.totalDamage
        bySlot.set(r.slot, s)
      }
      for (const c of res?.characters ?? []) {
        const s = bySlot.get(c.slot)
        if (s) s.basicTime = c.timeAllocation?.basicAttackTime ?? 0
      }
      const perSlot = [...bySlot.entries()].sort((a, b) => b[1].direct + b[1].anomaly - (a[1].direct + a[1].anomaly))
        .map(([, v]) => v)
        .map(v => ({
          ...v,
          topRows: v.rows.sort((a, b) => b.dmg - a.dmg).slice(0, 5),
        }))
      rows.push({
        run,
        ratio: hp > 0 ? damage / hp : 0,
        hp,
        damage,
        gold: runLimitedGold(run.team),
        team: run.team.map(m => `${nameOf(m.agentId)}M${m.mindscape}`).join('/'),
        anomalyChars: run.team.map(m => m.agentId).filter(id => catalog.getAgent(id)?.specialty === 'anomaly').map(id => nameOf(id)).join('+') || '（无异常）',
        primary: nameOf(run.primaryAgentId),
        perSlot,
      })
    }
    const elapsed = (Date.now() - t0) / 1000
    rows.sort((a, b) => a.ratio - b.ratio)
    // 用户口径（2026-09-02）：速杀 60s = 模型 180s 基本循环折算——fn 对照用 总伤×3 vs HP；
    // 后台不占前场、冰紊乱倍率正常（碎冰承载），时间不再深究。
    const fnOld = rows.filter(r => !(r.damage >= r.hp && r.hp > 0) && r.run.bossKilled).length
    const fn3 = rows.filter(r => !(r.damage * 3 >= r.hp && r.hp > 0) && r.run.bossKilled).length
    console.log(`\n=== ×3fn 队清单（按比率升序，前 60）——按异常构成分层 ===`)
    const fn3Rows = rows.filter(r => !(r.damage * 3 >= r.hp && r.hp > 0) && r.run.bossKilled)
    const byAnomaly = new Map<string, number>()
    for (const r of fn3Rows) {
      const key = r.anomalyChars
      console.log(`  ${(r.damage / r.hp * 100).toFixed(0).padStart(3)}% [${key}] ${r.team}`)
      byAnomaly.set(key, (byAnomaly.get(key) ?? 0) + 1)
    }
    console.log('构成统计:', JSON.stringify([...byAnomaly.entries()].sort((a, b) => b[1] - a[1])))
    console.log('\n=== 前沿直伤/异常拆分（比率最差 ' + topN + ' 队）===')
    console.log('批跑', frontier.length, '队 ·', elapsed.toFixed(1), 's')
    console.log(`fn（原判据 总伤≥HP）${fnOld} 队 | fn（×3 判据 总伤×3≥HP，用户口径）${fn3} 队`)
    for (const r of rows.slice(0, topN)) {
      console.log(`\n${(r.ratio * 100).toFixed(0)}% 金${r.gold} [${r.anomalyChars}] 主C=${r.primary} | ${r.team}`)
      for (const s of r.perSlot) {
        const total = s.direct + s.anomaly
        console.log(`  ${nameOf(s.agentId)}: 直伤 ${(s.direct / 1e6).toFixed(1)}M 异常 ${(s.anomaly / 1e6).toFixed(1)}M (直伤占比 ${total > 0 ? (s.direct / total * 100).toFixed(0) : '?'}%) ${total > 0 ? '| 总 ' + (total / 1e6).toFixed(1) + 'M' : ''} | 平A ${s.basicTime.toFixed(1)}s/${(s.basicDmg / 1e6).toFixed(1)}M`)
        for (const tr of s.topRows) console.log(`      - ${tr.name} ×${tr.count.toFixed(1)} (${(tr.dmg / 1e6).toFixed(1)}M${tr.moveId ? ' [' + tr.moveId + ']' : ''})`)
      }
    }

    // 分组聚合：主C直伤量 + 队直伤占比 + 主C平A时间 + ×3 fn 计数（按队内异常角色）
    console.log('\n=== 按队内异常角色分组（平均比率 / 平均主C直伤 / 平均队直伤占比 / 主C平A秒数 / ×3 fn 队数）===')
    const groups = new Map<string, { n: number; ratioSum: number; primaryDirect: number; directShareSum: number; primaryBasicTime: number; fn3: number }>()
    for (const r of rows) {
      const g = groups.get(r.anomalyChars) ?? { n: 0, ratioSum: 0, primaryDirect: 0, directShareSum: 0, primaryBasicTime: 0, fn3: 0 }
      g.n++
      g.ratioSum += r.ratio
      const p = r.perSlot.find(s => nameOf(s.agentId) === r.primary || s.agentId === r.run.primaryAgentId)
      g.primaryDirect += p?.direct ?? 0
      g.primaryBasicTime += p?.basicTime ?? 0
      const teamTotal = r.perSlot.reduce((s, x) => s + x.direct + x.anomaly, 0)
      const teamDirect = r.perSlot.reduce((s, x) => s + x.direct, 0)
      g.directShareSum += teamTotal > 0 ? teamDirect / teamTotal : 0
      if (r.damage * 3 < r.hp) g.fn3++
      groups.set(r.anomalyChars, g)
    }
    const gs = [...groups.entries()].sort((a, b) => a[1].ratioSum / a[1].n - b[1].ratioSum / b[1].n)
    console.log('异常角色组        队数 平均比率 平均主C直伤 平均队直伤占比 主C平A秒 ×3fn')
    for (const [key, g] of gs) {
      console.log(
        (key || '（无异常队）').padEnd(16),
        String(g.n).padStart(4),
        (g.ratioSum / g.n * 100).toFixed(0).padStart(6) + '%',
        (g.primaryDirect / g.n / 1e6).toFixed(1).padStart(9) + 'M',
        (g.directShareSum / g.n * 100).toFixed(0).padStart(11) + '%',
        (g.primaryBasicTime / g.n).toFixed(1).padStart(9),
        String(g.fn3).padStart(5),
      )
    }

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.run.bossKilled)).toBe(true)
  }, 3600000)
})
