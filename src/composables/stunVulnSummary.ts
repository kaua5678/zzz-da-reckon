/**
 * 失衡易伤可见化（.claude/task-ledger-stun-vuln.md Open #2）：
 * 伤害池行级 `stunMult`（轴启用时按轴内位置分配 0-1 覆盖）→ 结果页列展示 + 「加权有效易伤」汇总。
 *
 * 两个口径，页面必须分清（曾致混淆）：
 * - 行级 `stunMult` 字段 = **Boss 失衡易伤分量**（vuln=1.5 时满额行 = 1.5、零行 = 1.0、部分行中间值）；
 *   面板的失衡增伤（`stunDmgMultiplierBonus`，雨果队 +60）走面板通道单独结算。
 * - 展示/汇总用**生效易伤** = `calcStunMultiplier(vuln, 面板加成, frac)`（雨果队满额 = 2.100）。
 *   frac 由行级分量反推：frac = (stunMult − 1) / (vuln − 1)。
 *
 * 加权信用口径 = Σ(行伤害 × 生效易伤) / Σ(行伤害) − 1，与部署 A/B 差分实验同构
 * （A = 真实易伤总伤、B = stunVuln=1 总伤 ⇒ A/B = 伤害加权平均生效易伤，线性公式成立）。
 * 异常行不逐行暴露易伤（其结算内部已含，damagePool 只给直伤行写 stunMult）→ 按 1 计，
 * 信用因此偏保守（异常行的易伤贡献未计入）。
 */
// @fact engine:失衡易伤可见化/加权信用 口径: 行级 stunMult = Boss 失衡易伤分量（满额=stunVuln、零=1、跨窗部分中间值），生效易伤 = calcStunMultiplier(vuln, 面板失衡增伤, frac)；加权信用 = Σ(伤害×生效易伤)/Σ伤害 − 1，与部署 A/B 差分同构（archiveStunVulnProbe 实测 0.1966），异常行按 1 计、信用偏保守；满额参照 = 槽0 面板 | 据 实测@2026-09-10（archiveStunVulnProbe A/B 差分）+ 用户@2026-09-10 方案听取 | 验 src/composables/__tests__/stunVulnSummary.test.ts | 锚 src/composables/stunVulnSummary.ts#computeStunVulnSummary | 信 确认
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'

/** 行级 stunMult（vuln 分量）→ 生效易伤（含面板失衡增伤；异常行 undefined → 1） */
export function rowAppliedStunMult(
  stunMult: number | undefined,
  vuln: number,
  stunBonus: number,
  stunBonusAlways: number,
  stunCapAlways: number,
): number {
  if (stunMult === undefined) return 1
  const frac = vuln > 1 + 1e-9
    ? Math.max(0, Math.min(1, (stunMult - 1) / (vuln - 1)))
    : (stunMult >= 1 ? 1 : 0)
  return calcStunMultiplier(vuln, stunBonus, stunBonusAlways, stunCapAlways, frac)
}

export interface StunVulnSummary {
  /** 满额生效易伤（Boss 失衡易伤 × 面板加成，轴内 100% 覆盖；雨果队典型 2.100） */
  fullMult: number
  /** 满额信用 = fullMult − 1 */
  fullCredit: number
  /** 加权有效易伤 = Σ(伤害×生效易伤)/Σ伤害（全池，异常行按 1） */
  weightedVuln: number
  /** 加权易伤信用 = weightedVuln − 1（满额 = fullCredit） */
  weightedCredit: number
  /** 覆盖率 = weightedCredit / fullCredit（0..1；满额信用 ≤ 0 时 = 0） */
  coverageRate: number
}

export function computeStunVulnSummary(
  rows: { totalDamage: number; appliedStunMult: number }[],
  fullMult: number,
): StunVulnSummary {
  const total = rows.reduce((s, r) => s + Math.max(0, r.totalDamage), 0)
  const fullCredit = fullMult - 1
  if (total <= 0) {
    return { fullMult, fullCredit, weightedVuln: 1, weightedCredit: 0, coverageRate: 0 }
  }
  const weighted = rows.reduce(
    (s, r) => s + Math.max(0, r.totalDamage) * r.appliedStunMult,
    0,
  ) / total
  const credit = weighted - 1
  return {
    fullMult,
    fullCredit,
    weightedVuln: weighted,
    weightedCredit: credit,
    coverageRate: fullCredit > 1e-9 ? Math.max(0, Math.min(1, credit / fullCredit)) : 0,
  }
}

/**
 * 逐人（按槽位）失衡易伤增幅（用户 2026-09-13：「分别对 3 个人的增幅是多少，对全队增幅又是多少，
 * 这样能检查是不是只兑现了两成」）。**复用 `computeStunVulnSummary`**（同口径不另写公式，规则 11）：
 * 按 slot 分组各调一次，满额参照 = 全队 fullMult。让「全队加权」可下钻到每成员——
 * 谁的易伤吃满 / 谁几乎没吃到（兑现率 = credit/fullCredit）一眼对账。
 */
export interface StunVulnPerSlot {
  slot: number
  /** 该槽位总伤（易伤额外伤害 = total × credit） */
  total: number
  weightedVuln: number
  /** 增幅 = 该人加权生效易伤 − 1 */
  credit: number
  /** 兑现率 = credit / (fullMult−1)（与全队同一满额参照，直读「只兑现 X 成」） */
  coverageRate: number
}

export function computeStunVulnBySlot(
  rows: { slot: number; totalDamage: number; appliedStunMult: number }[],
  fullMult: number,
): StunVulnPerSlot[] {
  const slots = [...new Set(rows.map(r => r.slot))].sort((a, b) => a - b)
  return slots.map(slot => {
    const mine = rows.filter(r => r.slot === slot)
    const s = computeStunVulnSummary(mine, fullMult)
    return {
      slot,
      total: mine.reduce((acc, r) => acc + Math.max(0, r.totalDamage), 0),
      weightedVuln: s.weightedVuln,
      credit: s.weightedCredit,
      coverageRate: s.coverageRate,
    }
  })
}
