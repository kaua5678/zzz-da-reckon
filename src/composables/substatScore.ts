/**
 * 副词条评分 + 驱动盘 A/B 对比（2026-10-23）。
 *
 * ## 两种用法（用户口径 2026-10-23）
 * > 「副词条评分该算单人的，因为有人要算他对一个角色的词条养成进度。
 * >   也有人要比较两套盘子谁的伤害高」
 *
 * ① **单人评分**（`scoreSubstats(s, { slot })`）：基线 = **只把该槽位**的副词条清零
 *    （其余槽位保持原样），目标 = 当前。回答「这个角色这套词条一共值多少」。
 *    同时给两个分母：**该角色自身伤害**（养成进度看这个）与**全队伤害**（这个角色值不值看这个）。
 * ② **两套盘子对比**（`compareDiscPlans(s, { slot, a, b })`）：分别装上 A / B 两份
 *    完整驱动盘配置（套装 + 主词条 + 副词条），读两次伤害。回答「哪套更疼、差多少」。
 *
 * ## 为什么单人评分是主用法（而不只是"选项"）
 * - **成本差一个数量级**：一个槽位的词条数实测 2`4（`{精通20, 大攻击12}` 这类），
 *   2^n−1 = 3`15 次求值 ≈ 0.1`0.4s ⇒ 可以进页面就算；全队 3 槽 6`9 个词条要 63`511 次（1`10s）。
 * - **口径更诚实**：全队口径下辅助的词条几乎不显影（他的词条本来就不为伤害服务），
 *   而「该角色自身伤害」才能反映词条养成进度。两个数一起给，读者自己选口径。
 *
 * ## 拆解（仍是精确 Shapley）
 * 玩家 = 该槽位的一个词条。Shapley 满足**有效性**：Σ 各词条贡献 ≡ 总增益（判据逐位断言），
 * 所以「每条词条值多少」相加正好等于评分。
 * 为什么不用单项边际（只删这一条 / 顺序边际）：词条之间会互相放大（攻击×暴击×暴伤、
 * 穿透的非线性防御区）⇒ 单项边际不可加。实测 3 异常队：leave-one-out 和 87.82% vs 真值 77.81%。
 *
 * ## 轴态
 * 词条可能改变失衡次数（实测琉音 critRate 抬冲击力 ⇒ 失衡 6→7）。跨轴态那部分不是"词条收益"，
 * 而是「多了这一次失衡」的整窗易伤差。照实计入（评分 = 当前配装值多少），但把两侧轴态一并返回，
 * 供展示层提示。
 *
 * ## 运行位置
 * 必须跑在**独立场景**上（`withAnalysisScenario`）：只读 `AnalysisContext`，结束时恢复全部槽位原值。
 * 判据 `composables/__tests__/substatScore.test.ts` + `analysisScenario.test.ts` 的 `MIGRATED_ANALYZERS`。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { SubstatAxisSignature } from '@/composables/substatCurve'
import { useCatalogStore } from '@/stores/catalog'
import { localized } from '@/utils/format'
import type { DriveDiscConfig } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'
import { specConversionAmount } from '@/specs/runtime'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import type { AttributeConversionSpec } from '@/specs/types'

/** 精确 Shapley 的玩家数上限（2^n 次求值）；超过则退化为按槽位分组 */
export const MAX_EXACT_PLAYERS = 12

/** 一个「玩家」= 某槽位的某个副词条（整条词条一起投/不投，不拆步数） */
export interface SubstatPlayer {
  slot: number
  stat: string
  steps: number
}

/**
 * **转模放大的痕迹**：该词条的收益里有多少来自「它顺带触发了角色自己的属性转化」。
 *
 * 用户 2026-10-23：「副词条还会影响某些转模记得考虑」。
 *
 * 例：诺姆（1571）的 spec 声明 critRate→critDmg（每 1% 超出 50% 的部分 → 1.7% 暴伤，cap 85）
 * 与 critRate→定向失衡（0.8，cap 40）⇒ 1 步「暴击率」的实际收益是 1 步「爆伤」的 **2.36 倍**
 * （实测 2026-10-23，本机）。评分读的是引擎总伤，转模已在面板层生效、**已经算进去了**；
 * 本字段只是把「这不是普通词条」显式标出来，免得用户以为暴击率词条突然变强了。
 */
export interface SubstatConversionTrace {
  /** 转模的 spec id（如 `norma_crit_to_critdmg`） */
  id: string
  /** 来源属性 = 该词条的属性 */
  sourceStat: string
  /** 落点属性 */
  targetStat: string
  /** 该词条为这条转模贡献了多少步（受阈值/上限裁剪后的**实际**步数） */
  steps: number
  /** 该转模给落点属性加了多少点（= steps × valuePerStep，已封顶） */
  amount: number
}

export interface SubstatScoreContribution {
  slot: number
  /** 词条键；`*` = 该槽位整组（`coarse` 模式下合并） */
  stat: string
  steps: number
  /** 该词条触发的转模（空 = 这条词条不带转模） */
  conversions: SubstatConversionTrace[]
  /** 对**全队**伤害的贡献，百分点 */
  pct: number
  /** 对**当前配置下个人伤害**的贡献，百分点（参考口径；队友会改变出招次数，故不作主口径） */
  ownPct: number
  /** 占全队口径合计的份额（%）；合计为 0 时为 0 */
  sharePct: number
}

