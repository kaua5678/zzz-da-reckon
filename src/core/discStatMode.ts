import type { StatRules } from '@/types/catalog'

/**
 * 驱动盘主词条 / 副词条的结算口径（`applyStat` 的 `mode` 实参）。
 *
 * 优先级：
 * 驱动盘数值的语义由 **catalog 外部数据** 决定：
 * 1. `statRules.driveDisc.statModes[stat]` —— **显式结算规格**（CC-100，R5 D15）。
 * 2. `statRules.statDisplay[stat].display` —— 旧口径，只作缺失时的回退。
 * 3. 名字后缀启发式 —— 两者都缺时的兜底。
 *
 * 为什么不能再以 `display` 为准（R5 D15，2026-09-27 第 125 轮）：`display` 描述的是**面板属性怎么显示**
 * （冲击力、异常掌控在面板上显示为整数 ⇒ `number`），不描述驱动盘词条怎么结算。源数据
 * `build-recommendations.json`（nanoka 爬取）里 6 号位冲击力 `prop 12202` 与异常掌控 `prop 31402`
 * 的 `format` 都是 `{0:0.#%}`（百分比），唯一的固定值主词条异常精通 `prop 31203` 是 `{0:0}`。
 * 2026-09-18 R27-J2 按 `display` 把 6 号位异常掌控定为 +30 点，其依据全是仓库内部互相引用，已被 D15 推翻。
 *
 * ⚠ 本函数只管**驱动盘词条**。全局 Buff 通路走 `utils/statMeta.ts#statSettlementMode`（读 `STAT_META.mode`），
 * 两者语义不同，不得合并（`energyRegen`：驱动盘 +60% vs 基础回能字段 1.2 点/秒）。
 */
export function driveDiscStatMode(stat: string, statRules: StatRules | null | undefined): 'pct' | 'flat' {
  const explicit = statRules?.driveDisc.statModes?.[stat]
  if (explicit === 'pct' || explicit === 'flat') return explicit
  const display = statRules?.statDisplay[stat]?.display
  if (display === 'percent') return 'pct'
  if (display === 'number' || display === 'integer') return 'flat'
  return stat.endsWith('Pct') || stat.endsWith('Rate') || stat.endsWith('Dmg')
    || stat.endsWith('Ratio') || stat.endsWith('Mastery') || stat.endsWith('Regen')
    || stat.endsWith('Impact') || stat.endsWith('Efficiency') || stat.endsWith('Bonus')
    ? 'pct'
    : 'flat'
}
