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
