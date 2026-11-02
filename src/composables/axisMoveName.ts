/**
 * 轴视图的**招式名解析**（唯一来源，2026-10-30 收敛）。
 *
 * ## 为什么会有这个模块
 * 同一块轴动作在两处列名：**资源池·逐窗兑现图**（`views/ResultPage.vue#axisMoveName`）与
 * **队伍对比·难度曲线「这一档的轴」**（`views/TeamComparePage.vue#axisMoveNameOf`）。
 * 两份口径**已经漂移**：逐窗图特判了 `basic` → 「平A」与角色模块声明的连段名，曲线明细没有
 * ⇒ 同一个块在逐窗图里叫「平A」、在曲线明细里裸写内部 id `basic`（2026-10-30 那条提交只修了
 * 逐窗图那一半）。本模块把三档口径收成一条链：**平A 标识 → 模块连段名 → 目录倍率表 → 回落 moveId**。
 *
 * ## 口径（逐档都给理由，改前必读）
 * ① `moveId === 'basic'` ⇒ 「平A」：轴内的平A块 moveId 是**引擎兜底池的标识**，不是 catalog 招式
 *    （`data/moveTableQueries` 查不到它）—— 不特判就把内部 id 当名字画出去；
 * ② 角色模块声明的连段名（`agentMechanicView#agentCombos`，如 `banyue-combo` / `sigrid-pozhen`）：
 *    连段块不在倍率表里，名字只有模块给得出（轴编辑器的动作池同一口径）；
 * ③ 目录倍率表：走 **`utils/format#localized` 单一解析器**（CC-456）—— 手写
 *    `x.name.zhCN` 的 `??` 回退链会被 `localizedSingleSource` 源码锁拦下，别再散写；
 * ④ 三档都不中 ⇒ **回落 moveId 原样**：**不编名字**（编一个像真的中文比显示 id 更危险）。
 *
 * ⚠ 判定与数据一律由调用方注入（槽位、技能表），本模块不读 store。
 */
import { agentCombos } from '@/composables/agentMechanicView'
import { findMoveById } from '@/data/moveTableQueries'
import { localized } from '@/utils/format'

/**
 * 技能表的**子集视图**：解析招式名只用到「分类 → 招式 → id + 名字」这两列。
 *
 * ⚠ 是子集不是同形副本（判据 29 只管逐字段相同的副本）：目录技能表将来加字段，本模块不该被迫跟改；
 *   调用方传 `catalogStore.getAgentSkills(agentId)`（`AgentSkills`）即可直接赋值。
 */
export interface AxisMoveNameSkills {
  readonly categories: readonly { readonly moves: readonly { readonly id: string; readonly name: unknown }[] }[]
}

export interface AxisMoveNameContext {
  /** 槽位 → 角色 id（取不到给空串；连段名与技能表都按它查） */
  agentIdOf: (slot: number) => string
  /** 角色 id → 该角色的技能表（`catalogStore.getAgentSkills`；缺省 ⇒ 只做 ①②④ 三档） */
  skillsOf?: (agentId: string) => AxisMoveNameSkills | undefined
}

/**
 * 绑定「队伍 + 目录」上下文，返回 `(slot, moveId) => 招式可读名`。
 *
 * 两个调用方各一行（`ResultPage` 的逐窗图 `nameOf`、`TeamComparePage` 的轴明细 `nameOf`），
 * 之后**没有第二份口径**可漂移。
 */
export function axisMoveNameResolver(ctx: AxisMoveNameContext): (slot: number, moveId: string) => string {
  return (slot, moveId) => {
    // ① 引擎兜底池标识，不是 catalog 招式（实测 2026-10-30：不特判就在块里裸写「basic」，
    //    而轴编辑器同一个块写的是「平A」）
    if (moveId === 'basic') return '平A'
    const agentId = ctx.agentIdOf(slot)
    // ② 连段块（banyue-combo / sigrid-pozhen 等）不在倍率表里，名字由模块的 combos 声明给
    const combo = agentCombos(agentId)?.[moveId]
    if (combo?.label) return combo.label
    // ③④ 目录倍率表 → 回落 moveId（不编名字）
    const move = ctx.skillsOf ? findMoveById(ctx.skillsOf(agentId), moveId) : null
    if (move) return localized(move.name, moveId)
    /**
     * ⑤ **版本化 id（beta 快照 `1601v1`）回落同名 live 角色**（2026-11-03 实报修）：
     * beta 旁的 `agentSkills` 与 live **同 id 同名字**（实测 `1601006` 两边都是「强化特殊技：燃灯·晦尽」），
     * 而当 beta 旁挂没进本次会话的目录索引（例如页面是在开 beta 之前加载的）时，
     * `getAgentSkills('1601v1')` 为空 ⇒ 面板/逐窗图会裸写 `1601006`。
     * **这是按 id 查同一张表，不是编名字**：只有在版本化 id 查不到时才试它的基名，且仍然查不到就回落 moveId。
     */
    const baseId = agentId.replace(/v\d+$/, '')
    if (baseId !== agentId && ctx.skillsOf) {
      const viaBase = findMoveById(ctx.skillsOf(baseId), moveId)
      if (viaBase) return localized(viaBase.name, moveId)
    }
    return moveId
  }
}