/**
 * 轴态签名（失衡次数 + 易伤覆盖率）：跨轴态的评价要在展示层提示。
 * 类型与「副词条收益曲线」共用同一份定义（规则 11：跨文件类型只从单一来源引用；
 * 同名两份定义会被 `banyueRageCycleSingleSourceCc460` 的防复发判据抓红）。
 */

/**
 * 击破侧收益（**单独报，不进主评分**）。
 *
 * 主评分锁失衡次数 ⇒ 词条本身的价值；本结构报「这套词条顺带把轴态改了多少」，
 * 让用户看到「击破的额外增幅」，而不是把它混进「平时增幅」。
 */
export interface SubstatStunOutput {
  /** 词条把失衡次数抬高了几次（0 = 没跨阈值；负值 = 反而少了，理论上不该出现但如实报） */
  stunCountDelta: number
  /** 失衡总量（有效总失衡值）增量 */
  totalStunBuildUpDelta: number
  /** 失衡总量提升率（%）；0 词条基线为 0 时为 0 */
  totalStunBuildUpPct: number
  /** 易伤覆盖率增量（百分点） */
  coverageDeltaPct: number
  /** 解锁失衡次数后（自由收敛）的全队伤害增益，%；等于 `gainPct` 时说明本队没跨阈值 */
  freeformGainPct: number
  /** 解锁失衡次数后的该角色自身增益，% */
  freeformOwnGainPct: number
  /** 相对锁定口径多出来的那部分（= freeform − 主评分），即「失衡跳变贡献」，百分点 */
  jumpGainPct: number
  jumpOwnGainPct: number
  /** 0 词条基线的失衡总量（展示「旧 → 新」用；不是增量） */
  zeroTotalStunBuildUp: number
  /** 当前配装的失衡总量 */
  currentTotalStunBuildUp: number
}

export interface SubstatScoreResult {
  /** 本次评分的槽位；`null` = 全队模式（所有槽位的词条一起算） */
  slot: number | null
  /** 该角色命中了哪些转模（spec 声明的原样；展示层据此解释"为什么这条词条更值钱"） */
  conversions: AttributeConversionSpec[]
  /** 分母：0 词条时的全队总伤 */
  zeroTeam: number
  /** 当前配装的全队总伤 */
  currentTeam: number
  /** 分母：0 词条时该槽位自身的伤害（`slot = null` 时 = 全队） */
  zeroOwn: number
  /** 当前配装下该槽位自身的伤害 */
  currentOwn: number
  /** 评分（全队口径）：当前 / 0 词条 − 1（%） */
  gainPct: number
  /**
   * **当前配置下的个人伤害**增益（当前 / 0 词条 − 1，%）。
   *
   * ⚠ 措辞有意避开「该角色自身伤害」（用户口径 2026-10-23）：这个数是「在这支队里、按这套配装的
   * 出招次数」算出来的，**换队友会变**（队友决定招式次数），所以它不是「这个角色自己变强了多少」。
   * ⇒ 展示层一律写「当前配置下的个人伤害」，主口径用 `gainPct`（全队）。
   */
  ownGainPct: number
  /** 逐词条贡献（Shapley），Σ pct ≡ gainPct、Σ ownPct ≡ ownGainPct */
  contributions: SubstatScoreContribution[]
  /** true = 退化拆解（玩家 = 槽位而非单个词条） */
  coarse: boolean
  /** 实际求值次数（成本可核对：`2^n − 1`） */
  evals: number
  zeroAxis: SubstatAxisSignature
  currentAxis: SubstatAxisSignature
  /** true = 两个基线之间轴态变了（失衡次数不同 / 覆盖率差 > 1 个百分点） */
  axisChanged: boolean
  /**
   * **击破侧的收益**（用户口径 2026-10-23：「除了说总伤提升外，还可以说失衡总量增加了多少」）。
   *
   * 旧口径的陷阱：`critRate` 越过阈值会让失衡次数 3→4，那一步伤害跳 **5.39M（73 倍）**，
   * 而那 5.39M 里词条本身只有 ~0.074M、其余全是「多了一次失衡」的整窗易伤——
   * 这是**离散产物**，不是词条属性，混进评分会把 89% 的分数记给一个偶然跳变
   * （实测同配装：自由收敛全队 +18.37%，锁失衡 +2.04%）。
   *
   * ⇒ 本结果把两件事分开：
   * - `gainPct` / `ownGainPct` = **锁失衡次数**的版本（`stunCountLock` = 0 词条时的收敛值）⇒ 客观、可加；
   * - `stunOutput` = 失衡侧的**额外**收益（总伤差 + 失衡总量增量），单独报、不进主分数。
   */
  stunOutput: SubstatStunOutput
  /** 被取消 ⇒ false */
  complete: boolean
  reason: string
}

export interface SubstatScoreOptions {
  control?: BatchControl
  /** 评分哪个槽位（单人模式 = 主用法）；缺省 = 全队模式（所有槽位的词条一起算） */
  slot?: number
  /** 每多少次求值让出一次主线程（缺省 16） */
  yieldEvery?: number
}

