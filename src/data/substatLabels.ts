/**
 * 副词条的中文简称（图表图例 / 表格用）。
 *
 * 为什么不复用 `useStatLabel().statLabel()`：它读 catalog 的 `statRules.statDisplay[k].label`，
 * 而那份外部数据是**英文**（`ATK%` / `Anomaly Proficiency` / `PEN`）——配置页沿用它没问题（一直是英文），
 * 但收益曲线的图例要能和用户的说法对上（用户 2026-10-21：「我选择显示了大攻击、精通、小穿透」）。
 * 也不复用 `getStatMeta().label`：那是**公式口径**的完整名（「攻击大词条（阶段继承）」），太长，
 * 塞进 10 条图例里读不动。
 *
 * 键 = `statRules.driveDisc.subStatPool` 的合法键（池外键不该出现在图里，故本表也只登记池内 10 个）。
 * 这是**展示层数据表**（id/键 → 文案），按规则 26 的口径住在 `src/data/`。
 */
export const SUBSTAT_SHORT_LABELS: Readonly<Record<string, string>> = {
  atkPct: '大攻击',
  atkFlat: '小攻击',
  hpPct: '大生命',
  hpFlat: '小生命',
  defPct: '大防御',
  defFlat: '小防御',
  critRate: '暴击率',
  critDmg: '爆伤',
  anomalyProficiency: '精通',
  penFlat: '小穿透',
}

/** 池外键（未来的新词条）回落到键本身，不静默显示空白 */
export function substatShortLabel(stat: string): string {
  return SUBSTAT_SHORT_LABELS[stat] ?? stat
}
