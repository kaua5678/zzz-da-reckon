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
 * @fact data:反制支援/招式配对 口径: 克拉蕾(1611)反制支援 = 1611028 寸铁不让 + 专属支援突击 1611030 血华誓·琢形，一次化解一组控制技（整组弹刀不再发生）；两行按「一次动作」融合（见 data/moveFusions.ts#CLARET_COUNTER_ASSIST） | 据 用户@2026-09-12（「有反制支援的角色在场时，可以使用反制支援替换这些弹刀交互」「两个都算」）·复核@2026-09-25 | 验 src/composables/__tests__/counterAssist.test.ts | 锚 src/data/counterAssists.ts#CLARET_COUNTER_ASSIST | 信 确认
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
const COUNTER_ASSIST_MOVES: Record<string, CounterAssistMoves> = {
  [CLARET_COUNTER_ASSIST.agentId]: CLARET_COUNTER_ASSIST,
}

/** 全部已登记的反制支援配对（登记表的数组视图，供自检/判据遍历用；单一来源仍是上面的表） */
export const COUNTER_ASSIST_REGISTRY: ReadonlyArray<CounterAssistMoves> = Object.values(COUNTER_ASSIST_MOVES)

/** 该角色是否有反制支援招式（Boss 卡显示替换勾选、引擎判定承接槽位的唯一判据） */
export function counterAssistOf(agentId: string | null | undefined): CounterAssistMoves | null {
  if (!agentId) return null
  return COUNTER_ASSIST_MOVES[agentId] ?? null
}

/**
 * 反制支援专属追击段的 moveId 集合（全库并集）——**倍率表「支援突击」锚点必须排除它们**。
 *
 * 为什么：本表里 `followUpMoveId`（克拉蕾 1611030 琢形）在 catalog 里也挂在
 * `assist` 段的「支援突击」名下（EN 同为 `Assist Follow-Up`），但它是**反制支援的专属追击**、
 * 只在化解控制技时出现，**不是普通弹刀交互会用到的那条支援突击**（引擎 `findAssistFollowUp`
 * 取 assist 段第一条 = 1611027 无垢熔锋，见 `core/resource/moveLookup.ts`）。
 * 把两条一起取中位数会让版本直伤系数被本不该参与的行拖走 —— 实测克拉蕾
 * （1.227 无垢熔锋 + 2.909 琢形）/2 = **206.8%**，而真实锚点（无垢熔锋）只有 **122.7%**。
 *
 * @fact data:反制支援/追击段不参与直伤锚点 口径: 反制支援专属追击段（`followUpMoveId`）不计入「版本直伤系数」的支援突击样本——它是化解控制技的专属追击，不是普通弹刀的支援突击；排除后克拉蕾(1611) 直伤锚点 = 1611027 无垢熔锋 = 122.7%（原 206.8% 是两条支援突击取中位数的假象） | 据 用户@2026-10-09（「克拉蕾的中心系数该用支援突击：血华誓·无垢熔锋 (1611027)」）·复核@2026-10-09 | 验 src/composables/__tests__/multiplierCoefficients.test.ts | 锚 src/data/counterAssists.ts#COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS | 信 确认
 * ⟳复核: 新增锋御/反制支援角色时，确认其 followUpMoveId 同样不该进直伤锚点；若官方把「专属支援突击」与普通弹刀支援突击合并成同一行，本排除随之作废 | 到期 2027-03-31
 */
export const COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS: ReadonlySet<string> = new Set(
  COUNTER_ASSIST_REGISTRY.map(m => m.followUpMoveId),
)
