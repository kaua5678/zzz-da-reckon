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
 * **键序规则（CC-463 r582 泛化；零差基准按 JSON 键序哈希，所以这是契约不是细节）**：调用方的键按书写顺序原样输出；
 * 六个账本键作为一组落在调用方 **`count` 之后**（调用方若自己写了其中任一键，则整组落在它第一次出现的位置、
 * 调用方给的值覆盖默认 0）。这样 `{ moveId, moveName, category, element, count, …rest }` 这种在 `count` 前多写
 * 语义键的行也能迁进来而键序不变——CC-440 第一版固定「四头键 + 六账本 + rest」，`element` 会被挤到账本后面。
 */
export type ModuleExecRowInit = Partial<SkillExecution> & Pick<SkillExecution, 'moveId' | 'moveName' | 'category' | 'count'>

const LEDGER_KEYS = ['actionTime', 'comboAlignRatio', 'totalTime', 'totalComboAlignTime', 'energyConsume', 'totalEnergyConsume'] as const
export function moduleExecRow(init: ModuleExecRowInit): SkillExecution {
  const src = init as Record<string, unknown>
  const out: Record<string, unknown> = {}
  let placed = false
  const placeLedger = () => {
    if (placed) return
    placed = true
    for (const k of LEDGER_KEYS) out[k] = k in src ? src[k] : 0
  }
  for (const k of Object.keys(src)) {
    if ((LEDGER_KEYS as readonly string[]).includes(k)) {
      placeLedger()
      continue
    }
    out[k] = src[k]
    if (k === 'count') placeLedger()
  }
  placeLedger()
  return out as unknown as SkillExecution
}
