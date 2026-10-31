/**
 * 副词条优化器（单槽）+ 双爆配平（单槽整装）：从 config/catalog 两个 store 组装 core
 * `computeDefaultSubStatAllocation`（CC-186 前名 computeOptimalSubStats）的全部入参并算出配装。
 *
 * 为什么放编排层：原先 ImpactChart.vue `runOptimizerForSlot0` 在组件里直接 import 引擎
 * （`computeOptimalSubStats` + `getTemplate`，判据 7），并自己决定「模板 stat 数 → 步数配置键」
 * 「队友 buff 来源」「词条数夹到 0~54」这些计算口径。收拢后组件只负责把结果写回 store。
 *
 * 口径（第 194 轮起队友 buff 输入与伤害管线同源 `resolveSlotPanelBuffInputs`）：
 * - 空槽 / 无角色 / catalog 查不到角色 ⇒ null；
 * - 引擎抛错 ⇒ null（原组件 `catch { skip }`，即不改分配）；
 * - 返回值只含 n>0 的键，且夹到 [0, 54]。调用方应**整体替换** `driveDisc.subStatAllocation`。
 *
 * ⚠ 与 `stores/config.ts` 的配装推荐（applyBuildRecommendationForSlot）是**两条独立路径**；
 *    store 层不反向依赖 composables。两处共用的预算口径（设置键 / 缺省步数 / 分档）与写回规整
 *    已收进 core `resolveSubstatBudget` / `normalizeSubstatAllocation`，不要再各写一份。
 *
 * **CC-185（第 208 轮）起只有一种模式：useDefault 快速分配作起点 → 真实伤害精修（readDamage 必填）。**
 * 详见 docs/mcp-stun-dual-source.md §24.32 / §24.33。
 *
 * ============ 候选有效性：面板暴击 ≤ 封顶 + 一条词条（2026-10-29） ============
 *
 * 引擎对局内暴击溢出按「整条词条换爆伤」折算（`data/critMultiplier.ts#expectedCritMultiplier`，
 * 用户 2026-10-24 裁决）。那笔折算**要么真有词条可换、要么是白拿**——精修器若拿它当免费额度，
 * 就会把暴击堆到溢出：实测般岳 1471（4 号位暴击率 + 啄木鸟 2 件套 + 云岿如我 4 件套不动）
 *   起点 c6/爆伤20/hp13 → 面板 97.8% / 12,526,917
 *   套利 c15/爆伤20/hp4 → 面板 **119.4%** / 13,307,284，与「c6/爆伤29/hp4」**逐位同伤** ——
 *   而爆伤 29 步越单项上限（≤20），也破 A 档「暴击 >100% 的步数是纯浪费」（坑 53）。
 * 因此精修只接受「面板暴击 ≤ 封顶 + 1 条」的候选（微溢出是配平器合法终态，用户 2026-10-24 逐字
 * 「达到 98% 暴，再来一词条变 100.4%，这个词条只价值 2% 暴击」）；越线的候选直接不采纳。
 * 队列扫描（64 角色，2026-10-29）：修前 13 个角色精修后越封顶（最高 119.6%），修后全部 ≤ 封顶 + 1 条。
 *
 * ============ 双爆配平：4 号位主词条 + 2 件套 = 折算的给付手段（2026-10-29） ============
 *
 * 只堵套利会让最优解变保守（般岳从 13,307,284 掉回 12,526,917，−5.9%）。真兑现那笔折算的手段是
 * **翻动双爆来源本身**（用户 2026-10-29 裁决：「4 号位主词条的等效 10 个副词条，2 件套等效 3.33 词条」
 * ⇒ 配平宽度多 6.67~13.33 词条，不必让单一副词条越 20 步）：
 * - 4 号位主词条：暴击率 24% ≡ 10 条暴击词条，暴击伤害 48% ≡ 10 条爆伤词条；
 * - 2 件套：啄木鸟电音 +8% 暴击 ≡ 3.33 条，折枝剑歌 +16% 爆伤 ≡ 3.33 条。
 * 把 4 号位从暴击率翻成爆伤 ⇒ 腾出 10 条暴击词条余量，折算就能落到真词条上：
 *   配平态 4=爆伤 c15/爆伤20/hp4 → 面板 95.4%（不溢出）/ 13,273,424（TOP2 = 35 卡线）= 套利态的 **96%**。
 * 两条都翻（4=爆伤 + 折枝 c17/爆伤20/hp2）反被 TOP2（17+20 = 37）挡住 ⇒ 搜索必须在 TOP2 ≤ 35 内做。
 * 实测（2026-10-29，4 件套不动）：配平态相对现推荐 般岳 solo +5.96% / 般岳+诺姆+卢西娅 +4.18% /
 * 般岳+琉音+卢西娅 +2.68%；只翻 2 件套（4=暴击率 + 折枝 c10/爆伤20/hp9）分别 +3.07% / +2.27% / +1.93%。
 *
 * ⚠ nanoka / 邦布精灵的静态推荐**只作兜底**（用户 2026-10-29：它爬的是官方给新手的指导，「方向是对的，
 * 但高手会考虑配平」），不参与最优裁决——本模块的候选空间由引擎伤害裁决，静态推荐只提供起点。
 */
