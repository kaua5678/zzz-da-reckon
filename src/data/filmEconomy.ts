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
/** 直充汇率（菲林/元）——固定不可改（用户口径；首充双倍 = 20 为一次性，模拟不计） */
const TOPUP_FILM_PER_YUAN = 10
/** 月卡（绳网会员）：30 元 → 3000 + 300 = 3300 菲林（约 110 菲林/元，性价比最高） */
const MONTHLY_CARD_COST = 30
const MONTHLY_CARD_FILM = 3300
/** 每版本最多买几张月卡（月卡覆盖 30 天，版本 ≈ 42 天 → 2 张覆盖全版本） */
const MONTHLY_CARD_MAX_PER_VERSION = 2
/** 大月卡（丽都城募/成长计划）：68 元 → ~1320 菲林 + 抽卡道具（价值约 8 抽 = 1280）≈ 2600 菲林/版本（约 38 菲林/元） */
const BATTLE_PASS_COST = 68
const BATTLE_PASS_FILM = 2600
/** 一期危局 ≈ 版本时长 / 3（一版约 3 期、每期 ~14 天） */
export const PERIODS_PER_VERSION = 3
// @fact engine:抽卡收入/每版本菲林 口径: 收入是**输入不是常量**，两个消费方各有默认值——抽卡规划器 25000（PLANNER_FILM_PER_VERSION）、菲林经济模拟 15000 ≈ 1 金（页面可编辑）；发放粒度 = **版本日历**（每个版本开始日一份，pullPlanner#versionFilmGrants），不得按「期」发放 | 据 用户@2026-08-28（每版本 25000）·实测@2026-09-29（arena-B：44 期 44 个日期 ⇒ 按期发一份，收入约为每版本口径的 3 倍）·复核@2026-10-28（默认值未变，新增判据锁定「收入是输入」） | 验 src/composables/__tests__/filmEconomy.test.ts | 锚 src/data/filmEconomy.ts#PLANNER_FILM_PER_VERSION + src/composables/pullPlanner.ts#versionFilmGrants + src/data/filmEconomy.ts#PERIODS_PER_VERSION | 信 确认
// ⟳复核: 版本节奏（当前 ≈42 天/版本、3 期危局）或免费菲林产出变动时，复核这两个默认值与 PERIODS_PER_VERSION——版本更新后旧产出数字会静默漂移 | 到期 2027-03-31
/** 抽卡规划器默认每版本免费菲林（用户口径 2026-08-28：默认每版本发 25000 ≈ 1.67 金） */
export const PLANNER_FILM_PER_VERSION = 25000

/**
 * 充值预算按性价比分配（用户口径「都是先充月卡」；汇率固定不可改）。
 * 每版本预算（元）→ 菲林：
 * 1. 月卡（110 菲林/元，每版本最多 2 张覆盖全版本）；
 * 2. 剩余够 68 元 → 大月卡（≈38 菲林/元）；
 * 3. 再剩余按直充 10 菲林/元。
 */
export function allocateTopUpFilm(yuanPerVersion: number): number {
  let yuan = Math.max(0, Math.floor(yuanPerVersion))
  let film = 0
  const monthly = Math.min(MONTHLY_CARD_MAX_PER_VERSION, Math.floor(yuan / MONTHLY_CARD_COST))
  film += monthly * MONTHLY_CARD_FILM
  yuan -= monthly * MONTHLY_CARD_COST
  if (yuan >= BATTLE_PASS_COST) {
    film += BATTLE_PASS_FILM
    yuan -= BATTLE_PASS_COST
  }
  film += yuan * TOPUP_FILM_PER_YUAN
  return film
}