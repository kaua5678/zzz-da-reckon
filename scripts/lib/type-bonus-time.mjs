/**
 * 招式动作时间的**类型加成**推导（单一事实源）：catalog 的 `ether_purify`（秽盾）在录制时
 * 会带上按招式类型给的固定加成，真实动作时间 = `(秽盾 − 加成) / 100`。
 *
 * ## 为什么要有它（2026-10-18 用户口径）
 *
 * > 「支援突击：冲霄用的闪反秽盾公式，其时间也是 1.167s……引擎没加上那就改。」
 * > 「倍率演算页使用、资源引擎没接，这个问题显然不该发生，我们计算器的透明原则是算的什么就展示什么，不蒙骗用户。」
 *
 * 修前：`scripts/import-nanoka-missing.mjs` 与 `scripts/patch-move-action-time.mjs` 只按**招式名字**
 * 判类型加成（`Dodge Counter` / `Defensive Assist` / `Ultimate`），而般岳「支援突击：冲霄」
 * 英文名是 `Assist Follow-Up: Pierce Heavens` ⇒ bonus 判 0 ⇒ 时间取 `秽盾/100 = 2.667s`，
 * 而它的秽盾 266.7 = 积蓄 116.69 + **150**（闪反加成）⇒ 真实时间 1.167s。
 * 这个 1.5s 误差**同时**污染了两处且彼此不一致：
 * - 倍率演算页：`MOVE_TIME_ADJUSTMENTS['1471029'] = -1.5` 手写补上（页面显示 1.167s）；
 * - 资源引擎：直接读 catalog `actionTime`（2.667s）⇒ 金身/双反每次多算 1.5s 前台。
 * ⇒ 同一招在两个页面显示两个时间，违反透明原则。
 *
 * ## 规则（数据驱动，不认名字、不认角色）
 *
 * 给定 `etherPurify`（秽盾）与 `anomalyBuildup`（积蓄），若二者之差落在某个类型加成
 * `{150 闪反, 250 招架, 500 终结}` 的 ±2 容差内，则该招式的真实时间 = `(秽盾 − 加成) / 100`。
 * 名字只作为**佐证**（与数据冲突时以数据为准，见 `TYPE_BONUS_TOLERANCE`）。
 *
 * 为什么可信：全库 947 条有积蓄的招式里，94 条的 `秽盾 − 积蓄` 恰为 150/250/500 之一；
 * 其中 93 条的名字口径与数据口径一致，**唯一不一致的就是 1471029**（名字判 0、数据判 150）。
 * 名字与数据冲突的招式数 = 0（冲突会先在本文件暴露，见 `audit-type-bonus.mjs`）。
 *
 * ## 谁用
 *
 * - `scripts/import-nanoka-missing.mjs`（新角色导入时算 actionTime）
 * - `scripts/patch-move-action-time.mjs`（存量 catalog 修正）
 * - `scripts/validate-data.mjs`（护栏：`秽盾 − 积蓄 = 加成` 的招式，`actionTime` 必须等于 `(秽盾−加成)/100`）
 * - `src/data/standardMultiplierTable.ts` 的 `MOVE_TIME_ADJUSTMENTS` 已随之清空（不再需要手写补丁）
 */

/** 类型加成（秽盾单位）。与 `scripts/import-nanoka-missing.mjs` 的旧名字规则同值。 */
export const TYPE_BONUS = Object.freeze({ dodgeCounter: 150, defensiveAssist: 250, ultimate: 500 })

/** 秽盾 − 积蓄 与加成的容差（秽盾保留两位小数，取 2 容差覆盖四舍五入） */
export const TYPE_BONUS_TOLERANCE = 2

/**
 * 按数据（秽盾/积蓄）推断该招式的类型加成；无加成或数据不足返回 0。
 * @param {{ etherPurify?: number, anomalyBuildup?: number }} rows
 * @returns {number} 0 / 150 / 250 / 500
 */
export function inferTypeBonusFromRows({ etherPurify = 0, anomalyBuildup = 0 } = {}) {
  if (!(etherPurify > 0) || !(anomalyBuildup > 0)) return 0
  const diff = etherPurify - anomalyBuildup
  for (const bonus of Object.values(TYPE_BONUS)) {
    if (Math.abs(diff - bonus) <= TYPE_BONUS_TOLERANCE) return bonus
  }
  return 0
}

/**
 * 按名字推断类型加成（旧口径，**保留作佐证**，不再单独决定 actionTime）。
 * @param {{ zhCN?: string, en?: string, timeType?: string }} move
 */
export function inferTypeBonusFromName(move = {}) {
  const zh = move.name?.zhCN ?? ''
  const en = move.name?.en ?? ''
  if (move.timeType === 'ultimate' || zh.includes('终结技') || /Ultimate/.test(en)) return TYPE_BONUS.ultimate
  if (zh.startsWith('闪避反击') || /Dodge Counter/.test(en)) return TYPE_BONUS.dodgeCounter
  if (zh.startsWith('招架支援') || /Defensive Assist/.test(en)) return TYPE_BONUS.defensiveAssist
  return 0
}

/**
 * 招式真实动作时间（秒）：有数据加成时 = `(秽盾 − 加成)/100`，否则返回 `null`（调用方走原公式）。
 * @param {{ etherPurify?: number, anomalyBuildup?: number }} rows
 * @returns {number | null}
 */
export function actionTimeFromPurify({ etherPurify = 0, anomalyBuildup = 0 } = {}) {
  const bonus = inferTypeBonusFromRows({ etherPurify, anomalyBuildup })
  if (bonus <= 0) return null
  return Math.round((etherPurify - bonus) / 100 * 10000) / 10000
}
