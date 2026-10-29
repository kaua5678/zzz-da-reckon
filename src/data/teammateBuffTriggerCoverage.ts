/**
 * 队友 Buff**触发型效果的覆盖率折算**（单一事实源；用户 2026-10-29 裁决「可以这么折算」）。
 *
 * 背景：`teammate-buffs.json` 的效果覆盖率缺省 = **100%**（`stores/config.ts#teammateBuffCoverageOf`
 * 无记录 = 100），对「带时长、触发稀疏」的减益系统性高估。青衣影画一「闪络电压满时发动醉花月云转
 * ⇒ 目标防御 −15%，持续 15 秒」与影画六「醉花月云转命中 ⇒ 全属性抗性 −20%，持续 15 秒」就是这一类：
 * 她在多数队伍里只分到 13%~41% 的前台时间，一局只打出 6~14 轮醉花（实测见下表）。
 *
 * ## 口径（与 `discSetCoverage#discTriggerCoverage` 同一公式）
 *
 *   覆盖率 = min(1, 触发次数 × 效果时长 / 战斗有效时长)
 *
 * - 触发次数按**触发者该槽收敛后的执行行**计数（见 `TeammateBuffTriggerSpec.perTriggerMoveIds`）；
 * - 战斗有效时长与音擎/驱动盘折算同源（`core/effectiveTime#effectiveBattleTime`）；
 * - **轴 / 非轴同一路径**：行数就是数据（非轴 = 资源模型排出的醉花轮数；轴模式 = 轴里排的醉花块数），
 *   故不按轴态分档。
 * - **为什么 Σ 形式就是对的口径**（用户 2026-10-29 裁决，回应「扎堆会重叠」的疑问）：一次失衡要 **2 轮**
 *   醉花才把羁服叠满（10 层/轮），高手把这两轮摆在「失衡前一刻」与「再往前 15 秒」⇒ 两段 15 秒窗口
 *   **不重叠**，正好铺满该失衡窗前的 30 秒；失衡太快（击破耗时 < 15 秒）导致的重叠**由 min(1) 上限吃掉**
 *   —— 那种场合覆盖率本来就已经满了，不会突破 100%。⇒ 本式 = 「高手不重叠排布」的理想化，
 *   重叠不进数值（用户原话：「这考虑的比较理想，计算器这样已经尽力模拟了」）。
 * - 相位分布同 `discSetCoverage` 一样**舍弃**（整局固定加成）：只结算总秒数，不建模窗口落在第几秒。
 * - 手调优先：用户拖过滑块的条按手调值（面板阶段读 `configStore.teammateBuffManualCoverages`）；
 *   未登记的效果不折算（保持 100%）。
 *
 * @fact engine:队友buff覆盖率/折算口径 口径: 队友 buff 触发型效果的自动覆盖率 = min(1, 触发者执行行触发次数 × 效果时长 / 战斗有效时长)，触发次数取「一次触发对应的行」各行 count 的最大值（同轮多段行不双计）；轴/非轴同路径（行数即数据），手调滑块优先，未登记效果保持 100% | 据 用户@2026-10-29「醉花云15s短buff在非轴模式你可以这么折算，轴模式下我认为高级的玩家可以让醉花云打完正好进入失衡，所以这15s就分配在失衡前15s」+「如果失衡太快，打击破的时间小于15s导致有重叠，那也是覆盖率已经100%了，不会突破，其重叠部分自动被上限吃掉」（⇒ Σ 形式的合法性 = 高手不重叠排布，重叠由 min(1) 吃掉） | 验 src/core/__tests__/teammateBuffCoverageFold.test.ts | 锚 src/data/teammateBuffTriggerCoverage.ts#teammateBuffTriggerCoverage | 信 确认
 * ⟳复核: 新登记队友 buff 效果时确认它的触发行能从执行行数出来（触发通道之外要扩就改本表与消费点）| 到期 2027-04-30
 */

import type { SkillExecution } from '@/types/resource'

/** 单条登记项：触发者 + 一次触发对应的执行行 + 效果时长 */
export interface TeammateBuffTriggerSpec {
  /** 触发者 agentId（在该槽的执行行里数触发次数） */
  ownerAgentId: string
  /**
   * 一次触发对应的执行行 moveId 组。
   * ⚠ 同一轮施放会产出多段行（醉花 #1 突进 1251008 / #2 终结一击 1251009，两者 count 相同）
   * ⇒ 计数取**各行 count 的最大值**，不是求和（求和会把一轮算成两轮，覆盖率翻倍）。
   */
  perTriggerMoveIds: readonly string[]
  /** 效果时长（秒）；来源 = 原文「持续 X 秒」 */
  durationSeconds: number
}

