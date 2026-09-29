/**
 * 外层收敛的反馈快照与二周期判据。
 *
 * 签名必须从本轮输出即时生成，不能跨轮保存一个待更新的“当前值”。
 * stable 比相邻轮；二周期比 k 与 k-2。签名历史只在本轮判定之后追加。
 * 这是既有监测量的显式投影，不是全部 CalcRoundThreads 的序列化；新增独立反馈需补判据。
 * 例外（CC-314）：模块下一轮反馈字典 `moduleFeedback` 整体入签名（键排序），模块新增键不必再改这里。
 */
import type { CalcRoundResult } from './convergence'
import { giftedPolarAssaultOf } from './giftedPolarAssault'

export function outerFeedbackSignature(out: CalcRoundResult): string {
  const chars = out.resourceResult?.characters ?? []
  return [
    // 连续终结次数允许量化收敛，避免小数尾数让 stable 永远不成立。
    chars.map(c => (c.ultimateCount ?? 0).toFixed(3)).join(','),
    (out.anomalyPool?.perSlotBonus ?? []).map(v => Math.round(v)).join(','),
    `${out.interactionTopUp?.parry},${out.interactionTopUp?.dual}`,
    out.parrySplit ? `${out.parrySplit.breakerParry},${out.parrySplit.mainDpsParry}` : '',
    `${out.threadsNext.decibelParry ?? 0}`,
    JSON.stringify(out.threadsNext.backstageAuto ?? {}),
    // 保底填充依赖积蓄分数；只比较 floor 后的失衡次数会提前停止。
    out.stunPool ? (out.stunPool.totalStunBuildUp / out.stunPool.bossStunValue).toFixed(2) : '',
    // 剑仪反馈可能只改变执行行而不改变终结次数，必须独立监测。
    // CC-38b：经模块能力 giftedPolarAssaultCount 派发（无此能力的角色记 0，与原字段缺省同形）。
    chars.map(giftedPolarAssaultOf).join(','),
    // CC-194：postRound 注入（下一轮生效）读全队强特次数——强特变化而终结不变时也须再跑一轮。
    (out.threadsNext.postRoundInput?.exCounts ?? []).map(v => v.toFixed(3)).join(','),
    // CC-314：模块反馈字典整体入签名。CC-31 起模块加反馈键「编排层零改动」，但签名看不到字典 ⇒
    // 若新键不是上面各项的函数，stable 会在它收敛前停下。实测现有 14 个键在全部停点已与输入相等（零差）。
    moduleFeedbackSignature(out.threadsNext.moduleFeedback),
  ].join('|')
}

/** 键排序后序列化（写入顺序不同不应判为变化）；缺键 = 0 与缺省同义，故跳过 0 / 非有限值。 */
export function moduleFeedbackSignature(mf: Readonly<Record<string, unknown>> | undefined): string {
  if (!mf) return ''
  return Object.keys(mf).sort()
    .filter(k => { const v = Number(mf[k]); return Number.isFinite(v) && v !== 0 })
    .map(k => `${k}:${Number(mf[k])}`).join(',')
}

export interface OuterTwoCycleInput {
  /** 上一轮的输入 x[k-1]；首轮为 null。 */
  previousInput: number | null
  currentInput: number
  nextInput: number
  currentSignature: string
  /** 只含已经完成的轮次：末项是 k-1，不含当前 k。 */
  signatureHistory: readonly string[]
  tolerance: number
}

/**
 * 失衡值回到上一轮输入附近，且反馈回到同相位（lag=2），才接受二周期。
 * 相邻失衡值已在容差内时留给 stable 判据，不能把趋稳序列误报为 cycle。
 * 不按截断量拒绝周期：结构性超预算与是否成环是两个不同的判断。
 */
export function isOuterTwoCycle(input: OuterTwoCycleInput): boolean {
  const { previousInput, currentInput, nextInput, currentSignature, signatureHistory, tolerance } = input
  return previousInput !== null
    && signatureHistory.length >= 2
    && currentSignature === signatureHistory[signatureHistory.length - 2]
    && Math.abs(nextInput - previousInput) < tolerance
    && Math.abs(nextInput - currentInput) >= tolerance
}

