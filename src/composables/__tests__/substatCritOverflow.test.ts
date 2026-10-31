/**
 * 副词条「百暴」基线必须与真实面板同口径（2026-10-18，用户报「希格莉德 20 暴击 20 爆伤 3 攻击」）。
 *
 * 症状：推荐配装给希格莉德 20 步暴击（+48%），实际面板 133.4%，超 100% 封顶 33.4 个点、**13 步白扔**；
 * 「优化词条」重排后总伤 +14.4%。
 *
 * 根因：`core/substatOptimizer.ts#computeNoSubstatPanel` 的基线走 `calcPanel`（纯 buff 管线），
 * 而角色模块的 `applyPanel`（核心被动/额外能力/影画面板段）与 3/5 命技能等级通用规则在**编排层**
 * `panelPhases.ts#computePanelPhases` 才派发 ⇒ 基线面板少了角色自己的暴击。
 * 实测修前 62 个角色里 8 个过配：1591(13 步) / 1321(10) / 1521(7) / 1431(7) / 1301(4) / 1291(4) / 1441(4) / 1611(1)。
 *
 * 修法：`DefaultSubStatInput.panelHooks` ⇒ `core/agentPanelPhases.ts#applyAgentPanelHooks`（与编排层同序）。
 * 本测试锁两件事：① 全角色「分配后真实暴击 ≤ 模板封顶」；② 基线面板与真实面板的暴击率一致
 * （≥ 100% 封顶的角色除外——那种角色缺口本来就是 0，基线再准也只能给 0 步）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computePanel } from '@/composables/resourceCalc/panelPhases'
import { computeLoadoutPlanForSlot, computeSubstatAllocationForSlot } from '@/composables/substatOptimizer'
import { installTeamAwareBuildRecommendation } from '@/composables/teamAwareRecommendation'
import { useCalculatorStartup } from '@/composables/calculatorStartup'
import { setRecommendationTeamPanelResolver } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { panelAt } from '@/core/panel'
import { getTemplate } from '@/core/substatOptimizer'

const CRIT_STEP = 2.4

/**
 * 2026-10-29 追加：溢出折算的**给付手段是双爆配平**，配平器不得自己套利。
 *
 * 引擎把局内暴击溢出按「整条词条换爆伤」折算（data/critMultiplier.ts）。修前**精修器**把这笔折算当免费额度：
 * 全库扫描 64 角色，13 个精修后越封顶（般岳 97.8% → 119.4%），而且那点"更高伤害"与「爆伤 29 步」逐位相同
 * ——越了单项 ≤20 的现实现制，也破 A 档「暴击 >100% 的步数是纯浪费」。修后：
 * ① 精修候选有效性 = 面板暴击 ≤ 封顶 + 1 条；② 真兑现折算的手段是翻 4 号位与 2 件套（模块文件头「双爆配平」段）。
 */
const REFINE_SWEEP_AGENTS = ['1521', '1571', '1621', '1041', '1051', '1191', '1291', '1321', '1371', '1441', '1471', '1531', '1591']

describe('副词条百暴基线 = 真实面板（角色 applyPanel 不得漏算）', () => {
  it('全角色：推荐配装的暴击率不越过模板封顶（修前 8 人溢出）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, '', ''])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    const agents = catalog.displayAgents.filter(a => !a.hidden)
    expect(agents.length).toBeGreaterThan(50)
    const bad: string[] = []
    for (const a of agents) {
      cfg.setAgent(0, a.id, { defer: true })
      cfg.syncTeammateBuffsFromTeam()
      cfg.applyBuildRecommendationForSlot(0)
      const char = cfg.team[0]!
      const steps = char.driveDisc.subStatAllocation?.critRate ?? 0
      if (steps === 0) continue
      const keep = char.driveDisc.subStatAllocation
      char.driveDisc.subStatAllocation = {}
      const noSubs = computePanel(0, cfg, catalog)?.critRate ?? 0
      char.driveDisc.subStatAllocation = keep
      const cap = getTemplate(catalog.getAgent(a.id)!).critRateCap ?? 100
      const after = noSubs + steps * CRIT_STEP
      // 2.4% 一步的取整误差允许 1 步（floor 到步数上限）
      if (after - cap > CRIT_STEP) {
        bad.push(`${a.id} ${a.name.zhCN}: 无副词条 ${noSubs.toFixed(1)}% + ${steps} 步 = ${after.toFixed(1)}% > 封顶 ${cap}%`)
      }
    }
    expect(bad, `暴击词条过配（白扔的步数）：\n${bad.join('\n')}`).toEqual([])
  }, 300000)

  it('希格莉德（1591）：核心被动 +66% 暴击必须进基线 ⇒ 分配不再是满 20 步', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, { agentId: '1211' }])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    cfg.applyBuildRecommendationForSlot(0)
    const char = cfg.team[0]!
    // 修前：基线 19.4%（只有 buff 管线）⇒ floor((100-19.4)/2.4)=20 步封顶
    expect(char.driveDisc.subStatAllocation.critRate, '满 20 步 = 基线漏了核心被动的 +66%').toBeLessThan(20)
    const panel = computePanel(0, cfg, catalog)!
    const cap = getTemplate(catalog.getAgent('1591')!).critRateCap ?? 100
    expect(panel.critRate, `分配后真实暴击 ${panel.critRate.toFixed(1)}% 不应越封顶 ${cap}%`).toBeLessThanOrEqual(cap + CRIT_STEP)
    // 溢出被消掉的那部分必须换成有效词条（总步数不变）
    const total = Object.values(char.driveDisc.subStatAllocation).reduce((s, n) => s + n, 0)
    expect(total, '预算仍是 43 步（4 词条档），只是从暴击挪给了爆伤/攻击').toBe(43)
  }, 120000)
})

