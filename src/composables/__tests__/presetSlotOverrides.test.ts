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
import { catalogGoldSteps, goldStepsForPreset } from '@/composables/goldStepsFromCatalog'
import type { BossPresetFile } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { SetupCode } from '@/utils/setupCode'
import { defaultDowngradeFor } from '@/data/downgradeWEngines'

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
    // 右位 0 = 无专武 ⇒ **保留 wengine: 0**（下游 lockSlots 把精炼设 1，音擎另由 wEngines 决定；
    // 抹成 1 会让「无专武」这条信息丢失 ⇒ 用户填 00 也照样穿专武，2026-10-26 修）
    expect(r.locked[2]).toEqual({ cinema: 0, wengine: 0 })
  })

  it('② 锁了标准步（standardSteps）也要剔除', () => {
    const withStd: TeamPreset = { ...PRESET, standardSteps: [{ label: '常驻 1命', slot: 2, kind: 'cinema', value: 1 }] }
    const r = applySlotOverrides(withStd, [null, null, code(3, 1)])
    expect(r.preset.standardSteps).toEqual([])
  })
})

describe('goldStepsForPreset（只认用户显式配置，默认空）', () => {
  /**
   * 用户 2026-10-26 裁决（逐字）：「加金不该有排好的序……只能说全01这一片单薄的预设就行，
   * 要么给 ui 自己改，要么勾选贪婪，提示下一步。」
   *
   * ⇒ 修前「空 goldSteps ⇒ 从 catalog 推一份顺序当前缀阶梯」被明确否掉：
   * 实测那份顺序 96 队 285 档里 227 档选错配装、均值低 10.32%、最大低 43.40%。
   */
  it('用户写了 goldSteps ⇒ 逐位返回那份（同一个数组引用）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    expect(goldStepsForPreset(PRESET, h.catalog)).toBe(PRESET.goldSteps)
  })

  it('★ 空 goldSteps ⇒ **空**（不再编顺序；多金档必须用户显式要）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    const empty: TeamPreset = { ...PRESET, goldSteps: [] }
    expect(goldStepsForPreset(empty, h.catalog)).toEqual([])
    // 反空洞：catalog 候选池本身还在（贪婪要用），只是不再被当前缀阶梯
    const pool = catalogGoldSteps(empty.team, ['14151', '14156', '13008'], h.catalog)
    expect(pool.length).toBeGreaterThan(0)
    expect(pool.filter(s => s.kind === 'cinema').length).toBe(18)
  })
})

describe('computeTeamComparePoints（逐槽锁定接线）', () => {
  /**
   * 用户 2026-10-26：「只能说全 01 这一片单薄的预设就行，要么给 ui 自己改，要么勾选贪婪，提示下一步。」
   * ⇒ 默认（不勾贪婪、无用户阶梯）= **只出全 01 一个点**，且金数 = 基础金（不再假装能拉档）。
   */
  it('⑤ 空 goldSteps + 不勾贪婪 ⇒ 只出「全 01」一个点（不再编顺序）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const empty: TeamPreset = { ...PRESET, goldSteps: [] }
    const pts = computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [empty], goldLevels: [5, 6, 7, 8], boss: BOSS, phase: PHASE, autoEngine: false,
    })
    expect(pts).toHaveLength(1)
    // 基础金实测 5 = 三个限定 S 角色本体(3) + 两把限定专武本体(2)：
    // PRESET.wEngines 第三槽是 13008（A 级，不占金）⇒ presetBaseEngines 保留显式声明，不补成 14158。
    expect(pts[0]!.goldCount).toBe(5)
    expect(pts[0]!.cinemas).toEqual([0, 0, 0])
  })

  it('⑥ 空 goldSteps + 勾贪婪 ⇒ 金数区间各出一点（用户显式要才给）', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const empty: TeamPreset = { ...PRESET, goldSteps: [] }
    const pts = computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [empty], goldLevels: [5, 6, 7, 8], boss: BOSS, phase: PHASE, autoEngine: false,
      optimalGold: true,
    })
    expect(pts.length).toBeGreaterThan(1)
    // 伤害单调不减（多花一金不能变低）
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.damage).toBeGreaterThanOrEqual(pts[i - 1]!.damage)
  })

  it('★ 右位 0（无专武）⇒ 穿下位件，不留空音擎；点名则用点名那件', async () => {
    const h = await setupHarness([{ agentId: '1511' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    const preset = { ...PRESET, wEngines: undefined }
    const catalog = h.catalog
    // ① 不点名 ⇒ 走 data/downgradeWEngines 的角色表 → 职业表第一件
    const auto = applySlotOverrides(preset, [code(0, 0), null, null], catalog)
    const autoEngine = auto.preset.wEngines?.[0]
    expect(autoEngine, '00 不许留空音擎（空 = 没带武器，实测比下位低 34~41%）').toBeTruthy()
    expect(autoEngine).toBe(defaultDowngradeFor('1571', catalog.getAgent('1571')?.specialty))
    expect(auto.locked[0]).toEqual({ cinema: 0, wengine: 0 }) // 保留 wengine 0（= 无专武），供 UI 判「需要选下位」
    // ② 点名 ⇒ 用点名那件
    const named = applySlotOverrides(preset, [{ cinema: 0, wengine: 0, downgradeWEngineId: '13020' }, null, null], catalog)
    expect(named.preset.wEngines?.[0]).toBe('13020')
    // ③ 右位 ≥1 ⇒ 仍是专武（下位件不生效）
    const sig = applySlotOverrides(preset, [{ cinema: 2, wengine: 1, downgradeWEngineId: '13020' }, null, null], catalog)
    expect(sig.preset.wEngines?.[0]).not.toBe('13020')
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
    // 实测 8 = 基础 5（PRESET 显式 wEngines：14151/14156 限定 + 13008 不占金）+ 锁槽 2 命 + 该槽专武本体 14158。
    // ⚠ presetBaseEngines 只补**未声明**的槽：PRESET 显式给了 wEngines ⇒ 基础档仍是它声明的三件。
    // ⚠ 这是 2026-10-25 的口径：配置码 = 「命座 + 专武精炼」，右位 ≥1 就必须戴专武
    // （与 freeCompare 的 applyCodeToSlot 同一条语义）；右位 0 = 无专武。
    expect(pts[0]!.goldCount).toBe(8)
  })

  it('④ 常驻角色锁命座：伤害真变、金数不变（常驻不计金）', async () => {
    const h = await setupHarness([{ agentId: '1181' }, { agentId: '1561' }, { agentId: '1581' }])
    await h.catalog.loadBuildRecommendations()
    // 基础档（2026-10-26 起由 catalog 派生，= 主页「一键搭配」）：两个限定角色各带自己专武 = 4 金；
    // 格莉丝常驻、常驻/A 音擎不计金 ⇒ 锁她的命座只改伤害不改金数。
    const resident: TeamPreset = {
      id: 'resident-lock', name: '常驻锁命', team: ['1181', '1561', '1581'],
      goldSteps: [], interactions: [],
    }
    const run = (c: number) => computeTeamComparePoints({ config: h.config, calc: useResourceCalc() }, {
      presets: [resident], goldLevels: [2], boss: BOSS, phase: PHASE, autoEngine: false,
      slotOverrides: [code(c, 1), null, null],
    })[0]!
    const c0 = run(0)
    const c6 = run(6)
    expect(c0.goldCount).toBe(4) // 维琳娜/蕾米 本体+专武各 2 金；格莉丝常驻不计金
    expect(c6.goldCount).toBe(4)
    expect(c6.damage).toBeGreaterThan(c0.damage)
  })
})