/**
 * 副词条单步的原始值（百分点 / 点）——**读 catalog 的步长表**，不手抄（规则 2 / 规则 11）。
 * 只用于把「转模贡献了几步」摊给某条词条；实际数值结算仍由 `core/panel.ts#applyDriveDiscConfig` 负责。
 */
function discStepOf(stat: string): number {
  const rules = useCatalogStore().statRules
  return rules?.driveDisc.sRankSubStatBaseStep[stat] ?? 0
}

const ZERO_STUN_OUTPUT: SubstatStunOutput = {
  stunCountDelta: 0, totalStunBuildUpDelta: 0, totalStunBuildUpPct: 0, coverageDeltaPct: 0,
  freeformGainPct: 0, freeformOwnGainPct: 0, jumpGainPct: 0, jumpOwnGainPct: 0,
  zeroTotalStunBuildUp: 0, currentTotalStunBuildUp: 0,
}

const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** 队伍里所有「非空槽位 × 非零词条」——拆解的玩家集合（顺序稳定：槽位 → 词条名字典序） */
export function collectSubstatPlayers(
  team: ReadonlyArray<{ driveDisc: { subStatAllocation: Record<string, number> } }>,
  slots?: readonly number[],
): SubstatPlayer[] {
  const out: SubstatPlayer[] = []
  for (let slot = 0; slot < team.length; slot++) {
    if (slots && !slots.includes(slot)) continue
    const alloc = team[slot].driveDisc.subStatAllocation
    for (const stat of Object.keys(alloc).sort()) {
      const steps = alloc[stat] ?? 0
      if (steps > 0) out.push({ slot, stat, steps })
    }
  }
  return out
}

function popcount(x: number): number {
  let c = 0
  while (x) { c += x & 1; x >>= 1 }
  return c
}

/** 二项式系数（只用于 Shapley 权重，n ≤ 12 时整数精确） */
export function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
/**
 * 精确 Shapley：2^n 子集全枚举、每个子集只求值一次（空集与全集复用已算好的基线）。
 *
 * 有效性：Σ φ_i = v(全集) − v(∅)（Shapley 公理之一）——判据里断言，防"拆解和 ≠ 总分"。
 * 权重 w(k) = 1 / (n · C(n−1, k))，与 k!(n−k−1)!/n! 等价但没有大数阶乘。
 * `value` 返回 `number[]` ⇒ **一次求值同时算多个指标**（全队伤害 + 该角色伤害），
 * 不让「多给一个口径」变成多跑一遍子集。
 */
export async function shapleyValues(
  n: number,
  v0: number[],
  vAll: number[],
  value: (mask: number) => number[],
  opts: { control?: BatchControl; yieldEvery?: number } = {},
): Promise<{ shap: number[][]; complete: boolean; evals: number }> {
  const dims = v0.length
  const total = 1 << n
  const memo: number[][] = new Array(total)
  memo[0] = v0
  memo[total - 1] = vAll
  let complete = true
  const yieldEvery = Math.max(1, opts.yieldEvery ?? 16)
  for (let m = 1; m < total - 1; m++) {
    if (isBatchAborted(opts.control)) { complete = false; break }
    memo[m] = value(m)
    if (m % yieldEvery === 0) await yieldToMacrotask()
  }
  const shap: number[][] = Array.from({ length: dims }, () => new Array<number>(n).fill(0))
  if (!complete) return { shap, complete, evals: total - 1 }
  for (let j = 0; j < n; j++) {
    for (let m = 0; m < total; m++) {
      if (m & (1 << j)) continue
      const w = 1 / (n * binom(n - 1, popcount(m)))
      const hi = memo[m | (1 << j)]!
      const lo = memo[m]!
      for (let d = 0; d < dims; d++) shap[d]![j]! += w * (hi[d]! - lo[d]!)
    }
  }
  return { shap, complete, evals: total - 1 }
}

/** 一次求值读出的两个指标（同一份管线结果，不是两次求值） */
export interface DamageReading {
  /** 全队总伤 */
  team: number
  /** 该槽位自身伤害（`slot = null` 时 = 全队） */
  own: number
}

/**
 * 计算「当前副词条 vs 0 副词条」的评分与逐词条贡献。
 *
 * `opts.slot` 给了 ⇒ **只动该槽位**的词条（其余槽位保持原值）——单人评分、养成进度用这个。
 * 缺省 ⇒ 全队模式（所有槽位一起清零/恢复）。
 * 场景内会临时改写 `subStatAllocation`，`finally` 恢复全部槽位原值（不留现场）。
 */
