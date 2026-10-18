/**
 * **交互扫描**（Interaction Sweep）：逐点抬高某一类交互次数，把每一步「变了什么」如实列出来。
 *
 * ## 为什么需要它（用户口径 2026-10-18）
 *
 * > 「你问的是交互提升为什么伤害降低是吧？我建议做一个**单独页面**，
 * >   **分别计算交互上升的每一点变化了什么**。」
 *
 * 起因：难度曲线上 `banyue-liuyin-lucia` 从 ① 全 0 交互 → ② 角色基准（31 次）**伤害反而降了**
 * （74.46M → 59.31M）。曲线只给两个点，看不出中间发生了什么；而这条链上至少有三个耦合：
 * 交互 → 失衡次数 → 好评/资源 → **轴预设的窗分配（`goodReviewOverflow` 会换轴）** → 伤害。
 *
 * ⇒ 本模块把「交互次数」当**单一自变量**逐格扫（每格 +step 次），每格采一份完整快照：
 * 伤害 / 轴态 / 失衡次数 / 逐槽资源 / 伤害按来源分组 / 关键次数 / 时间账。
 * 相邻两格做差 = 「这一次加交互，到底换来了什么、又挤掉了什么」。
 *
 * ## 与难度曲线的关系（别混）
 *
 * - **难度曲线**回答「这支队的难度-伤害形状」（x = 综合操作难度，含时间压力）；
 * - **本扫描**回答「把交互这一个旋钮拧一格，发生了什么」（x = 纯交互次数，其它全不动）。
 * 前者是产品视图，后者是**诊断视图**——所以单开一页，不塞进曲线。
 *
 * ## 口径（改这里前先读）
 *
 * - **基线** = 用户当前配置（不是难度曲线的「全关」）：本页是诊断工具，要看的是「在我这队上，
 *   加交互会怎样」，所以起点 = 现场；
 * - **只动交互**：时间权重 / 金数 / 配装 / 合轴率全部保持基线值（`absorb` 也**不动**——
 *   难度曲线里 ④ 会拉满吸收，那会把两个旋钮混在一起）；
 * - **逐类型独立扫**：`parryCount` / `dodgeCounterCount` / `blockCount` / `dualCounterCount`
 *   各扫一条，**不叠加**（叠加就分不清是哪一类的贡献）；
 * - **每格都从基线重放**（写回基线后再写该格的值），不累积——否则上一格的残留会污染下一格。
 */
import type { AnalysisContext } from '@/composables/analysisScenario'
import { batchReporter, isBatchAborted, type BatchTaskOptions } from '@/composables/batchTask'
import { captureKeyCounts } from '@/composables/difficultyCurve'
import { axisStateOf, axisKindLabel, type AxisState } from '@/composables/difficultyAxis'
import { frontlineOccupationBreakdown } from '@/core/resource/timeOccupation'
import type { TeamPreset } from '@/types/teamPreset'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

/** 可扫的交互类型（键 = `config.team[slot]` 上的字段名） */
export const SWEEP_INTERACTION_KEYS = [
  'parryCount',
  'dodgeCounterCount',
  'blockCount',
  'dualCounterCount',
] as const
export type SweepInteractionKey = typeof SWEEP_INTERACTION_KEYS[number]

/** 交互类型的中文标签（UI 列头 / tooltip 共用） */
export const SWEEP_INTERACTION_LABEL: Record<SweepInteractionKey, string> = {
  parryCount: '弹刀',
  dodgeCounterCount: '闪避反击',
  blockCount: '格挡',
  dualCounterCount: '双反',
}
/** 一格（某个交互类型 = 某个次数）的完整快照 */
export interface SweepStep {
  /** 本格设置的总次数（三槽同值；槽位 2 常是辅助，其交互默认 0） */
  count: number
  /** 队伍总伤害 */
  dmg: number
  /** 轴态（唯一事实源 = `axisStateOf`） */
  axis: AxisState
  /** 轴态中文短标签（UI 直接显示，不各写一套） */
  axisLabel: string
  /** 失衡次数 */
  stunCount: number
  /** 关键次数快照（大招 / 强特 / 连携 / 失衡 / 异常触发 / 紊乱 / 乱流 + 角色专属行） */
  counts: Record<string, number>
  /** 伤害按来源分组（Σ ≡ 本格总伤害） */
  dmgBySource: Record<string, number>
  /** 逐槽资源（按身份取，不按下标） */
  slots: SweepSlotSnapshot[]
  /** 时间账：毛前台 / 轴内合轴 / 招式合轴抵扣 / 净占用 / 节省 */
  time: SweepTimeSnapshot
}

export interface SweepSlotSnapshot {
  slot: number
  agentId: string
  /** 该槽实打交互总数（四类相加） */
  interactions: number
  /** 喧响总量 */
  decibel: number
  /** 闪能/能量总量 */
  energy: number
  /** 前台时间 */
  frontline: number
  /** 平A时间 */
  basic: number
}

export interface SweepTimeSnapshot {
  grossFrontline: number
  axisOverlap: number
  creditApplied: number
  net: number
  saved: number
  /** 硬溢出秒数（引擎 `overflowSeconds`） */
  overflow: number
}

