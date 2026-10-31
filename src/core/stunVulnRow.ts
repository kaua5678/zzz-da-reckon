/**
 * 行级失衡易伤派生（**单一事实源**）——「这一行实际吃到的失衡易伤是几倍 / 它有多少伤害落在失衡窗内」。
 *
 * 两个消费者：
 *   ① 展示：`composables/stunVulnSummary.ts` re-export 本文件的 `rowStunCoverage` / `rowAppliedStunMultOf` /
 *      `rowFullStunMultOf`（公式不复制，规则 11）；
 *   ② 建池：`composables/resourceCalc/damagePool.ts` 在建池末尾把 `stunAppliedMult` / `stunAlwaysMult` /
 *      `stunWindowCoverage` 盖章到每一行，供「伤害来源分解」拆「含失衡 / 无失衡」两个属性区。
 *
 * 口径（用户 2026-10-28）：「无失衡属性区」**只抹掉 Boss 失衡系统，不抹常驻易伤**——
 * 扳机（1361）的 Always 通道 35% 在非失衡期也生效，抹掉它等于篡改该角色的拐力。
 * 反事实行伤害 = 行伤害 × alwaysMult / appliedMult：
 *   appliedMult = calcStunMultiplier(行基数, 失衡增伤, always, cap, 行覆盖率)
 *   alwaysMult  = calcStunMultiplier(…, 覆盖率 0) = 1 + always/100（引擎在 cov ≤ 0 时直接返回它）
 * 比值 − 1 = 「失衡窗把这一行放大了多少」，比值 1 = 该行与 Boss 失衡系统无关。
 */
// @fact engine:damage/属性区有失衡与无失衡 口径: 「属性区（无失衡）」把每行的失衡窗倍率还原成 1 —— 反事实行伤害 = 行伤害 × `stunAlwaysMult` / `stunAppliedMult`，**只抹 Boss 失衡窗、不抹 Always 常驻易伤**（扳机 1361 的 35%/55% 在非失衡期也生效，抹掉即篡改拐力；用户 2026-10-28 逐字：「像扳机这种非失衡也给了易伤区的你不能抹除其易伤贡献」）。「失衡期贡献率」= 1 − 无失衡属性区 ÷ 有失衡属性区（该族伤害被 Boss 失衡系统放大的比例，**不是**角色强弱）；「失衡爆发效率」= Σ(行伤害 × 行窗内占比) ÷ Σ行伤害（含异常/异放行）。行级三字段由建池末尾盖章（`damagePool.ts`），**纯展示、零求值影响**；「加权有效易伤」仍按旧口径（异常行按 1），两者刻意不同 | 据 用户@2026-10-28（「属性区需要区分两个……这俩相比差了一个失衡期贡献率」） | 验 src/core/__tests__/stunVulnRow.test.ts + src/composables/__tests__/damageStunSplit.test.ts + src/composables/__tests__/damageSourceBreakdown.test.ts | 锚 src/core/stunVulnRow.ts#stunRowWindowAppliedMultOf | 信 确认
// ⟳复核: 若 Always 通道语义变化（现为「全时段生效」）、异常行开始暴露行级易伤、或「失衡爆发效率」被用于难度/评分等折算，重核本口径与页面措辞 | 到期 2027-04-30
import { calcPanelStunMultiplier, type StunVulnPanelFields } from '@/core/anomalyPool/helpers'
import { clampRatio } from '@/utils/finiteClamp'

/** 按行计算所需的最小行形状（DamagePoolRow 的子集） */
export interface StunRowLike {
  stunMult?: number
  stunCoverage?: number
  stunVulnBase?: number
  /** 建池侧显式写入的「本行伤害落在失衡窗内的占比」；缺省时回落到 stunCoverage / 由 stunMult 反推 */
  stunWindowCoverage?: number
}

/** 满额参照所用的面板失衡加成（槽 0 惯例）+ Boss stunVuln */
export interface StunPanelBonus {
  vuln: number
  bonus: number
  always: number
  cap: number
}

/**
 * 唯一取乘区入口：把本文件的结构体当作**面板三字段**交给 `calcPanelStunMultiplier`
 * （core 下除 owner（`anomalyPool/helpers`）外一律走面板入口，不直调 `calcStunMultiplier`——
 * 源码锁 `damageMultipliersSingleSource.test.ts` 守这条）。
 */
function panelStunMultiplierOf(p: StunPanelBonus, baseStunMultiplier: number, stunned: boolean | number): number {
  return calcPanelStunMultiplier(
    {
      stunDmgMultiplierBonus: p.bonus,
      stunDmgMultiplierBonusAlways: p.always,
      stunDmgMultiplierBonusCapAlways: p.cap,
    },
    baseStunMultiplier,
    stunned,
  )
}

