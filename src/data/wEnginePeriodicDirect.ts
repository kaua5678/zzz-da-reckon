/**
 * 音擎周期直伤事件表（CC-82 2026-09-27，census §5.89）。原为 `composables/resourceCalc/helpers.ts`
 * 内联 `wEngine.id === '14001'` 判定 + 常量。键 = 音擎 id（数字字符串）；兼容旧配置的 `legacyIds`。
 *
 * 口径（逐字沿用原实现）：`requiresSpecialtyMatch` 时仅音擎职业 = 装备者职业才生效；
 * 次数 = ceil(有效战斗时长 / 精修 CD)，伤害 = 攻击力 × damageMultiplier% × 装备者直伤乘区
 * （结算见 core/resource/rowBuild.ts#buildAnomalyEventExecutions，cfg 字段 cannonRotor*）。
 *
 * ⚠ 现只有一件；cfg 字段名 / 事件 id 仍是 cannonRotor* / cannon_rotor_crit_proc。
 *   加第二件前先把它们泛化为数组（见 docs/mcp-worker-task-queue.md CC-84 触发条件）。
 */
export interface WEnginePeriodicDirectSpec {
  /** 触发伤害倍率（攻击力百分比） */
  damageMultiplier: number
  /** 精修 1..5 的冷却秒数 */
  cooldownByModLevel: readonly [number, number, number, number, number]
  /** 仅当音擎职业 = 装备者职业时生效 */
  requiresSpecialtyMatch: boolean
}

export const W_ENGINE_PERIODIC_DIRECT: Readonly<Record<string, WEnginePeriodicDirectSpec>> = {
  // 加农转子：攻击命中并暴击时触发 200% 攻击力直伤事件，按精修 CD 计算本局上限
  '14001': { damageMultiplier: 200, cooldownByModLevel: [8, 7.5, 7, 6.5, 6], requiresSpecialtyMatch: true },
}

/** 按 id 查，再按 legacyIds（旧 zzz_wiki_XXXX 配置迁移后保留的别名）查。 */
export function findWEnginePeriodicDirect(
  wEngine: { id: string; legacyIds?: readonly string[] } | null | undefined,
): WEnginePeriodicDirectSpec | undefined {
  if (!wEngine) return undefined
  const direct = W_ENGINE_PERIODIC_DIRECT[wEngine.id]
  if (direct) return direct
  for (const id of wEngine.legacyIds ?? []) {
    const spec = W_ENGINE_PERIODIC_DIRECT[id]
    if (spec) return spec
  }
  return undefined
}
