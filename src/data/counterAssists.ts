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
 *   **不是锋御专属**（用户 2026-10-30：「接吧，有反制支援的角色越来越多了，不再是克拉蕾专属」）：
 *   目前三家 —— 克拉蕾(1611 锋御) / 挽昼(1601 锋御) / 知更鸟(1661 防护)。
 *
 * 为什么不靠倍率表名字扫：克拉蕾的「支援突击」有两条——「血华誓·无垢熔锋」跟[招架支援]、
 * 「血华誓·琢形」跟[反制支援]，两者 EN 同为 `Assist Follow-Up`，按名匹配会挑错行
 * （`findAssistFollowUp` 取第一条 = 无垢熔锋）。反制支援与其专属支援突击的配对是**角色数据**，
 * 显式登记在此；新锋御角色录入时加一行即可（引擎与 Boss 卡都只读本表，无 agentId 分支）。
 *
 * @fact data:反制支援/招式配对 口径: 反制支援按角色登记「本体 + 专属支援突击」两行——克拉蕾(1611)=1611028 寸铁不让+1611030 琢形（融合成一次动作，见 data/moveFusions.ts#CLARET_COUNTER_ASSIST）、挽昼(1601)=1601204 希望堡垒+1601205 灯塔（融合，SUNBRINGER_COUNTER_ASSIST）、知更鸟(1661)=1661017 反制支援：角力+1661019 角力协同突击（**不融合**：1661019 由「其他角色发动反制支援后」自动触发，不属她自己那次动作）；一次反制支援化解一组控制技，整组弹刀不再发生 | 据 用户@2026-09-12（「有反制支援的角色在场时，可以使用反制支援替换这些弹刀交互」「两个都算」）·用户@2026-10-30（「接吧，有反制支援的角色越来越多了，不再是克拉蕾专属」）·复核@2026-09-25 | 验 src/composables/__tests__/counterAssist.test.ts | 锚 src/data/counterAssists.ts#COUNTER_ASSIST_MOVES | 信 确认
 * ⟳复核: 新增反制支援角色时按同一形状登记（本体 + 专属追击），并判「追击段是否属于本体那一次动作」——属则进 moveFusions，不属（他触发的自动段）只登记不算时间/倍率 | 到期 2027-06-30
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

/**
 * 挽昼（1601，锋御）：反制支援：希望堡垒 + 支援突击：灯塔，立于苍穹。
 * 原文「发动[反制支援]后，点按 攻击 发动」⇒ 同一动作的两段（与克拉蕾同形），且灯塔
 * 「重击命中敌人时，直接为目标添加1层[残痕]」——该赠送层在 `sunbringer.ts#solveSunbringerLoops` 建模。
 */
export const SUNBRINGER_COUNTER_ASSIST: CounterAssistMoves = {
  agentId: '1601',
  moveId: '1601204',
  followUpMoveId: '1601205',
  label: '反制支援：希望堡垒',
}

/**
 * 知更鸟（1661，防护）：反制支援：角力 + 支援突击：角力协同突击。
 *
 * ⚠ 与另两家不同形：1661019 原文是「**队伍中其他角色**发动[反制支援]后，若触发[完美反制]自动发动」
 * ——它不是她自己那次动作的后续段（新包把旧 1661018「角力突击」并掉了，用户裁决「可能只是对应id变了」），
 * 所以这里只登记 followUpMoveId 供**分类排除**（不进支援突击直伤锚点），**不进 moveFusions**
 * （并入就会把 318.5% 加到她每次反制支援上 = 虚增）。它作为「他触发的自动段」暂未建模，见 spec notes。
 */
export const ROBIN_COUNTER_ASSIST: CounterAssistMoves = {
  agentId: '1661',
  moveId: '1661017',
  followUpMoveId: '1661019',
  label: '反制支援：角力',
}

/** agentId → 反制支援招式配对（新角色录入时加行；一张表驱动引擎 / Boss 卡 / 倍率分类） */
const COUNTER_ASSIST_MOVES: Record<string, CounterAssistMoves> = {
  [CLARET_COUNTER_ASSIST.agentId]: CLARET_COUNTER_ASSIST,
  [SUNBRINGER_COUNTER_ASSIST.agentId]: SUNBRINGER_COUNTER_ASSIST,
  [ROBIN_COUNTER_ASSIST.agentId]: ROBIN_COUNTER_ASSIST,
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
 * @fact data:反制支援/追击段不参与直伤锚点 口径: 反制支援本体与专属追击各自是独立招式类型（counterAssist / counterAssistFollowUp），**分类上就不属于支援突击**，故恒不进「版本直伤系数」的支援突击样本——克拉蕾(1611) 直伤锚点 = 1611027 无垢熔锋 = 122.7%（原 206.8% 是两条支援突击取中位数的假象） | 据 用户@2026-10-09（「克拉蕾的中心系数该用支援突击：血华誓·无垢熔锋 (1611027)」）·复核@2026-10-24（改为分类层排除，锚点值不变） | 验 src/composables/__tests__/multiplierCoefficients.test.ts | 锚 src/data/counterAssists.ts#COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS | 信 确认
 * ⟳复核: 新增锋御/反制支援角色时，确认其 followUpMoveId 同样不该进直伤锚点；若官方把「专属支援突击」与普通弹刀支援突击合并成同一行，本排除随之作废 | 到期 2027-03-31
 */
export const COUNTER_ASSIST_FOLLOW_UP_MOVE_IDS: ReadonlySet<string> = new Set(
  COUNTER_ASSIST_REGISTRY.map(m => m.followUpMoveId),
)

/**
 * 反制支援**本体** moveId 集合（倍率演算分类用）。
 * 与专属追击同理：它不是「支援突击/招架支援」那些常规交互招式，
 * 而是「一次化解整组控制技」的独立招式类型（标准式 = 强特公式 @40 等效能量，见 standardMultiplierTable#EQUIVALENT_ENERGY）。
 */
export const COUNTER_ASSIST_MOVE_IDS: ReadonlySet<string> = new Set(
  COUNTER_ASSIST_REGISTRY.map(m => m.moveId),
)