export async function scoreSubstats(
  scenario: AnalysisContext,
  opts: SubstatScoreOptions = {},
): Promise<SubstatScoreResult> {
  const { config, calc } = scenario
  const original = config.team.map(c => ({ ...c.driveDisc.subStatAllocation }))
  const originalLock = config.enemy.stunCountLock
  const slot = typeof opts.slot === 'number' ? opts.slot : null
  const slots = slot === null ? config.team.map((_, i) => i) : [slot]
  /** 一次求值同时读「全队」与「该槽自身」（同一份 `damagePoolRows`，零额外成本） */
  const read = (): DamageReading => {
    const team = calc.teamTotalDamage.value
    if (slot === null) return { team, own: team }
    let own = 0
    for (const row of calc.damagePoolRows.value) if (row.slot === slot) own += row.totalDamage
    return { team, own }
  }
  const readAxis = (): SubstatAxisSignature => ({
    stunCount: calc.stunPoolResult.value?.stunCount ?? -1,
    coverage: calc.stunCoverage.value,
  })
  const fail = (reason: string, zeroAxis?: SubstatAxisSignature, currentAxis?: SubstatAxisSignature): SubstatScoreResult => ({
    slot, conversions: [], zeroTeam: 0, currentTeam: 0, zeroOwn: 0, currentOwn: 0, ownGainPct: 0, gainPct: 0,
    stunOutput: ZERO_STUN_OUTPUT,
    contributions: [], coarse: false, evals: 0,
    zeroAxis: zeroAxis ?? { stunCount: -1, coverage: 0 },
    currentAxis: currentAxis ?? { stunCount: -1, coverage: 0 },
    axisChanged: false, complete: false, reason,
  })
  try {
    const players = collectSubstatPlayers(config.team, slots)
    if (players.length === 0) return fail(slot === null ? '当前队伍没有任何副词条' : '该角色没有副词条')
    const exact = players.length <= MAX_EXACT_PLAYERS
    // 退化拆解的玩家 = 槽位整组（单人模式只有 1 个玩家 ⇒ 贡献 = 整槽，等价于「不拆」）
    const list: SubstatPlayer[] = exact
      ? players
      : slots.filter(s => players.some(p => p.slot === s))
        .map(s => ({
          slot: s,
          stat: '*',
          steps: players.filter(p => p.slot === s).reduce((a, p) => a + p.steps, 0),
        }))
    /**
     * 把 `mask` 落在**逐词条**粒度上（不是「整槽」）。
     *
     * ⚠ 2026-10-23 实机抓到：首版按「槽位整组」写回 `original[i]` ⇒ 任意一条词条的位被打开时，
     * 该槽**全部**词条一起生效 ⇒ 同槽第二条词条在所有子集里都拿不到独立边际，Shapley 恒 0
     * （实机表现：三条「大攻击」全显示 +0%）。而 Σ ≡ 评分的判据仍然绿（第一条独吞整槽收益）
     * ——**"拆解看着自洽但其实是错的"**，只能靠「同槽每条词条都必须非零」这类判据抓。
     *
     * 范围外的槽位保持原值（单人模式下 = 队友的词条完全不动，这是「只评这个角色」的定义）。
     */
    const setMask = (mask: number) => {
      for (let i = 0; i < config.team.length; i++) {
        const c = config.team[i]
        if (!c) continue
        if (!slots.includes(i)) { c.driveDisc.subStatAllocation = { ...original[i] }; continue }
        const alloc: Record<string, number> = {}
        list.forEach((player, gi) => {
          if (player.slot !== i) return
          if ((mask & (1 << gi)) === 0) return
          if (player.stat === '*') Object.assign(alloc, original[i])
          else alloc[player.stat] = player.steps
        })
        c.driveDisc.subStatAllocation = alloc
      }
    }
    /**
     * ## 两遍求值：先自由、再锁失衡（用户口径 2026-10-23）
     *
     * 主评分必须**锁失衡次数**：词条越过击破阈值会让失衡次数 +1，那一步伤害跳 5.39M（73 倍），
     * 而词条本身只有 0.074M —— 那是**离散产物**，混进评分会把 89% 分数记给一个偶然跳变。
     * 与「命座提升率」的处置同源（`cinemaUplift.ts`：用 `stunCountLock` 钉住次数再逐级对比）。
     *
     * 锁定值 = **0 词条基线的收敛次数**（先自由跑一遍拿到它）⇒ 整张表衡量的都是
     * 「在同样的失衡次数下，这些词条值多少」。
     * 同时把自由收敛那一遍的数据留作 `stunOutput`（击破侧的额外增幅，单独报）。
     */
    setMask(0)
    const zeroFree = read()
    const zeroFreeAxis = readAxis()
    const zeroStunBuildUp = calc.stunPoolResult.value?.totalStunBuildUp ?? 0
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
    const currentFree = read()
    const currentFreeAxis = readAxis()
    const currentStunBuildUp = calc.stunPoolResult.value?.totalStunBuildUp ?? 0
    if (!(zeroFree.team > 0)) return fail('0 副词条时队伍总伤为 0：增益百分比没有分母', zeroFreeAxis, currentFreeAxis)
    // 锁定失衡次数 = 0 词条基线的收敛次数（≥0 才生效；-1 = 基线本身没算出次数，退回自由口径）
    const lockValue = zeroFreeAxis.stunCount
    const originalLock = config.enemy.stunCountLock
    const canLock = lockValue >= 0
    if (canLock) config.enemy.stunCountLock = lockValue
    setMask(0)
    const zero = read()
    const zeroAxis = readAxis()
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
    const current = read()
    const currentAxis = readAxis()
    if (!(zero.team > 0)) {
      config.enemy.stunCountLock = originalLock
      return fail('锁定失衡次数后队伍总伤为 0：增益百分比没有分母', zeroAxis, currentAxis)
    }
    const gainPct = (current.team / zero.team - 1) * 100
    const ownGainPct = zero.own > 0 ? (current.own / zero.own - 1) * 100 : 0
    const freeformGainPct = (currentFree.team / zeroFree.team - 1) * 100
    const freeformOwnGainPct = zeroFree.own > 0 ? (currentFree.own / zeroFree.own - 1) * 100 : 0
    const stunOutput: SubstatStunOutput = {
      stunCountDelta: currentFreeAxis.stunCount - zeroFreeAxis.stunCount,
      totalStunBuildUpDelta: currentStunBuildUp - zeroStunBuildUp,
      totalStunBuildUpPct: zeroStunBuildUp > 0 ? (currentStunBuildUp / zeroStunBuildUp - 1) * 100 : 0,
      coverageDeltaPct: (currentFreeAxis.coverage - zeroFreeAxis.coverage) * 100,
      freeformGainPct,
      freeformOwnGainPct,
      jumpGainPct: freeformGainPct - gainPct,
      jumpOwnGainPct: freeformOwnGainPct - ownGainPct,
      zeroTotalStunBuildUp: zeroStunBuildUp,
      currentTotalStunBuildUp: currentStunBuildUp,
    }
    const { shap, complete } = await shapleyValues(
      list.length,
      [zero.team, zero.own],
      [current.team, current.own],
      mask => {
        setMask(mask)
        const r = read()
        return [r.team, r.own]
      },
      { control: opts.control, yieldEvery: opts.yieldEvery },
    )
    /**
     * 该角色的转模（spec 声明）——**评分里已经算进去了**（转模在面板层施加，评分读引擎总伤）；
     * 这里额外标出「这条词条顺带触发了哪些转模、给了多少」，否则读者会奇怪
     * 「为什么暴击率词条比爆伤词条值钱 2.4 倍」（实测诺姆 1571）。
     *
     * ⚠ **算法 = 边际分摊，不是「词条自身原始值过阈值」**（2026-10-23 判据抓到的第一版缺陷）：
     * 诺姆的转模阈值是「暴击率 > 50%」，而一条词条只贡献 `24 个百分点 ⇒ 按自身原始值算
     * **永远够不到阈值**、痕迹恒空（实测：暴击率词条 conversions=[]）。
     * 正确语义 = 这条词条让转模**多了多少**：
     * `Δ = amount(面板总值) − amount(面板总值 − 该词条原始值)`。
     * 阈值以下那部分不归任何单条词条（那是角色基础/其他来源给的），正好符合直觉。
     */
    const specConversions = slot === null
      ? []
      : (getAgentSpec(config.team[slot].agentId)?.attributeConversions ?? [])
    /** 该槽位面板（按 spec 的 sourcePanelPhase 取局内/局外）——只读，用于算转模总量 */
    const panelForConversions = (): { inCombat: Record<string, number>; outOfCombat: Record<string, number> } => {
      if (slot === null) return { inCombat: {}, outOfCombat: {} }
      const phases = computePanelPhases(slot, config, useCatalogStore(), calc.effectiveWEngineCoverages.value, calc.effectiveDiscEffectCoverages.value)
      if (!phases) return { inCombat: {}, outOfCombat: {} }
      return {
        inCombat: phases.inCombat as unknown as Record<string, number>,
        outOfCombat: phases.outOfCombat as unknown as Record<string, number>,
      }
    }
    const conversionTracesFor = (player: SubstatPlayer, panels: { inCombat: Record<string, number>; outOfCombat: Record<string, number> }): SubstatConversionTrace[] => {
      const out: SubstatConversionTrace[] = []
      for (const conv of specConversions) {
        if (conv.sourceStat !== player.stat) continue
        const panel = conv.sourcePanelPhase === 'outOfCombat' ? panels.outOfCombat : panels.inCombat
        const total = panel[conv.sourceStat] ?? 0
        const raw = player.steps * discStepOf(player.stat)
        const withIt = specConversionAmount(conv, total)
        const without = specConversionAmount(conv, total - raw)
        const delta = withIt - without
        if (Math.abs(delta) <= 1e-9) continue
        // 折算成"贡献了几步"（供展示；已是边际量）
        const steps = conv.valuePerStep !== 0 ? delta / conv.valuePerStep : 0
        out.push({ id: conv.id, sourceStat: conv.sourceStat, targetStat: conv.targetStat, steps, amount: delta })
      }
      return out
    }
    const convPanels = specConversions.length > 0 ? panelForConversions() : { inCombat: {}, outOfCombat: {} }
    const contributions: SubstatScoreContribution[] = list.map((player, i) => ({
      slot: player.slot,
      stat: player.stat,
      steps: player.steps,
      conversions: conversionTracesFor(player, convPanels),
      pct: (shap[0]![i]! / zero.team) * 100,
      ownPct: zero.own > 0 ? (shap[1]![i]! / zero.own) * 100 : 0,
      sharePct: 0,
    }))
    const sumPct = contributions.reduce((a, c) => a + c.pct, 0)
    for (const c of contributions) c.sharePct = sumPct !== 0 ? (c.pct / sumPct) * 100 : 0
    return {
      slot,
      conversions: specConversions,
      stunOutput,
      zeroTeam: zero.team,
      currentTeam: current.team,
      zeroOwn: zero.own,
      currentOwn: current.own,
      gainPct,
      ownGainPct,
      contributions,
      coarse: !exact,
      evals: (1 << list.length) - 1,
      zeroAxis,
      currentAxis,
      axisChanged: zeroAxis.stunCount !== currentAxis.stunCount
        || Math.abs(zeroAxis.coverage - currentAxis.coverage) > 0.01,
      complete,
      reason: '',
    }
  } finally {
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
    // 锁定是本次求值的临时状态（与命座提升率同款：只在场景内改，跑完必须还原）
    config.enemy.stunCountLock = originalLock
  }
}

