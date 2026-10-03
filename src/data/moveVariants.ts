/**
 * 队友在队招式变体（CC-405）—— 单一事实源
 *
 * 口径：nanoka 原文 param.desc 对同一招式给出「（协同）」倍率行时，表示**某队友在队**下该段
 * 由另一个 moveId 的倍率**替换**（不是叠加）。与 `moveFusions.ts` 正交：
 *   - 融合组回答「一次动作 = 哪些段求和」；
 *   - 变体表回答「队友在队时某段换成哪一段」。
 * 融合求和前先对每个 term 做段替换，所以融合组内的段也能被替换（珂蕾妲引爆→协同引爆）。
 *
 * 消费点唯一：`composables/resourceCalc/helpers.ts#enrichExecutionPlan`（执行行倍率回填，
 * 全队 agentId 在手）。轴表/技能行等 UI 查表仍显示未协同值——它们没有队伍上下文，
 * 这是记录在案的已知偏差（见 docs/mcp-calc-core-architecture.md CC-405）。
 *
 * 零 import：录入层/编排层/core 都可直接 `import type`，不影响 layer-inversion 判据。
 */

export interface TeammateMoveVariant {
  /** 招式所属代理人 */
  agentId: string
  /** 触发替换的队友（在队即触发，不看前台/后台） */
  teammateId: string
  /** 原段 moveId → 协同段 moveId（只换倍率行；行名/actionCode 仍是原段） */
  swaps: Readonly<Record<string, string>>
  /** 文档用 */
  label: string
  /** 依据（param.desc 原文出处） */
  note: string
}

/** 段替换器：输入段 id，返回替换后段 id（未登记返回原 id） */
export type SegmentResolver = (moveId: string) => string

// @fact engine:moveVariant/珂蕾妲×本协同 口径: 本在队时珂蕾妲强化普攻二段 1101006→1101007、强化特殊技引爆 1101105→1101106、终结技 1101401→1101402（替换非叠加；只换倍率行，时间仍取原段） | 据 nanoka full/1101.json 原文「当珂蕾妲与本同时出战…会由双方配合发动协同攻击，进一步提升招式的威力」+ param「…倍率（协同）」 | 验 src/composables/__tests__/moveVariants.test.ts | 锚 src/data/moveVariants.ts#KOLEDA_BEN_COOP | 信 确认
// ⟳复核: 本角色版本更新/珂蕾妲数据重导后，核对 full/1101.json 三条「（协同）」param 的 Skill id 与倍率是否仍为 1101007/1101106/1101402 | 到期 2026-12-31
const KOLEDA_BEN_COOP: TeammateMoveVariant = {
  agentId: '1101',
  teammateId: '1121',
  swaps: {
    '1101006': '1101007', // 强化普攻二段 → 强化普攻二段（协同）
    '1101105': '1101106', // 沸腾熔炉引爆 → 引爆（协同）
    '1101401': '1101402', // 锤进地心 → 锤进地心（协同）
  },
  label: '珂蕾妲·本在队协同攻击（强化普攻二段 / 沸腾熔炉引爆 / 终结技）',
  note: 'full/1101.json：普攻「当珂蕾妲与本同时出战，发动强化[普通攻击]时…协同攻击」；特殊技「与本同时出战，并衔接在强化[普通攻击]后快速发动招式时…协同攻击」（快速衔接 = 模块既有默认口径，影画1 c1Coverage 默认 1）；终结技「与本同时出战时…协同攻击」。特殊技（非强化）协同引爆 1101103 未入表：引擎不发非强化 E 行。',
}

export const TEAMMATE_MOVE_VARIANTS: readonly TeammateMoveVariant[] = [
  KOLEDA_BEN_COOP,
]

/**
 * 按「本角色 + 全队 agentId」合成段替换器；没有命中的变体时返回 null（调用方零开销走原路径）。
 * 多个变体同时命中时按登记顺序叠加（先登记先换；目前无此情形）。
 */
export function teammateSegmentResolver(agentId: string, teamAgentIds: readonly string[]): SegmentResolver | null {
  const hits = TEAMMATE_MOVE_VARIANTS.filter(v => v.agentId === agentId && v.teammateId !== agentId && teamAgentIds.includes(v.teammateId))
  if (hits.length === 0) return null
  return (moveId: string) => {
    let id = moveId
    for (const v of hits) id = v.swaps[id] ?? id
    return id
  }
}
