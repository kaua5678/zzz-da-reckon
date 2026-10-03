/**
 * 展示层「默认选中 / 示例」角色 id 的单一来源（CC-431，2026-10-03）。
 *
 * 这些都是**用户给的例子或口径**（不是引擎规则）：页面初始下拉选谁、对比图默认比谁、候选池种子是哪几位。
 * 此前散落在 5 个 .vue 里（TimeChartsPage / MultiplierCoeffPage / CharIncrementPage / SlotCompareChart / FreeComparePage），
 * 展示层带角色 id 字面量 ⇒ 角色下架 / 改 id 时页面静默指向不存在的角色，且 grep 不到「哪些页面默认选了谁」。
 * 锁：`src/data/__tests__/viewAgentDefaults.test.ts`——每个 id 必须在 catalog 里；时间线相关的必须在 AGENT_RELEASE_NODE 里；
 * `src/views` / `src/components` 下不许再出现 `'1xxx'` 形态的角色 id 字面量（新页面的默认值加到这里，不要写在页面里）。
 *
 * 改默认值：只改这里；名字对照用 `node scripts/resolve.mjs <id>`（规则 15，不要凭名字联想）。
 */

/** 时间线页（TimeChartsPage）默认主 C：仪玄 1371（用户指定先做仪玄验证） */
export const TIMELINE_DEFAULT_MAIN_AGENT_ID = '1371'
/** 时间线页候选池种子：仪玄演变路径的队友（青衣 1251 / 潘引壶 1421 / 橘福福 1391 / 卢西娅 1451 / 琉音 1481），用户口径 */
export const TIMELINE_DEFAULT_CANDIDATE_POOL: readonly string[] = ['1251', '1421', '1391', '1451', '1481']

/** 倍率系数页（MultiplierCoeffPage）默认角色 1401 */
export const MULTIPLIER_COEFF_DEFAULT_AGENT_ID = '1401'
/** 角色增量页（CharIncrementPage）默认角色：卢西娅 1451（用户例子） */
export const CHAR_INCREMENT_DEFAULT_AGENT_ID = '1451'
/** 槽位对比图（SlotCompareChart）默认对比对象：琉音 1481 vs 诺姆·霍洛维尔 1571（用户口径示例） */
export const SLOT_COMPARE_DEFAULT_AGENT_A = '1481'
export const SLOT_COMPARE_DEFAULT_AGENT_B = '1571'

/** 自由对比页（FreeComparePage）用户原话的三个实体（规则 15：已 `node scripts/resolve.mjs` 查证，非名字联想） */
export const FREE_COMPARE_AGENTS = {
  /** 柏妮思 异常·火 */
  burnice: '1171',
  /** 菲欧妮 异常·火（用户写的「菲欧尼」是笔误） */
  phoenix: '1641',
  /** 维琳娜 异常·风 */
  velina: '1561',
} as const

/** 供锁测试 / 巡检用：全部展示层默认角色 id（去重） */
export const ALL_VIEW_DEFAULT_AGENT_IDS: readonly string[] = Array.from(new Set([
  TIMELINE_DEFAULT_MAIN_AGENT_ID,
  ...TIMELINE_DEFAULT_CANDIDATE_POOL,
  MULTIPLIER_COEFF_DEFAULT_AGENT_ID,
  CHAR_INCREMENT_DEFAULT_AGENT_ID,
  SLOT_COMPARE_DEFAULT_AGENT_A,
  SLOT_COMPARE_DEFAULT_AGENT_B,
  ...Object.values(FREE_COMPARE_AGENTS),
]))