/** 环内停点选点的输入成员：只带选点需要的四个量（失衡输入/输出、离散截断、时间自洽度）。 */
export interface OuterCyclePickMember {
  /**
   * CC-153（第 176 轮）：physical 计数下「池 ≥ 读入」为可行；`false` = 不可行（引擎按读入 K 分配了 K 个窗，池却撑不住）。
   * 缺省（undefined）视为可行 ⇒ 非 physical 调用方不传即零影响。判据见 pickOuterCycleMember ⓪″。
   */
  feasible?: boolean
  /**
   * CC-153：physical 下成员实际的失衡窗数 = 读入的物理次数 K（引擎按 K 分配窗口），⓪ 零窗判据用它而不是规划值 `stunIn`
   * （实测 auto-1401-1511-1411：可行成员读入 2 次、规划 stunIn 0.015 被 ⓪ 误判零窗剔除）。缺省 = 用 `stunIn`（非 physical 零影响）。
   */
  windowsIn?: number
  /** 该轮输入的失衡次数（环内映射的自变量）。 */
  stunIn: number
  /** 该轮输出的失衡次数（= 下一轮输入）。 */
  next: number
  /** 离散自洽度：终局整数化后的装配截断秒数（装不下 = 大）。 */
  disc: number
  /** 时间自洽度：|预算 − Σ物化净占用| + 截断秒数；无结果成员由调用方给 `+Infinity`。 */
  time: number
}

/** 选点容差：`stun` 与判稳/判环同源，`disc`/`time` 分别对应两条同级门槛。 */
export interface OuterCyclePickTolerance {
  stun: number
  disc: number
  time: number
}

export interface OuterCyclePickResult {
  /** 选中成员在**入参数组**中的下标（不是过滤后候选数组的下标）。 */
  index: number
  /** 选中成员不是最后一轮（被过滤或被更优者顶替）时为 true。 */
  pickedEarlier: boolean
}

/**
 * 环内停点选点（从 `useResourceCalc#pickCanonical` 抽出的纯函数，逐位零 delta）。
 *
 * 判据按序（规则来历与实测反例见 `useResourceCalc` 内 `pickCanonical` 的长注释）：
 *   ⓪ **零窗成员不参选**：`stunIn >= tol.stun` 的为带窗成员；有带窗成员时只在带窗成员里选
 *      （过滤掉任何成员即 `pickedEarlier = true`），全员零窗（真 0 失衡队）则全体参选。
 *      physical 下「窗数」取 `windowsIn`（读入的物理次数 K；CC-153），缺省取 `stunIn`。
 *   ⓪″ **不可行成员不参选**（CC-153，第 176 轮，CC-150 残差的对称侧）：`feasible === false` 的成员（physical 下池 < 读入）
 *      在还有可行成员时剔除（同样计入 `pickedEarlier`）；全员不可行则照旧参选。实测 yixuan-trigger-lucia 读入 4 → 池 3
 *      被选中 ⇒ 资源行连携 4、池 / 轴栈 3（同源破）。回退：删本级过滤。
 *   以下各级都是「相对当前池内最优」的筛选（CC-136 起；此前为带容差的两两比较，不传递、依赖成员排列）：
 *   ① **失衡自洽度** `|next − stunIn|`：保留 ≤ 池内最小值 + tol.stun 的成员（容差与判稳/判环同源）。
 *   ⓪′ **离散自洽度**：再保留截断秒数 ≤ 最小值 + tol.disc 的成员。
 *   ② **时间自洽度**：再保留 ≤ 最小值 + tol.time 的成员（2s 以内视为同级）。
 *   ③′ **输入失衡次数小者**（CC-136，第 160 轮）：再保留 `stunIn` ≤ 最小值 + tol.stun 的成员。
 *      为什么：2-循环两成员在 ① 上恒相等、② 又常落在 2s 同级容差内，旧 ③「取最后一轮」让结果取决于
 *      **循环在第几轮被识别**（奇偶性）——扫描实测 auto-1201-1481-1211/c6 在琉音转模系数 1.90..2.10 的 41 个点上，
 *      38 个点落 3 轮 / 规划失衡 0.70，3 个孤立点（1.91 / 1.955 / 2.0）落 4 轮 / 1.1186，总伤差 +5.34%。
 *      ③′ 只看成员自身的输入、筛选是全序 ⇒ 同一个环（不论从哪个相位检出）永远选同一个成员。
 *      取「小」= 不高估失衡收益（与 CC-134 floor 同向的保守口径）。
 *      详见 docs/mcp-outer-fixedpoint-continuity.md。回退：换回两两比较循环（git show 0028eb01:本文件）。
 *   ③ 仍同级（如只有反馈签名在交替的周期）取池内最后一轮（与旧行为一致）。
 *
 * `disc`/`time` 允许为 `+Infinity`（无结果成员）：有有限值成员时 Infinity 自然被筛掉；
 * 全员 Infinity 时 `Infinity <= Infinity + t` 为真 ⇒ 全员保留、该维度不分高下（与旧语义一致）。
 */
