/**
 * **多段演出组**：一次发动、多段演出，**每段各算各的伤害**，但**同一次发动只花一次喧响**。
 *
 * ## 与融合组（`data/moveFusions.ts`）的区别（别混）
 *
 * | | 融合组 | 多段演出组（本文件） |
 * |---|---|---|
 * | 伤害 | 多段**合成一份倍率**（如雅连携 = #1+#2 合成 1.717s 的一次动作） | **每段各出一份** |
 * | 执行行 | 引擎**只物化主段**，兄弟段**不得成行**（`moveFusion.test.ts` 双计护栏） | **每段都成行** |
 * | 喧响 | 按主段收一次（天然不会重复） | **要显式去重**：轴里两段都捏时只收 3000 |
 *
 * ## 为什么需要（用户裁决 2026-10-22）
 *
 * 用户逐字：
 * > 「奥菲斯的大招应该把动作块合在一起，因为他会**自动放完两个倍率**，只需要 **3k 喧响**，
 * >   旋转完了可以自动发射激光」
 *
 * 原文（`data/raw/nanoka_missing/full/1301.json` chain 终结技：与火共舞）：
 * > 「喧响等级达到[极]时，点按发动：**向前发动旋转攻击，然后向前方发射激光**」
 *
 * 实测缺陷（轴编辑器里把两个分段都放）：
 * | 放法 | 总伤害 | 收喧响 |
 * |---|---|---|
 * | 只放 #1（1301015） | 2.8813M | 3000 |
 * | 只放 #2（1301016） | 2.8167M | 3000 |
 * | **两块都放** | **2.8813M（完全相同）** | **6000** ❌ |
 *
 * ⚠ 但注意：**执行行与伤害是各算各的**（实测 `ultCount=2` 时 #1 2 次 120265、#2 2 次 48106，
 * 两段都在出伤害）。所以这**不是**融合组那种「合成一份倍率」的情形——
 * 它是「一段演出拆成两个动作块，但只需要一次喧响」。
 */

/** 多段演出组的形状：`segments` 内的段同属一次发动 */
export interface MovePerformanceGroup {
  /** 主段 moveId（去重时的组键） */
  moveId: string
  agentId: string
  label: string
  /** 同一次发动的全部段（含主段） */
  segments: readonly string[]
  note: string
}

/**
 * 奥菲与玛格莎·终结技·与火共舞 = #1 旋转攻击 + #2 激光。
 *
 * 用户裁决 2026-10-22：「…只需要 3k 喧响，旋转完了可以自动发射激光」
 */
const ORPHIE_ULTIMATE_PERFORMANCE: MovePerformanceGroup = {
  moveId: '1301015',
  agentId: '1301',
  label: '奥菲与玛格莎·终结技·与火共舞（旋转 + 激光）',
  segments: ['1301015', '1301016'],
  note: 'full/1301.json chain「终结技：与火共舞」desc「向前发动旋转攻击，然后向前方发射激光」= 一次发动两段演出；模块 orphie.ts 亦注明「#1(1301015)+#2(1301016) 合一计一次终结技」（用户 2026-10-22 裁决：只收 3k 喧响）。',
}

export const MOVE_PERFORMANCE_GROUPS: MovePerformanceGroup[] = [
  ORPHIE_ULTIMATE_PERFORMANCE,
]

/**
 * 段 moveId → 所属多段演出组（反向索引，由 `segments` 派生，不另维护表）。
 * 收费侧用它回答「这一块是不是同一次发动的另一段」——是则喧响收 0。
 */
export const movePerformanceGroupOfSegment: ReadonlyMap<string, MovePerformanceGroup> = new Map(
  MOVE_PERFORMANCE_GROUPS.flatMap((g) => g.segments.map((s) => [s, g] as const)),
)

/** 便捷查询：段 → 组键（无组返回 undefined）。组键 = 主段 moveId。 */
export function movePerformanceGroupOf(moveId: string | undefined): string | undefined {
  if (!moveId) return undefined
  return movePerformanceGroupOfSegment.get(moveId)?.moveId
}
