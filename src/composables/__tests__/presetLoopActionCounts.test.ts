/**
 * 逐预设循环的起点不变量（CC-260 → CC-267）。
 * CC-260 曾在三个循环开头 `restoreActionCounts`；CC-267 起 setAgent 换人即把 ACTION_COUNT_BOUNDS 全集回到模板值
 * 再预填基准 ⇒ 装配结果与用户 store 的残留次数、预设装配顺序都无关，restoreActionCounts 已删。
 * 修前：嘲讽取消 / 完美格挡 / 仪玄系等专属次数留在槽上，散点 104 预设 x 全体虚高，仪玄 / 普罗米娅预设伤害随残留变。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { ACTION_COUNT_BOUNDS, ASSIST_ACTION_BASELINE, type ActionCountField } from '@/stores/config'

const FIELDS = Object.keys(ACTION_COUNT_BOUNDS) as ActionCountField[]

describe('CC-267 换人重置全部动作次数', () => {
  it('预设 A 写入专属次数后装配预设 B：不泄漏（无需循环内恢复）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const auto = teamPresets.find(p => p.id.startsWith('auto-'))!
    const leaker = { ...auto, id: 'tmp-leaker', interactions: [{ type: 'tauntCancel', count: 5 }] }
    applyTeamToStore(config, leaker)
    expect(config.team[0]!.tauntCancelCount).toBe(5)
    applyTeamToStore(config, auto)
    expect(config.team.map(c => c.tauntCancelCount)).toEqual([0, 0, 0])
  })

  it('用户 store 残留任意次数：装配结果与「干净 store」逐字段相同', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const preset = teamPresets.find(p => p.team.includes('1371'))! // 仪玄：专属字段有真实读者
    applyTeamToStore(config, preset)
    const clean = config.team.map(c => FIELDS.map(f => c[f]))
    for (const c of config.team) for (const f of FIELDS) c[f] = ACTION_COUNT_BOUNDS[f].max
    applyTeamToStore(config, preset)
    expect(config.team.map(c => FIELDS.map(f => c[f]))).toEqual(clean)
  })

  it('CC-268：用户槽残留潜能不影响装配结果（换人回到模板潜能 6）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    // 2026-10-08 自动预设库重生成后 艾莲(1191) 不再出现在任何预设（旧 auto-1191-* 三条已消失）。
    // 换成 猫又(1021)：同为「模块读潜能」的角色（`mechanics/agents/nekomata.ts` 按 potentialLevel
    // 取 `NEKOMATA_POTENTIAL_CRIT_DMG`，实测 slot0 潜能 1→6 总伤 +4.91M）⇒ 泄漏判据仍然咬合。
    const preset = teamPresets.find(p => p.team.includes('1021'))! // 猫又：模块读潜能
    for (const c of config.team) c.potentialLevel = 1
    applyTeamToStore(config, preset)
    expect(config.team.map(c => c.potentialLevel)).toEqual([6, 6, 6])
  })

  it('CC-264：setAgent 预填快支 / 连携基准（ASSIST_ACTION_BASELINE）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    for (const c of config.team) { c.quickAssistCount = 0; c.chainCountPerStun = 0 }
    const auto = teamPresets.find(p => p.id.startsWith('auto-') && !(p.interactions ?? []).some(i => i.type === 'quickAssist'))!
    applyTeamToStore(config, auto)
    expect(config.team.map(c => c.quickAssistCount)).toEqual([3, 3, 3])
    expect(config.team.map(c => c.chainCountPerStun)).toEqual([1, 1, 1])
    expect(ASSIST_ACTION_BASELINE).toEqual({ quickAssist: 3, chainPerStun: 1 })
    const root = resolve(__dirname, '..')
    for (const file of ['teamTimelineStore.ts', 'runArchiveDeploy.ts']) {
      const src = readFileSync(resolve(root, file), 'utf-8')
      expect(src, file).not.toMatch(/setActionCount\(s, 'quickAssistCount', \d/)
      expect(src, file).not.toMatch(/setActionCount\(s, 'chainCountPerStun', \d/)
    }
  })

  it('源码锁：setAgent 按 ACTION_COUNT_BOUNDS 全集重置', () => {
    const src = readFileSync(resolve(__dirname, '../../stores/config.ts'), 'utf-8')
    const i = src.indexOf('function setAgent(')
    expect(src.slice(i, i + 1500)).toMatch(/for \(const f of Object\.keys\(ACTION_COUNT_BOUNDS\) as ActionCountField\[\]\)[^\n]*\[f\] = tpl\[f\]/)
  })
})
