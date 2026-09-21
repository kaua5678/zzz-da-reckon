/**
 * 探针（PROBE_YSG_LOOP=1）：叶瞬光+琉音+照 外层不动点逐轮轨迹。
 *
 * 用户口径：全 0 命 1 精专武、打沙拉（180s），该队应有 10 次白毛变身。
 * 本探针手工复播外层不动点（runCalcRound 逐轮），打印每轮：
 * 输入失衡次数 / 1431 cycle（decibel/gift/zhaoying/total）/ 净占用 / 池失衡次数。
 */
import { describe, expect, it } from 'vitest'
import { computed } from 'vue'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createConvergenceRoundInputs, createRunCalcRound } from '@/composables/resourceCalc/convergence'
import { initialCalcRoundThreads } from '@/composables/resourceCalc/roundThreads'
import { netFrontlineOccupation } from '@/core/resource/helpers'

describe('探针：叶瞬光+琉音+照 外层不动点轨迹', () => {
  it.runIf(process.env.PROBE_YSG_LOOP)('逐轮打印', async () => {
    const teamIds = (process.env.PROBE_YSG_TEAM ?? '1431,1481,1341').split(',')
    const cinema = Number(process.env.PROBE_YSG_CINEMA ?? 0)
    const axisSet = process.env.PROBE_YSG_AXIS
    const { catalog } = await setupHarness(
      teamIds.map((agentId, i) => ({ agentId, cinemaLevel: i === 0 ? cinema : 0 })))
    const config = useConfigStore()
    if (process.env.PROBE_YSG_PRESET) config.applyTeamPreset(teamIds as [string, string, string])
    if (axisSet !== undefined) config.setMechanicSetting('yeshuguang.formAxis', Number(axisSet))
    config.team[0].wEngineId = '14143'
    config.team[0].wEngineModLevel = 1
    config.team[1].wEngineId = '14148'
    config.team[1].wEngineModLevel = 1
    config.team[2].wEngineId = '14134'
    config.team[2].wEngineModLevel = 1
    config.syncTeammateBuffsFromTeam()

    const calc = useResourceCalc()
    const inputs = createConvergenceRoundInputs({
      configStore: config, catalogStore: catalog,
      panels: calc.panels, resourceConfig: calc.resourceConfig,
      remielleAnomalyMultiplier: computed(() => 1),
    })
    const run = createRunCalcRound({
      configStore: config, catalogStore: catalog, panels: calc.panels, resourceConfig: calc.resourceConfig,
      resourceResult: { value: null }, adjustedResourceResult: { value: null },
      inStunAnomalyState: { value: null }, bossAnomalyState: { value: null }, stunCoverage: { value: 0 },
      matchedPlanName: { value: null }, banyueInteractionTopUp: { value: null },
      windowDuration: { value: 10 }, computeWindowDuration: () => 10, computeStunCoverage: () => 0,
      ...inputs,
    })

    let stunCount = 0
    let threads = initialCalcRoundThreads()
    const stunWindowDur = 10
    const stunEffTime = Math.max(0, (config.enemy.battleTime ?? 180) - (config.enemy.invincibleTime ?? 0))
    const scale = Number(process.env.PROBE_YSG_SCALE ?? 0.125)
    console.log('--- interactionScale =', scale, '---')
    for (let k = 0; k < 10; k++) {
      const out = run(stunCount, threads, { forceNoAxis: false, interactionScale: scale })
      if (!out) { console.log(`k=${k} → null`); break }
      const rr = out.resourceResult
      const ys = rr.characters.find((c: any) => c.agentId === '1431') as any
      const cyc = ys?.yeshuguangCycle
      const rawNext = out.stunPool?.stunCount ?? 0
      // 外层缩放（复播 useResourceCalc 的 next 计算）
      const coverage = Math.min(1, stunCount * stunWindowDur / stunEffTime)
      let next = rawNext * (1 - coverage)
      const maxFull = Math.floor(stunEffTime / stunWindowDur)
      if (next > maxFull) {
        const residualFactor = stunEffTime / stunWindowDur - maxFull
        const excess = next - maxFull
        next = maxFull + Math.min(Math.max(0, excess), residualFactor)
      }
      // 非失衡时间充足性约束（复播 useResourceCalc 的同名步骤）
      const totalNecessary = (rr?.characters ?? []).reduce(
        (s: number, c: any) => s + (c.timeAllocation?.necessaryTime ?? 0), 0)
      const nonStunTime = stunEffTime - next * stunWindowDur
      if (nonStunTime < totalNecessary) {
        next = Math.max(0, (stunEffTime - totalNecessary) / stunWindowDur)
      }
      console.log(
        `k=${k}`,
        '| axis=', cyc?.formAxis,
        '| stunIn=', stunCount.toFixed(3),
        '| rawNext=', rawNext,
        '| scaledNext=', next.toFixed(3),
        '| decibel=', cyc?.decibelForms,
        '| gift=', cyc?.giftForms,
        '| zhaoying=', cyc?.zhaoyingForms?.toFixed(3),
        '| total=', cyc?.totalForms?.toFixed(3),
        '| net=', netFrontlineOccupation(rr).toFixed(2),
        '| trunc=', rr.convergence?.timeTruncatedSeconds,
        '| giftRow=', rr.characters.find((c: any) => c.agentId === '1431')?.executions
          ?.filter((e: any) => e.source === 'gift' || (e.moveName ?? '').includes('好评转大'))
          ?.map((e: any) => e.count)?.join('/'),
      )
      threads = { ...out.threadsNext, anomalyDecibelBonus: out.anomalyPool?.perSlotBonus ?? [] }
      stunCount = next
    }
    expect(true).toBe(true)
  }, 600000)
})
