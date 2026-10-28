/**
 * 调频经济常量（抽卡期望 / 充值性价比 / 每版本收入默认）——单一事实源。
 *
 * 依据（萌娘百科·绝区零/调频，游戏内「调频详情」公示，2026-08 核对）：
 * - 单抽 = 160 菲林（加密母带/原装母带均 160）。
 * - 独家频段（角色池）：S 级综合出率（含保底）1.6% → 期望 1/0.016 = 62.5 抽/S；
 *   50/50 + 歪后必 UP（大保底）→ 每个限定命座期望 = 62.5 × 1.5 = **93.75 抽**。
 * - 音擎频段（武器池）：S 级综合出率 2%、80 抽保底、75/25 + 歪后必 UP →
 *   每个限定音擎期望 = 50 × 1.25 = **62.5 抽**（用户口径「武器有保底，均抽六十多」✓）。
 * - 充值性价比（用户口径「先充月卡」；**汇率固定不可改**，模拟只让用户输入预算）：
 *   月卡 30 元 → 3300 菲林（≈110 菲林/元，最高）> 大月卡 68 元 → ≈2600 菲林等值（≈38/元）
 *   > 直充 10 菲林/元（首充双倍 = 20 为一次性，模拟不计）。
 * - 每版本免费菲林 = **输入，不是常量**：菲林经济模拟默认 ≈1 金 = 15000（页面可编辑，用户口径
 *   「一版本给 1 金」）；抽卡规划器默认 25000（`PLANNER_FILM_PER_VERSION`，用户口径 2026-08-28）。
 *   两者都按**版本日历**发放（每个版本开始日一份），不得按「期」发——一版约 3 期，按期发等于三倍超发。
 * - 一版本 ≈ 3 期危局（页面口径），每期收入 = 版本收入 / 3。
 *
 * ⚠ **成本与收入的口径各有一条 `@fact`**（下面两处）：成本 = 期望值（不是单抽价 / 保底上限），
 * 收入 = 输入（不是常量），且两条都挂了 `⟳复核` 到期日——版本更新 / 卡池规则变动时由 `zc drift` 点名。
 */
const PULL_FILM = 160
// @fact engine:抽卡成本/期望菲林 口径: 一金 = 期望抽数 × 160 菲林（不是单抽价、不是保底上限）：限定角色/命座 93.75 抽 = 15000、限定音擎/精炼 62.5 抽 = 10000；两个值只在本文件定义，购买阶梯的增量成本一律经 pullPlanner#tierCost 按档位差分派生（本体 / 专武 / 满配都是派生值），页面与规划器不得另抄数字 | 据 用户@2026-09-01（只用期望值口径，模拟抽卡运气已删）·复核@2026-10-28（filmEconomy 与 tierCost 逐值对照，新增判据锁定差分派生）·萌娘百科·绝区零/调频（游戏内「调频详情」公示，2026-08 核对：角色池综合 1.6% × 50/50 歪后必 UP、音擎池 2% × 75/25） | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#CINEMA_GOLD_FILM + src/data/filmEconomy.ts#WEAPON_GOLD_FILM + src/composables/pullPlanner.ts#tierCost | 信 确认
// ⟳复核: 官方调频详情或卡池规则（综合出率 / 保底 / 歪率 / 单抽价）变动时，重算这两条期望抽数；若把单链阶梯拆成角色/音擎两条独立阶梯，tierCost 与购买阶梯一并复核 | 到期 2027-03-31
/** 一金命座（角色池 1 个限定命座/本体）的期望菲林 = 93.75 抽 × 160 */
export const CINEMA_GOLD_FILM = Math.ceil(93.75 * PULL_FILM) // 15000
/** 一金武器（音擎池 1 个限定音擎/精炼）的期望菲林 = 62.5 抽 × 160 */
export const WEAPON_GOLD_FILM = Math.ceil(62.5 * PULL_FILM) // 10000
/** 自由额度汇率（菲林/元 = 直充）——固定不可改 */
export const TOP_UP_FREE_FILM_PER_YUAN = 10
/** 一期危局 ≈ 版本时长 / 3（一版约 3 期、每期 ~14 天） */
export const PERIODS_PER_VERSION = 3
// @fact engine:抽卡收入/每版本菲林 口径: 收入是**输入不是常量**，两个消费方各有默认值——抽卡规划器 25000（PLANNER_FILM_PER_VERSION）、菲林经济模拟 15000 ≈ 1 金（页面可编辑）；发放粒度 = **版本日历**（每个版本开始日一份，pullPlanner#versionFilmGrants），不得按「期」发放 | 据 用户@2026-08-28（每版本 25000）·实测@2026-09-29（arena-B：44 期 44 个日期 ⇒ 按期发一份，收入约为每版本口径的 3 倍）·复核@2026-10-28（默认值未变，新增判据锁定「收入是输入」） | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#PLANNER_FILM_PER_VERSION + src/composables/pullPlanner.ts#versionFilmGrants + src/data/filmEconomy.ts#PERIODS_PER_VERSION | 信 确认
// ⟳复核: 版本节奏（当前 ≈42 天/版本、3 期危局）或免费菲林产出变动时，复核这两个默认值与 PERIODS_PER_VERSION——版本更新后旧产出数字会静默漂移 | 到期 2027-03-31
/** 抽卡规划器默认每版本免费菲林（用户口径 2026-08-28：默认每版本发 25000 ≈ 1.67 金） */
export const PLANNER_FILM_PER_VERSION = 25000