// ============================================================================
// 两套盘子 A/B 对比
// ============================================================================

/**
 * 一份完整**配装**快照 = 驱动盘（套装 + 主词条 + 副词条）+ 音擎（id + 精炼档）。
 *
 * 驱动盘部分直接复用引擎类型 `DriveDiscConfig`（规则 11：同形不改写；判据 29 也禁止结构副本）；
 * 音擎这两个字段与 `CharacterConfig` 同名同义（`wEngineId` / `wEngineModLevel`），
 * 故 A/B 既能比「换盘子」也能比「换武器 / 换精炼」（用户口径 2026-10-23：
 * 「比如我某个武器想换精炼数或者换其他武器」）。
 *
 * `wEngineId = ''` = 不戴音擎（与 `CharacterConfig` 同口径：空串就是没有）。
 */
export interface DiscPlan extends DriveDiscConfig {
  /** 音擎 id；`''` = 不戴 */
  wEngineId: string
  /** 精炼档（1–5） */
  wEngineModLevel: number
}

/** 一处差异：套装 / 主词条 / 副词条 */
export type DiscPlanDiffKind = '套装4' | '套装2' | '套装2b' | '主词条' | '副词条' | '音擎' | '精炼'

export interface DiscPlanDiff {
  kind: DiscPlanDiffKind
  /** 差异落在哪个字段（如「4 号位」「大攻击」） */
  label: string
  a: string
  b: string
}

