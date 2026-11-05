/**
 * **机制「入场券」未满足提示**（用户口径 2026-11-04，逐字）：
 *
 * > 「莱卡恩这种感觉需要提醒一下，**没弹刀就没围猎**。这个强度占模太多了，如果有用户
 * >  **误认为莱卡恩弱就不透明了**，搞得好像计算器故意针对莱卡恩一样，不给别人关键的模。
 * >  **自动交互的情况下我希望这个能被检测出来**。」
 *
 * ## 量化形态（不透明长什么样）
 *
 * 同一队、同一套配装（`auto-1611-1141-1211`），只有「莱卡恩弹刀次数」不同：
 *
 * | 莱卡恩弹刀 | 失衡 | 围猎 | 总伤 |
 * |---|---|---|---|
 * | 0 | 5 | **0 次** | 55.50M |
 * | 6 | 8 | 4.68 次 | 66.70M |
 *
 * ⇒ 差 **11.2M（+20%）**，而结果页此前**一个字都不说**。用户看到 55.50M 只会想「莱卡恩好弱」。
 *
 * ## ⚠ 提示的语义边界：只说「没生效 + 怎么解锁」，**不说「你亏了，快补」**
 *
 * 实测（同一状态下只给莱卡恩加弹刀）**不一定涨伤**：
 *
 * | 莱卡恩弹刀 | 总伤 | 失衡 |
 * |---|---|---|
 * | 0（自动交互交付的状态） | 84.05M | 4 |
 * | 2 | 75.93M | 11 |
 * | 4 | 74.81M | 12 |
 *
 * 因为多出来的失衡窗会吃掉时间/资源，收益是正是负**由引擎算**。写成「补了更赚」就是误导。
 * ⇒ 本模块的措辞固定为：**「当前没生效」+「解锁需要 N 次弹刀」+「开关之后收益由引擎重算」。**
 *
 * ## 为什么判定住这里（而不是页面里 `v-if`）
 *
 * 同 `axisFallbackNotice.ts` 的形状：**声明在角色模块**（`capabilityGates`，规则 6 不许编排层按
 * agentId 分支）→ **判定是纯函数**（本文件，可喂最小夹具单测）→ **页面只渲染**。
 * 结果页与各比较入口共用 `ResourcePoolView` ⇒ 一处改、多处见得着。
 *
 * ## 三条「不提示」的反空洞判据（缺任何一条都会变成噪音）
 *
 * 1. **门已满足**（`activeOf` 为真）⇒ 不提示（能力在正常工作，没有可解释的缺口）；
 * 2. **要求量为 0**（`requirement.min <= 0`）⇒ 不提示（声明不出「补到几次」，说了也没用）；
 * 3. **该槽位没有这个角色**（`rr` 为 null / 槽位空）⇒ 不提示。
 */
import type { ActionCountField } from '@/stores/config'
import type { TeamResourceResult } from '@/types/resource'
import type { CapabilityGateDecl } from '@/mechanics/typesHooks'
import { getAgentMechanic } from '@/mechanics/registry'

/** 一条未满足的门（页面逐条渲染；也是自动交互 note 的素材） */
export interface CapabilityGateMiss {
  /** 槽位（0-based；展示用 `slotLabel` 那份名字） */
  slot: number
  agentId: string
  /** 能力名（如「围猎」） */
  label: string
  /** 缺的那个次数字段（用户可直接去交互栏改） */
  field: ActionCountField
  /** 该字段当前值 */
  current: number
  /** 解锁所需的最小值 */
  min: number
  /** 解锁后引擎会额外产出什么（一行可读量；模块没声明则为空串） */
  unlockHint: string
}

export interface CapabilityGateNotice {
  /** 是否该提示（唯一判据：存在至少一条未满足的门） */
  show: boolean
  /** 一行标题（多条门时仍是同一句总述） */
  title: string
  /** 详情（纯文本，**不要**写 Markdown 记法——naive-ui alert 会原样显示星号，实测踩到） */
  detail: string
  /** 逐条未满足的门（页面可列点渲染；空数组 ⇔ `show === false`） */
  misses: CapabilityGateMiss[]
}

/** 提示所需的读数（结构类型：单测可喂最小夹具，页面从快照取） */
export interface CapabilityGateNoticeInput {
  /** 本轮队伍资源结果（`calc.resourceResult.value`）；null ⇒ 不提示 */
  resourceResult: TeamResourceResult | null
  /** 槽位名（1-based 旧口径，与 `ResourcePoolView` 的 `slotLabels` 同源）；缺项回落 `槽N` */
  slotLabels?: readonly string[]
  /** 该槽的交互次数现状（读 store 的**用户可见**字段值；缺项按 0 算） */
  countsOf: (slot: number, field: ActionCountField) => number
}

const NONE: CapabilityGateNotice = { show: false, title: '', detail: '', misses: [] }

/**
 * 算「入场券未满足」提示（纯函数，不碰 store）。
 *
 * ⚠ **不提示**的三条判据见文件头「三条反空洞判据」。其中 ② 是**反空洞**的关键：
 * 若某模块声明了 `min: 0` 的门，判定它「未满足」就等于对所有队常亮——那不是提示，是噪音。
 */
