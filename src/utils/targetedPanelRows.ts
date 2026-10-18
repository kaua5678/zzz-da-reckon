/**
 * 面板上「定向字段」（`<stat>__<招式族>`）的统一枚举（展示层）。
 *
 * 为什么需要（2026-10-18）：引擎把带 `target` 的效果写进定向键
 * （`core/buff.ts#applyTargetedStat`，`core/damage.ts` 按当前招式读回），而展示层各处
 * 只列**基础字段** ⇒ 定向部分在页面上不可见。已逐个补过的族：`dmgBonus__*` / `critRate__*` /
 * `critDmg__*` / `skillDmgBonus__*`。剩下的一族是**敌方减益**：
 *   · 14132 心弦夜响 → `enemyFireResReduction__chain` / `__ultimate`（连携/终结无视火抗）
 *   · 14146 机巧心种 → `enemyDefReduction__basic` / `__ultimate`（普攻/终结无视防御）
 * 这两条**引擎侧是对的**（实测：伊芙琳读 chain=25 / basic=0；席德读 basic=20 / exSpecial=0），
 * 缺的只是「页面上说不出来」。
 *
 * 判定：键里带 `__` 且前缀命中给定族 ⇒ 一行；标签走 `getStatMeta`（它会自动加
 * 「（普通攻击限定）」后缀，单一来源 `data/skillDamageTargets`）。
 */
import type { PanelValues, SkillDamageTarget } from '@/types/catalog'
import { normalizeSkillDamageTarget } from '@/data/skillDamageTargets'
import { getStatMeta } from './statMeta'

export interface TargetedPanelRow {
  /** 完整键（如 `enemyFireResReduction__chain`） */
  key: string
  /** 基础 stat（如 `enemyFireResReduction`） */
  base: string
  /** 招式族 */
  target: SkillDamageTarget
  /** 中文标签（含「（连携技限定）」后缀） */
  label: string
  value: number
}

/**
 * 取面板上属于给定族的定向行（按 `prefixes` 精确匹配基础名，避免 `enemyRes` 误吃 `enemyResXxx`）。
 * `value === 0` 的键不返回（与基础行的 `v-if` 同口径）。
 */
export function targetedPanelRows(
  panel: Readonly<PanelValues>,
  prefixes: readonly string[],
): TargetedPanelRow[] {
  const rows: TargetedPanelRow[] = []
  for (const [key, raw] of Object.entries(panel)) {
    const sep = key.indexOf('__')
    if (sep < 0) continue
    const base = key.slice(0, sep)
    if (!prefixes.includes(base)) continue
    const value = typeof raw === 'number' ? raw : 0
    if (!value) continue
    rows.push({
      key,
      base,
      target: normalizeSkillDamageTarget(key.slice(sep + 2)),
      label: getStatMeta(key).label,
      value,
    })
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}
