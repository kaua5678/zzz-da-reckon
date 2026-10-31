/**
 * 失衡易伤可见化：
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
// @fact engine:失衡易伤可见化/加权信用 口径: 行级 stunMult = Boss 失衡易伤分量；覆盖率取行级引擎实值 `stunCoverage`、基数取行级 `stunVulnBase`（缺省 = Boss stunVuln），`stunMult` 反推仅作无新字段时的回落（CC-226）；生效易伤 = calcStunMultiplier(行级基数, 面板失衡增伤, 覆盖率)；加权信用 = Σ(伤害×生效易伤)/Σ伤害 − 1，与部署 A/B 差分同构（archiveStunVulnProbe 实测 0.1966），异常行按 1 计、信用偏保守；满额参照 = 槽0 面板 | 据 实测@2026-09-10（archiveStunVulnProbe A/B 差分）+ 用户@2026-09-10 方案听取·复核@2026-09-25·复核@2026-09-30 | 验 src/composables/__tests__/stunVulnSummary.test.ts | 锚 src/composables/stunVulnSummary.ts#computeStunVulnSummary | 信 确认
// @fact engine:失衡易伤/信用恒等式 口径: **加权信用 ≡ [always×D_直伤 + (满额信用−always)×Σ_直伤(伤害×cov)] / D_全池**（always = 面板 `stunDmgMultiplierBonusAlways` 经 `stunDmgMultiplierBonusCapAlways` 钳后 /100；cov = 行级 `stunCoverage`）。推导：轴模式下直伤行生效易伤 = `alwaysMult + (fullMult−alwaysMult)×cov`（**always 通道全时段生效、轴内外都吃**，见 `calcStunMultiplier` 的线性插值式），异常行恒按 1 ⇒ 加权平均展开即上式。⚠ **简化式「credit = 轴内伤害占比 × 满额信用」只在 always=0 时成立**（实测：无扳机队逐位相等，**含扳机 1361 的队偏差最大 0.198**——本文件 2026-10-16 首版曾写成无条件恒等式，同日被 T184 代理的 980 格普查证伪并订正）。故 `coverageRate`（页面「兑现率」）**不等于**轴内伤害占比（有 always 通道时被抬高），也不等于「时间覆盖率」（引擎无轴时按 `失衡次数×单窗/有效时长` 均匀给易伤，轴模式把它**集中**到轴内高倍率招式上） | 据 实测@2026-10-16（`.zc/perf/T184identity.perf.ts` 精确式误差 ≤7.8e-16 逐位成立；`.zc/perf/T184relation.perf.ts` 的简化式在 112/980 格失效，根因 = 扳机 1361 的 always=35） | 验 src/composables/__tests__/stunVulnSummary.test.ts | 锚 src/composables/stunVulnSummary.ts#computeStunVulnSummary | 信 确认
// ⟳复核: 若 always 通道语义变化（现为「全时段生效、轴内外都吃」）、轴模式改为「轴内按覆盖率部分吃易伤」（现为 1/0 两档硬分）、或异常行开始暴露行级易伤，本恒等式失效 ⇒ 重核精确式并同步改「兑现率」的用户可见措辞（它现被 always 通道抬高，不是纯轴内占比） | 到期 2027-04-30
// 行级失衡易伤派生（覆盖率反推 / 生效易伤 / 满额）**已迁 `core/stunVulnRow.ts`**：它现在有两个消费者
// （本展示汇总 + 建池时给每行盖章 stunAppliedMult / stunAlwaysMult），公式只能有一份（规则 11）。
// ⚠ **只转出这三个**（既有 import 点 stunVulnDisplay / 两个测试用到的那三个）：建池用的
// `stunRowWindowCoverageOf` / `stunAlwaysMultOf` / `stunPanelBonusOf` 与两个类型**不在这里转出**——
// 它们的生产消费者直接从 `@/core/stunVulnRow` 取；多转一手 = 死转出（deadChannelLs 判据 ⑫ 会红）。
export { rowStunCoverage, rowAppliedStunMultOf, rowFullStunMultOf } from '@/core/stunVulnRow'

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
