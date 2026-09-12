/**
 * 反制支援（Counter Assist）招式登记表 —— 单一事实源（引擎与 UI 同源消费）。
 *
 * 游戏口径（`data/raw/nanoka_missing/noun_3.2.3.json` 术语 2000003 + `full/1611.json` 招式文本）：
 * - **[控制技]**（用户口中的「紫光技」）：招式无视无敌且没有闪光提示，期间无法发动终结技，
 *   须以[招架支援]/[回避支援]逐段应对；全部成功 → **[完美反制]**（高额伤害 + 大量失衡）。
 *   一组控制技 = 连续数段攻击 → Boss 预设按「多次弹刀 + 一次支援突击」录入（见 bossPreset 的
 *   `counterAssistGroups`）。
 * - **[反制支援]**：「自身或前场角色即将被部分敌人的**控制技**攻击时」点按切人发动，
 *   **与怪物角力，一次动作整组化解控制技** → 一组 = 一次反制支援（用户口径 2026-09-12）。
 *   锋御角色（specialty=sharpen）自带该招式，当前全库唯一 = 克拉蕾(1611)。
 *
 * 为什么不靠倍率表名字扫：克拉蕾的「支援突击」有两条——「血华誓·无垢熔锋」跟[招架支援]、
 * 「血华誓·琢形」跟[反制支援]，两者 EN 同为 `Assist Follow-Up`，按名匹配会挑错行
 * （`findAssistFollowUp` 取第一条 = 无垢熔锋）。反制支援与其专属支援突击的配对是**角色数据**，
 * 显式登记在此；新锋御角色录入时加一行即可（引擎与 Boss 卡都只读本表，无 agentId 分支）。
 *
 * @fact data:反制支援/招式配对 口径: 克拉蕾(1611)反制支援 = 1611028 寸铁不让 + 专属支援突击 1611030 血华誓·琢形，一次化解一组控制技（整组弹刀不再发生）；两行按「一次动作」融合（见 data/moveFusions.ts#CLARET_COUNTER_ASSIST） | 据 用户@2026-09-12（「有反制支援的角色在场时，可以使用反制支援替换这些弹刀交互」「两个都算」） | 验 src/composables/__tests__/counterAssist.test.ts | 锚 src/data/counterAssists.ts#CLARET_COUNTER_ASSIST | 信 确认
 */

export interface CounterAssistMoves {
  /** 角色 agentId（表键，冗余便于自检回环） */
  agentId: string
  /** 反制支援本体行（catalog moveId） */
  moveId: string
  /** 反制支援后紧接的专属支援突击行（与普通弹刀的支援突击**不同行**） */
  followUpMoveId: string
  /** 展示名（Boss 卡 / 交互栏提示用） */
  label: string
}

/** 克拉蕾（1611，锋御）：反制支援：寸铁不让 + 支援突击：血华誓·琢形 */
export const CLARET_COUNTER_ASSIST: CounterAssistMoves = {
  agentId: '1611',
  moveId: '1611028',
  followUpMoveId: '1611030',
  label: '反制支援：寸铁不让',
}

/** agentId → 反制支援招式配对（当前全库唯一锋御 = 克拉蕾；新锋御录入时加行） */
export const COUNTER_ASSIST_MOVES: Record<string, CounterAssistMoves> = {
  [CLARET_COUNTER_ASSIST.agentId]: CLARET_COUNTER_ASSIST,
}

/** 该角色是否有反制支援招式（Boss 卡显示替换勾选、引擎判定承接槽位的唯一判据） */
export function counterAssistOf(agentId: string | null | undefined): CounterAssistMoves | null {
  if (!agentId) return null
  return COUNTER_ASSIST_MOVES[agentId] ?? null
}
