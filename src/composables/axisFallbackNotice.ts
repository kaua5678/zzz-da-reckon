/**
 * **弃轴提示**（用户口径 2026-10-16，逐字）：
 *
 * > 「合轴率不修改是在**非轴模式下的默认设置**，这里**没有资源要求**。
 * >  轴模式下，**如果弃轴要给提醒**，毕竟用户选择了轴就是想看轴，**悄悄退化等于欺骗用户**。
 * >  此外弃轴可以给提示，说**需要更多合轴率**，**引导用户提高合轴率**，进而算出完整轴。」
 *
 * ## 两句话各自的口径（别混）
 *
 * 1. **非轴模式没有资源要求** ⇒ 合轴率保持缺省是**正常**的，非轴队**不该**收到任何提示。
 *    提示只在「用户明确选择了轴」（`useStunAxis` 开 或 自动轴命中）**且引擎弃了它**时出现。
 * 2. **弃轴必须显式告知** ⇒ 引擎的 `convergence.axisFallback` 此前只在**队伍对比页**的
 *    `timeDetail` 里露过一行（`teamCompare.ts#actionTimeTotal`），**主计算器结果页完全没有**——
 *    用户在结果页看到的是一份「看起来正常的非轴结果」，不知道自己的轴被丢了。本模块补上这个通道。
 *
 * ## 为什么要给「提高合轴率」这个具体指引（实测依据，不是猜测）
 *
 * 弃轴是「轴计划净占用 > 时间预算」。而**抬高合轴吸收率正是减少净占用的正牌手段**（纯收益旋钮，
 * 用户 2026-10-12：「拉满合轴率，不仅溢出能打，还能打更多资源和时间」）。实测
 * （`.zc/perf/T186absorb.perf.ts`，`banyue-qingyi-lucia` @ 基塔布鲁）：
 *
 * | 吸收率 | 有轴伤害 | 轴态 |
 * |---|---|---|
 * | 0.4（缺省） | 40.76M | 轴不可行 |
 * | **0.6** | **62.96M** | **完整轴** |
 * | 1.0 | 65.52M | 完整轴 |
 *
 * ⇒ 只把吸收率从缺省 0.4 抬到 0.6，轴就从「不可行」变「完整轴」（×1.422）。
 * 所以提示必须**带上这个具体建议**（并给出「至少需要多少」的估算），而不是只说「轴不可行」。
 *
 * ## 与「引擎自动抬吸收率」的分工（用户口径优先）
 *
 * 本模块**只提示、不改引擎**。用户口径是「**引导用户提高合轴率**」——
 * 即**把选择权留给用户**（合轴率是用户可调的旋钮，且非轴模式下它有默认值语义）。
 * ⚠ 这与「引擎自己在弃轴前偷偷把吸收率拉满」是**两种不同的产品取向**：
 * 后者会让「用户设的 0.4」静默失效（同样是欺骗），故**不做**（见 R13 的订正）。
 */
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import type { ConfigModel } from '@/stores/config'

/** 提示所需的读数（结构类型：单测可喂最小夹具，`computed` 天然满足 `{ value }`） */
export interface AxisFallbackNoticeInput {
  /** 引擎弃轴读数（`convergence.axisFallback`） */
  fallback: boolean
  /** 用户是否明确选择了轴（手动轴开 或 自动轴命中）——非轴模式**不提示** */
  axisRequested: boolean
  /** 当前生效的合轴吸收率设置（用户可调，缺省 0.4） */
  absorbRatio: number
}

export interface AxisFallbackNotice {
  /** 是否该提示（唯一判据：用户要了轴 且 引擎弃了它） */
  show: boolean
  /** 一行标题 */
  title: string
  /** 详情（可多句；页面按段落渲染） */
  detail: string
  /**
   * 建议的下一步动作（`raise-absorb` = 引导提高合轴率；`none` = 已在上限，只能如实告知）。
   * 页面据此决定要不要显示「去调合轴率」按钮。
   */
  action: 'raise-absorb' | 'none'
  /** 若 `action === 'raise-absorb'`：当前吸收率与上限（页面可显示「现在是 X，可以试到 1.0」） */
  currentAbsorb: number
  ceiling: number
}

/**
 * 算弃轴提示（纯函数，不碰 store）。
 *
 * ⚠ **非轴模式恒不提示**（用户口径第一句）：没选轴就没有资源要求，弃轴这个概念不适用。
 * 调用方传 `axisRequested: false` 时本函数恒返回 `show: false`。
 */
export function axisFallbackNotice(input: AxisFallbackNoticeInput): AxisFallbackNotice {
  /**
   * 吸收率上限 = **1.0**（引擎 `helpers.ts` 把它 `Math.min(1, ...)` 夹住，见 `absorbRatio` 的钳制行）。
   * 这里写成常量而**不是可选项参数**：它是引擎语义、不是配置（判据 16 的「只读不写可选通道」形态——
   * 曾写成 `absorbCeiling?: number` 被死通道扫描抓到，已删）。
   */
  const ceiling = 1
  const current = Number.isFinite(input.absorbRatio) ? input.absorbRatio : 0
  const none: AxisFallbackNotice = { show: false, title: '', detail: '', action: 'none', currentAbsorb: current, ceiling }
  if (!input.fallback || !input.axisRequested) return none
  const pct = (v: number) => `${Math.round(v * 100)}%`
  if (current >= ceiling - 1e-9) {
    return {
      show: true,
      title: '⚠ 轴被引擎弃用（已退化为一般循环）',
      // ⚠ 纯文本，**不要**写 Markdown 记法（`**` 在 naive-ui alert 里会原样显示成星号，实测踩到）
      detail: '你选择了失衡轴，但轴的资源需求超出时间预算，引擎已退回无轴打法计算——'
        + '下面的伤害不是轴打出来的。合轴率已经是上限（' + pct(ceiling) + '），'
        + '只能靠换 Boss（更低失衡值 / 带秽盾）或调整轴内容（少捏几招）让它装得下。',
      action: 'none',
      currentAbsorb: current,
      ceiling,
    }
  }
  return {
    show: true,
    title: '⚠ 轴被引擎弃用（已退化为一般循环）',
    // ⚠ 纯文本，**不要**写 Markdown 记法（`**` 在 naive-ui alert 里会原样显示成星号，实测踩到）
    detail: '你选择了失衡轴，但轴的资源需求超出时间预算，引擎已退回无轴打法计算——'
      + '下面的伤害不是轴打出来的。最直接的解法是提高合轴率：当前是 ' + pct(current)
      + '，抬到上限 ' + pct(ceiling) + ' 通常能让轴装下（实测某队 0.4 → 0.6 就从「轴不可行」变成'
      + '「完整轴」，伤害 ×1.42）。提高合轴率会让队友的前台时间被并行吸收、腾出时间给主C。',
    action: 'raise-absorb',
    currentAbsorb: current,
    ceiling,
  }
}

/** 便捷入口：从 config 读「用户是否要了轴 + 当前吸收率」（页面与探针共用，避免各自读 store 漂移） */
export function axisFallbackNoticeOf(config: Pick<ConfigModel, 'useStunAxis' | 'getMechanicSetting'>, fallback: boolean, autoActive: boolean): AxisFallbackNotice {
  // 上限由本模块内部固定为 1.0（引擎语义），不从这里传——见 `axisFallbackNotice` 内注释
  return axisFallbackNotice({
    fallback,
    // 「用户要了轴」= 手动开关开 **或** 自动轴命中（两者任一都表示「用户期望看到轴」）
    axisRequested: config.useStunAxis || autoActive,
    absorbRatio: config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4),
  })
}