export interface DiscCompareResult {
  slot: number
  aTeam: number
  bTeam: number
  aOwn: number
  bOwn: number
  /**
   * (B − A) / A × 100，全队口径 —— **锁失衡次数**的版本（主口径）。
   *
   * 与单人评分（`scoreSubstats`）同一把尺：A/B 两套配装装在**同一个失衡量**上比，
   * 差值才只反映配装本身。口径依据见下方 `freeformDeltaTeamPct`。
   */
  deltaTeamPct: number
  /** (B − A) / A × 100，该角色自身口径（同样锁失衡） */
  deltaOwnPct: number
  /**
   * **自由收敛**口径（不锁失衡）：B/A 各自跑到收敛。
   *
   * 为什么主口径不能是这个（用户 2026-10-26 报障「诺姆精5人为刀俎 → 精1专武 个人 +60%，
   * 12.5% 火抗和 25% 增伤怎么提升 60%」）：换音擎会改**冲击力 → 失衡次数**，
   * 多出来的那一次失衡是**离散跳变**，不是这把武器的属性。
   * 实测诺姆那组（本机，Boss 熔狱行赭）：自由口径 个人 +85.44%，锁 2 次失衡 +71.21%
   * ⇒ 「多打一次失衡」自己就占 +8.31 个人 / +9.61 全队，而且会把百分比推到看起来不可能的量级。
   * 与 `scoreSubstats`（`stunCountLock` = 0 词条基线的次数）和 `cinemaUplift.ts`（逐级锁次数）同源处置。
   */
  freeformDeltaTeamPct: number
  /** 自由收敛口径的个人差值 */
  freeformDeltaOwnPct: number
  /** A 的收敛失衡次数（= 锁定值；< 0 = 没算出次数，此时退回自由口径） */
  stunLock: number
  /** 锁口径下 A / B 各自的失衡次数（= stunLock；< 0 = 未锁） */
  aStunCount: number
  bStunCount: number
  /** B 比 A 多打的失衡次数（> 0 ⇒ 自由口径里含离散跳变） */
  stunCountDelta: number
  /** 逐项差异（套装 / 主词条 / 副词条；相等项不列） */
  diff: DiscPlanDiff[]
  /** 总副词条步数（A / B） */
  stepsA: number
  stepsB: number
  complete: boolean
  reason: string
}

export interface DiscCompareOptions {
  slot: number
  a: DiscPlan
  b: DiscPlan
  control?: BatchControl
}

/** 读当前槽位的完整驱动盘配置（"把当前这套存成 A" 的入口） */
export function readDiscPlan(
  slot: number,
  team: ReadonlyArray<{ driveDisc: DriveDiscConfig; wEngineId?: string; wEngineModLevel?: number }>,
): DiscPlan {
  const char = team[slot]
  const disc = char.driveDisc
  return {
    fourPieceSetId: disc.fourPieceSetId,
    twoPieceSetId: disc.twoPieceSetId,
    // 2+2+2 开关：A/B 对比必须一起带走，否则「存成 A」会静默丢掉第三套（形态在对比里漂移）
    ...(disc.thirdTwoPieceSetId ? { thirdTwoPieceSetId: disc.thirdTwoPieceSetId } : {}),
    mainStats: { ...disc.mainStats },
    subStatAllocation: { ...disc.subStatAllocation },
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
  }
}

