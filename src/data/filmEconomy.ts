/**
 * 调频经济常量（抽卡期望 / 充值性价比 / 每版本收入默认）——单一事实源。
 *
 * 依据（bwiki「调频」/「丽都城募」/「「点映返礼」」+ 游戏内「调频详情」，**2026-10-28 复核**）：
 * - 单抽 = 160 菲林（加密母带 1 盘 = 160，十连 1600，90 抽 14400；音擎池同价）。
 * - 独家频段（角色池）：S 级基础 0.6%、含保底综合 1.6% → 期望 1/0.016 = 62.5 抽/S；
 *   90 抽保底 + 50% UP（歪后必 UP，大保底）→ 每个限定命座期望 = 62.5 × 1.5 = **93.75 抽**。
 * - 音擎频段（音擎池）：S 级综合出率 2%、**80 抽**保底、**75%** UP（歪后必 UP）→
 *   每个限定音擎期望 = 50 × 1.25 = **62.5 抽**（用户口径「武器有保底，均抽六十多」✓）。
 * - 充值（**汇率固定不可改**，模拟只让用户输入预算；档位表见下方 `TOP_UP_TIERS`）：
 *   绳网会员 30 元 → 3000 菲林（100 菲林/元）> 丽都城募 68 元 → 800 菲林（11.76/元）
 *   > 首充双倍 20 菲林/元（一次性，前 ¥1308）> 直充 10 菲林/元。
 *   ⚠ 2026-10-28 前这里写的是「月卡 3300 / 大月卡 ≈2600」——两处都与官方数值不符（月卡每日 90 不是 100；
 *   城募成长计划只发 800 菲林），已按 bwiki 奖励总计表更正，Chart 4 的模拟读数随之变化。
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
/** 直充汇率（菲林/元）——固定不可改；六档全部 1:10（见 TOP_UP_PACKS） */
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
 * 1. **固定档**（离散、限量、按性价比降序买）：
 *    - 绳网会员（小月卡）30 元 → **3000** 菲林（立即 300 + 30 天 × 每日 90），每版本 ≤2 张（30 天 × 2 ≈ 42 天版本）；
 *    - 丽都城募·成长计划（大月卡）68 元 → **800** 菲林（只计菲林：同档还发高保真母盘 30 / 任选 1 把 S 音擎
 *      凭证 / 材料，均不进限定抽卡预算；常驻「原装母带」由基础方案给，同样不计）；
 * 2. **自由额度**：固定档买得起就买，其余按直充 10 菲林/元 折算；**不足最小档（¥6）的零头留在
 *    leftoverYuan**——「太小的数据就只给档位」，不硬凑。
 * 3. **首充双倍**（20 菲林/元、一次性、六档合计 ¥1308 / +13080 菲林）**不进每版本预算**，
 *    单独导出 `FIRST_DOUBLE_BONUS_FILM`（+13080）给「长期规划起点」参考（与原文件「首充双倍为一次性，
 *    模拟不计」口径一致）。
 *
 * ⚠ **否决记录（2026-10-28，实测数字）**：试过把首充双倍塞进每版本预算（先买月卡 → 双倍 → 城募），
 * 结果是 ① 20 菲林/元 把大月卡 11.76 菲林/元 挤成**永不购买**（128 元预算下模型宁可买双倍直充，
 * 6800 vs 7360），② 预算 127→128 元时总额**从 7340 掉到 6800**（多花一元反而更少）⇒ 分配器非单调、
 * 且让城募档成为死路。故退回「限量礼包优先 + 直充固定 10/元」，双倍只作一次性参考值。
 *
 * 数据来源（2026-10-28 联网核对，逐条可复查）：
 * - 直充档位 6/30/98/198/328/648 元 → 60/300/980/1980/3280/6480 菲林：bwiki「「点映返礼」」换算表逐档 1:10；
 *   单抽 = 加密母带 1 盘 = 160 菲林（十连 1600，90 抽 14400），音擎池同价。
 * - 小月卡「立即 300 菲林 + 30 天每日 90」（9game 月卡攻略与 bwiki 活动页「绳网会员-节日版 每日 90」同口径）。
 * - 大月卡：bwiki「丽都城募」奖励总计表 —— 成长计划 菲林 800、高保真母盘 30、「伟大建设者」凭证 1、
 *   音擎主控芯片 1、丁尼 80 万；基础方案另给原装母带 5。典藏计划 ¥128 = 成长计划 + 200 菲林 + 立即 +10 级。
 */
export interface TopUpTier {
  id: 'monthly' | 'battlePass'
  label: string
  /** 单档价格（元） */
  yuan: number
  /** 单档菲林（**只计菲林**，母带/材料不入限定预算） */
  film: number
  /** 每版本可买张数 */
  perVersion: number
}

/**
 * 固定档表（**唯一事实源**）：顺序 = 购买顺序 = 性价比降序（100 > 11.76 菲林/元）。
 * 加一档 = 加一行；改单价/限量 = 改这里，页面与模拟都读它。
 *
 * ⚠ 首充双倍（20 菲林/元）单位效率高于大月卡（11.76），但不参与本表的排序与分配——
 * 为什么、试过的排法与实测数字见文件头「否决记录」。
 */
export const TOP_UP_TIERS: readonly TopUpTier[] = [
  { id: 'monthly', label: '绳网会员（小月卡）', yuan: 30, film: 3000, perVersion: 2 },
  { id: 'battlePass', label: '丽都城募·成长计划（大月卡）', yuan: 68, film: 800, perVersion: 1 },
]

