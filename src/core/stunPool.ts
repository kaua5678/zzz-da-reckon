/**
 * 失衡池计算引擎
 *
 * 逻辑：
 * 1. 从招式执行计划提取每个招式的 daze（失衡倍率）
 * 2. 用 calcStunBuildUp 计算每招的实际失衡值（经过冲击力/失衡提升/抗性等乘区）
 * 3. 汇总全队总失衡值
 * 4. 失衡次数 = floor(总失衡值 / bossStunValue)
 * 5. 连携次数 = 失衡次数 × 每次连携数（首领默认3）
 *    （CC-231 删除了原第 6 步「失衡相关喧响奖励 = 失衡次数 × 20 + 总连携次数 × 10」：该字段自初始提交起无引擎消费者，
 *     连携 ×10 实际由 core/anomalyPool#calcSpecialActionBonus 计入个人喧响，「进入失衡 ×20」从未计给任何人，只在失衡池卡片上显示 ⇒ 误导）
 *
 * 数据来源：
 * - 招式执行计划：从 resource.ts 的 SkillExecution 扩展，需要 daze 和 element
 * - 面板属性：impact, stunBuildUpBonus, enemyStunTakenBonus 等
 * - Boss 配置：stunValue（失衡值上限）、stunVuln（失衡易伤）
 */
import type { PanelValues } from '@/types/catalog'
import { getStunBuildUpBonus, getTargetedElementStat, getTargetedStat } from './buff'
import { panelAt, emptyPanel } from './panel'
import { enemyResistanceOf } from '@/utils/elementStatKeys'
import type {
  StunPoolResult, StunContribution,
} from '@/types/resource'

/** 招式执行记录（扩展，含 daze 和 element 信息） */
export interface StunSkillExecution {
  moveId: string
  moveName: string
  slot: number
  count: number
  /** 基础失衡倍率（百分比，如 120 表示 120%） */
  baseDaze: number
  /** 招式元素（用于查找抗性） */
  element?: string
  /** 招式类型（用于读取定向失衡加成） */
  skillType?: string
  /** 行级失衡值提升（%，与面板 stunBuildUpBonus 同乘区加算；如莱卡恩 C1 有限次强特强化） */
  stunBuildUpBonus?: number
}

/** 失衡池计算输入 */
export interface StunPoolInput {
  /** 全队招式执行计划 */
  executions: StunSkillExecution[]
  /** 各角色的面板 */
  panels: PanelValues[]
  /** Boss 失衡值上限 */
  bossStunValue: number
  /** 每次失衡的连携次数（首领默认3） */
  chainCountPerStun: number
  /** 各元素失衡抗性（百分比，如20表示20%） */
  enemyStunResistances?: Record<string, number>
  /** 物理异常（畏缩）覆盖率，0-1之间
   *  畏缩使敌人受到的失衡值 +7.5%，持续10秒
   *  实际增幅 = 7.5% × 覆盖率
   *  来自 anomalyPool 的 coverage.physicalCoverageRate
   */
  physicalFlinchCoverageRate?: number
  /**
   * 轴内失衡值失效比例：key = `${slot}:${moveId}`（moveId 与 executions 中一致，
   * 平A为 'basic_attack'），value = 该招式落在失衡窗口内的单位占比 0-1。
   * 失衡窗口内打出的失衡值不累积下一次失衡条，因此从有效失衡值中扣除。
   */
  inAxisStunFractionByKey?: Record<string, number>
  /**
   * 失衡值返还比例（0~0.25，如雨果决算按剩余失衡时间每 1s 返 5%、上限 25%）。
   * 每次失衡结束时返还 `返还比例 × bossStunValue` 的失衡值进入下一次失衡条——
   * 等效于第 1 次失衡仍满额、之后每次失衡所需外部失衡值降为 `bossStunValue × (1 - 返还比例)`。
   */
  refundStunRatio?: number
  /** Boss 白送的失衡值（如 亵渎者 30% 失衡上限，直接计入总失衡值、不做抗性/返还折算） */
  stunGift?: number
  /**
   * 非轴模式的窗口时间占比（0-1）＝ 失衡窗口总时长 / 有效战斗时间（即 stunCoverage）。
   *
   * 时间守恒（用户口径 2026-09-01）：**失衡窗口里的招式享受易伤，但不累计失衡值**。
   * 轴模式靠逐招 inAxisStunFractionByKey 精确扣除；非轴模式此前**没有任何扣除**，
   * 于是整段有效时间的动作全额攒条，算出的次数又把 N×窗口时长 加回时间轴却不倒扣——
   * 实测般琉卢/星徽队因此得到 6 次失衡（窗口 108s，非失衡只剩 72s，却按 180s 攒条）。
   *
   * 折算后形成负反馈：次数↑ → 覆盖率↑ → 有效攒条量↓ → 次数↓，外层不动点自己收敛到
   * 实战档位（带 01 击破的队伍 4-5 次），**不需要硬钳上限**。
   * 与逐招 fraction 取较大者，避免轴模式双重折算。
   */
  windowTimeFraction?: number
}

