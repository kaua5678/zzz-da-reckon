/**
 * 探针：实战对比（RunArchivePage 部署路径）里「失衡易伤」实际吃到多少 + 谁没吃到。
 *
 * 问题（用户 2026-09）：部署后计算伤害比实战低很多，怀疑失衡易伤静默不算。
 * 判据（同一次部署内差分，不动其它输入）：
 *  A = 真实 Boss 失衡易伤倍率（部署值）下的总伤；B = `enemy.stunVuln=1.0`（易伤消失）下的总伤
 *  加权易伤信用 w = A/B − 1 —— 满额应为 (stunVuln − 1)；w 远小于满额 = 被稀释。
 *  并打印每槽位行的 moveId/次数/易伤列值 + 轴栈 executed，定位「谁没吃到」。
 *
 * 跑法：PROBE_ARCHIVE_STUN=1 npx vitest run src/composables/__tests__/archiveStunVulnProbe.test.ts
 * 可选：PROBE_ARCHIVE_TOP=N（默认 3 队，按 伤害/血量 最低取）
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
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

describe('探针：实战对比部署路径的失衡易伤信用', () => {
  it.runIf(process.env.PROBE_ARCHIVE_STUN)('部署 run → 加权易伤信用 + 行级分布', async () => {
    const topN = Number(process.env.PROBE_ARCHIVE_TOP ?? 3)
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
    const frontier = lowGoldFrontier(usable, { killedOnly: true, goldWindow: 3 })
    const scored: { run: ArchiveRun; ratio: number }[] = []
    for (const run of frontier) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const hp = configStore.enemy.hp ?? 0
      scored.push({ run, ratio: hp > 0 ? (calc.teamTotalDamage.value ?? 0) / hp : 0 })
    }
    scored.sort((a, b) => a.ratio - b.ratio)

    for (const { run, ratio } of scored.slice(0, topN)) {
      const room = archive.rooms[run.targetId]
      const deploy = submissionToDeploy(run, room, bossFile.bosses, room?.seasonStart)
      applyDeployConfig(configStore, deploy, bossFile.bosses, bossFile.phaseViews ?? [])
      const realVuln = configStore.enemy.stunVuln
      const rows = () => (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
      const total = () => calc.teamTotalDamage.value ?? 0

      console.log(`\n### 伤害/血量=${(ratio * 100).toFixed(1)}% | score=${run.score} | ${(run.team ?? []).map(m => `${nameOf(m.agentId)}M${m.mindscape}`).join('/')}`)
      console.log(`  状态：useStunAxis=${configStore.useStunAxis} autoActive=${calc.autoActive.value} 生效轴=${calc.effectiveStunAxes.value.length}` +
        ` stunCount=${(calc.stunPoolResult.value as any)?.stunCount ?? '?'} 单窗=${calc.windowDuration.value}s 战斗=${configStore.enemy.battleTime}s 无敌=${configStore.enemy.invincibleTime}s` +
        ` Boss失衡易伤=${realVuln} 血量=${((configStore.enemy.hp ?? 0) / 1e6).toFixed(1)}M`)
      const rrMeta = calc.resourceResult.value
      console.log(`  收敛：converged=${rrMeta?.converged} iterations=${rrMeta?.iterations} 细节=${JSON.stringify(rrMeta?.convergence)}`)

      for (const [ai, ax] of calc.effectiveStunAxes.value.entries()) {
        console.log(`  轴#${ai} ${ax.name}：` + ax.actions.map(a => `s${a.slot}·${a.moveId}×${a.count}`).join(' '))
      }
      const stack = calc.stackTraversalResult.value as any
      const executed: any[] = Array.isArray(stack?.executed) ? stack.executed : Object.values(stack?.executed ?? {})
      console.log(`  轴栈 executed ${executed.length} 块：` + executed.map((e: any) => {
        const c = typeof e?.count === 'number' ? e.count.toFixed(2) : String(e?.count ?? '?')
        return `s${e?.slot}·${e?.moveId ?? e?.key ?? '?'}×${c}`
      }).join(' '))
      if (stack?.warnings?.length) console.log('  轴栈 warnings：' + stack.warnings.slice(0, 5).join(' | '))

      const a = total()
      const perSlot: Record<number, number> = {}
      for (const r of rows()) perSlot[r.slot] = (perSlot[r.slot] ?? 0) + r.totalDamage
      for (const [slot] of Object.entries(perSlot).sort((x, y) => y[1] - x[1])) {
        const s = Number(slot)
        const share = a > 0 ? ((perSlot[s] ?? 0) / a * 100).toFixed(0) : '0'
        console.log(`  s${s} ${nameOf(configStore.team[s]?.agentId)} 伤害占比 ${share}%`)
        const list = rows().filter(r => r.slot === s).sort((x, y) => y.totalDamage - x.totalDamage)
        for (const r of list) {
          const shareR = a > 0 ? (r.totalDamage / a * 100).toFixed(1) : '0'
          console.log(`      ${r.type} ${r.name.slice(0, 18).padEnd(20)} moveId=${String(r.moveId ?? '-').slice(0, 26).padEnd(27)} ×${String(r.count.toFixed(1)).padStart(5)} 占比${shareR.padStart(5)}% 易伤=${r.type === '直伤' ? (r.stunMult?.toFixed(2) ?? '-') : '异常:未记录'}${/轴外/.test(r.note) ? ' [轴外段]' : ''}`)
        }
      }

      const rr = calc.resourceResult.value
      for (const ch of rr?.characters ?? []) {
        const ex = (ch.executions ?? []).filter(e => /1291|hugo/.test(String(e.moveId)))
        if (ex.length) console.log(`  资源池 s${ch.slot} 雨果系执行行：` + ex.map(e => `${e.moveId}×${(e.count ?? 0).toFixed(2)}`).join(' '))
      }
      console.log(`  雨果滑块：exVerdictRatio=${configStore.getMechanicSetting('hugo.exVerdictRatio', 1)} ultimateVerdictRatio=${configStore.getMechanicSetting('hugo.ultimateVerdictRatio', 1)} remainingStunSeconds=${configStore.getMechanicSetting('hugo.remainingStunSeconds', 5)}`)
      // 差分实验：关掉自动轴（回到非轴）——看决算执行行是否回来（隔离「轴内块反推覆盖」这条通道）
      configStore.autoYidhariAxis = false
      const rrNoAxis = calc.resourceResult.value
      const noAxisEx = (rrNoAxis?.characters?.[0]?.executions ?? []).filter(e => /1291|hugo/.test(String(e.moveId)))
      console.log(`  [差分·关自动轴] 雨果系执行行：` + noAxisEx.map(e => `${e.moveId}×${(e.count ?? 0).toFixed(2)}`).join(' '))
      configStore.autoYidhariAxis = true
      configStore.enemy.stunVuln = 1.0
      const b = total()
      configStore.enemy.stunVuln = realVuln
      const credit = b > 0 ? a / b - 1 : 0
      console.log(`  → 加权易伤信用 = ${credit.toFixed(4)}（满额 ${(realVuln - 1).toFixed(2)} → 只吃到 ${(credit / (realVuln - 1) * 100).toFixed(1)}%）`)
      console.log(`  → 总伤 ${(a / 1e6).toFixed(2)}M（无易伤基线 ${(b / 1e6).toFixed(2)}M）`)
    }
    expect(scored.length).toBeGreaterThan(0)
  }, 3600000)
})
