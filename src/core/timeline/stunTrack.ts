/**
 * 影子内核 · 失衡轨（R4-A1 第 1 步；设计稿 D3）。
 *
 * 模型：
 * - 失衡条从 `initialStun` 开始；窗口外按 `offWindowLoop` 顺序循环执行动作，**动作完成时**累加失衡值；
 * - 失衡条 ≥ bossStunValue ⇒ 在该时刻开窗，窗口时长固定；窗口内打出的失衡值无效（与现引擎
 *   `StunPoolResult.inAxisStunTotal`「失衡窗口内失效」同口径），窗口内只产出轴预设动作事件；
 * - 出窗后失衡条 = 返还比例 × 上限（+ 溢出，若 carryOverflow）；循环从中断处续上；
 * - 会越过 battleTime 的窗口外动作不完成、不计入（末尾截断自然发生，不回灌问题在这里不存在）。
 *
 * 失衡次数不依赖任何「引擎答案」：窗口外速率来自动作自身的时长与失衡值，不用引擎的前台时间预算，
 * 因此不会与现引擎的失衡次数形成循环论证。
 */
import type { StunTrackInput, StunTrackResult, StunWindow, TimelineEvent } from './types'

const EPS = 1e-9
/** 防御性上限：异常输入（极小 duration）时不死循环 */
const MAX_STEPS = 200_000

export function simulateStunTrack(input: StunTrackInput): StunTrackResult {
  const battleTime = Math.max(0, input.battleTime)
  const boss = input.bossStunValue
  const windowDuration = Math.max(0, input.windowDuration)
  const refundRatio = Math.max(0, Math.min(0.25, input.refundRatio ?? 0))
  const carry = input.carryOverflow === true
  const loop = input.offWindowLoop.filter(a => a.duration > 0)
  const templates = input.windowTemplates ?? []

  const events: TimelineEvent[] = []
  const windows: StunWindow[] = []
  const completedByMove: Record<string, number> = {}
  const bump = (slot: number, moveId: string) => {
    const key = `${slot}:${moveId}`
    completedByMove[key] = (completedByMove[key] ?? 0) + 1
  }

  let t = 0
  let meter = Math.max(0, input.initialStun ?? 0)
  let overflowLost = 0
  let truncatedAction = false
  let cursor = 0

  /** 满值则开窗；返回 false 表示战斗已结束 */
  const maybeOpenWindow = (): boolean => {
    if (!(boss > 0) || meter < boss - EPS) return true
    const index = windows.length
    const start = t
    const end = Math.min(start + windowDuration, battleTime)
    const overflow = Math.max(0, meter - boss)
    windows.push({ index, start, end, enterMeter: meter, overflow })
    // 溢出在开窗那一刻就决定去留：不结转 ⇒ 立即记入丢弃（被战斗结束截断的末窗也算）
    if (!carry) overflowLost += overflow
    events.push({ t: start, kind: 'stunEnter', window: index })
    const template = templates.length ? templates[Math.min(index, templates.length - 1)] : []
    for (const a of [...template].sort((x, y) => x.offset - y.offset)) {
      if (a.offset < 0 || a.offset > windowDuration + EPS) continue
      const at = start + a.offset
      if (at > battleTime + EPS) continue
      events.push({ t: at, kind: 'windowAction', slot: a.slot, moveId: a.moveId, decibel: a.decibel ?? 0, window: index })
      bump(a.slot, a.moveId)
    }
    if (start + windowDuration > battleTime + EPS) {
      t = battleTime
      meter = 0
      return false
    }
    t = start + windowDuration
    events.push({ t, kind: 'stunExit', window: index })
    meter = refundRatio * boss + (carry ? overflow : 0)
    return t < battleTime - EPS
  }

  let alive = maybeOpenWindow()
  let steps = 0
  while (alive && loop.length > 0 && steps++ < MAX_STEPS) {
    const a = loop[cursor]
    const end = t + a.duration
    if (end > battleTime + EPS) { truncatedAction = true; break }
    t = end
    meter += Math.max(0, a.stun)
    events.push({ t, kind: 'action', slot: a.slot, moveId: a.moveId, stun: a.stun, decibel: a.decibel ?? 0 })
    bump(a.slot, a.moveId)
    cursor = (cursor + 1) % loop.length
    alive = maybeOpenWindow()
  }

  events.push({ t: battleTime, kind: 'end' })
  return {
    events,
    windows,
    stunCount: windows.length,
    residual: meter,
    overflowLost,
    completedByMove,
    truncatedAction,
  }
}
