/**
 * 全队**源面板**的槽位视图（2026-10-25，1601/1661 收尾批）。
 *
 * 背景：`core/buff.ts#SourcePanelsByOwner` 是「ownerId（agentId / teammateBuffId 别名）→ 局外/局内面板」，
 * 它服务的消费者是 **buff 公式通道**（`cloneEffectWithSourceValue` 按 `[ownerId, teammateId]` 查）。
 * 而角色模块的钩子（`applyPanel` / `teamPanelEffects`）是**按槽位**工作的：它们手上只有 `slot` / `team`，
 * 每个模块都要自己重做一次「slot → agentId → 查表」就等于把同一段查表逻辑抄 60 遍（规则 11）。
 *
 * 因此这里提供**同一批面板对象**的槽位视图（不是拷贝：`PanelValues` 引用逐槽相同），
 * 派发侧建一次、钩子侧用 `panelOfSlot` 取：
 *   · 与 `calcPanel` 的 `sourcePanelsByOwner` **同源同实例** ⇒ 同一队伍下与队友 buff 转模看到同一份数；
 *   · 源面板 = **角色自身配置**（不带队友 buff），所以它不能拿来当「已上拐的最终面板」用；
 *   · 槽位号 ≠ 下标（`panels` 族按位置压缩）⇒ 只用 `.find(m => m.slot === …)` 建立视图，**禁下标**。
 */
import type { BuffScope, PanelValues } from '@/types/catalog'
import type { SourcePanelsByOwner } from './buff'

/** 槽位号 → { outOfCombat?, inCombat? }（值 = `SourcePanelsByOwner` 里同一批面板对象） */
export type SourcePanelsBySlot = Record<number, Partial<Record<BuffScope, PanelValues>>>

/** 队伍成员的最小身份面（`MechanicTeamMember` / config team 都满足；按 `slot` 查，别用下标） */
export interface SourcePanelTeamMember {
  slot: number
  agentId: string
}

/**
 * 把 owner 键控的源面板表折成**槽位键控**视图。
 *
 * 空槽 / catalog 查不到角色的槽不产生条目（该槽本就没有源面板）；别名键（slug / teammateBuffId）
 * 指向同一对象，故按 agentId 取即可拿到最新值（`adjustTeammateBuffSource` 的改写对它可见）。
 */
export function buildSourcePanelsBySlot(
  sourcePanels: SourcePanelsByOwner,
  team: readonly SourcePanelTeamMember[],
): SourcePanelsBySlot {
  const bySlot: SourcePanelsBySlot = {}
  for (const member of team) {
    if (!member.agentId) continue
    const panels = sourcePanels[member.agentId]
    if (panels) bySlot[member.slot] = panels
  }
  return bySlot
}

/**
 * 读某槽位在指定相位的**源面板**（缺省 undefined = 该槽没有源面板，调用方决定怎么兜底）。
 *
 * 口径：源面板 = 该角色**自身**配置（角色白值 + 音擎 + 驱动盘 + 自身 buff，**不含**队友 buff），
 * 用于「读队友面板做转模」类机制（卢西娅/橘福福/耀嘉音/知更鸟…）与「初始 X」类判据。
 * 已有同用途的 buff 公式通道（`sourceStat` / `sourcePanelPhase`）优先用声明式通道，别在模块里重算。
 */
export function panelOfSlot(
  sourcePanels: SourcePanelsBySlot | undefined,
  slot: number,
  phase: BuffScope,
): PanelValues | undefined {
  return sourcePanels?.[slot]?.[phase]
}