import {
  computeDefaultSubStatAllocation, getTemplate, normalizeSubstatAllocation, resolveSubstatBudget,
  fitsTopTwoCap,
} from '@/core/substatOptimizer'
import type { SubstatTemplate } from '@/core/substatOptimizer'
import { CRIT_RATE_STEP } from '@/data/critMultiplier'
import type { Agent, DriveDiscSet, WEngine } from '@/types/catalog'
import type { DriveDiscConfig } from '@/types/catalog'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import {
  additionalAbilityActiveForPanel,
  buildMechanicTeamMembers,
  resolveMechanicSettings,
  resolveSlotPanelBuffInputs,
} from '@/composables/resourceCalc/panelPhases'
import { buildSourcePanelsBySlot } from '@/core/sourcePanels'
import { panelAt } from '@/core/panel'
import type { useResourceCalc } from '@/composables/useResourceCalc'

/**
 * CC-183（第 206 轮）：真实伤害精修。
 * 引擎打分（computeExpectedScore，CC-186 已删）是「攻击 × 暴击 × 增伤 / 攻击 × 精通」的闭式近似，看不到技能级乘区
 * （技能专属暴击/增伤/倍率、异常与直伤真实占比、转模…），实测系统性高估暴击/精通、低估攻击。
 * 与其逐项校准近似式，不如让伤害管线本身裁决：以 core 默认分配为起点（CC-185），在模板词条间做「挪 k 步」爬山
 * （k=4→2→1，首个改进即接受），评估 = 写入分配后读 `readDamage()`（useResourceCalc.teamTotalDamage，
 * 惰性 computed + state memo；与 teamCompare 的「改 store → 读 → 恢复现场」同一模式）。
 * 结束时恢复原分配；调用方按返回值整体替换。maxEvals 封顶耗时（单人队约 25ms/次）。
 */
export interface SubstatRefineOptions {
  readDamage: () => number
  /**
   * 结算侧本槽面板暴击（`panelAt(calc.panels.value, slot)?.critRate`）。**候选有效性判据**（见文件头）：
   * 面板暴击 ≤ 封顶 + 一条词条 —— 越线候选不采纳，堵掉「溢出整条转爆伤」的套利。
   * 传结算侧面板而不是自算：覆盖率 / 队友 buff / 全局 Buff 必须与伤害管线同一份。
   */
  readPanelCrit: () => number
  maxEvals?: number
}

/**
 * 结算侧本槽面板暴击的读法 = `SubstatRefineOptions.readPanelCrit` 的生产实现（单一来源）。
 * 放这里而不是各页面自己取：展示层（views/components）禁 import `@/core`（ARCHITECTURE §0 的越层棘轮），
 * 而这条读数必须与伤害管线**同一个**结算侧面板（压缩数组 ⇒ 用 `panelAt` 按槽取，判据 17）。
 */
export function slotPanelCritReader(calc: ReturnType<typeof useResourceCalc>, slot: number): () => number {
  return () => panelAt(calc.panels.value, slot)?.critRate ?? 0
}



