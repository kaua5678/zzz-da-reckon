/**
 * CC-260：逐预设循环的动作次数不跨预设泄漏（configSnapshot#restoreActionCounts）。
 * 修前：setAgent 不重置快支 / 连携 / 嘲讽取消等，手编预设 slot0 快支 3 会漏给下一个未声明快支的预设；
 * CC-259 后散点 x 读实打快支（×0.6）⇒ x 随预设顺序 / 界面筛选子集变化。
 * CC-264 起快支 / 连携由 setAgent 预填；本锁的泄漏探针改用嘲讽取消。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { restoreActionCounts, snapshotStore } from '@/composables/configSnapshot'
import { ASSIST_ACTION_BASELINE } from '@/stores/config'

describe('CC-260 逐预设起点不变量', () => {
  it('声明了 setAgent 不管的字段（嘲讽取消）的预设之后装配 auto 预设：restoreActionCounts 后回到基线', async () => {
    // CC-264 起 setAgent 也预填快支 / 连携，泄漏探针改用 setAgent 仍不重置的 tauntCancelCount（合成预设）
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    for (const c of config.team) c.tauntCancelCount = 0
    const snap = snapshotStore(config)
    const auto = teamPresets.find(p => p.id.startsWith('auto-'))!
    const leaker = { ...auto, id: 'tmp-leaker', interactions: [{ type: 'tauntCancel', count: 5 }] }
    applyTeamToStore(config, leaker)
    expect(config.team[0]!.tauntCancelCount).toBe(5)
    // 修前行为（无恢复）：泄漏
    applyTeamToStore(config, auto)
    expect(config.team[0]!.tauntCancelCount).toBe(5)
    // 修后：循环开头恢复动作次数
    applyTeamToStore(config, leaker)
    restoreActionCounts(config, snap)
    applyTeamToStore(config, auto)
    expect(config.team.map(c => c.tauntCancelCount)).toEqual([0, 0, 0])
    // setAgent 负责的字段仍按角色预填（恢复在 setAgent 之前，不被清零）
    expect(config.team.some(c => c.parryCount > 0)).toBe(true)
  })

  it('CC-264：setAgent 预填快支 / 连携基准（ASSIST_ACTION_BASELINE），散点不再继承用户 store 隐藏值', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    for (const c of config.team) { c.quickAssistCount = 0; c.chainCountPerStun = 0 }
    const auto = teamPresets.find(p => p.id.startsWith('auto-') && !(p.interactions ?? []).some(i => i.type === 'quickAssist'))!
    applyTeamToStore(config, auto)
    expect(config.team.map(c => c.quickAssistCount)).toEqual([3, 3, 3])
    expect(config.team.map(c => c.chainCountPerStun)).toEqual([1, 1, 1])
    expect(ASSIST_ACTION_BASELINE).toEqual({ quickAssist: 3, chainPerStun: 1 })
    // 轻量装配 / 部署不再写魔数
    const root = resolve(__dirname, '..')
    for (const file of ['teamTimelineStore.ts', 'runArchiveDeploy.ts']) {
      const src = readFileSync(resolve(root, file), 'utf-8')
      expect(src, file).not.toMatch(/setQuickAssistCount\(s, \d/)
      expect(src, file).not.toMatch(/setChainCountPerStun\(s, \d/)
    }
  })

  it('源码锁：三个逐预设循环开头都调用 restoreActionCounts', () => {
    const root = resolve(__dirname, '..')
    for (const [file, head] of [
      ['teamCompare.ts', 'for (const preset of options.presets) {'],
      ['difficultyCurve.ts', 'for (const preset of options.presets) {'],
      ['positionCompare.ts', 'for (const preset of presets) {'],
    ] as const) {
      const src = readFileSync(resolve(root, file), 'utf-8')
      const i = src.indexOf(head)
      expect(i, file).toBeGreaterThan(0)
      expect(src.slice(i, i + 200), file).toMatch(/^[^\n]*\n\s*restoreActionCounts\(configStore, snap\)/)
    }
  })
})
