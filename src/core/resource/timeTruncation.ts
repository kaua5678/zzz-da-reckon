/**
 * 时间线截断（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运，零逻辑改动）。
 *
 * 为什么这一族是内聚切面：`TIME_FOLD_CONVERGENCE_SECONDS` 与
 * `truncateExecutionsToFrontline` 是一对**同源**符号——容差常量只被截断入口读，
 * 两者的口径必须由同一个数说话（见本文件 `@fact engine:时间线截断/入口容差`）。
 * 对 helpers.ts 其它符号**零内部依赖**（闸门实测：剥注释后出度仅该常量本身）。
 *
 * ⚠ 随本段迁来的两条 `@fact`（`engine:时间线截断` / `engine:时间线截断/入口容差`）
 * 「锚」已同步改指本文件——**路径跟随，不是销号**（口径内容一字未改）；`engine:时间线截断`
 * 在 `scripts/check-guards.mjs` 的 `CALIBER_TRIGGER_ALLOWLIST` 键同步改指本文件。
 */
import type { SkillExecution, TruncationCut } from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'

// @fact engine:时间线截断 口径: 资源允许的动作量超过可用前台时按时间线截断（实战 180s 到点结算，不管这套连段打没打完），次数必须整数（floor+小数降序加回装包）、平A填充行先占位不参与截断、砍到0次的行整行消失；overflowSeconds 语义=被截断的秒数 | 据 用户@2026-09-05·复核@2026-09-08 | 验 src/composables/__tests__/timeTruncation.test.ts | 锚 src/core/resource/timeTruncation.ts#truncateExecutionsToFrontline | 信 确认
/**
 * 折叠环收敛容差（秒）= 截断入口容差（秒）——**同一个数，只此一处**。
 *
 * 为什么必须同源（债 2 分诊 R32 实测，2026-09-18）：S2 折叠环按 `maxExcess ≤ 1e-3` 判「账本与物化行已自洽」
 * 停轮，即上游**允许 1 毫秒残差**；S4 截断入口原用 `used <= room + 1e-9` 判「装不装得下」——
 * 上游放行的毫秒残差到了下游就是「装不下」，随后**整数装包**把 0.3 毫秒的超出放大成砍掉一整次动作
 * （实测 3 队：`auto-1591-1481-1311` s0 超 5.9e-4s → 砍连携 0.906s；`auto-1591-1161-1211` s0 超
 * 1.3e-3s → 砍 0.580s；`auto-1461-1521-1031` s1/s2 超 3.3e-4/9.3e-5s → 砍 5 行 0.434s）。
 * 这 3 队的「截断」不是资源装不下，是两级容差不一致制造的假截断——它们的账本/行能量落差也随之为假。
 * 结构性溢出（1431 簇，超 4~71s）不受本容差影响。
 */