/** 词条 / 主词条的中文简称（与 `data/substatLabels` 同口径；主词条池多几个键） */
const STAT_LABEL: Readonly<Record<string, string>> = {
  atkPct: '大攻击', atkFlat: '小攻击', hpPct: '大生命', hpFlat: '小生命',
  defPct: '大防御', defFlat: '小防御', critRate: '暴击率', critDmg: '爆伤',
  anomalyProficiency: '精通', penFlat: '小穿透',
  penRatio: '穿透率', physicalDmg: '物理增伤', fireDmg: '火增伤', iceDmg: '冰增伤',
  electricDmg: '电增伤', etherDmg: '以太增伤', windDmg: '风增伤', anomalyMastery: '异常掌控',
  energyRegen: '能量回复', impact: '冲击力',
  dmgBonus: '通用增伤', skillDmgBonus: '招式增伤', anomalyDmgBonus: '异常增伤',
  stunBuildUpBonus: '失衡值', critDmg__ultimate: '终结技爆伤',
}

/** 音擎名（catalog 查；空串 = 不戴；查不到回落 id） */
function engineName(id: string): string {
  if (!id) return '（不戴）'
  const w = useCatalogStore().getWEngine(id)
  return w ? localized(w.name) : id
}

export function discStatLabel(stat: string): string {
  return STAT_LABEL[stat] ?? stat
}

/** 两份配装的逐项差异（套装名从 catalog 查；查不到回落 id） */
export function diffDiscPlans(a: DiscPlan, b: DiscPlan): DiscPlanDiff[] {
  const catalog = useCatalogStore()
  const setName = (id: string): string => {
    if (!id) return '（无）'
    const set = catalog.driveDiscSetsMap.get(id)
    return set ? (set.name.zhCN || id) : id
  }
  const out: DiscPlanDiff[] = []
  if (a.fourPieceSetId !== b.fourPieceSetId) {
    out.push({ kind: '套装4', label: '四件套', a: setName(a.fourPieceSetId), b: setName(b.fourPieceSetId) })
  }
  if (a.twoPieceSetId !== b.twoPieceSetId) {
    out.push({ kind: '套装2', label: '二件套', a: setName(a.twoPieceSetId), b: setName(b.twoPieceSetId) })
  }
  if ((a.thirdTwoPieceSetId ?? '') !== (b.thirdTwoPieceSetId ?? '')) {
    out.push({ kind: '套装2b', label: '第三套（2 件套 = 2+2+2）', a: setName(a.thirdTwoPieceSetId ?? ''), b: setName(b.thirdTwoPieceSetId ?? '') })
  }
  for (const pos of [4, 5, 6] as const) {
    const av = a.mainStats[pos] ?? ''
    const bv = b.mainStats[pos] ?? ''
    if (av !== bv) {
      out.push({
        kind: '主词条',
        label: pos + ' 号位',
        a: av ? discStatLabel(av) : '（空）',
        b: bv ? discStatLabel(bv) : '（空）',
      })
    }
  }
  const stats = new Set([...Object.keys(a.subStatAllocation), ...Object.keys(b.subStatAllocation)])
  for (const stat of [...stats].sort()) {
    const av = a.subStatAllocation[stat] ?? 0
    const bv = b.subStatAllocation[stat] ?? 0
    if (av !== bv) out.push({ kind: '副词条', label: discStatLabel(stat), a: av + ' 步', b: bv + ' 步' })
  }
  // 音擎 / 精炼（用户口径 2026-10-23「某个武器想换精炼数或者换其他武器」）：
  // 分两栏报——换武器与换精炼是两件不同的事，合并成一栏看不出是"换了把"还是"同一把升了精炼"。
  if (a.wEngineId !== b.wEngineId) {
    out.push({ kind: '音擎', label: '音擎', a: engineName(a.wEngineId), b: engineName(b.wEngineId) })
  }
  if (a.wEngineModLevel !== b.wEngineModLevel) {
    out.push({ kind: '精炼', label: '精炼档', a: 'R' + a.wEngineModLevel, b: 'R' + b.wEngineModLevel })
  }
  return out
}

/**
 * 对比两套驱动盘配置：分别装到 `slot` 上求值，读「全队」与「该角色自身」两个伤害。
 *
 * 口径：A、B 各自**完整覆盖**该槽位的套装/主词条/副词条（不是"只换盘子"），
 * 其它槽位完全不动 ⇒ 差异只来自这一槽的配装。
 * `diff` / `stepsA|B` 都是同一次读取的派生量，不另存第二份。
 */