/** 一条扫描线（一个交互类型 = 一条） */
export interface SweepSeries {
  key: SweepInteractionKey
  label: string
  /** 起点次数（= 基线现场里三槽该字段的最大值，扫描从它开始） */
  from: number
  steps: SweepStep[]
  /** 最优格（伤害最高的那一格） */
  best: SweepStep
  /** 起点格 */
  base: SweepStep
  /** 伤害从起点到最优的变化（负 = 加交互反而掉伤害） */
  gainAtBest: number
}

export interface SweepResult {
  presetId: string
  presetName: string
  bossName: string
  phaseLabel: string
  series: SweepSeries[]
  /** 求值次数（诊断：告诉用户这个扫描花了多少次全队求值） */
  evaluations: number
  /** 是否跑完（false = 用户中途取消，`series` 只含已算部分） */
  complete: boolean
}

/** 复用仓库统一的批任务选项（进度载荷 `{pct,text}` + 取消信号），不另造一套 */
export interface SweepOptions extends BatchTaskOptions {
  preset: TeamPreset
  boss: BossPreset
  phase: BossPresetPhase
  /** 每个交互类型扫到多少次（缺省 20） */
  maxCount?: number
  /** 步长（缺省 1） */
  step?: number
  /** 只扫这些类型（缺省全部） */
  keys?: readonly SweepInteractionKey[]
}
/** 采一格快照（全部字段读**同一份**求值结果，避免与档位错配） */
function captureStep(ctx: AnalysisContext, count: number): SweepStep {
  const rr = ctx.calc.resourceResult.value
  const time = rr ? frontlineOccupationBreakdown(rr) : null
  const axis = axisStateOf(ctx.calc)
  const dmgBySource: Record<string, number> = {}
  for (const row of ctx.calc.damagePoolRows.value) {
    const key = row.type === '直伤' ? (row.name || row.source || '直伤') : row.type
    dmgBySource[key] = (dmgBySource[key] ?? 0) + (row.totalDamage || 0)
  }
  const names = ctx.calc.agentNames.value
  const slots: SweepSlotSnapshot[] = []
  for (let slot = 0; slot < 3; slot++) {
    const agentId = ctx.config.team[slot]?.agentId
    if (!agentId) continue
    // ⚠ 按身份取（`characters` 按位置压缩 ⇒ 下标 ≠ 槽位号）
    const c = rr?.characters.find(x => x.slot === slot)
    if (!c) continue
    slots.push({
      slot,
      agentId: names[agentId] || agentId,
      interactions: interactionsOfSlot(ctx, slot),
      decibel: c.decibelSource.total,
      energy: c.energySource.total,
      frontline: c.timeAllocation.frontlineTime,
      basic: c.timeAllocation.basicAttackTime,
    })
  }
  return {
    count,
    dmg: ctx.calc.teamTotalDamage.value,
    axis,
    axisLabel: axisKindLabel(axis),
    stunCount: ctx.calc.stunPoolResult.value?.stunCount ?? 0,
    counts: captureKeyCounts(ctx.calc),
    dmgBySource,
    slots,
    time: {
      grossFrontline: time?.grossFrontline ?? 0,
      axisOverlap: time?.axisOverlap ?? 0,
      creditApplied: time?.creditApplied ?? 0,
      net: time?.net ?? 0,
      saved: time?.saved ?? 0,
      overflow: rr?.overflowSeconds ?? 0,
    },
  }
}

/** 某槽当前交互总数（四类相加） */
function interactionsOfSlot(ctx: AnalysisContext, slot: number): number {
  const row = ctx.config.team[slot] as unknown as Record<string, number | undefined> | undefined
  return SWEEP_INTERACTION_KEYS.reduce((a, k) => a + (row?.[k] ?? 0), 0)
}

/** 读某槽某交互类型的当前值 */
function readKey(ctx: AnalysisContext, slot: number, key: SweepInteractionKey): number {
  const row = ctx.config.team[slot] as unknown as Record<string, number | undefined> | undefined
  return row?.[key] ?? 0
}
/** 让出主线程一拍（宏任务）：每次求值约 0.3~0.5s，不让出 ⇒ 页面整段时间点不动 = 「卡死」 */
const yieldToMacrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * 跑一次交互扫描（**异步分片**，调用方负责在独立场景里调用，见 `analysisScenario#withAnalysisScenario`）。
 *
 * ## 为什么是 async（2026-10-19 修「点进页面就卡死」）
 *
 * 一次扫描 = 4 类 × 20 格 ≈ 80 次全队求值 ≈ **30~40s**。原先写成同步函数 ⇒ 主线程被独占
 * 整段时间，Vue 渲染、点击、滚动全部停摆，用户看到的就是「卡死」（不是崩溃，是**没有响应**）。
 * 现在每算一格 `await` 一次宏任务：浏览器有机会重绘进度条、响应「取消」。
 * 口径与 `composables/impactSampling.ts#sampleImpactSurface` 一致（那里早就是这么做的）。
 *
 * ⚠ **每格都从基线重放**：先把该类型在三槽的基线值记下，每格先写回基线、再写本格值。
 * 不做的话上一格的值会残留（`setActionCount` 是覆盖写，但「哪些槽被扫过」会跨格泄漏）。
 *
 * 被取消时返回**已算部分**（`complete: false`），调用方据此决定展不展示——与采样器同语义。
 */