describe('双爆配平：溢出折算必须由 4 号位 / 2 件套 给付，配平器不得自己套利', () => {
  /** 曾越封顶的 13 个角色（2026-10-29 修前全库扫描结果）；要全量扫把数组换成 displayAgents（≈26s） */
  it('重演扫描：精修与配平后面板暴击都不越封顶 + 1 条', async () => {
    const h = await setupHarness([{ agentId: '1471' }, '', ''], { recommendedBuild: true })
    const { config, catalog } = h
    const calc = useResourceCalc()
    const bad: string[] = []
    for (const id of REFINE_SWEEP_AGENTS) {
      config.setAgent(0, id, { defer: true })
      config.syncTeammateBuffsFromTeam()
      config.applyBuildRecommendationForSlot(0)
      const char = config.team[0]!
      const cap = getTemplate(catalog.getAgent(id)!).critRateCap ?? 100
      const keep = { main: { ...char.driveDisc.mainStats }, two: char.driveDisc.twoPieceSetId, alloc: { ...char.driveDisc.subStatAllocation } }
      const opts = {
        readDamage: () => calc.teamTotalDamage.value ?? 0,
        readPanelCrit: () => panelAt(calc.panels.value, 0)?.critRate ?? 0,
      }
      // ① 只精修副词条（词条收益曲线 / 敏感度曲线的基线走这条）：不得把自己推到溢出
      const alloc = computeSubstatAllocationForSlot(0, config, catalog, opts, calc.effectiveWEngineCoverages.value)
      if (alloc) {
        char.driveDisc.subStatAllocation = alloc
        const crit = panelAt(calc.panels.value, 0)?.critRate ?? 0
        if (crit - cap > CRIT_STEP + 1e-6) bad.push(`${id} 精修后 ${crit.toFixed(1)}% > 封顶+${CRIT_STEP}`)
      }
      char.driveDisc.mainStats = keep.main
      char.driveDisc.twoPieceSetId = keep.two
      char.driveDisc.subStatAllocation = keep.alloc
      // ② 配平（4 号位 / 2 件套 / 副词条 联合）：终态不得溢出
      const plan = computeLoadoutPlanForSlot(0, config, catalog, opts, calc.effectiveWEngineCoverages.value)
      expect(plan, id).toBeTruthy()
      const p = plan!
      expect(p.subStatAllocation.critRate ?? 0, `${id} 暴击词条不越单项上限`).toBeLessThanOrEqual(20)
      if (Object.values(p.subStatAllocation).sort((a, b) => b - a).slice(0, 2).reduce((s, n) => s + n, 0) > 35) {
        bad.push(`${id} 配平后 TOP2 越界`)
      }
      if (p.mainStat4) char.driveDisc.mainStats[4] = p.mainStat4
      char.driveDisc.twoPieceSetId = p.twoPieceSetId
      char.driveDisc.subStatAllocation = p.subStatAllocation
      const crit = panelAt(calc.panels.value, 0)?.critRate ?? 0
      if (crit - cap > CRIT_STEP + 1e-6) bad.push(`${id} 配平后 ${crit.toFixed(1)}% > 封顶+${CRIT_STEP}`)
      char.driveDisc.mainStats = keep.main
      char.driveDisc.twoPieceSetId = keep.two
      char.driveDisc.subStatAllocation = keep.alloc
    }
    expect(bad, `越封顶 / 越 TOP2：\n${bad.join('\n')}`).toEqual([])
  }, 300000)

  /**
   * 推荐配装接队友暴击（2026-10-29）：默认配装是别人第一眼看到的东西，队友给的暴击必须进百暴基线。
   * 修前般岳 + 本（1121 额外能力 +16% 暴击）的推荐分配面板 **113.8%**（6 步暴击全白扔）。
   */
  it('般岳 + 本（+16% 暴击）：推荐分配的面板不溢出；旧口径（不接队友）确实溢出', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1471' }, { agentId: '1121' }, ''], { recommendedBuild: true })
    const calc = useResourceCalc()
    const cap = getTemplate(catalog.getAgent('1471')!).critRateCap ?? 100
    const withTeam = panelAt(calc.panels.value, 0)!.critRate
    expect(withTeam, `新口径面板 ${withTeam.toFixed(1)}% 不越封顶（队友 +16% 暴击已进基线）`).toBeLessThanOrEqual(cap)
    // 负控：拆掉端口（旧口径 = 推荐配装与队友无关）⇒ 同一支队必须重新溢出，否则本判据无判别力
    setRecommendationTeamPanelResolver(null)
    config.applyBuildRecommendationForSlot(0)
    const legacy = panelAt(calc.panels.value, 0)!.critRate
    expect(legacy, `旧口径面板 ${legacy.toFixed(1)}% 应溢出（本判据的判别力来源）`).toBeGreaterThan(cap)
    installTeamAwareBuildRecommendation()
  }, 120000)

  it('生产启动入口真的装上了端口：useCalculatorStartup 之后推荐配装接队友暴击', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1471' }, { agentId: '1121' }, ''], { recommendedBuild: true })
    const calc = useResourceCalc()
    const cap = getTemplate(catalog.getAgent('1471')!).critRateCap ?? 100
    // 先退回旧口径（不靠 harness 的安装），再用**生产启动入口**装回来
    setRecommendationTeamPanelResolver(null)
    useCalculatorStartup()
    config.applyBuildRecommendationForSlot(0)
    const crit = panelAt(calc.panels.value, 0)!.critRate
    expect(crit, `启动入口安装后面板 ${crit.toFixed(1)}% 不越封顶`).toBeLessThanOrEqual(cap)
  }, 120000)

  it('装配点不腐坏：生产启动入口与测试 harness 都装端口（漏装 = 生产静默退回旧口径）', () => {
    const src = (relPath: string) => readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8')
    expect(src('composables/calculatorStartup.ts'), '生产唯一安装点（须在 initDefaultTeam 之前）')
      .toContain('installTeamAwareBuildRecommendation()')
    expect(src('test/harness.ts'), '测试 harness 装同一端口 ⇒ 判据与生产同态')
      .toContain('installTeamAwareBuildRecommendation()')
  })

  it('般岳（1471）：翻 4 号位与 2 件套把溢出兑现成爆伤 —— 面板不溢出且伤害严格高于推荐配装', async () => {
    const h = await setupHarness([{ agentId: '1471' }, '', ''], { recommendedBuild: true })
    const { config, catalog } = h
    const calc = useResourceCalc()
    const char = config.team[0]!
    const before = calc.teamTotalDamage.value ?? 0
    // 修前：精修把暴击堆到 119.4%（= 爆伤 29 步的折算，越单项上限）且 4 号位 / 2 件套 一动不动
    const plan = computeLoadoutPlanForSlot(0, config, catalog, {
      readDamage: () => calc.teamTotalDamage.value ?? 0,
      readPanelCrit: () => panelAt(calc.panels.value, 0)?.critRate ?? 0,
    }, calc.effectiveWEngineCoverages.value)!
    expect(plan.flippedMainStat4 || plan.flippedTwoPiece, '般岳必须发生配平翻转').toBe(true)
    if (plan.mainStat4) char.driveDisc.mainStats[4] = plan.mainStat4
    char.driveDisc.twoPieceSetId = plan.twoPieceSetId
    char.driveDisc.subStatAllocation = plan.subStatAllocation
    const panel = panelAt(calc.panels.value, 0)!
    const cap = getTemplate(catalog.getAgent('1471')!).critRateCap ?? 100
    expect(panel.critRate, `配平后面板暴击 ${panel.critRate.toFixed(1)}% 不越封顶`).toBeLessThanOrEqual(cap)
    expect(calc.teamTotalDamage.value ?? 0, '配平必须真的赚（不是靠溢出折算）').toBeGreaterThan(before)
  }, 120000)
})
