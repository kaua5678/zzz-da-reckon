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

/**
 * 以**模块自身的 `settings` 声明**为唯一默认值来源的读口（CC-508）。
 * 此前每个模块在 `settings: [{ id, default: N }]` 声明一次 N，又在 `cfgMechanicSetting(cfg, id, N)` 手抄一次
 * （28 个模块 / 74 处逐字相同；引擎 `buildCharConfig` 已按声明 default 预填 cfg，读侧 fallback 只对手搭 cfg 的单测生效）。
 * `declared` 用惰性 getter：模块常量通常在文件底部，调用期才解引用。未声明且未给 fallback ⇒ 抛错（拼错 id 立刻暴露）。
 * 显式 `fallback` 仍可覆盖（动态 id 或策略性不同于声明的场合）。
 */
export function mechanicSettingReader(
  declared: () => ReadonlyArray<{ id: string; default: number }> | undefined,
): (cfg: unknown, id: string, fallback?: number) => number {
  let defaults: Map<string, number> | undefined
  return (cfg, id, fallback) => {
    if (fallback === undefined) {
      defaults ??= new Map((declared() ?? []).map(s => [s.id, s.default]))
      fallback = defaults.get(id)
      if (fallback === undefined) throw new Error(`[mechanicSetting] ${id} 未在模块 settings 声明且未给 fallback`)
    }
    return cfgMechanicSetting(cfg, id, fallback)
  }
}
