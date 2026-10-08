/**
 * 机制设置「引擎写 cfg、模块读」协议的单一来源（CC-235）。
 *
 * 写入方：`composables/resourceCalc/helpers.ts#buildCharConfig` 把 `configStore.getMechanicSetting(id, default)`
 * 写到 `cfg[mechanicSettingCfgKey(id)]`（恒为数字）。读取方：角色模块、`specs/resources.ts`。
 * 此前键格式 `setting:${id}` 与读取 helper 在 30 多个角色模块里各抄一份（setting / cfgSetting / cfgNum / cfgRate…），
 * 语义还有 4 种变体（Number 强转 / 要求 typeof number / null 取 0 或取 fallback），新模块只能继续抄。
 *
 * 模块在**用到设置的地方**直接调 reader 换算，不要在 buildCharConfig 里换算后写进 cfg 私有字段再给别的钩子读
 * （r750 CC-533 删了 21 个模块的 56 个这类镜像字段：读侧的 `?? 默认` 是默认值的第三份；2026-09-20 安比 / 塞维林
 * 的滑块失效就是读了没人写的镜像字段）。
 *
 * 三个读口各有一个「声明即默认值」的 reader，模块不手抄默认值：cfg 袋子 `mechanicSettingReader`、
 * 面板记录 `mechanicSettingPanelReader`、派发器递给钩子的 store 读取器 `mechanicSettingGetterReader`（r751 CC-534）。
 */
export function mechanicSettingCfgKey(id: string): string {
  return `setting:${id}`
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
  const defaultOf = declaredDefault(declared)
  return (cfg, id, fallback) => cfgMechanicSetting(cfg, id, defaultOf(id, fallback))
}
/**
 * 同一协议的 `applyPanel` 侧读口（记录键 = 设置 id；见 `mechanicSettingOf`）的「声明即默认值」版本（CC-508b）。
 * 引擎 `panelPhases.ts` 用 `setting.default` 预填记录，读侧 fallback 同样只对手搭记录的单测生效。
 */
export function mechanicSettingPanelReader(
  declared: () => ReadonlyArray<{ id: string; default: number }> | undefined,
): (settings: Readonly<Record<string, number>> | null | undefined, id: string, fallback?: number) => number {
  const defaultOf = declaredDefault(declared)
  return (settings, id, fallback) => mechanicSettingOf(settings, id, defaultOf(id, fallback))
}
/**
 * 第三个读口（r751 CC-534）：派发器递给钩子的 store 读取器 `getMechanicSetting(id, fallback)`
 * （stunRefundRatio / extraDirectRows / poolSummary 等）。store 里没有用户值时它直接返回 fallback，
 * 所以这里的 fallback 就是**生产默认值**（另两个读口的 fallback 只对手搭输入生效），同样取模块声明。
 */
export function mechanicSettingGetterReader(
  declared: () => ReadonlyArray<{ id: string; default: number }> | undefined,
): (get: (id: string, fallback: number) => number, id: string, fallback?: number) => number {
  const defaultOf = declaredDefault(declared)
  return (get, id, fallback) => get(id, defaultOf(id, fallback))
}
/** 三个 reader 共用：显式 fallback 优先；否则惰性建「id → 声明 default」表；未声明 ⇒ 抛错 */
function declaredDefault(declared: () => ReadonlyArray<{ id: string; default: number }> | undefined): (id: string, fallback?: number) => number {
  let defaults: Map<string, number> | undefined
  return (id, fallback) => {
    if (fallback !== undefined) return fallback
    defaults ??= new Map((declared() ?? []).map(s => [s.id, s.default]))
    const d = defaults.get(id)
    if (d === undefined) throw new Error(`[mechanicSetting] ${id} 未在模块 settings 声明且未给 fallback`)
    return d
  }
}
