/**
 * **属性乘区的唯一写入口**（用户 2026-11-06 口径）。
 *
 * > 一切属性都是在自己的乘区影响总属性，进而在属性区改变计算。资源侧通过动作时间、
 * > 资源消耗和回复形成动作数组，在倍率区改变计算。属性 × 倍率 = 结果。
 *
 * 面板两阶段（唯一实现 = `core/buff.ts#recalcAccumStat`）：
 *
 * ```
 * 白值 = 人物白值 + 武器白值
 * 局外 = 白值 × (1 + Σ局外%) + Σ局外固定
 * 局内 = 局外 × (1 + Σ局内%) + Σ局内固定      ← 面板最终值
 * ```
 *
 * ⚠ **括号位置就是语义**：`Σ局外固定` 与 `白值 × (1 + Σ局外%)` 同在 `× (1 + Σ局内%)` 的**内侧**
 * ⇒ 局外固定同样吃局内%。实测（1321 C2）：白值 929.759 + 驱动盘固定 316 = 局外 1245.759，
 * 局内 = 1245.759 × 1.35 = 1681.774，增量 436.016 == 0.35 × 1245.759。
 * hp / def / impact 与 atk 同式同函数（`CORE_STAT_BY_BONUS` / `PHASE_SCALAR_STAT_BY_BONUS`）。
 *
 * ⇒ 「自身攻击力 +25%」这一条必须进 **局内%乘区**，兑现成增量 `局外总属性 × 25%`。
 *
 * ## 为什么必须有这个函数（而不是再写一遍注释）
 *
 * `applyPanel` 跑在 `calcPanel` 的批次**之后**，累加器已 `finalizeCoreStatBonuses`。
 * 于是当时能用的两条路**都错，且错得一模一样**：
 *
 * | 写法 | 实测面板攻击 | 偏差 |
 * |---|---|---|
 * | `panel.atk *= 1.25` | 3114.00 | **+239.21** |
 * | `applyStat(panel,'atkPct',25)` | 3113.59 | **+238.80** |
 * | **本函数（局外基数增量）** | **2874.79** | **0** |
 *
 * （夹具：1591 / 局外 atk 1535.67 / 局内 2490.87 / 局内固定 955.20；
 *  正确值 = 1535.67 × 1.25 + 955.20 = 2874.79。两条错路都把「局内固定加成」也乘了 25%。）
 *
 * `docs/` 与模块注释里这条规则已经写过 6 遍（CC-497 / CC-502 /
 * `harumasa` / `vivian` / `zhao` / `zhendou` / `ben` 各自手写一遍
 * `outOfCombatStat(...) * pct / 100`），但**没有任何 API 叫「给我以局外为基数的 25%」**
 * ⇒ 第 7 次（sigrid C1）仍然写成了乘法。规则靠文档传播时，最小实现阶梯会稳定地选中乘法。
 *
 * 判据：`src/mechanics/__tests__/statZone.test.ts`（三种写法对拍 + 与累加器通道逐位一致）。
 */
import type { PanelValues } from '@/types/catalog'
import { addPanelStat, getPanelStat, setPanelStat } from '@/utils/panelStat'

/** 属性乘区支持的属性（核心三围 + 冲击力；三者都是「局外基数 × (1+Σ%) + Σ固定」同式） */
export type ZoneStat = 'atk' | 'hp' | 'def' | 'impact'

const ZONE_INPUT_KEY: Record<ZoneStat, string> = {
  atk: 'inCombatAtkPct',
  hp: 'inCombatHpPct',
  def: 'inCombatDefPct',
  impact: 'inCombatImpactPct',
}

/**
 * 把 `pct`% 加进该属性的**局内百分比乘区**，并按局外基数兑现成面板增量。
 *
 * 语义与「在局外批次的累加器里 +pct」等价（`core/buff.ts#recalcAccumStat`：
 * `panel[stat] = base × (1 + pct/100) + flat`），只是这里 base 已经是产出的局外总属性。
 *
 * @param panel 局内面板（`applyPanel` 收到的那个，会被就地修改）
 * @param outOfCombatPanel 局外面板（`AgentPanelInput.outOfCombatPanel`）
 * @param stat 属性
 * @param pct 百分比（25 表示 +25%）
 * @returns 实际加进面板的绝对量（供调用方记账；缺局外面板或 pct 为 0 时返回 0）
 */
export function applyInCombatPct(
  panel: PanelValues,
  outOfCombatPanel: { readonly [P in ZoneStat]?: number } | null | undefined,
  stat: ZoneStat,
  pct: number,
): number {
  if (!Number.isFinite(pct) || pct === 0) return 0
  const base = Math.max(0, Number(outOfCombatPanel?.[stat] ?? 0))
  if (base <= 0) return 0
  const delta = base * pct / 100
  setPanelStat(panel, stat, (getPanelStat(panel, stat) ?? 0) + delta)
  // 乘区记账：把「本条进了百分之几」写回带相位前缀的可读键（与 core/buff#recordAccumInputs 同义）。
  // 只做展示/属性账，不参与计算 —— 计算已由上面的 delta 兑现。
  addPanelStat(panel, ZONE_INPUT_KEY[stat], pct)
  return delta
}
