/**
 * **连续失衡：末窗「已开启但装不下整套轴」的兑现折算**（用户口径 2026-10-23）。
 *
 * ## 用户原话（逐字，本轮定口径）
 *
 * > 「在完整 n 失衡到完整 n+1 失衡期间，交互增加对伤害的提升遵循这个结论：
 * >   **先是慢慢增加**伤害（交互本身的伤害倍率增加，失衡倍率也增加但是完全没有达到新一次失衡所以没效果），
 * >   **到一定程度后开始快速增加**（交互本身的伤害和失衡达到临界，**开始兑现第 n+1 次失衡**），
 * >   最后达到**完整 n+1 次失衡后又回到慢慢增加**。其中**快速增加就是我说的连续失衡处理**。」
 *
 * ## 为什么需要它（现在的引擎是二值的）
 *
 * 引擎把「打几次失衡」表达成**整数窗数**：`floor(cont)`。于是「第 N+1 次失衡差一点点就能开」
 * 与「完全没开」在数值上**完全一样**（都按 N 次算）。实测（`auto-1611-1141-1211`，其余全钉死）：
 *
 * | 闪反次数 | 池次数 | cont | 覆盖率 | 伤害 |
 * |---|---|---|---|---|
 * | 18 | 5 | 5.958 | 44.4% | 64.161M |
 * | 19 | 6 | 6.440 | 53.3% | **73.429M** |
 *
 * ⇒ 一格之内 +9.268M（占全程 70.9%），中间**没有任何过渡**。用户要的「快速增加段」在图上是一条垂线。
 *
 * ## 物理口径（本模块只做这一件事）
 *
 * 失衡条在**窗外时间**里按速率 `ρ` 累积（窗内打的招式不攒条 —— 时间守恒，见
 * `effectiveTime#stunWindowFraction` 的 @fact）。第 k 窗**开启**的条件是攒满 k 条，
 * 因此开启时刻：
 *
 * ```
 * t_open(k) = k / ρ + (k − 1) × W        // 前 k−1 个窗各占 W 秒
 * ```
 *
 * 窗开启后**能兑现多少**取剩余时间 ÷ 窗长：
 *
 * ```
 * frac(k) = clamp((effTime − t_open(k)) / W, 0, 1)
 * ```
 *
 * - `t_open(k) ≥ effTime` ⇒ 这一窗**根本没开**（`frac = 0`）—— 与用户 2026-10-21 §33 的裁决一致：
 *   池 2.96 是「第 3 次**没开启**」，**不是**「打了一半」，不许折算易伤；
 * - `0 < frac < 1` ⇒ **开启了但打不完** —— 这正是本模块要兑现的「连续」段；
 * - `frac = 1` ⇒ 完整窗（与二值口径逐位相同）。
 *
 * ## 与「离散」的差别只出现在**开启之后**
 *
 * 关键点：`frac > 0` 的前提是**条已经攒满**（窗开了）。所以本模块**不会**把
 * 「条只有 95.8%」当成「95.8% 的窗」——那正是 2026-10-21 整条回退掉的错误方向
 * （见 `docs/STUN_CONTINUOUS_LASTWINDOW.md` §42）。
 *
 * ## 为什么 `builtWindows` 要由调用方给（线性化假设）
 *
 * 严格的不动点是 `K = N + frac(K)`，而 `cont` 本身随计划窗数变化（多排一窗 ⇒ 少 W 秒攒条）。
 * 本模块**不做**引擎往返：它取「按当前整数计划 N 实测到的 `builtWindows`」为锚，
 * 用 `ρ = builtWindows / 窗外时间` 作**局部线性化**。这是有意的近似（debt 见下），
 * 理由是：① `ρ` 对窗数的敏感度在单窗尺度上是二阶量；② 真正的不动点求解需要引擎重跑，
 * 属于编排层（`solveTeam`）的活，不是本纯函数该承担的。
 *
 * @fact engine:stun/连续失衡 口径: 末窗兑现 = **顺序物理推演**——第 k 窗在 `t_open(k) = (k−1)·W + k/ρ` 开启（`ρ = builtWindows / (effTime − plannedWindows·W)`，窗内不攒条）；`t_open+W ≤ eff` ⇒ 完整窗、`t_open < eff < t_open+W` ⇒ 末窗兑现 `(eff−t_open)/W`、`t_open ≥ eff` ⇒ **没开启 ⇒ 0**（用户 2026-10-21「没攒满 = 没开启 = 没有易伤」）；`planned` 先夹到 `floor(built)`（池排不出更多窗） | 据 用户@2026-10-23「完整n到完整n+1之间先慢增、到临界后快增、到完整n+1后又慢增；快增就是连续失衡处理」 | 验 src/core/__tests__/continuousStun.test.ts | 锚 src/core/continuousStun.ts#realizeStunWindows | 信 确认
 * ⟳复核: 若 kStar/池口径改成「计划值可以大于物理窗数」（放开 `physicalMax`），重核 `planned` 夹取与 band 的存在条件 | 到期 2027-04-30
 * @debt 线性化 ρ（不做 K = N + frac(K) 的引擎往返）；升级路径 = `solveTeam` 在 kStar 之后
 *       用本函数做 1~2 轮定点迭代（每次改 `stunCountLockOverride` 重跑一轮，成本 ≈ 1 次全队求值）。
 */
import { finiteOr0 } from '@/utils/finiteClamp'

