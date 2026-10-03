/**
 * 机制设置「引擎写 cfg、模块读」协议的单一来源（CC-235）。
 *
 * 写入方：`composables/resourceCalc/helpers.ts#buildCharConfig` 把 `configStore.getMechanicSetting(id, default)`
 * 写到 `cfg[mechanicSettingCfgKey(id)]`（恒为数字）。读取方：角色模块、`specs/resources.ts`。
 * 此前键格式 `setting:${id}` 与读取 helper 在 30 多个角色模块里各抄一份（setting / cfgSetting / cfgNum / cfgRate…），
 * 语义还有 4 种变体（Number 强转 / 要求 typeof number / null 取 0 或取 fallback），新模块只能继续抄。
 */
export function mechanicSettingCfgKey(id: string): string {
  return `setting:${id}`
}

/**
 * 读 cfg 上机制设置的**原始值**（不做数字转换；CC-362）。协议上写入恒为数字，
 * 只给需要兼容旧字符串值的读取方用（夜曦光明心境轴 `'full' | 'short_pair' | 'short_mie'`）——
 * 让模块不必为读这一个键把整个 cfg 强转成 `Record<string, unknown>`。
 */
export function cfgMechanicSettingRaw(cfg: unknown, id: string): unknown {
  return (cfg as Record<string, unknown> | null | undefined)?.[mechanicSettingCfgKey(id)]
}

/** 读 cfg 上的机制设置：数字直接用；null/undefined 取 fallback；其余按 Number() 转换，非有限数取 fallback */
export function cfgMechanicSetting(cfg: unknown, id: string, fallback: number): number {
  const raw = (cfg as Record<string, unknown> | null | undefined)?.[mechanicSettingCfgKey(id)]
  if (raw === null || raw === undefined) return fallback
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * 读 `applyPanel` 一侧的机制设置记录（键 = 设置 id，不带 `setting:` 前缀；CC-439）：
 * 可转成有限数就用，否则取 fallback。与 `cfgMechanicSetting` 是同一协议的两个读口
 * （引擎把同一份 store 值既写进 cfg 袋子、也以记录形式递给面板钩子）。
 * 此前 corin / phoenix / severian / sigrid 各私抄一份逐字相同的 `settingOf`。
 */
export function mechanicSettingOf(settings: Readonly<Record<string, number>> | null | undefined, id: string, fallback: number): number {
  const value = Number(settings?.[id])
  return Number.isFinite(value) ? value : fallback
}