function refineWithRealDamage(
  slot: number,
  configStore: ConfigModel,
  seed: Record<string, number>,
  stats: readonly string[],
  statCap: number,
  critCap: number,
  opts: SubstatRefineOptions,
): Record<string, number> {
  const disc = configStore.team[slot].driveDisc
  const original = disc.subStatAllocation
  const maxEvals = opts.maxEvals ?? 80
  let evals = 0
  const evalAlloc = (a: Record<string, number>): number => {
    evals++
    disc.subStatAllocation = { ...a }
    return opts.readDamage()
  }
  /** 候选有效性：面板暴击 ≤ 封顶 + 1 条（文件头「候选有效性」段；微溢出合法，再多就是白拿折算） */
  const critWithinCap = (): boolean => opts.readPanelCrit() <= critCap + CRIT_RATE_STEP + 1e-6
  let best = { ...seed }
  for (const s of stats) best[s] = best[s] ?? 0
  try {
    // 起点照收：它由 core 默认分配按「百暴缺口」算出来，本身不越封顶；但队友 buff 把基线顶到
    // 封顶以上时它的暴击步数已是 0 —— 那种溢出没有词条可撤，不归精修管（不在本轮降级为「越线」）。
    let bestDmg = evalAlloc(best)
    for (const k of [4, 2, 1]) {
      let improved = true
      while (improved && evals < maxEvals) {
        improved = false
        for (const from of stats) {
          if ((best[from] ?? 0) < k) continue
          for (const to of stats) {
            if (to === from || (best[to] ?? 0) + k > statCap) continue
            if (evals >= maxEvals) break
            const cand = { ...best, [from]: best[from] - k, [to]: (best[to] ?? 0) + k }
            // TOP2（用户 2026-10-26）：精修只能在「最高两项合计 ≤ 35」的分配空间里挪步，
            // 否则爬山会把默认分配又推回 20/19 这种现实里刷不出来的盘子。
            if (!fitsTopTwoCap(cand)) continue
            const d = evalAlloc(cand)
            // 越封顶的候选不采纳（哪怕伤害更高）：那笔更高是溢出折算给的，不是这份分配挣的
            if (!critWithinCap()) continue
            if (d > bestDmg * (1 + 1e-9)) { best = cand; bestDmg = d; improved = true; break }
          }
          if (improved) break
        }
      }
    }
  } finally {
    disc.subStatAllocation = original
  }
  return best
}

/** 单槽优化上下文：seed() 用**当前** driveDisc 现场（调用方可在枚举候选时先写入 4 号位 / 2 件套） */
interface SlotOptimizerContext {
  agent: Agent
  wEngine: WEngine | undefined
  tmpl: SubstatTemplate
  budget: { statCap: number; totalSteps: number }
  /** 暴击封顶（锋御锐暴 200，其余 100；与 core 百暴预算同一常量来源） */
  critCap: number
  seed: () => Record<string, number> | null
}

function resolveSlotOptimizerContext(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
  wEngineCoverages?: Record<string, number>,
): SlotOptimizerContext | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
  // 第 194 轮：与伤害管线同一份队友 buff 输入（门控 / 接收槽过滤 / 全局 Buff / 覆盖率 / 来源修正）
  const setInfo = resolveSlotPanelBuffInputs(slot, configStore, catalogStore, wEngineCoverages)
  const tmpl = getTemplate(agent)
  const budget = resolveSubstatBudget(tmpl, configStore.getMechanicSetting)
  const settings = resolveMechanicSettings(configStore)
  const additionalAbilityActive = additionalAbilityActiveForPanel(slot, configStore, catalogStore)
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const sourcePanels = buildSourcePanelsBySlot(setInfo.sourcePanelsByOwner, team)
  return {
    agent,
    wEngine,
    tmpl,
    budget,
    critCap: tmpl.critRateCap ?? 100,
    seed: () => {
      try {
        return computeDefaultSubStatAllocation({
          agent, wEngine,
          driveDiscConfig: char.driveDisc,
          setsMap: catalogStore.driveDiscSetsMap,
          teammateBuffs: setInfo.teammateBuffs,
          statRules: catalogStore.statRules,
          ...budget,
          config: { cinemaLevel: char.cinemaLevel, wEngineModLevel: char.wEngineModLevel, potentialLevel: char.potentialLevel, sourcePanelsByOwner: setInfo.sourcePanelsByOwner, effectCoverageMap: setInfo.effectCoverageMap, enemyWeakness: configStore.enemy.weakness },
          // 起点面板必须与伤害管线同口径（2026-10-18 百暴溢出修复）：calcPanel 不跑角色模块 applyPanel，
          // 不传 panelHooks ⇒「百暴」缺口按没跑核心被动的暴击率算（希格莉德 19.4% vs 真实 85.4%）。
          panelHooks: {
            slot,
            settings,
            additionalAbilityActive,
            team,
            // 源面板槽位视图：与 `computePanelPhases` 同一份表（`setInfo.sourcePanelsByOwner`）折成 slot 键，
            // 供 `teamPanelEffects` 里「读队友面板做转模」的模块（知更鸟离场守护读自身生命等）复刻伤害管线。
            sourcePanels,
            enemyStunVuln: configStore.enemy.stunVuln,
            // 编排层优化器的起点必须复刻伤害管线面板 ⇒ 队友给本槽的面板加成也要算
            withTeamPanelEffects: true,
          },
        })
      } catch {
        return null
      }
    },
  }
}