/** 计算单次招式的实际失衡值
 *  本函数是失衡积蓄的**唯一活实现**（简化内联计算）。`damage.ts` 曾有一个更完整的
 *  `calcStunBuildUp`（带 breakdown 逐区），于 R33（2026-09-18）删除——它全仓零引用，
 *  且口径已与本函数**分叉**（本函数多出 `physicalFlinchCoverageRate` 畏缩项与行级
 *  `execStunBonus`），留着会让人以为改的是那一份。
 *
 *  受到失衡值提升区说明：
 *  - panel.enemyStunTakenBonus：来自其他buff的受到失衡提升
 *  - 物理异常[畏缩]：+7.5%，持续10秒，实际增幅 = 7.5% × 物理覆盖率
 *  - 两者加算合并到「受到失衡值提升区」
 */
function calcPerHitStun(
  baseDaze: number,
  panel: PanelValues,
  enemyStunResistance: number,
  physicalFlinchCoverageRate: number,
  element: string,
  skillType?: string,
  execStunBonus = 0,
): number {
  const baseStun = baseDaze

  // 冲击力区
  const impact = panel.impact
  const afterImpact = baseStun * (impact / 100)

  // 失衡值提升区（面板定向 + 行级提升同乘区加算）
  const stunBuildUpBonus = getStunBuildUpBonus(panel, skillType) + execStunBonus
  const afterBuildUp = afterImpact * (1 + stunBuildUpBonus / 100)

  // 受到失衡值提升区
  // = panel自带的受到失衡提升 + 物理异常[畏缩]覆盖率 × 7.5%
  const enemyStunTaken = panel.enemyStunTakenBonus
  const flinchBonus = 7.5 * physicalFlinchCoverageRate
  const totalStunTaken = enemyStunTaken + flinchBonus
  const afterTaken = afterBuildUp * (1 + totalStunTaken / 100)

  // 失衡抗性区
  const stunResRed = getTargetedStat(panel, 'enemyStunResReduction', skillType) + getTargetedElementStat(panel, 'enemyStunRes', element, skillType)
  const effectiveRes = enemyStunResistance - stunResRed
  const afterRes = afterTaken * (1 - effectiveRes / 100)

  return afterRes
}

