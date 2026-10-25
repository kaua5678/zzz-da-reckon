/**
 * 逐槽锁定（`presetSlotOverrides`）+ 空 goldSteps 的 catalog 阶梯（`goldStepsForPreset`）。
 *
 * 用户口径 2026-10-25：「修改自由度大一点」「格里斯这种常驻角色还不能设置其金数」+
 * 「C，默认肯定要快速，你有精确需求可以自己打开开关呀」。
 *
 * 判据重点（都是实测踩过的形状）：
 * ① 不填锁 = **同一个 preset 引用**逐位不变（零改动，不是"数值看起来一样"）；
 * ② 锁了某槽 ⇒ 该槽加金步被剔除、点循环里最终配置 = 配置码写的那个（不被加金覆盖）；
 * ③ 锁定槽的金数如实进 `goldCount`（`teamGoldOf` 唯一口径），不是预算里的那份；
 * ④ 常驻角色（格莉丝 1181）锁 6 命：伤害真变、金数不变（常驻不计金）；
 * ⑤ 空 goldSteps 的预设：金数滑块真的能拉（改前 `resolveGoldLevel` 钳到 1 个点）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamComparePoints } from '@/composables/teamCompare'
import { NO_SLOT_OVERRIDES, applySlotOverrides, isSlotLocked } from '@/composables/presetSlotOverrides'
import { goldStepsForPreset } from '@/composables/goldStepsFromCatalog'
import type { BossPresetFile } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { SetupCode } from '@/utils/setupCode'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const BOSS = bossData.bosses[0]!
const PHASE = BOSS.phases[0]!

const PRESET: TeamPreset = {
  id: 'slot-lock-test',
  name: '逐槽锁定测试队',
  team: ['1511', '1561', '1581'],
  wEngines: ['14151', '14156', '13008'],
  goldSteps: [
    { label: '南宫羽 1命', slot: 0, kind: 'cinema', value: 1 },
    { label: '维琳娜 1命', slot: 1, kind: 'cinema', value: 1 },
    { label: '蕾米埃尔 1命', slot: 2, kind: 'cinema', value: 1 },
  ],
  interactions: [],
}

const code = (c: number, w: number): SetupCode => ({ cinema: c, wengine: w })

describe('applySlotOverrides（纯函数）', () => {
  it('① 无锁定 ⇒ 返回同一个 preset 引用，locked 全 null', () => {
    const r = applySlotOverrides(PRESET, NO_SLOT_OVERRIDES)
    expect(r.preset).toBe(PRESET)
    expect(r.locked).toEqual([null, null, null])
    expect(isSlotLocked(NO_SLOT_OVERRIDES, 0)).toBe(false)
  })

  it('② 锁了的槽：加金步与常驻步都被剔除，其余槽保留；右位 0 规整成精炼 1', () => {
    const r = applySlotOverrides(PRESET, [code(2, 1), null, code(0, 0)])
    expect(r.preset.goldSteps.map(s => s.slot)).toEqual([1])
    expect(r.locked[0]).toEqual({ cinema: 2, wengine: 1 })
    expect(r.locked[1]).toBeNull()
    // 右位 0 = 无专武 ⇒ 精炼规整成 1（游戏里没有精炼 0）
    expect(r.locked[2]).toEqual({ cinema: 0, wengine: 1 })
  })

  it('② 锁了标准步（standardSteps）也要剔除', () => {
    const withStd: TeamPreset = { ...PRESET, standardSteps: [{ label: '常驻 1命', slot: 2, kind: 'cinema', value: 1 }] }
    const r = applySlotOverrides(withStd, [null, null, code(3, 1)])
    expect(r.preset.standardSteps).toEqual([])
  })
})

describe('goldStepsForPreset（空 goldSteps 才有 catalog 阶梯）', () => {
  it('作者排过顺序 ⇒ 逐位返回作者那份（同一个数组引用）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    expect(goldStepsForPreset(PRESET, h.catalog)).toBe(PRESET.goldSteps)
  })

  it('空 goldSteps ⇒ 从 catalog 推阶梯（含限定角色影画 + 基础音擎是限定时的精炼步）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    const empty: TeamPreset = { ...PRESET, goldSteps: [] }
    const steps = goldStepsForPreset(empty, h.catalog)
    expect(steps.length).toBeGreaterThan(0)
    // 三个都是限定 S ⇒ 每人 6 条影画步
    expect(steps.filter(s => s.kind === 'cinema').length).toBe(18)
    // 基础音擎 14151/14156/13008：前两个是限定 ⇒ 各 4 条精炼步；13008 是 A 级 ⇒ 换装步 + 4 条精炼步
    expect(steps.filter(s => s.kind === 'wengine' && s.wEngineId === '14158').length).toBe(1)
    expect(steps.filter(s => s.kind === 'wengine' && !s.wEngineId).length).toBe(12)
  })
})

describe('computeTeamComparePoints（逐槽锁定接线）', () => {
  it('⑤ 空 goldSteps 的预设：金数 5~8 各出一档点（改前只有 1 个）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const empty: TeamPreset = { ...PRESET, goldSteps: [] }
    const pts = computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [empty], goldLevels: [5, 6, 7, 8], boss: BOSS, phase: PHASE, autoEngine: false,
    })
    expect(pts.map(p => p.goldCount)).toEqual([5, 6, 7, 8])
    // 伤害单调不减（多花一金不能变低）
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.damage).toBeGreaterThanOrEqual(pts[i - 1]!.damage)
  })

  it('②③ 锁一个槽 ⇒ 该槽最终配置 = 配置码，且金数按最终配置算', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const pts = computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [PRESET], goldLevels: [5], boss: BOSS, phase: PHASE, autoEngine: false,
      slotOverrides: [null, null, code(2, 1)],
    })
    expect(pts).toHaveLength(1)
    expect(pts[0]!.cinemas).toEqual([0, 0, 2])
    // 5 金基础（3 限定本体 + 2 件限定专武）+ 蕾米 2 命 + 蕾米专武本体（码右位 1 = 精1，
    // 该槽基础音擎原本是 A 级 13008 ⇒ 换成专武 14158，+1 金）= 8 金
    // ⚠ 这是 2026-10-25 的口径：配置码 = 「命座 + 专武精炼」，右位 ≥1 就必须戴专武
    // （与 freeCompare 的 applyCodeToSlot 同一条语义）；右位 0 = 无专武。
    expect(pts[0]!.goldCount).toBe(8)
  })

  it('④ 常驻角色锁命座：伤害真变、金数不变（常驻不计金）', async () => {
    const h = await setupHarness([{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const resident: TeamPreset = {
      id: 'resident-lock', name: '常驻锁命', team: ['1181', '1561', '1581'],
      wEngines: ['', '', ''], goldSteps: [], interactions: [],
    }
    const run = (c: number) => computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [resident], goldLevels: [2], boss: BOSS, phase: PHASE, autoEngine: false,
      slotOverrides: [code(c, 1), null, null],
    })[0]!
    const c0 = run(0)
    const c6 = run(6)
    expect(c0.goldCount).toBe(2) // 维琳娜 + 蕾米本体；格莉丝常驻不计金
    expect(c6.goldCount).toBe(2)
    expect(c6.damage).toBeGreaterThan(c0.damage)
  })
})