export async function runInteractionSweep(ctx: AnalysisContext, options: SweepOptions): Promise<SweepResult> {
  const maxCount = Math.max(1, Math.trunc(options.maxCount ?? 20))
  const step = Math.max(1, Math.trunc(options.step ?? 1))
  /**
   * **默认只扫「本队真的有」的交互类型**（用户口径 2026-10-18：「金身格挡和般岳双反本来就是只有般岳才能打，
   * 我主页都隐藏了没让改」）。
   *
   * 判据 = 三槽里该字段的**基线值**：全 0 ⇒ 这支队的角色根本不打这种交互（般岳以外没有金身/双反），
   * 扫它只会得到一条「加 20 次伤害纹丝不动」的假线，既占版面又误导。
   * ⚠ 与主页「战斗动作次数」的隐藏口径同源：那里也是按角色 `interactionDefaults` 决定显不显示该输入框。
   */
  const requested = options.keys ?? SWEEP_INTERACTION_KEYS
  const keys = options.keys !== undefined
    ? requested
    : requested.filter(key => [0, 1, 2].some(slot => readKey(ctx, slot, key) > 0))
  let evaluations = 0
  const report = batchReporter(options)
  /**
   * 总格数（进度条分母）。按「每类从起点到上界」先数一遍：
   * 起点来自现场基线，所以只能在这里算，不能写死 maxCount。
   */
  const totalCells = keys.reduce((sum, key) => {
    const base = [0, 1, 2].map(slot => readKey(ctx, slot, key))
    const from = Math.max(0, ...base)
    return sum + Math.floor((Math.max(from + step, maxCount) - from) / step) + 1
  }, 0)

  /** 提前结束（取消）时统一出口：还原基线由各分支自己保证，这里只补 complete 标记 */
  const finish = (complete: boolean): SweepResult => ({
    presetId: options.preset.id,
    presetName: options.preset.name,
    bossName: options.boss.name,
    phaseLabel: options.phase.label,
    series,
    evaluations,
    complete,
  })

  /** 基线值（三槽 × 该类型），扫完必须还原 */
  const baseline = new Map<SweepInteractionKey, number[]>()
  for (const key of keys) {
    baseline.set(key, [0, 1, 2].map(slot => readKey(ctx, slot, key)))
  }

  const series: SweepSeries[] = []
  for (const key of keys) {
    const base = baseline.get(key)!
    /** 起点 = 三槽该字段的最大值（通常只有主C/击破位有值） */
    const from = Math.max(0, ...base)
    const steps: SweepStep[] = []
    /**
     * ⚠ **扫描上界必须 ≥ 起点**（2026-10-18 修）：般岳闪反基线 = 10，页面缺省 `maxCount = 20` 没问题；
     * 但单测/诊断常传 `maxCount = 8` ⇒ `from(10) > maxCount(8)` ⇒ 循环一格都不进 ⇒
     * `steps.length === 0` ⇒ 该类型被静默丢弃（实测「闪避反击 / 格挡」两条线整条消失）。
     * 修法 = 上界取 `max(from + step, maxCount)`：起点已超请求上界时，至少给出「起点 → 起点+step」两格
     * （诊断要看的是趋势，不是绝对上界）。
     */
    const upper = Math.max(from + step, maxCount)
    for (let count = from; count <= upper; count += step) {
      if (isBatchAborted(options.control)) return finish(false)
      // 每格从基线重放：先写回基线值，再覆盖本格值
      for (let slot = 0; slot < 3; slot++) ctx.config.setActionCount(slot, key, base[slot] ?? 0)
      // 本格值：只改「基线里非零的槽」+ 槽0（主C 恒有交互）；辅助槽恒 0 的不动，避免失真
      for (let slot = 0; slot < 3; slot++) {
        if ((base[slot] ?? 0) > 0 || slot === 0) ctx.config.setActionCount(slot, key, count)
      }
      steps.push(captureStep(ctx, count))
      evaluations++
      report(evaluations / totalCells, '交互扫描 ' + evaluations + '/' + totalCells + ' 格')
      // 让出主线程：浏览器才能重绘进度条、响应「取消」与页面切换
      await yieldToMacrotask()
    }
    // 还原基线
    for (let slot = 0; slot < 3; slot++) ctx.config.setActionCount(slot, key, base[slot] ?? 0)

    if (steps.length === 0) continue
    const first = steps[0]!
    let best = first
    for (const s of steps) if (s.dmg > best.dmg) best = s
    series.push({
      key,
      label: SWEEP_INTERACTION_LABEL[key],
      from,
      steps,
      best,
      base: first,
      gainAtBest: best.dmg - first.dmg,
    })
  }

  return finish(true)
}