/**
 * **充值档位**（用户裁决 2026-10-28）：小额/长期规划**只给档位，不拆零换算**。
 *
 * > 「太小的数据就只给档位，比如最低就是小月卡*1。等你买完小大月卡和首充双倍后，
 * >  自由额度才容易换算。」
 *
 * ⇒ 模型分两层，别把任意元数直接乘汇率：
 * 1. **固定档**（离散、限量、按性价比降序买）：小月卡 30 元 → 3300（每版本 ≤2 张，
 *    月卡覆盖 30 天、版本 ≈42 天）、大月卡 68 元 → 2600（每版本 1 张）；
 * 2. **自由额度**：**只有固定档全部买满之后**，剩余元数才按 `TOP_UP_FREE_FILM_PER_YUAN` 折算；
 *    没买满时的零头原样留在 `leftoverYuan`（不折菲林）——「不纠结这些」。
 *
 * 首充双倍（20 菲林/元、一次性）**暂不进档位表**：缺官方档位金额与双倍额度，不猜
 * （见下面 `@fact … 未建模`）。补齐后它只是往 `TOP_UP_TIERS` 加一行。
 */
export interface TopUpTier {
  id: 'monthly' | 'battlePass'
  label: string
  /** 单档价格（元） */
  yuan: number
  /** 单档菲林 */
  film: number
  /** 每版本可买张数 */
  perVersion: number
}

/**
 * 固定档表（**唯一事实源**）：顺序 = 购买顺序 = 性价比降序（菲林/元 110 > 38.2）。
 * 加一档 = 加一行；改单价/限量 = 改这里，页面与模拟都读它。
 */
export const TOP_UP_TIERS: readonly TopUpTier[] = [
  { id: 'monthly', label: '小月卡', yuan: 30, film: 3300, perVersion: 2 },
  { id: 'battlePass', label: '大月卡', yuan: 68, film: 2600, perVersion: 1 },
]