/** 失衡池主计算 */
export function calcStunPool(input: StunPoolInput): StunPoolResult {
  const { executions, bossStunValue, chainCountPerStun, enemyStunResistances = {}, physicalFlinchCoverageRate = 0 } = input
  const inAxisFractions = input.inAxisStunFractionByKey ?? {}
  const windowFraction = Math.max(0, Math.min(1, input.windowTimeFraction ?? 0))
  const refundStunRatio = Math.max(0, Math.min(0.25, input.refundStunRatio ?? 0))

  const contributions: StunContribution[] = []
  const perSlotStun = [0, 0, 0]
  let totalStunBuildUp = 0
  let grossStunBuildUp = 0
  let inAxisStunTotal = 0

  for (const exec of executions) {
    if (exec.count <= 0 || exec.baseDaze <= 0) continue

    const panel = panelAt(input.panels, exec.slot) ?? emptyPanel()
    const element = exec.element ?? 'physical'
    // 键与失衡减抗同口径（变种读基础元素、烈霜读冰；查不到 = 0），见 enemyResistanceOf（r757 CC-540）
    const baseStunRes = enemyResistanceOf(enemyStunResistances, element)
    const perHit = calcPerHitStun(exec.baseDaze, panel, baseStunRes, physicalFlinchCoverageRate, element, exec.skillType, exec.stunBuildUpBonus)
    const total = perHit * exec.count
    // CC-469′（r651）：复合而非取大。逐招 fraction = 该招被轴块排进窗口的份额（轴模式才有，非轴恒 0）；
    // 其余 (1 − fraction) 份额均匀落在「非轴块时间」里，其中 `windowFraction` 比例处于**未被轴块填满的窗口**
    // （调用方在轴模式传 未覆盖窗口秒/(有效时间 − 覆盖秒)，非轴模式传 N·W/有效时间）⇒ 两段都不攒条。
    // 旧 `max(fraction, N·W/eff)`：栈填满时对窗外招式再按全窗时间扣一次（双重扣除，jufufu 多扣 39k/50k）；
    // 栈填不满时对轴块招式的窗外次数又一点不扣（1521 队 4→7 过冲）。复合式两头都对，非轴模式逐位同旧。
    const keyFraction = Math.max(0, Math.min(1, inAxisFractions[`${exec.slot}:${exec.moveId}`] ?? 0))
    const inAxisFraction = keyFraction + (1 - keyFraction) * windowFraction
    const inAxisStun = total * inAxisFraction
    const effectiveStun = total - inAxisStun

    contributions.push({
      moveId: exec.moveId,
      moveName: exec.moveName,
      slot: exec.slot,
      count: exec.count,
      baseDaze: exec.baseDaze,
      perHitStun: perHit,
      totalStun: total,
      inAxisFraction,
      inAxisStun,
      effectiveStun,
    })

    perSlotStun[exec.slot] = (perSlotStun[exec.slot] ?? 0) + effectiveStun
    totalStunBuildUp += effectiveStun
    grossStunBuildUp += total
    inAxisStunTotal += inAxisStun
  }

  // 失衡次数 = floor(有效总失衡值 / bossStunValue)；失衡窗口内打出的失衡值无效。
  // 失衡值返还（雨果决算）：第 1 次失衡满额，之后每次失衡所需外部失衡值 = bossStunValue × (1 - 返还比例)。
  // Boss 白送失衡（stunGift）：直接计入总失衡值（不做抗性/返还折算）。
  const totalStunWithGift = totalStunBuildUp + Math.max(0, input.stunGift ?? 0)
  const effectiveStunCost = bossStunValue * (1 - refundStunRatio)
  const stunCount = bossStunValue > 0
    ? (totalStunWithGift >= bossStunValue
      ? 1 + Math.floor((totalStunWithGift - bossStunValue) / effectiveStunCost)
      : 0)
    : 0
  // 实际被返还（用于展示）：除最后一次失衡外的每次失衡各返还 refundStunRatio × bossStunValue
  const stunRefundValue = Math.max(0, stunCount - 1) * refundStunRatio * bossStunValue

  // 总连携次数
  const chainCountTotal = stunCount * chainCountPerStun

  return {
    contributions,
    totalStunBuildUp,
    grossStunBuildUp,
    inAxisStunTotal,
    bossStunValue,
    stunCount,
    stunRefundRatio: refundStunRatio,
    stunRefundValue,
    stunGift: Math.max(0, input.stunGift ?? 0),
    chainCountPerStun,
    chainCountTotal,
    perSlotStun,
  }
}

/**
 * 失衡次数的**连续**版（CC-469′b，r652）：`stunCount === Math.floor(continuousStunCount(pool))` 按构造成立
 *（`1 + floor((t−b)/c) ≡ floor(1 + (t−b)/c)`；t<b 段取 t/b ∈ [0,1) ⇒ floor 0）。轴态不动点对连续 N 二分时用它作
 * 「N 窗口下池还能攒出几次」的读数，让 floor 口径与池自身同源（锁 `stunPoolContinuous.test.ts`）。
 */
export function continuousStunCount(pool: Pick<StunPoolResult, 'totalStunBuildUp' | 'stunGift' | 'bossStunValue' | 'stunRefundRatio'>): number {
  const b = pool.bossStunValue
  if (!(b > 0)) return 0
  const t = pool.totalStunBuildUp + Math.max(0, pool.stunGift)
  if (t < b) return t / b
  return 1 + (t - b) / (b * (1 - pool.stunRefundRatio))
}
/**
 * `continuousStunCount` 的反函数（CC-472，r653）：要让池报出连续次数 n，`totalStunBuildUp` 至少要多少
 *（赠送 `stunGift` 已抵扣）。首次失衡成本 b，之后每次 b(1−r)。用途：后台合轴自动填充的「保底 N 次」缺口
 * 原来写成 `N×bossStunValue`，与池的计数律不同源（r>0 时多算 (N−1)·r·b，再 ×1.2 冗余 ⇒ 过冲）。
 * 锁：`stunPoolContinuous.test.ts`（`continuousStunCount({…, totalStunBuildUp: stunBuildUpForCount(sp, n)}) ≈ n`）。
 */