/** 连续失衡的输入（全部是**已经算出来的**读数，本函数不读 store、不 import 引擎） */
export interface ContinuousStunInput {
  /** 当前整数计划窗数 N（= 引擎 `stunPoolResult.stunCount`，与轴栈排窗依据同源） */
  plannedWindows: number
  /** 该计划下**攒出来的**窗数（= `continuousStunCount(pool)`，可带小数） */
  builtWindows: number
  /** 名义窗长 W（秒，含全队失衡延时） */
  windowDuration: number
  /** 有效战斗时间（秒）= 战斗时间 − 无敌时间 */
  effectiveTime: number
}

/** 分解结果 */
export interface ContinuousStunResult {
  /** 完整兑现的窗数（每一窗都是满 W 秒） */
  completeWindows: number
  /**
   * **末窗兑现比例** ∈ [0, 1)。
   * `0` = 第 `completeWindows + 1` 窗没开启（或刚好卡在结束时刻），此时本模块与二值口径**逐位相同**。
   */
  lastFraction: number
  /** 连续窗数 = `completeWindows + lastFraction`（覆盖率分子用它：`× W / effTime`） */
  realizedWindows: number
  /** 本窗条累积速率（窗/秒，诊断用） */
  buildRate: number
  /** 第 `completeWindows + 1` 窗的开启时刻（秒；≥ effTime = 没开） */
  nextOpenAt: number
  /** 该计划下**攒出来的**窗数（原样透传，便于面板诊断） */
  builtWindows: number
}

/**
 * 把「整数计划 + 攒条量」折成**连续兑现的窗数**。
 *
 * 语义见文件头。三条不变量（判据测试逐条钉住）：
 * ① **不越界**：`completeWindows + lastFraction ≤ builtWindows + 1e-9`
 *    —— 兑现不可能多于「攒出来的 + 正在开的这一窗」；
 * ② **不回退**：`builtWindows` 取整覆盖完 `plannedWindows` 时 `lastFraction = 0`
 *    —— 保证「已经完整的窗」不被折算削掉；
 * ③ **单调**：`builtWindows` ↑ ⇒ `realizedWindows` 不减。
 */
export function realizeStunWindows(input: ContinuousStunInput): ContinuousStunResult {
  const W = Math.max(0, finiteOr0(input.windowDuration))
  const effTime = Math.max(0, finiteOr0(input.effectiveTime))
  const built = Math.max(0, finiteOr0(input.builtWindows))
  const planned = Math.max(0, Math.floor(finiteOr0(input.plannedWindows)))
  const base: ContinuousStunResult = {
    completeWindows: 0, lastFraction: 0, realizedWindows: 0,
    buildRate: 0, nextOpenAt: Number.POSITIVE_INFINITY, builtWindows: built,
  }
  if (W <= 0 || effTime <= 0 || built <= 0) return base

  /**
   * **攒条速率 ρ（窗/秒）**：`builtWindows` 是「按 `plannedWindows` 个窗占用战斗时间」这一前提下
   * 由池模型算出的读数（`stunWindowFraction` 扣的正是 `stunCount × W`）⇒ 以它为分母才是同一把尺。
   *
   * ⚠ 分母**必须是 `planned`**，不能是 `effTime`：窗开着的时候不攒条（时间守恒）。
   */
  /**
   * ⚠ **`planned` 物理上不可能超过 `floor(built)`**：池只攒得出 `built` 窗，排不出更多。
   * 越界输入（如 `planned=8 / built=0.3`）按下限夹住 —— 不夹会让 `ρ` 的分母（扣掉 8 窗占时）
   * 小到失真，反而算出 `realized > built` 这种越界结果。
   */
  const plannedEff = Math.min(planned, Math.floor(built + 1e-9))
  const outside = effTime - plannedEff * W
  if (outside <= 0) return { ...base, completeWindows: plannedEff, realizedWindows: plannedEff }
  const buildRate = built / outside
  if (!(buildRate > 0)) return base

  /**
   * **顺序推演**（物理过程，不是闭式）：第 k 窗在 `t_open(k) = (k−1)·W + k/ρ` 开启
   * ——前面 k−1 窗各占 W 秒，窗外时间以 ρ 攒条。
   *
   * - `t_open(k) + W ≤ effTime` ⇒ **完整窗**，继续判下一窗；
   * - `t_open(k) < effTime < t_open(k) + W` ⇒ **开启了但打不完**（本模块要兑现的「快增段」）；
   * - `t_open(k) ≥ effTime` ⇒ **没开启** ⇒ 停，`lastFraction = 0`。
   *
   * ⚠ 循环上界 `floor(built)+2`：池只攒得出 `built` 窗，再往后不可能开。
   */
  let complete = 0
  let lastFrac = 0
  let nextOpenAt = Number.POSITIVE_INFINITY
  for (let k = 1; k <= Math.floor(built) + 2; k++) {
    const tOpen = (k - 1) * W + k / buildRate
    if (tOpen >= effTime) { nextOpenAt = tOpen; break }
    if (tOpen + W <= effTime) { complete = k; continue }
    lastFrac = (effTime - tOpen) / W
    nextOpenAt = tOpen
    break
  }
  const EPS = 1e-9
  const frac = lastFrac >= 1 - EPS || lastFrac < EPS ? 0 : lastFrac
  return {
    completeWindows: complete,
    lastFraction: frac,
    realizedWindows: complete + frac,
    buildRate,
    nextOpenAt,
    builtWindows: built,
  }
}