/** 直充档位（元 → 菲林）：全部 1:10，最小档 ¥6 决定「零头不再折算」的下限 */
export const TOP_UP_PACKS: readonly { yuan: number; film: number }[] = [
  { yuan: 6, film: 60 },
  { yuan: 30, film: 300 },
  { yuan: 98, film: 980 },
  { yuan: 198, film: 1980 },
  { yuan: 328, film: 3280 },
  { yuan: 648, film: 6480 },
]

/** 首充双倍额度（元）= 六档各首次购买一次 = 1308 元 */
export const FIRST_DOUBLE_YUAN_CAP = TOP_UP_PACKS.reduce((s, p) => s + p.yuan, 0)
/** 首充双倍期间每元菲林 = 直充的 2 倍 */
export const FIRST_DOUBLE_FILM_PER_YUAN = TOP_UP_FREE_FILM_PER_YUAN * 2
/**
 * 首充双倍**一次性**能**额外**多拿的菲林上限 = 1308 元 × (20 − 10) = 13080
 *（六档各买一次、每档首次翻倍；这 1308 元本身按 10/元 买到的 13080 菲林不算「额外」）。
 * **不参与每版本预算分配**（见文件头否决记录）——它是账号级起点加成，用来说明
 * 「新号第一笔直充相当于 5 折」，别把它摊进每版本收入。
 */
export const FIRST_DOUBLE_BONUS_FILM = FIRST_DOUBLE_YUAN_CAP * (FIRST_DOUBLE_FILM_PER_YUAN - TOP_UP_FREE_FILM_PER_YUAN)

// @fact engine:抽卡收入/充值档位 口径: 每版本预算→菲林分两层——① 固定档 TOP_UP_TIERS 按性价比降序买（绳网会员 30 元→3000、每版本 ≤2；丽都城募成长计划 68 元→800、每版本 1，只计菲林不折母带/材料）；② 余量按直充 10 菲林/元 折算，不足 ¥6 最小档的零头留在 leftoverYuan；**首充双倍（20 菲林/元、六档合计 ¥1308 = +13080 菲林）是一次性账号加成，不进每版本预算**，单独导出 FIRST_DOUBLE_BONUS_FILM（+13080）供长期起点参考 | 据 用户@2026-10-28（「太小的数据就只给档位…等你买完小大月卡和首充双倍后，自由额度才容易换算」）·bwiki「「点映返礼」」六档换算表 1:10·bwiki「丽都城募」奖励总计（成长计划 菲林 800）·月卡攻略（立即 300 + 每日 90 × 30 天） | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#TOP_UP_TIERS + src/data/filmEconomy.ts#FIRST_DOUBLE_YUAN_CAP + src/data/filmEconomy.ts#topUpPlanOf | 信 确认
// ⟳复核: 官方充值档位（六大直充档位 / 月卡与城募的菲林数 / 每版本限购）或首充双倍是否重置变动时，改 TOP_UP_TIERS、TOP_UP_PACKS 与 FIRST_DOUBLE_YUAN_CAP 并复核本条 | 到期 2027-03-31

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
  /** 按直充折算的元数（≥ 最小档 ¥6 的部分） */
  freeYuan: number
  /** 直充换来的菲林（= freeYuan × 10） */
  freeFilm: number
  /** 没花掉、也没折算的零头（元，恒 < 最小档 ¥6）——「只给档位」的那部分 */
  leftoverYuan: number
  /** 还差多少元才够买下一档限量礼包（全买满或预算已够 ⇒ null） */
  nextTierGapYuan: number | null
  /** 本次预算合计换到的菲林（= 固定档 + 直充） */
  totalFilm: number
}

/**
 * 预算 → 档位明细。纯函数、不读外部状态。
 *
 * 口径（用户 2026-10-28）：「太小的数据就只给档位……等你买完小大月卡和首充双倍后，自由额度才容易换算」。
 * ⇒ 先买限量礼包（**不因为首充效率更高就跳过礼包**，见 TOP_UP_TIERS 的否决记录），
 *   剩余走直充；各直充档位都是 10 菲林/元，所以按连续金额折算与整档购买的差 < ¥6（最小档），
 *   不足 ¥6 的零头不折算（列为 leftoverYuan）。
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
  /** 买完限量礼包后的余量（决定「再充多少够下一档」） */
  const remainderAfterTiers = yuan
  const packMin = TOP_UP_PACKS[0].yuan
  const convertible = yuan >= packMin
  const freeYuan = convertible ? yuan : 0
  const freeFilm = freeYuan * TOP_UP_FREE_FILM_PER_YUAN
  const leftoverYuan = yuan - freeYuan
  let nextTierGapYuan: number | null = null
  for (const tier of TOP_UP_TIERS) {
    const bought = purchases.find(p => p.tier.id === tier.id)?.count ?? 0
    if (bought >= tier.perVersion) continue
    const gap = tier.yuan - remainderAfterTiers
    if (nextTierGapYuan === null || gap < nextTierGapYuan) nextTierGapYuan = Math.max(0, gap)
  }
  return {
    purchases,
    freeYuan,
    freeFilm,
    leftoverYuan,
    nextTierGapYuan,
    totalFilm: purchases.reduce((s, p) => s + p.film, 0) + freeFilm,
  }
}

/** 每版本预算（元）→ 菲林（= `topUpPlanOf` 的 totalFilm；明细用 topUpPlanOf） */
export function allocateTopUpFilm(yuanPerVersion: number): number {
  return topUpPlanOf(yuanPerVersion).totalFilm
}