/**
 * 登记表：effectId → 触发规格。
 *
 * 只登记「带时长且触发可数」的效果。高频到恒 ≥100% 的效果登记了也是白算（数值不变），不登记。
 *
 * 实测（引擎，180s、C6 青衣、各队预设，2026-10-29）：
 * | 队伍 | 醉花轮数 | Σ折算 | C1 减防归零 | C6 减抗归零 |
 * |---|---|---|---|---|
 * | 1521+1251+1311 | 14 | 100% | −8.50% | −16.67% |
 * | 1051+1251+1451 | 10 | 83% | −1.85% | −16.67% |
 * | 1471+1251+1451 | 6 | 50% | −1.83% | −16.67% |
 * | 1531+1251+1451 | 6 | 50% | −2.37% | −16.67% |
 */
export const TEAMMATE_BUFF_TRIGGER_COVERAGE: Readonly<Record<string, TeammateBuffTriggerSpec>> = {
  /** 青衣影画一·介电击穿：闪络电压满时发动醉花月云转 ⇒ 目标防御 −15%（自身暴击 +20% 另在模块面板级），持续 15 秒 */
  qingyi_cinema_1_enemy_def_reduction: {
    ownerAgentId: '1251',
    perTriggerMoveIds: ['1251008', '1251009'],
    durationSeconds: 15,
  },
  /** 青衣影画六·奇经八脉：醉花月云转命中 ⇒ 目标全属性伤害抗性 −20%，持续 15 秒 */
  qingyi_cinema_6_enemy_res_reduction: {
    ownerAgentId: '1251',
    perTriggerMoveIds: ['1251008', '1251009'],
    durationSeconds: 15,
  },
}

/**
 * 触发次数 = 「一次触发对应的行」里**最大**的那份行次数（同轮多段行只算一轮）。
 * 触发者不在队 / 没有任何该行 ⇒ 0。
 */
export function teammateBuffTriggerCount(
  spec: TeammateBuffTriggerSpec,
  executions: readonly SkillExecution[],
): number {
  let max = 0
  for (const moveId of spec.perTriggerMoveIds) {
    let n = 0
    for (const row of executions) if (row.moveId === moveId) n += Math.max(0, Number(row.count) || 0)
    if (n > max) max = n
  }
  return max
}

/**
 * 从**全队**资源结果里挑出触发者那一槽，数它的触发次数。
 *
 * 身份匹配放在本文件（数据层）而不是调用方：规则 6 的 agentId 棘轮把
 * `src/composables/useResourceCalc.ts + resourceCalc/**` 的身份比较冻结在 0（新增即红），
 * 而这里的比较对象来自**登记表**（不是硬编码角色分支），属「按数据表查」。
 *
 * @param owners 各槽的资源结果（只要有 `agentId` 与 `executions` 即可，结构类型零耦合）
 */
export function teammateBuffTriggerCountForOwner(
  spec: TeammateBuffTriggerSpec,
  owners: readonly { agentId: string; executions: readonly SkillExecution[] }[],
): number {
  const owner = owners.find(c => c.agentId === spec.ownerAgentId)
  return owner ? teammateBuffTriggerCount(spec, owner.executions) : 0
}

/**
 * 触发次数 + 时长 → 覆盖率（%，0–100）。未登记效果 / 战斗时长为 0 ⇒ `null`（= 不折算，回退手调或 100%）。
 * 触发次数为 0 时返回 0（这一局一次都没打出来，效果确实吃不到）。
 */
export function teammateBuffTriggerCoverage(
  effectId: string,
  triggerCount: number,
  battleSeconds: number,
): number | null {
  const spec = TEAMMATE_BUFF_TRIGGER_COVERAGE[effectId]
  if (!spec) return null
  if (!(battleSeconds > 0)) return null
  const count = Math.max(0, Number(triggerCount) || 0)
  if (count <= 0) return 0
  return Math.max(0, Math.min(100, Math.min(1, (count * spec.durationSeconds) / battleSeconds) * 100))
}

// ⚠ 与 `discSetCoverage.ts` 同一分层约束：本文件在 `src/data/`（CC-248 最底层），不得 import `core/*`；
//   只依赖类型（`@/types/resource`，纯类型、零运行时）。触发次数由调用方从执行行算好传进来。