export function pickOuterCycleMember(
  members: readonly OuterCyclePickMember[],
  tol: OuterCyclePickTolerance,
): OuterCyclePickResult {
  const candidateIdx: number[] = []
  for (let i = 0; i < members.length; i++) {
    if ((members[i].windowsIn ?? members[i].stunIn) >= tol.stun) candidateIdx.push(i)
  }
  const idx0 = candidateIdx.length > 0 ? candidateIdx : members.map((_, i) => i)
  // ⓪″ CC-153：physical 不可行成员不参选（有可行成员时）
  const feasibleIdx = idx0.filter(i => members[i].feasible !== false)
  const idx = feasibleIdx.length > 0 ? feasibleIdx : idx0
  // CC-136：以「当前最优」为基准逐级筛选（全序，与成员排列/轮次相位无关），取代原两两比较
  // （带容差的两两比较不传递，结果随检出轮次的旋转而变）。回退：换回两两比较循环。
  let pool = idx
  const keep = (key: (m: OuterCyclePickMember) => number, t: number) => {
    const best = Math.min(...pool.map(i => key(members[i])))
    pool = pool.filter(i => key(members[i]) <= best + t)
  }
  keep(m => Math.abs(m.next - m.stunIn), tol.stun) // ① 失衡自洽
  keep(m => m.disc, tol.disc) // ⓪′ 离散自洽
  keep(m => m.time, tol.time) // ② 时间自洽
  keep(m => m.stunIn, tol.stun) // ③′ 输入失衡次数小者
  // ③ 仍同级：取最后一轮
  const bestIdx = pool[pool.length - 1]
  const pickedEarlier = idx.length < members.length || bestIdx !== idx[idx.length - 1]
  return { index: bestIdx, pickedEarlier }
}

/**
 * 周期 ≥3 的长环识别（从 `runOuterLoop` 耗尽后的 lag 双层循环抽出，逐位零 delta）。
 *
 * 判据 = 签名相等（同相位反馈）且同相位失衡输入在容差内；`lag` 从 3 起、命中第一个即返回。
 * 返回命中周期；无命中返回 `null`。周期 2 的轨迹会在 lag=4 命中（lag 从 3 起的既有行为）：
 * 失衡值振荡的 2-循环由 `isOuterTwoCycle` 在迭代中先行接住；**失衡值恒定、只有反馈签名在两态间
 * 交替**的 2-周期它不接（要求相邻失衡值差 ≥ 容差），会耗尽迭代后走到这里——实测样本：叶瞬光 +
 * 琉音 + 照 轴退化后 interactionScale 0.25 档的 4 成员环（2026-09-24 探针，见 outerCycle.test.ts 语料表）。
 */
export function findOuterLongCycleLag(
  sigHistory: readonly string[],
  stunHistory: readonly number[],
  tolerance: number,
): number | null {
  for (let lag = 3; lag < sigHistory.length; lag++) {
    for (let k = lag; k < sigHistory.length; k++) {
      if (sigHistory[k] !== sigHistory[k - lag]) continue
      if (Math.abs(stunHistory[k] - stunHistory[k - lag]) >= tolerance) continue
      return lag
    }
  }
  return null
}