// @fact engine:时间线截断/入口容差 口径: 截断入口判「装不下」的容差与折叠环收敛判据同一常量 TIME_FOLD_CONVERGENCE_SECONDS=1e-3（上游放行的残差下游不得再当溢出截断；两级容差不一致曾把 ≤1.3ms 超出放大成砍 0.43~0.91s 整次动作，3/104 队假截断） | 据 债2分诊·R32 实测@2026-09-18 | 验 src/composables/__tests__/timeTruncation.test.ts | 锚 src/core/resource/timeTruncation.ts#TIME_FOLD_CONVERGENCE_SECONDS | 信 确认
// ⟳复核: S2 折叠环收敛判据或本入口容差再动时，复核「假截断队数仍为 0」（R32 实测 3/104 队：auto-1591-1481-1311 / auto-1591-1161-1211 / auto-1461-1521-1031 的 cut 应恒为 0）并按 timeGolden 逐队归因；债 2 批 2-1（rowTimeLimit 外环回灌）**未落地**，停在 runAssemble 抽取前（分支 collab/wip-snapshot-20260919）| 到期 2026-12-31
export const TIME_FOLD_CONVERGENCE_SECONDS = 1e-3
/**
 * 按可用前台时间**截断**执行计划（通用资源循环规则，2026-09-05 用户口径）。
 *
 * 规则：资源允许的动作量 > 本槽可用前台 ⇒ 在时间线处截断，多余资源不兑现成动作——
 * 实战 180s 到点直接结算，不管你这一轮明心境/这套连段打没打完。旧实现没有这一层：
 * 装不下时只能靠折叠循环把超出量折进 `necessaryTime`（账本虚高）→ 平A池被挤成 0 →
 * 物化行反而打不满（实测朱鸢队留白 93.7s、叶瞬光队 18~58s），既不准也解释不了。
 *
 * **整数装包截断**（复用坑17 的终局口径，不是等比缩小数）：次数必须是整数——等比缩会产出
 * 「强化特殊技 ×2.78 次」这种不存在的动作（实测红 11 条：12.27/2.78/5.76/31.97 次）。
 * 做法：① 每行按可用比例 floor 次数；② 剩余时间按**小数部分降序**逐个加回 1 次，
 * 直到装不下为止。装配顺序不代表实战出招顺序，所以不按尾部整行丢（实测会把排在最后的
 * 模块行——叶瞬光架势段、琉音抱拳——连伤害带失衡整类删光，直接让 calcOutput 返回 null）。
 * 平A行是填充项（占剩余时间），不参与截断；后台行不占前台，自然也不参与。
 *
 * @returns 截断后的行 + 被砍掉的秒数（= 该槽真实的时间压力，供 overflowSeconds/操作难度消费）
 *   + 截断前的招式行秒数（`usedSeconds`，存活率 = 1 − cutSeconds/usedSeconds）
 *   + **逐行明细** `cuts`（Σ cutSeconds == cutSeconds；资源池「被砍招式」清单与难度轴交互缩放的输入）
 */