/**
 * 副词条精修（**只动副词条**）。与 `computeLoadoutPlanForSlot` 的分工是**有意**的：
 * 词条收益曲线（`substatCurve`）与敏感度采样（`impactSampling`）拿本函数的输出当「现场」基线——
 * 它们采的是「某词条再堆 x 步」的边际，不进主词条 / 套装的选择空间（那会改变图的横轴含义：
 * 玩家的现场面板是 UI store 里那份，翻 4 号位 / 2 件套 属于「最优分配 / 配装最优」两个显式按钮）。
 * 要连 4 号位与 2 件套一起配平用 `computeLoadoutPlanForSlot`。
 */
export function computeSubstatAllocationForSlot(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
  refine: SubstatRefineOptions,
  /** 音擎覆盖率表：缺省 store 手调表；手里有 calc 的调用方传 `calc.effectiveWEngineCoverages`（与伤害同口径） */
  wEngineCoverages?: Record<string, number>,
): DriveDiscConfig['subStatAllocation'] | null {
  const ctx = resolveSlotOptimizerContext(slot, configStore, catalogStore, wEngineCoverages)
  if (!ctx) return null
  const seed = ctx.seed()
  if (!seed) return null
  const chosen = refineWithRealDamage(slot, configStore, seed, ctx.tmpl.stats, ctx.budget.statCap, ctx.critCap, refine)
  return normalizeSubstatAllocation(chosen)
}

/** 配平结果：4 号位主词条 / 2 件套 / 副词条 —— 三者必须**一起**写回（配平是联合的，只写副词条会退回溢出态） */
export interface SlotLoadoutPlan {
  /** 4 号位主词条（与进入时相同 = 未翻转） */
  mainStat4: string
  /** 2 件套 id（与进入时相同 = 未翻转） */
  twoPieceSetId: string
  subStatAllocation: Record<string, number>
  /** 4 号位 / 2 件套 相对进入时是否翻动（UI 文案与披露用） */
  flippedMainStat4: boolean
  flippedTwoPiece: boolean
  /** 枚举过的 (4 号位, 2 件套) 组合数（成本披露用；不含精修内部求值） */
  combos: number
}

/** 2 件套是否「双爆来源」——配平宽度的一半（啄木鸟 +8% 暴击 ≡ 3.33 词条 / 折枝剑歌 +16% 爆伤 ≡ 3.33 词条） */
function isCritTwoPiece(set: DriveDiscSet): boolean {
  return (set.twoPiece?.effects ?? []).some(e => e.stat === 'critRate' || e.stat === 'critDmg')
}

/** 4 号位候选：当前值 + 双爆两项（按 mainStatPools 过滤：没有 4 号位池的角色不翻） */
function mainStat4Candidates(current: string, pool: readonly string[]): string[] {
  const out: string[] = []
  for (const s of [current, 'critRate', 'critDmg']) {
    if (!s || !pool.includes(s) || out.includes(s)) continue
    out.push(s)
  }
  return out
}

/** 2 件套候选：当前值 + 全部双爆 2 件套（排除与 4 件套 / 第三套同 id，避免同一套装重复计数） */
function twoPieceCandidates(sets: readonly DriveDiscSet[], current: string, four: string, third?: string): string[] {
  const out: string[] = []
  for (const id of [current, ...sets.filter(s => isCritTwoPiece(s)).map(s => s.id)]) {
    if (!id || id === four || id === third || out.includes(id)) continue
    out.push(id)
  }
  return out
}

