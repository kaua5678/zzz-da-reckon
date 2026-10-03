import type { SkillExecution } from '@/types/resource'

/**
 * 角色模块自造执行行的**必填账本骨架**（CC-440，2026-10-04）。
 *
 * 为什么：模块 `buildExecutions` / `patchExecutions` 自己 push 的行（追加攻击、技能专属段、分身行…）
 * 此前每处手写一整个 `SkillExecution` 字面量，全仓 55 处（r478 `grep -c "totalDecibelRecovery: 0" src/mechanics/agents/*.ts`），
 * 五份 `pushExec` 私抄（lighter / lucy / rina / yaojiayin / yeshuguang）各长各的；
 * `SkillExecution` 再加一个必填账本字段就要改 55 处。
 *
 * 口径：只给**必填**账本字段默认 0（`actionTime / comboAlignRatio / totalTime / totalComboAlignTime /
 * energyConsume / totalEnergyConsume`；`totalTime` 缺省 0 与现有 54/55 处一致，要 `actionTime × count` 的自己传）。
 *
 * ⚠ **故意不默认**四个可选回能字段 `decibelRecovery / totalDecibelRecovery / energyRecovery / totalEnergyRecovery`：
 * 它们是三态——`undefined` = 回填时取倍率表值；显式 `0` = 模块禁用；`decibelRecoveryOverride` = 模块换算值
 * （`composables/resourceCalc/helpers.ts:380-382`、`core/resource/rowAccounting.ts:131`）。
 * r478 实测把 yeshuguang 原本不写的 `decibelRecovery` 默认成 0 ⇒ 1431 各队终结技 2→1、timeGolden 18 条红。
 * 所以要「禁用」的调用方必须**显式写 0**，骨架不替你决定。
 *
 * 键序与原字面量一致（moveId, moveName, category, count, 六个账本字段, 调用方其余字段）——零差基准按 JSON 键序哈希。
 */
export type ModuleExecRowInit = Partial<SkillExecution> & Pick<SkillExecution, 'moveId' | 'moveName' | 'category' | 'count'>

export function moduleExecRow(init: ModuleExecRowInit): SkillExecution {
  const { moveId, moveName, category, count, ...rest } = init
  return {
    moveId,
    moveName,
    category,
    count,
    actionTime: 0,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    ...rest,
  }
}
