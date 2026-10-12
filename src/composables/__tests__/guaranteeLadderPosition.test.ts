/**
 * T140b **现状锁 + 反证**：难度曲线「全关」档与保底档（G3）的位置。
 *
 * ⚠ **本文件是 T140b 的实验产物，不是某个修法的判据**（该任务终判 `STATUS: blocked`，
 * 两条候选路线都被实测反证，见 `/home/kaua/t140b/REPORT.md`）。它把三条**决策相关**的实测事实
 * 钉成机器判据，让「下一个会话动手前先看这里」而不是重跑探针：
 *
 * ① **轴态下 `guarantee.fury` / `guarantee.ultimate` 的边际逐位为 0** —— 这就是
 *    `convergence.ts#guaranteeFury` 的「视同勾选」（`axisActive || …`，用户裁决 2026-10-11，
 *    **有意设计，不许删**）在曲线上的可观察形态。负控 = 同树同条件下**非轴队**的
 *    `guarantee.ultimate` 边际 > 0 ⇒ 归零确实是轴态造成的，不是这两键本来就没用。
 *
 * ② **反证路线 (a)「全关档也置 forceNoAxis/清轴」**：难度阶梯的目标集里**没有任何一档会把轴开回来**
 *    （轴来自 `applyAxisBinding(preset)` = 队伍配置，不是优化杠杆）⇒ 清轴基线会让**整条曲线**退化成
 *    非轴曲线。实测（Boss 30021）：`auto-1051-1481-1451` 终点 −17.698M、
 *    `auto-1521-1481-1311` 终点 −15.349M。本用例断言「清轴后逐档 apply 完全部目标，生效轴仍为 0」——
 *    将来若有人新增「开轴」档，本断言变红，强制回来重估 (a)。
 *
 * ③ **`guarantee.stun` 不在自动勾选内，且对轴队仍是活杠杆**（带声明弹刀预算的 Boss 时最高 +12.0M）⇒
 *    路线 (b)「G3 对轴队已被前置满足」**不能整档一律标注**（那会把活着的 stun 键一起说成死的）。
 *
 * 跑法：`npx vitest run src/composables/__tests__/guaranteeLadderPosition.test.ts`
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore, applyGoldToStore, baseGoldOf } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { clearDifficultyLevers, climbDifficultyLadder, type LadderCtx } from '@/composables/difficultyLadder'
import { axisStands } from '@/composables/difficultyAxis'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

const KEYS = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

/** 曲线真实「全关」基线：clearDifficultyLevers（guarantee.* 全 0、吸收 0）+ 预设静态权重/交互 + 基础金 */
function baseline(config: LadderCtx['config'], calc: ReturnType<typeof useResourceCalc>, preset: (typeof teamPresets)[number]) {
  applyTeamToStore(config, preset)
  applyGoldToStore(config, preset, baseGoldOf(preset))
  clearDifficultyLevers({ config, calc })
  for (const k of KEYS) config.setMechanicSetting(k, 0)
}

const dmgOf = (calc: ReturnType<typeof useResourceCalc>) => calc.teamTotalDamage.value