/**
 * 由行级 stunMult 反推覆盖率——**只作回落**（行没带覆盖率、也不是建池产出的行时：测试夹具 / 旧数据）。
 * 反推假设本行基数 = Boss stunVuln；叶瞬光帷幕行的基数是 `veilStunVulnBase`（触顶时 < stunVuln），
 * 用 stunVuln 反推会把覆盖率压低（例：基数 1.1、stunVuln 1.5 ⇒ 满覆盖被读成 20%）。
 */
export function coverageFromStunMult(stunMult: number, vuln: number): number {
  return vuln > 1 + 1e-9
    ? clampRatio((stunMult - 1) / (vuln - 1))
    : (stunMult >= 1 ? 1 : 0)
}

/**
 * 行的失衡覆盖率（**「加权有效易伤」口径，逐位保持原样**）：只认 `stunCoverage` 与 stunMult 反推；
 * **异常行（既无 stunMult 也无 stunCoverage）→ undefined**，汇总按 1 计（@fact 已登记的保守口径）。
 * ⚠ 刻意**不读** `stunWindowCoverage`：那个字段是给「属性区含/无失衡拆分」用的，含异常行——
 * 若让本函数也读它，结果页既有的「加权有效易伤 / 逐人增幅」数字会整体变（异常行开始计易伤），
 * 那是另一次口径变更，不在本次范围内（见 2026-10-28 用户口径：只加拆分，不改既有汇总）。
 */
export function rowStunCoverage(row: StunRowLike, vuln: number): number | undefined {
  if (row.stunMult === undefined && row.stunCoverage === undefined) return undefined
  return row.stunCoverage ?? coverageFromStunMult(row.stunMult as number, vuln)
}

/**
 * 行的失衡窗占比（**「属性区拆分 / 失衡爆发效率」口径，含异常行**）：建池盖章优先、其次引擎实值。
 * 供伤害加权的窗内占比使用——异常行也在窗内结算，漏掉它们会把爆发效率系统性压低。
 */
export function stunRowWindowCoverageOf(row: StunRowLike): number | undefined {
  const v = row.stunWindowCoverage ?? row.stunCoverage
  return v === undefined ? undefined : clampRatio(v)
}

/** 行级生效易伤：用本行真实基数（`stunVulnBase`，缺失 = vuln）与覆盖率；无覆盖率信息 → 1 */
export function rowAppliedStunMultOf(row: StunRowLike, p: StunPanelBonus): number {
  const cov = rowStunCoverage(row, p.vuln)
  if (cov === undefined) return 1
  return panelStunMultiplierOf(p, row.stunVulnBase ?? p.vuln, cov)
}

/**
 * **本行生效易伤（建池口径）**：只看「窗内占比」（`stunWindowCoverage` 优先、回落 `stunCoverage`），
 * **不要求行带 `stunMult`** —— 异常/异放行不带那个分量，但它们的结算内部同样吃了这档易伤。
 *
 * 与「加权有效易伤」用的 `rowAppliedStunMultOf` 差在这一点上：后者刻意把异常行按 1 计
 * （既有保守口径，见其注释）。本函数专供**属性区有/无失衡拆分**与**失衡爆发效率**。
 */
export function stunRowWindowAppliedMultOf(row: StunRowLike, p: StunPanelBonus): number {
  const cov = stunRowWindowCoverageOf(row) ?? 0
  return panelStunMultiplierOf(p, row.stunVulnBase ?? p.vuln, cov)
}

/** 本行满覆盖时的生效易伤（用本行基数；叶瞬光帷幕行触顶时低于全队满额参照） */
export function rowFullStunMultOf(row: StunRowLike, p: StunPanelBonus): number {
  return panelStunMultiplierOf(p, row.stunVulnBase ?? p.vuln, true)
}

/**
 * 非失衡期也生效的常驻易伤（Always 通道，扳机 1361 的 35%/55%）= `calcStunMultiplier(…, 覆盖率 0)`。
 * 引擎在 cov ≤ 0 时直接返回 alwaysMult、**不看基数**，故基数传 1。
 */
export function stunAlwaysMultOf(p: StunPanelBonus): number {
  return panelStunMultiplierOf(p, 1, 0)
}

/** 面板 → 满额参照（面板失衡三字段 + Boss stunVuln） */
export function stunPanelBonusOf(
  panel: Pick<StunVulnPanelFields, 'stunDmgMultiplierBonus' | 'stunDmgMultiplierBonusAlways' | 'stunDmgMultiplierBonusCapAlways'> | undefined,
  vuln: number,
): StunPanelBonus {
  return {
    vuln,
    bonus: panel?.stunDmgMultiplierBonus ?? 0,
    always: panel?.stunDmgMultiplierBonusAlways ?? 0,
    cap: panel?.stunDmgMultiplierBonusCapAlways ?? 0,
  }
}
