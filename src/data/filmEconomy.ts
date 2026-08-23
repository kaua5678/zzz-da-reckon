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
 * - 每版本免费菲林 ≈ 1 金（用户口径「一版本给 1 金」= 15000 菲林，可编辑）。
 * - 一版本 ≈ 3 期危局（页面口径），每期收入 = 版本收入 / 3。
 */
export const PULL_FILM = 160
/** 一金命座（角色池 1 个限定命座/本体）的期望菲林 = 93.75 抽 × 160 */
export const CINEMA_GOLD_FILM = Math.ceil(93.75 * PULL_FILM) // 15000
/** 一金武器（音擎池 1 个限定音擎/精炼）的期望菲林 = 62.5 抽 × 160 */
export const WEAPON_GOLD_FILM = Math.ceil(62.5 * PULL_FILM) // 10000
/** 直充汇率（菲林/元）——固定不可改（用户口径；首充双倍 = 20 为一次性，模拟不计） */
export const TOPUP_FILM_PER_YUAN = 10
/** 月卡（绳网会员）：30 元 → 3000 + 300 = 3300 菲林（约 110 菲林/元，性价比最高） */
export const MONTHLY_CARD_COST = 30
export const MONTHLY_CARD_FILM = 3300
/** 每版本最多买几张月卡（月卡覆盖 30 天，版本 ≈ 42 天 → 2 张覆盖全版本） */
export const MONTHLY_CARD_MAX_PER_VERSION = 2
/** 大月卡（丽都城募/成长计划）：68 元 → ~1320 菲林 + 抽卡道具（价值约 8 抽 = 1280）≈ 2600 菲林/版本（约 38 菲林/元） */
export const BATTLE_PASS_COST = 68
export const BATTLE_PASS_FILM = 2600
/** 一期危局 ≈ 版本时长 / 3（一版约 3 期、每期 ~14 天） */
export const PERIODS_PER_VERSION = 3
/** 每版本免费菲林默认（≈ 1 金，用户口径「一版本给 1 金」；可编辑） */
export const DEFAULT_FILM_PER_VERSION = CINEMA_GOLD_FILM
/** 默认初始总限定金（全队 0 命 1 精带专武 = 6 金） */
export const DEFAULT_INITIAL_GOLD = 6
/** 默认消耗占比（每期菲林花多少抽卡；用户例「给 1 金用半金」= 0.5） */
export const DEFAULT_SPEND_RATIO = 0.5

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