export function stunBuildUpForCount(pool: Pick<StunPoolResult, 'stunGift' | 'bossStunValue' | 'stunRefundRatio'>, n: number): number {
  const b = pool.bossStunValue
  if (!(b > 0) || !(n > 0)) return 0
  const gross = n < 1 ? n * b : b + (n - 1) * b * (1 - pool.stunRefundRatio)
  return Math.max(0, gross - Math.max(0, pool.stunGift))
}
/**
 * 以给定失衡次数重建池的**次数派生字段**（返还值 / 总连携），其余字段（贡献明细、失衡值合计）原样保留。
 * 用途（CC-150，第 174 轮）：physical 缺省下外层以 2-环退出、环内整数次数无不动点（f(K)=K+1、f(K+1)=K）时，
 * 规范成员的引擎按读入的 K 分配时间，池却报 K+1 ⇒ 池 / 轴栈 / 伤害侧与资源行不同源（坑36 破）。
 * 取「最大自洽可行整数」K（按 K 分配时池撑得住 ≥K），报告池同步钳到 K。
 */
export function withStunCount(pool: StunPoolResult, stunCount: number): StunPoolResult {
  const chainCountTotal = stunCount * pool.chainCountPerStun
  return {
    ...pool,
    stunCount,
    stunRefundValue: Math.max(0, stunCount - 1) * pool.stunRefundRatio * pool.bossStunValue,
    chainCountTotal,
  }
}
/**
 * 后台合轴自动填充反推的**迟滞步**（CC-477，r659；r660 收口为「到保底即持住」）。
 *
 * 病灶（r659 探针 `arenaF/r659-bs.out`，auto-1371-1481-1451 弹刀/闪反各 +25）：反推 `est = ceil(缺口 / 每对净失衡)` 是对**当前执行行**的线性
 * 估计——13 对时 N=4，其他行在 4 窗口径下 59434、估「11 对够」；可一旦削到 12 对，本轮落到 N=3 分支，其他行只剩 58529
 * （随 N 生成的按窗行少了一窗 ≈ 3.7 对），估又变「要 14」。同一对数区间 [11,13] 里 N=3 / N=4 **两个分支都自洽**，
 * 线性回削必跨分支 ⇒ 外层 2-环（旧 ×1.2 下 15↔10、CC-475 后 13↔12）⇒ `cycle` 退出 + CC-150 钳 ⇒ 同一输入报 N=3 或 4
 * 取决于迭代路径。单纯阻尼压不住（分支阈值就在削幅之内）。
 * r660 补刀（探针 `arenaF/r660-trace2.out`，yixuan-roxy-lucia 裸三人）：r659 版「到保底后不回削」只拦向下，向上仍 +1 再被
 * 供给上限夹——而上限随对数翻转（24 对 cap 25、25 对多出第 5 个大招、自身前台时间↑ ⇒ cap 24）⇒ 24↔25 环、`cycle` 退出。
 * 保底是**地板不是目标**（用户口径 2026-09-07「反推至保底 4」、「不占前台不计难度」）：到了就不该再动，向上多装 = 最大化。
 *
 * 规则（按序）：
 * - 无上一轮量（本 pass 首轮）⇒ 直接取估计，夹上限。
 * - 上一轮量 > 本轮供给上限 ⇒ 取上限（可行性优先于持住）。
 * - 本轮已到保底（`reached`，池次数 ≥ 保底）⇒ **持住**上一轮量；唯一例外 `est = 0`（其他行单独已够、自动对数本就不该有）⇒ 归零（CC-475 锁 ②）。
 * - 未到保底、估计更高 ⇒ 上行 `prev + ceil(Δ/2)`（至少 +1，压过冲），夹上限。
 * - 未到保底、估计不高于上一轮 ⇒ 持住：估计（poolAt(保底) 口径）与实际次数（promoteFixpoint 不动点）互相矛盾 = 多根分支
 *   （见 arch CC-477 行遗留观察点），回削会掉分支、加对是盲目最大化，都不如停在原地让外层 stable 退出、按实际 N 报。
 * 回退：调用处改回 `Math.min(cap, est)`。
 */
export function relaxAutoFillStep(prev: number | undefined | null, est: number, cap: number, reached: boolean): number {
  const e = Math.max(0, est)
  if (prev === undefined || prev === null) return Math.min(cap, e)
  if (prev > cap) return cap
  if (reached) return e === 0 ? 0 : prev
  if (e > prev) return Math.min(cap, prev + Math.ceil((e - prev) / 2))
  return prev
}