// @fact optimizer:双爆配平 口径: 暴击溢出的「整条换爆伤」折算必须由翻动 4 号位主词条（24% 暴击 / 48% 爆伤 ≡ 10 条词条）与 2 件套（8% / 16% ≡ 3.33 条）给付；配平器候选有效性 = 面板暴击 ≤ 封顶 + 1 条（越线不采纳，微溢出合法）；配平结果 = 4 号位 / 2 件套 / 副词条 三者一起写回 | 据 用户@2026-10-29（「暴击率120%的时候把暴击变成爆伤，这一定赚」+「考虑4号位主词条的等效10个副词条，和2件套等效3.33词条」） | 验 src/composables/__tests__/substatCritOverflow.test.ts | 锚 src/composables/substatOptimizer.ts#computeLoadoutPlanForSlot | 信 确认
// ⟳复核: 若词条步长（2.4/4.8）、暴击封顶口径、1/2/3 号位主词条池或 2 件套双爆集合变化，重核配平宽度算式与候选空间 | 到期 2027-04-30
/**
 * 「配平」：联合求 (4 号位主词条, 2 件套, 副词条) 的近似最优（文件头「双爆配平」段的实现）。
 *
 * 算法（求值成本 = 组合数 + 一次精修，般岳 4 组合 ≈ 8 + 30~44 次，与只精修副词条同量级）：
 * 1. 枚举 (4 号位 ∈ {当前, 暴击率, 爆伤}) × (2 件套 ∈ {当前, 双爆 2 件套})；
 * 2. 每个组合先算 core 默认分配（它自带「百暴缺口 + TOP2 ≤ 35」，**候选的有效性已经由它满足**）
 *    并求一次伤害 —— 组合阶段用起点伤害排序（起点即该组合的配平形态，实测与精修后同序）；
 * 3. 在最佳组合上跑真实伤害精修（候选有效性 = 不越暴击封顶）；
 * 4. 结束时恢复现场，返回三个字段由调用方**一起**写回。
 */
export function computeLoadoutPlanForSlot(
  slot: number,
  configStore: ConfigModel,
  catalogStore: ReturnType<typeof useCatalogStore>,
  refine: SubstatRefineOptions,
  wEngineCoverages?: Record<string, number>,
): SlotLoadoutPlan | null {
  const ctx = resolveSlotOptimizerContext(slot, configStore, catalogStore, wEngineCoverages)
  if (!ctx) return null
  const disc = configStore.team[slot].driveDisc
  const originalMain4 = disc.mainStats[4] ?? ''
  const originalTwo = disc.twoPieceSetId
  const originalAlloc = disc.subStatAllocation
  const mainPool = catalogStore.statRules?.driveDisc.mainStatPools['4'] ?? []
  // 池缺（statRules 未加载）时退化成「只有当前值」= 不翻 4 号位，而不是整条路径失效
  const mainCands = mainStat4Candidates(originalMain4, mainPool).length
    ? mainStat4Candidates(originalMain4, mainPool)
    : [originalMain4].filter(s => s !== '')
  const twoCands = twoPieceCandidates([...catalogStore.driveDiscSetsMap.values()], originalTwo, disc.fourPieceSetId, disc.thirdTwoPieceSetId)
  /** 写 4 号位：空 = 未选 ⇒ 删键（不让空串进 mainStats） */
  const setMain4 = (v: string) => {
    if (v) disc.mainStats[4] = v
    else delete disc.mainStats[4]
  }
  const restore = () => {
    setMain4(originalMain4)
    disc.twoPieceSetId = originalTwo
    disc.subStatAllocation = originalAlloc
  }
  let combos = 0
  try {
    let bestMain = originalMain4
    let bestTwo = originalTwo
    let bestSeed: Record<string, number> | null = null
    let bestDmg = Number.NEGATIVE_INFINITY
    for (const main4 of mainCands) {
      for (const two of twoCands) {
        setMain4(main4)
        disc.twoPieceSetId = two
        const seed = ctx.seed()
        if (!seed) continue
        disc.subStatAllocation = normalizeSubstatAllocation(seed)
        combos++
        const damage = refine.readDamage()
        if (damage > bestDmg) {
          bestDmg = damage
          bestMain = main4
          bestTwo = two
          bestSeed = { ...disc.subStatAllocation }
        }
      }
    }
    if (!bestSeed) return null
    setMain4(bestMain)
    disc.twoPieceSetId = bestTwo
    const refined = refineWithRealDamage(slot, configStore, bestSeed, ctx.tmpl.stats, ctx.budget.statCap, ctx.critCap, refine)
    return {
      mainStat4: bestMain,
      twoPieceSetId: bestTwo,
      subStatAllocation: normalizeSubstatAllocation(refined),
      flippedMainStat4: bestMain !== originalMain4,
      flippedTwoPiece: bestTwo !== originalTwo,
      combos,
    }
  } finally {
    restore()
  }
}
