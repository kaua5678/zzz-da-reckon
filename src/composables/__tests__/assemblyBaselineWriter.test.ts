/**
 * CC-266：动作次数基准只有一个写入者（setAgent）。轻量装配 teamTimelineStore#applyTeamToStore 与
 * 部署 runArchiveDeploy 不再重复写基准；本锁证明删去重复写入后装配结果仍逐位等于基准（两条分支），
 * 并锁源码不回流。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamTimelineStore'
import { baseStateFor } from '@/composables/teamTimelineStore'
import { ASSIST_ACTION_BASELINE, interactionBaselineFor } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'

describe('CC-266 装配入口不重复写基准', () => {
  it('轻量装配（autoBuild false / true）后每槽动作次数 = setAgent 基准（先弄脏再装配）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const catalog = useCatalogStore()
    await catalog.loadBuildRecommendations() // autoBuild=true 走 applyTeamPreset，要求推荐已加载
    const teams = [...new Map(teamPresets.map(p => [p.team.join('-'), p.team as [string, string, string]])).values()]
    for (const autoBuild of [false, true]) {
      for (const team of teams) {
        for (const c of config.team) { c.parryCount = 77; c.dodgeCounterCount = 77; c.blockCount = 77; c.dualCounterCount = 77; c.quickAssistCount = 77; c.chainCountPerStun = 3 }
        applyTeamToStore(config, team, baseStateFor(team, catalog), autoBuild)
        team.forEach((id, s) => {
          const b = interactionBaselineFor(id, catalog.getAgent(id)?.specialty)
          const c = config.team[s]!
          const tag = `${team.join('-')} slot${s} autoBuild=${autoBuild}`
          expect([c.parryCount, c.dodgeCounterCount, c.blockCount, c.dualCounterCount], tag).toEqual([b.parry, b.dodge, b.block, b.dual])
          expect([c.quickAssistCount, c.chainCountPerStun], tag).toEqual([ASSIST_ACTION_BASELINE.quickAssist, ASSIST_ACTION_BASELINE.chainPerStun])
        })
      }
    }
  }, 120_000)

  it('源码锁：teamTimelineStore 不写动作次数；runArchiveDeploy 只写弹刀 / 格挡 / 双反偏差', () => {
    const root = resolve(__dirname, '..')
    const strip = (f: string) => readFileSync(resolve(root, f), 'utf-8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(strip('teamTimelineStore.ts')).not.toMatch(/\.setActionCount\([^,]+, '(parryCount|dodgeCounterCount|blockCount|dualCounterCount|quickAssistCount|chainCountPerStun)'/)
    const deploy = strip('runArchiveDeploy.ts')
    expect(deploy).not.toMatch(/\.setActionCount\([^,]+, '(dodgeCounterCount|quickAssistCount|chainCountPerStun)'/)
    expect(deploy).toMatch(/setActionCount\(s, 'parryCount', custom \? base\.parry : 0\)/)
  })
})