// @fact engine:抽卡收入/充值档位 口径: 预算→菲林分两层——固定档（TOP_UP_TIERS：小月卡 30→3300 每版本 ≤2、大月卡 68→2600 每版本 1）按性价比降序买；**固定档全部买满后**剩余额度才按自由汇率 10 菲林/元 折算，未买满的零头留在 leftoverYuan 不折（用户裁决「太小的数据就只给档位…等你买完小大月卡和首充双倍后，自由额度才容易换算」） | 据 用户@2026-10-28 | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#TOP_UP_TIERS + src/data/filmEconomy.ts#topUpPlanOf | 信 确认
// ⟳复核: 官方充值档位（月卡/大月卡单价、每档菲林、每版本可买张数）或直充汇率变动时，改 TOP_UP_TIERS 并复核本条 | 到期 2027-03-31
// @fact engine:抽卡收入/首充双倍 未建模: 首充双倍（20 菲林/元、一次性）不进档位表——缺官方「档位金额 × 双倍额度」数据，不猜数值；补齐后往 TOP_UP_TIERS 加一行并给 perVersion（每账号一次即可表达） | 据 用户@2026-10-28（档位顺序里点名「首充双倍」）·首充双倍汇率见本文件头注释 | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#TOP_UP_TIERS | 信 中
// ⟳复核: 拿到官方首充双倍档位表（哪些档位双倍、双倍后各多少菲林、是否每账号一次）后建模并销条 | 到期 2027-03-31

/** 一次分配的明细（页面可读「买了哪几档 / 还差多少才够下一档」） */
export interface TopUpPurchase {
  tier: TopUpTier
  count: number
  /** 该档总花费（元） */
  yuan: number
  /** 该档总菲林 */
  film: number
}

export interface TopUpPlan {
  /** 买到的固定档（按购买顺序） */
  purchases: TopUpPurchase[]
  /** 固定档是否全部买满（= 只有这时才启用自由额度换算） */
  allTiersMaxed: boolean
  /** 自由额度折算掉的元数（未买满恒 0） */
  freeYuan: number
  /** 自由额度换来的菲林（未买满恒 0） */
  freeFilm: number
  /** 没花掉也没折算的零头（元）——「只给档位」的那部分 */
  leftoverYuan: number
  /** 本次预算合计换到的菲林（= 固定档 + 自由额度） */
  totalFilm: number
}

/**
 * 预算 → 档位明细。纯函数、不读外部状态。
 *
 * 算法（为什么贪心够用）：两档性价比相差近 3 倍（110 vs 38.2），且高档限量 ≤2 张、
 * 单档价格是 30 的倍数关系——在「每版本」这个量级里，任何换一档的组合都比贪心差
 * （实测 98 元：2 小月卡 6600 > 1 小月卡+大月卡 5900）。真要加第三档时重新验证。
 */
export function topUpPlanOf(yuanPerVersion: number): TopUpPlan {
  let yuan = Math.max(0, Math.floor(yuanPerVersion))
  const purchases: TopUpPurchase[] = []
  for (const tier of TOP_UP_TIERS) {
    const count = Math.min(tier.perVersion, Math.floor(yuan / tier.yuan))
    if (count <= 0) continue
    purchases.push({ tier, count, yuan: count * tier.yuan, film: count * tier.film })
    yuan -= count * tier.yuan
  }
  const allTiersMaxed = TOP_UP_TIERS.every(t => (purchases.find(p => p.tier.id === t.id)?.count ?? 0) >= t.perVersion)
  const freeYuan = allTiersMaxed ? yuan : 0
  const freeFilm = freeYuan * TOP_UP_FREE_FILM_PER_YUAN
  return {
    purchases,
    allTiersMaxed,
    freeYuan,
    freeFilm,
    leftoverYuan: yuan - freeYuan,
    totalFilm: purchases.reduce((s, p) => s + p.film, 0) + freeFilm,
  }
}

/** 每版本预算（元）→ 菲林（= `topUpPlanOf` 的 totalFilm；明细用 topUpPlanOf） */
export function allocateTopUpFilm(yuanPerVersion: number): number {
  return topUpPlanOf(yuanPerVersion).totalFilm
}