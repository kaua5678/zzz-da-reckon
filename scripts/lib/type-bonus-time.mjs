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
 * **反制支援（Counter Assist）系的定点秽盾基数 = 300**：这族招式的 `ether_purify = 300 + 100t`。
 *
 * 为什么不能并进 TYPE_BONUS：那三项靠「秽盾 − 积蓄」反推，而反制支援的积蓄**不参与**这个恒等式
 * （1601204：秽盾 600 / 积蓄 599.44，差 0.56；1611028：差 −24.52）——**数据推不出来，只能按招族认**。
 *
 * 三个独立样本反解同一个 300（各 3 列独立命中，见 counterAssist.test.ts）：
 * 克拉蕾 1611028 3.717s / 1661 反制支援 t=(678.37−300)/100=3.784s / 挽昼 1601204 3.0s。
 * ⚠ 与**招架支援 250** 的区别（用户 2026-10-30 追问「不是 −250 吗」）：250 是弹刀（Defensive Assist）
 * 的类型加成，走 TYPE_BONUS.defensiveAssist；反制支援是另一个招族。实测 1601204 按 250 折得 3.5s，
 * 三列比值 0.896 / 0.907 / 0.899（明显偏低），按 300 折得 3.0s，三列 1.0003 / 1.0006 / 1.0001。
 *
 * 认行口径 = **招式名**（中文「反制支援」开头 / 英文 Counter Assist）+ 显式 id 表
 * （`1611030` 琢形：名字是「支援突击」但那一段的基数随反制支援，唯一需要钉 id 的样本）。
 */
export const COUNTER_ASSIST_ETHER_BASE = 300
/** 名字判不出、只能钉 id 的反制支援专属追击段（目前仅克拉蕾 1611030 琢形） */
const COUNTER_ASSIST_BASE_MOVE_IDS = new Set(['1611030'])

/**
 * 该招式是否属于反制支援系（按名 + 定点 id；**不按名字前缀泛化到普通支援突击**——
 * 1511x/1601x 那种跟招架支援的「支援突击：虔志如初」基数就是 0）。
 * @param {{ id?: string, name?: { zhCN?: string, en?: string } }} move
 * @returns {number} 0 或 300
 */
export function counterAssistEtherBase(move = {}) {
  if (COUNTER_ASSIST_BASE_MOVE_IDS.has(String(move.id ?? ''))) return COUNTER_ASSIST_ETHER_BASE
  const zh = move.name?.zhCN ?? ''
  if (zh.startsWith('反制支援')) return COUNTER_ASSIST_ETHER_BASE
  if (/Counter Assist/i.test(move.name?.en ?? '')) return COUNTER_ASSIST_ETHER_BASE
  return 0
}

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