export function capabilityGateNotice(input: CapabilityGateNoticeInput): CapabilityGateNotice {
  const rr = input.resourceResult
  if (!rr) return NONE
  const misses: CapabilityGateMiss[] = []
  for (const ch of rr.characters) {
    const gates = gatesOf(ch.agentId)
    if (gates.length === 0) continue
    for (const gate of gates) {
      // 判据 ②：要求量 0 ⇒ 「补到几次」说不出口，不提示（防常亮噪音）
      const min = Number.isFinite(gate.requirement.min) ? gate.requirement.min : 0
      if (min <= 0) continue
      // 判据 ①：门已满足 ⇒ 能力在正常工作，没有可解释的缺口
      if (gate.activeOf(ch)) continue
      misses.push({
        slot: ch.slot,
        agentId: ch.agentId,
        label: gate.label,
        field: gate.requirement.field,
        current: countOfField(input, ch.slot, gate.requirement.field),
        min,
        unlockHint: gate.unlockHint ?? '',
      })
    }
  }
  if (misses.length === 0) return NONE
  return {
    show: true,
    title: misses.length === 1
      ? `⚠ 有 1 项能力因前置条件未满足而没有生效`
      : `⚠ 有 ${misses.length} 项能力因前置条件未满足而没有生效`,
    detail: detailOf(misses, input.slotLabels),
    misses,
  }
}

/**
 * 逐条摘要（自动交互把同一份摘要写进 `note`；两处同源 ⇒ 页面上看到的与 note 里说的逐字一致）。
 *
 * 形如 `第2槽 莱卡恩·围猎未启用（需要弹刀 ≥1 次，当前 0）`。
 */
export function capabilityGateMissSummary(miss: CapabilityGateMiss, slotLabels?: readonly string[]): string {
  const who = slotLabels?.[miss.slot] ? `${slotLabels[miss.slot]}·` : ''
  const field = FIELD_LABELS[miss.field] ?? miss.field
  // ⚠ 措辞固定为「未启用 + 缺几次」，**不写**「你亏了 / 补了更赚」：实测补门可能掉伤（见文件头 A/B 表）
  return `${who}${miss.label}未启用（需要 ${field} ≥${miss.min} 次，当前 ${fmtCount(miss.current)}）`
}

/** 自动交互 `note` 用的单行版本（多条用「；」连接；空数组 ⇒ 空串） */
export function capabilityGateNoteText(misses: readonly CapabilityGateMiss[], slotLabels?: readonly string[]): string {
  if (misses.length === 0) return ''
  return `未启用的机制：${misses.map(m => capabilityGateMissSummary(m, slotLabels)).join('；')}`
}

/**
 * 交互字段的中文名（提示与 note 共用一份，规则 11 单一来源）。
 * ⚠ 只收**能当入场券用**的次数字段（`ActionCountField` 全集里的交互项）；角色专属计数不进这张表。
 */
const FIELD_LABELS: Partial<Record<ActionCountField, string>> = {
  parryCount: '弹刀',
  dodgeCounterCount: '闪避反击',
  blockCount: '格挡',
  dualCounterCount: '双反',
}

function fmtCount(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/**
 * 读本槽该字段的**用户可见现状**。
 *
 * ⚠ 只读入参（不在这里 `import` store）：比较入口的快照是**差分重放**出来的档位，
 * 现读 UI store 会显示另一个档的数字（`curvePointPool.ts` 头注释）⇒ 由调用方给读数口。
 */
function countOfField(input: CapabilityGateNoticeInput, slot: number, field: ActionCountField): number {
  const v = Number(input.countsOf(slot, field))
  return Number.isFinite(v) ? v : 0
}

function detailOf(misses: readonly CapabilityGateMiss[], slotLabels?: readonly string[]): string {
  // ⚠ 纯文本，不要写 Markdown 记法（`**` 在 naive-ui alert 里会原样显示成星号，`axisFallbackNotice` 实测踩到）
  const lines = misses.map(m => {
    const base = capabilityGateMissSummary(m, slotLabels)
    return m.unlockHint ? `${base}。解锁后引擎会产出：${m.unlockHint}` : base
  })
  return `${lines.join('。')}。以上能力当前完全没有计入下面的伤害——不代表角色只有这点强度。`
    + '在交互栏把对应次数填到门槛即可解锁；解锁后伤害可能上升也可能下降'
    + '（多出来的动作会占用时间与资源），由引擎重算。'
}

/** 模块声明 → 门清单（无声明 = 空数组；模块 id 解析走 registry，不在这里列角色） */
function gatesOf(agentId: string): ReadonlyArray<CapabilityGateDecl> {
  return agentId ? (getAgentMechanic(agentId)?.capabilityGates ?? []) : []
}

/**
 * 便捷入口：从**快照**取读数（页面与探针共用，避免各自读 store 漂移）。
 *
 * `countsOf` 由页面给（ResultPage 读 UI store，比较入口读该档重放的 store）；
 * 槽位名走快照的 `slotLabels`（1-based，与资源页其它地方一致）。
 */
export function capabilityGateNoticeOfSnapshot(snapshot: {
  resourceResult: TeamResourceResult | null
  slotLabels?: readonly string[]
}, countsOf: CapabilityGateNoticeInput['countsOf']): CapabilityGateNotice {
  return capabilityGateNotice({ resourceResult: snapshot.resourceResult, slotLabels: snapshot.slotLabels, countsOf })
}

/** 只要 miss 清单（自动交互只要这段，不需要标题/详情文案） */
export function capabilityGateMissesOf(
  resourceResult: TeamResourceResult | null,
  countsOf: CapabilityGateNoticeInput['countsOf'],
): CapabilityGateMiss[] {
  return capabilityGateNotice({ resourceResult, countsOf }).misses
}