export function truncateExecutionsToFrontline(
  executions: SkillExecution[],
  availableSeconds: number,
): { executions: SkillExecution[]; cutSeconds: number; usedSeconds: number; cuts: Omit<TruncationCut, 'slot'>[] } {
  /** 可截断行：占前台且不是平A填充行 */
  const isTruncatable = (e: SkillExecution) => isFrontlineExecution(e) && e.moveId !== 'basic_attack'
  let used = 0
  let basicTime = 0
  for (const e of executions) {
    if (!isFrontlineExecution(e)) continue
    if (e.moveId === 'basic_attack') basicTime += e.totalTime ?? 0
    else used += e.totalTime ?? 0
  }
  // 平A是填充项先占位：招式行能用的只剩「可用前台 − 平A」
  const room = Math.max(0, availableSeconds - basicTime)
  // 入口容差与折叠环收敛判据同源（见 TIME_FOLD_CONVERGENCE_SECONDS 头注释）：上游已判「自洽」的
  // 毫秒残差在这里不是溢出。真溢出（结构性，秒级）照常进入整数装包。
  if (used <= room + TIME_FOLD_CONVERGENCE_SECONDS) return { executions, cutSeconds: 0, usedSeconds: used, cuts: [] }

  // 每行的「单位时长」：totalTime / count（count=1 但 totalTime 是聚合量的行，如飞光当量，
  // 也能正确处理）；count=0 的行（纯时间聚合）按整行一个单位处理。
  const units = executions.filter(isTruncatable).map(e => {
    const t = e.totalTime ?? 0
    const perUnit = e.count > 0 ? t / e.count : t
    return { e, count: e.count, perUnit, frac: 0 }
  })
  let remaining = room
  // ① 按比例 floor
  const scale = room > 0 ? room / used : 0
  for (const u of units) {
    const target = u.count * scale
    const keep = u.count > 0 ? Math.floor(target) : (target >= 0.5 ? 1 : 0)
    u.frac = u.count > 0 ? target - keep : 0
    u.count = keep
    remaining -= keep * u.perUnit
  }
  // ② 剩余时间按小数部分降序加回整次（装不下就停）
  // ⚠ 加回**不得越过原次数**（2026-09-19 R37 实测修正）：小数次数行（如 8.249 次）floor 到 8 后若再加回 1 次 = 9 > 8.249，
  // 截断后的计划反而比截断前多打 0.751 次、kept 虚高 1.9s，且该行既不在 cuts 里、cutSeconds 又被冲小 ⇒ 「Σ 逐行 cutSeconds == overflow」
  // 恒等式破（teamTimeSummary 曾把 0.244s 残差当量化噪声容忍；批 2-1 重折后 1431 队放大到 1.9s 才暴露根因）。
  // 小数余量本就装不下一整次，按整数装包纪律留在 cut 里如实上报。
  const order = units.map((_u, i) => i).sort((a, b) => units[b].frac - units[a].frac)
  let cursor = 0
  while (cursor < order.length) {
    const u = units[order[cursor]]
    if (u.count + 1 <= u.e.count + 1e-9 && u.perUnit <= remaining + 1e-9) {
      u.count += 1
      remaining -= u.perUnit
      cursor = 0
    } else {
      cursor += 1
    }
  }

  const idx = new Map<SkillExecution, number>()
  let k = 0
  for (const e of executions) if (isTruncatable(e)) idx.set(e, k++)
  const req = (v: number | undefined, r: number) => (typeof v === 'number' ? v * r : 0)
  const opt = (v: number | undefined, r: number) => (typeof v === 'number' ? v * r : v)
  const out = executions.map(e => {
    if (!isTruncatable(e)) return e
    const u = units[idx.get(e)!]
    if (u.count === u.e.count) return e
    const ratio = u.e.count > 0 ? u.count / u.e.count : 0
    if (u.count === 0) return null // 整行不再发生
    return {
      ...e,
      count: u.count,
      totalTime: u.count * u.perUnit,
      totalComboAlignTime: req(e.totalComboAlignTime, ratio),
      totalEnergyConsume: req(e.totalEnergyConsume, ratio),
      totalDecibelRecovery: req(e.totalDecibelRecovery, ratio),
      totalEnergyRecovery: req(e.totalEnergyRecovery, ratio),
      totalAnomalyBuildUp: opt(e.totalAnomalyBuildUp, ratio),
      totalSpecialResourceRecovery: opt(e.totalSpecialResourceRecovery, ratio),
      totalHealingAmount: opt(e.totalHealingAmount, ratio),
      truncatedRatio: ratio,
    }
  }).filter((e): e is SkillExecution => e !== null)
  // 逐行截断明细（Σ cutSeconds == used − kept）：资源池「被砍招式」清单 + 难度轴交互缩放的输入
  // （用户 2026-09-11：截断只报总量时，界面看不出砍了什么、交互还按全量计）。整行砍到 0 的也记。
  const cuts: Omit<TruncationCut, 'slot'>[] = units
    .filter(u => u.e.count > 0 && u.count < u.e.count)
    .map(u => {
      const ratio = u.count / u.e.count
      return {
        moveId: u.e.moveId,
        moveName: u.e.moveName ?? u.e.moveId,
        countBefore: u.e.count,
        countAfter: u.count,
        cutSeconds: (u.e.count - u.count) * u.perUnit,
        cutEnergyRecovery: (u.e.totalEnergyRecovery ?? 0) * (1 - ratio),
        cutDecibelRecovery: (u.e.totalDecibelRecovery ?? 0) * (1 - ratio),
      }
    })
  let kept = 0
  for (const e of out) if (isTruncatable(e)) kept += e.totalTime ?? 0
  return { executions: out, cutSeconds: Math.max(0, used - kept), usedSeconds: used, cuts }
}