describe('T140b 现状锁：轴队「全关」档的保底键边际', () => {
  it('① 轴态 ⇒ fury/ultimate 边际逐位为 0；负控：非轴队同键 > 0', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const pick = (id: string) => teamPresets.find(p => p.id === id)!

    /** 逐键边际（每次都从全关基线重新起算） */
    const marginal = (preset: (typeof teamPresets)[number], key: (typeof KEYS)[number]) => {
      baseline(config, calc, preset)
      const off = dmgOf(calc)
      config.setMechanicSetting(key, 1)
      return { off, gain: dmgOf(calc) - off, axes: calc.effectiveStunAxes.value.length }
    }

    // —— 轴队：曲线全关档下轴仍生效（前提），fury/ultimate 两键边际逐位为 0
    const axisTeam = pick('yixuan-roxy-lucia')
    for (const key of ['guarantee.fury', 'guarantee.ultimate'] as const) {
      const r = marginal(axisTeam, key)
      expect(r.axes, `前提：${axisTeam.id} 在曲线全关档仍是轴态`).toBeGreaterThan(0)
      expect(r.gain, `${axisTeam.id}｜轴态 ⇒ ${key} 被视同勾选，边际必须逐位为 0`).toBe(0)
    }

    // —— 负控：非轴队（清轴，曲线全关档轴不生效）的 ultimate 键边际 > 0
    // ⇒ 上面那个 0 是**轴态**造成的，不是这两个键本来就没用（否则本用例对泄漏零判别力）
    const nonAxisTeam = pick('banyue-norma-lucia')
    baseline(config, calc, nonAxisTeam)
    config.setAxisState({ stunAxes: [], stunAxisPlans: [], useStunAxis: false })
    config.autoYidhariAxis = false
    expect(calc.effectiveStunAxes.value.length, '负控前提：清轴后非轴态').toBe(0)
    const off = dmgOf(calc)
    config.setMechanicSetting('guarantee.ultimate', 1)
    expect(dmgOf(calc) - off, '负控：非轴队的 guarantee.ultimate 必须真有边际').toBeGreaterThan(0)
  }, 300_000)

  it('② 反证路线 (a)：阶梯只动「交互配置 + 合轴吸收」两个旋钮，没有任何"开轴"旋钮', async () => {
    // ## T140c 更新（本用例原锁的是「DIFFICULTY_GOALS 里没有开轴档」，该目标集已随贪心阶梯删除）
    //
    // 新结构的旋钮**只有两个**（`difficultyLadder.ts` 文件头）：交互配置（`default`/`joint`）与
    // 合轴吸收率。两者都**不改轴绑定**（`applyTimeWeightAllocation` 只写权重/弹刀/嘲讽取消；
    // `setMechanicSetting` 只写吸收率）⇒ 路线 (a)「清轴起点」在新结构下**依然**会让整条曲线退化为非轴。
    // 本断言因此照旧有判别力：将来若有人新增「切轴/开轴」旋钮，这里变红。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1051-1481-1451')!

    baseline(config, calc, preset)
    expect(calc.effectiveStunAxes.value.length, '前提：该队默认是轴队').toBeGreaterThan(0)

    // 路线 (a) 的"等效开关"：让「全关」起点真的是 off
    config.setAxisState({ stunAxes: [], stunAxisPlans: [], useStunAxis: false })
    config.autoYidhariAxis = false
    expect(calc.effectiveStunAxes.value.length, '(a) 之后起点确已 off').toBe(0)

    // 跑完整条曲线 ⇒ 若没有旋钮能把轴开回来，整条曲线就是非轴曲线
    const ctx: LadderCtx = { config, calc }
    const r = climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      base: c => c.calc.teamTotalDamage.value,
    })
    expect(
      calc.effectiveStunAxes.value.length,
      '旋钮集内没有任何"开轴"旋钮 ⇒ (a) 会让整条曲线退化为非轴；若新增开轴旋钮，本断言变红，请回来重估路线 (a)',
    ).toBe(0)
    // 清轴起点下，整条曲线的轴态只能是 none（既没弃轴也没注入轴）
    for (const pt of r.points) expect(pt.axis.kind).toBe('none')
  }, 300_000)

  it('③ guarantee.stun 不在自动勾选内：带弹刀预算 Boss 时对轴队仍是活杠杆', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const file = await catalog.loadBossPresets() as unknown as { bosses: BossPreset[] }
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'yixuan-roxy-lucia')!

    // 秽息司祭：defaults 里声明 parryNoFollowUpTotal=15（弹刀反推链的输入来源）
    const boss = file.bosses.find(b => b.id === '30033')!
    const phase: BossPresetPhase = boss.phases[boss.phases.length - 1]!
    expect(boss.defaults, '前提：该 Boss 声明了弹刀预算').toHaveProperty('parryNoFollowUpTotal')

    // ⚠ 顺序是关键（与 `computeDifficultyCurves` 同序）：先 applyBossRoom —— 它会**自动勾选**
    // `guarantee.stun`（`stores/config#applyBossPreset`：Boss 声明了弹刀预算就替用户勾上），
    // 而曲线的「全关」`clearDifficultyLevers` 在那之后再把它清零。反过来写会让 off 基线自带 stun=1
    // ⇒ 本用例退化成恒 0、对这条口径零判别力（首版实测踩到）。
    baseline(config, calc, preset)
    applyBossRoom(config, boss, phase)
    clearDifficultyLevers({ config, calc })
    for (const k of KEYS) config.setMechanicSetting(k, 0)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
    expect(calc.effectiveStunAxes.value.length, '前提：该队在曲线全关档仍是轴态').toBeGreaterThan(0)
    const off = dmgOf(calc)
    config.setMechanicSetting('guarantee.stun', 1)
    expect(
      dmgOf(calc) - off,
      'guarantee.stun 被有意排除在自动勾选外 ⇒ 它对轴队必须仍有边际（路线 (b) 不得把 G3 整档标成"已前置满足"）',
    ).toBeGreaterThan(0)
  }, 300_000)

  it('④ T140c 取代：G3 不再是阶梯的一点（保底降级为轴可行性判定条件）', async () => {
    // ## 本用例的沿革（**取代**，不是静默删除——卡 §7 要求留痕）
    //
    // T140b 原锁：「轴队的 G3 不进录取序列，如实进 `dropped`；负控 = 非轴队的 G3 仍被录取」。
    // **T140c 让这条判据整体失效**，因为 `G3` 这个点**不再存在**：
    //  - `DIFFICULTY_GOALS` / `dropped` / `opened` 三个概念随贪心阶梯一并删除（卡 §3.3 / §3.4）；
    //  - 保底（`guarantee.fury` / `guarantee.ultimate`）**降级为轴可行性的判定条件**——
    //    轴要立起来时由引擎自己补资源（`convergence.ts#guaranteeFury` 的「视同勾选」，用户裁决
    //    2026-10-11，实现一字未动），**不再由阶梯打开**。
    //
    // 新判据锁的是同一件事的**新形态**：轴队与非轴队在**同一条曲线**上的轴态差异（这才是 G3 当初
    // 想表达的东西），且曲线**不因保底而产生一个点**。
    // 否决记录见 `docs/ENGINE_PIPELINE_GUIDE.md` §4。
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'yixuan-roxy-lucia')!
    // 完整房间夹具（同 difficultyCurve.test.ts 的 FAKE_BOSS/FAKE_PHASE）：
    // ⚠ 不能省字段——`applyBossPreset` 会读 `phase.stunValue` / `damageResistances` …
    // 缺项会让 `stunResistances` 变成 NaN 并在折叠环里炸成 `st[i] undefined`（首版踩到）。
    const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
    const boss: BossPreset = {
      id: '40009', name: '异构·基塔布鲁', nameEn: 'Integrated - Girtablullu', aliases: [],
      icon: null, iconSource: null, isCriticalAssault: true,
      monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
      defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
      phases: [],
    }
    const phase = {
      phaseId: '690461', zoneKey: '69046201', version: '3.2', label: '3.2 · 2026-07-30',
      begin: '2026-07-30 04:00:00', modeType: 'critical_assault', stageName: '异构·基塔布鲁',
      stageNum: 1, level: 70, hp: 31_900_305, stunValue: 18933.95, defense: 953, bossAnomalyCoeff: 1.1,
      damageResistances: { ...res20 }, stunResistances: { ...res20 },
      anomalyResistances: { ...res20 }, weakness: [], resistance: [],
    } as unknown as BossPresetPhase
    // 负控队：同 Boss、同夹具，但**非轴**。
    // ⚠ 夹具沿革（T140c 重标定）：原用 `banyue-norma-lucia`，实测它在本 Boss 下**是轴队**
    // （`baseline/轴不可行 → axis/完整轴 → progress/完整轴 → max/完整轴`）——那正是本卡的核心论点
    // （「让轴可行」不只归保底，交互最优 + 合轴同样能让轴立起来）⇒ 它不再适合当「非轴」负控。
    // 换 `auto-1431-1491-1311`：全库普查（`.zc/perf` 口径同源探针）中每一点轴态都是 `none` 的 58 队之一。
    const nonAxisPreset = teamPresets.find(p => p.id === 'auto-1431-1491-1311')!
    const rows = await withAnalysisScenario(s =>
      computeDifficultyCurves(s, { presets: [preset, nonAxisPreset], boss, phase }))
    const axisLadder = rows.find(r => r.presetId === preset.id)!.ladder
    const nonAxisLadder = rows.find(r => r.presetId === nonAxisPreset.id)!.ladder

    // ① **结构**：曲线里不再有任何「保底点」——点名只允许四个定点，`G3` 不在其中
    const allowed = new Set(['baseline', 'axis', 'progress', 'max'])
    for (const pt of axisLadder.points) {
      expect(allowed.has(pt.point), `点名 ${pt.point} 必须是四个关键点之一`).toBe(true)
    }
    // ② **保底不再由阶梯打开**：直接在本 store 上跑一次阶梯，跑完三个保底键仍是「未打开」
    //    （引擎的「视同勾选」只做本轮读数、不落 store —— 这正是该设计选择不写 store 的原因）。
    //    ⚠ 必须**直接跑**而不是读上面 `withAnalysisScenario` 的 `config`：那是场景克隆，
    //    外层的 store 本来就不会被写（隔离契约），拿它断言「阶梯没写保底」是**零判别力**的假判据。
    {
      const ctx: LadderCtx = { config, calc: useResourceCalc() }
      clearDifficultyLevers(ctx)
      applyTeamToStore(config, preset)
      climbDifficultyLadder(ctx, preset.team as [string, string, string], {
        base: c => c.calc.teamTotalDamage.value,
      })
      for (const k of KEYS) {
        expect(config.getMechanicSetting(k, 0), `${k} 不得被阶梯写进 store`).not.toBe(1)
      }
      // 计数投影（G4 语义）同理：阶梯不再改它 ⇒ 保持 `clearDifficultyLevers` 写的 0
      expect(config.getMechanicSetting('time.stunPlanProjection', -1), '计数口径不得随难度漂移').toBe(0)
    }
    // ③ **轴队 vs 非轴队的轴态差异如实可读**（G3 当初想表达的东西，现在由 `axis` 字段承载）：
    //    负控队在本 Boss 下**从来不是轴队** ⇒ 它的每一点轴态都是 `none`，且 ② 如实缺失。
    for (const pt of nonAxisLadder.points) {
      expect(pt.axis.kind, '非轴队每一点的轴态都应是 none').toBe('none')
      expect(axisStands(pt.axis)).toBe(false)
    }
    expect(nonAxisLadder.axisPointMissing, '非轴队 ② 必须如实缺失').toBe(true)
  }, 300_000)
})