export async function compareDiscPlans(
  scenario: AnalysisContext,
  opts: DiscCompareOptions,
): Promise<DiscCompareResult> {
  const { config, calc } = scenario
  const { slot, a, b } = opts
  const original = config.team.map(c => ({ ...c.driveDisc.subStatAllocation }))
  const originalDisc = {
    fourPieceSetId: config.team[slot].driveDisc.fourPieceSetId,
    twoPieceSetId: config.team[slot].driveDisc.twoPieceSetId,
    thirdTwoPieceSetId: config.team[slot].driveDisc.thirdTwoPieceSetId,
    mainStats: { ...config.team[slot].driveDisc.mainStats },
    // 音擎也是「配装」的一部分：A/B 可以换武器 / 换精炼（用户口径 2026-10-23），必须一起还原
    wEngineId: config.team[slot].wEngineId,
    wEngineModLevel: config.team[slot].wEngineModLevel,
  }
  const read = (): DamageReading => {
    const team = calc.teamTotalDamage.value
    let own = 0
    for (const row of calc.damagePoolRows.value) if (row.slot === slot) own += row.totalDamage
    return { team, own }
  }
  const apply = (plan: DiscPlan) => {
    const char = config.team[slot]
    const disc = char.driveDisc
    disc.fourPieceSetId = plan.fourPieceSetId
    disc.twoPieceSetId = plan.twoPieceSetId
    disc.thirdTwoPieceSetId = plan.thirdTwoPieceSetId
    disc.mainStats = { ...plan.mainStats };
    disc.subStatAllocation = { ...plan.subStatAllocation }
    char.wEngineId = plan.wEngineId
    char.wEngineModLevel = plan.wEngineModLevel
  }
  const fail = (reason: string): DiscCompareResult => ({
    slot, aTeam: 0, bTeam: 0, aOwn: 0, bOwn: 0, deltaTeamPct: 0, deltaOwnPct: 0,
    freeformDeltaTeamPct: 0, freeformDeltaOwnPct: 0, stunLock: -1, aStunCount: -1, bStunCount: -1, stunCountDelta: 0,
    diff: [], stepsA: 0, stepsB: 0, complete: false, reason,
  })
  const originalLock = config.enemy.stunCountLock
  const readAxis = (): { stunCount: number } => ({ stunCount: calc.stunPoolResult.value?.stunCount ?? -1 })
  try {
    // ① 自由收敛：两套配装各跑各的次数（这是"换上去实际会打多少"，保留为对照）
    config.enemy.stunCountLock = -1
    apply(a)
    const raFree = read()
    const aAxis = readAxis()
    apply(b)
    const rbFree = read()
    const bAxis = readAxis()
    if (!(raFree.team > 0) || !(rbFree.team > 0)) return fail('至少一套配装的全队总伤为 0：百分比没有分母')
    // ② 锁失衡次数：以 A 的收敛次数为锚，两套配装在同一失衡量上比（与 scoreSubstats 同一把尺）
    const stunLock = aAxis.stunCount
    const canLock = stunLock >= 0
    if (canLock) config.enemy.stunCountLock = stunLock
    apply(a)
    const ra = canLock ? read() : raFree
    const aAxisLocked = canLock ? readAxis() : aAxis
    apply(b)
    const rb = canLock ? read() : rbFree
    const bAxisLocked = canLock ? readAxis() : bAxis
    if (!(ra.team > 0) || !(rb.team > 0)) return fail('锁定失衡次数后至少一套配装的全队总伤为 0：百分比没有分母')
    const sum = (m: Record<string, number>) => Object.values(m).reduce((x, y) => x + y, 0)
    return {
      slot,
      aTeam: ra.team,
      bTeam: rb.team,
      aOwn: ra.own,
      bOwn: rb.own,
      deltaTeamPct: (rb.team / ra.team - 1) * 100,
      deltaOwnPct: ra.own > 0 ? (rb.own / ra.own - 1) * 100 : 0,
      freeformDeltaTeamPct: (rbFree.team / raFree.team - 1) * 100,
      freeformDeltaOwnPct: raFree.own > 0 ? (rbFree.own / raFree.own - 1) * 100 : 0,
      stunLock: canLock ? stunLock : -1,
      aStunCount: aAxisLocked.stunCount,
      bStunCount: bAxisLocked.stunCount,
      stunCountDelta: aAxis.stunCount >= 0 && bAxis.stunCount >= 0 ? bAxis.stunCount - aAxis.stunCount : 0,
      diff: diffDiscPlans(a, b),
      stepsA: sum(a.subStatAllocation),
      stepsB: sum(b.subStatAllocation),
      complete: true,
      reason: '',
    }
  } finally {
    // 锁定是本次求值的临时状态（与 scoreSubstats 同款：只在场景内改，跑完必须还原）
    config.enemy.stunCountLock = originalLock
    const char = config.team[slot]
    const disc = char.driveDisc
    disc.fourPieceSetId = originalDisc.fourPieceSetId
    disc.twoPieceSetId = originalDisc.twoPieceSetId
    disc.thirdTwoPieceSetId = originalDisc.thirdTwoPieceSetId
    disc.mainStats = { ...originalDisc.mainStats };
    char.wEngineId = originalDisc.wEngineId
    char.wEngineModLevel = originalDisc.wEngineModLevel;
    for (let i = 0; i < config.team.length; i++) {
      const c = config.team[i]
      if (c) c.driveDisc.subStatAllocation = { ...original[i] }
    }
  }
}
