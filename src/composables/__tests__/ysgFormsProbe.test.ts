/**
 * 探针（PROBE_YSG_FORMS=1）：叶瞬光+琉音+照 白毛变身次数 × 时间循环自洽性。
 *
 * 用户口径：全 0 命 1 精专武、打沙拉（180s），该队应有 10 次白毛变身。
 * 本探针把 decibelForms / giftForms / zhaoyingForms / totalForms 与
 * 「前台时间 vs 180s」「必要时间 vs 前台可用」逐项打出，定位时间循环问题。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { isFrontlineExecution } from '@/types/resource'
import { netFrontlineOccupation, frontlineOccupationBreakdown } from '@/core/resource/helpers'

describe('探针：叶瞬光+琉音+照 白毛变身次数', () => {
  it.runIf(process.env.PROBE_YSG_FORMS)('打印 cycle 与时间账', async () => {
    const cinema = Number(process.env.PROBE_YSG_CINEMA ?? 0)
    const axis = process.env.PROBE_YSG_AXIS ?? ''
    await setupHarness([
      { agentId: '1431', cinemaLevel: cinema },
      { agentId: '1481', cinemaLevel: 0 },
      { agentId: '1341', cinemaLevel: 0 },
    ])
    const config = useConfigStore()
    // 全 1 精专武
    if (!process.env.PROBE_YSG_PRESET) {
      config.team[0].wEngineId = '14143'
      config.team[0].wEngineModLevel = 1
      config.team[1].wEngineId = '14148'
      config.team[1].wEngineModLevel = 1
      config.team[2].wEngineId = '14134'
      config.team[2].wEngineModLevel = 1
    }
    if (axis !== '') config.setMechanicSetting('yeshuguang.formAxis', Number(axis))
    if (process.env.PROBE_YSG_LOCK) config.enemy.stunCountLock = Number(process.env.PROBE_YSG_LOCK)
    if (process.env.PROBE_YSG_PRESET) {
      const { catalog } = await import('@/stores/catalog').then(m => ({ catalog: m.useCatalogStore() }))
      await catalog.loadBuildRecommendations()
      config.applyTeamPreset(['1431', '1481', '1341'])
    }
    if (process.env.PROBE_YSG_INTER) {
      // 预设口径交互：parry8 / dodge4（实战顶分收录）
      config.team[0].parryCount = 8
      config.team[0].dodgeCounterCount = 4
      config.team[1].parryCount = 8
      config.team[1].dodgeCounterCount = 4
      config.team[2].parryCount = 8
      config.team[2].dodgeCounterCount = 4
    }
    config.syncTeammateBuffsFromTeam()
    console.log('### cinema =', cinema, '| formAxis setting =', axis === '' ? '(default)' : axis)

    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const ys = rr.characters.find(c => c.agentId === '1431')!
    const cyc = (ys as any).yeshuguangCycle
    console.log('=== 白毛变身（明心境）次数 ===')
    console.log('decibelForms(喧响) =', cyc?.decibelForms)
    console.log('giftForms(转大)    =', cyc?.giftForms)
    console.log('zhaoyingForms(照影)=', cyc?.zhaoyingForms)
    console.log('totalForms         =', cyc?.totalForms)
    console.log('formAxis           =', cyc?.formAxis)
    console.log('outsideSword       =', cyc?.outsideSword)

    const battleTime = config.enemy.battleTime ?? 180
    let frontline = 0
    for (const ch of rr.characters) {
      for (const exec of ch.executions) {
        if (!isFrontlineExecution(exec)) continue
        frontline += exec.totalTime ?? 0
      }
    }
    console.log('=== 时间账 ===')
    console.log('battleTime =', battleTime, '| 前台合计 =', frontline.toFixed(2))
    for (const ch of rr.characters) {
      const t = ch.executions.reduce((s, e) => s + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      console.log(`  ${ch.agentId} 前台 = ${t.toFixed(2)}s`)
    }
    console.log('=== 收敛 / 截断 ===')
    console.log('convergence =', JSON.stringify(rr.convergence))
    console.log('overflowSeconds =', rr.overflowSeconds)
    console.log('truncationBySlot =', JSON.stringify((rr as any).truncationBySlot))
    console.log('truncationCuts =', JSON.stringify(rr.truncationCuts))
    console.log('truncationRefold =', JSON.stringify((rr.convergence as any)?.truncationRefoldPasses), 'before=', (rr.convergence as any)?.truncationBeforeRefoldSeconds)
    console.log('timeBudgetRefund =', (rr as any).timeBudgetRefund)
    console.log('netFrontlineOccupation =', netFrontlineOccupation(rr))
    console.log('frontlineBreakdown =', JSON.stringify(frontlineOccupationBreakdown(rr)))
    console.log('timePressure(1431) =', (rr.characters[0] as any)?.timePressureSeconds)
    console.log('=== 账本（necessary + basic）===')
    let nec = 0
    let bas = 0
    for (const ch of rr.characters) {
      const c = ch as any
      nec += c.necessaryTime ?? 0
      bas += c.basicAttackTime ?? 0
      console.log(`  ${ch.agentId} necessary=${c.necessaryTime ?? '?'} basic=${c.basicAttackTime ?? '?'}`)
    }
    console.log(`账本合计 = ${(nec + bas).toFixed(2)} (necessary ${nec.toFixed(2)} + basic ${bas.toFixed(2)}) | 行合计 = ${frontline.toFixed(2)} | 预算 = ${battleTime}`)
    console.log('=== 队友执行行 ===')
    for (const ch of rr.characters) {
      if (ch.agentId === '1431') continue
      console.log(`-- ${ch.agentId} --`)
      for (const e of ch.executions) {
        console.log(' ', e.moveId, e.moveName, 'count=', e.count, 'totalTime=', (e.totalTime ?? 0).toFixed(2), 'bucket=', (e as any).timeBucket, 'src=', (e as any).source, 'ratio=', (e as any).truncatedRatio)
      }
    }
    const ysgExec = ys.executions.map((e: any) => `${e.moveId} ${e.moveName} count=${typeof e.count === 'number' ? e.count.toFixed(3) : e.count} totalTime=${(e.totalTime ?? 0).toFixed(2)} bucket=${e.timeBucket ?? '-'} ratio=${e.truncatedRatio ?? '-'} src=${e.source ?? '-'}`)
    console.log('=== 叶瞬光执行行 ===')
    for (const line of ysgExec) console.log(' ', line)
    expect(true).toBe(true)
  }, 600000)
})
