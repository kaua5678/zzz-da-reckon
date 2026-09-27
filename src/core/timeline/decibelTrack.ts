/**
 * 影子内核 · 喧响轨（R4-A1 第 1 步；设计稿 D4）。
 *
 * - 每槽一条喧响条，**上限（cap）与大招消耗（ultimateCost）分开**：cap 缺省 = 消耗，
 *   橘福福 1391「队伍喧响上限 +1000」的 A/B 只需把 cap 改成 4000（默认不生效）。
 * - 释放后**保留余量**（喧响 −= 消耗），不是清零——这是 `decibelCapVerdict.test.ts` 头注释
 *   步骤 ① 写明的目标口径；cap = 消耗时两者等价。
 * - 策略 `windowEnter`：只在开窗时刻，所有 ≥ 消耗的槽各放一次；`whenFull`：一到消耗立即放（被动回复
 *   的越线时刻按线性解析求出，不按事件离散化）。
 * - 输入是失衡轨产出的事件流（action / windowAction 带本槽喧响，stunEnter 触发开窗奖励与释放）。
 *
 * 本文件是独立实现（按槽、带上限参数），不复用 core/resourceTrack.ts 的单池喧响轨：
 * 那条轨受「喧响上限口径」闸门看守，影子阶段不碰它（设计稿 §1.2）。
 */
import type { DecibelTrackOptions, DecibelTrackResult, SlotDecibelResult, TimelineEvent } from './types'

const EPS = 1e-9

function perSlot(v: number | number[] | undefined, n: number, fallback: number): number[] {
  if (Array.isArray(v)) return Array.from({ length: n }, (_, i) => v[i] ?? fallback)
  return Array.from({ length: n }, () => (v ?? fallback))
}

export function simulateSlotDecibel(events: TimelineEvent[], opts: DecibelTrackOptions): DecibelTrackResult {
  const n = Math.max(1, opts.slots ?? 3)
  const battleTime = Math.max(0, opts.battleTime)
  const cost = perSlot(opts.ultimateCost, n, 3000)
  const capRaw = perSlot(opts.cap, n, NaN)
  const cap = capRaw.map((c, i) => (Number.isFinite(c) ? Math.max(c, cost[i]) : cost[i]))
  const rate = perSlot(opts.passiveRate, n, 0).map(r => Math.max(0, r))
  const onEnter = perSlot(opts.onStunEnter, n, 0)
  const policy = opts.policy ?? 'windowEnter'

  const meter = perSlot(opts.initial, n, 0).map((v, i) => Math.min(cap[i], Math.max(0, v)))
  const slots: SlotDecibelResult[] = Array.from({ length: n }, () => ({ ultimates: 0, ultimateTimes: [], wasted: 0, remaining: 0, gained: 0 }))
  const ultEvents: TimelineEvent[] = []

  const release = (i: number, t: number) => {
    meter[i] -= cost[i]
    slots[i].ultimates += 1
    slots[i].ultimateTimes.push(t)
    ultEvents.push({ t, kind: 'ultimate', slot: i })
  }

  /** 瞬时获得（事件喧响 / 开窗奖励） */
  const gain = (i: number, amount: number, t: number) => {
    if (!(amount > 0)) return
    slots[i].gained += amount
    meter[i] += amount
    if (policy === 'whenFull') {
      while (meter[i] >= cost[i] - EPS) release(i, t)
    }
    if (meter[i] > cap[i]) { slots[i].wasted += meter[i] - cap[i]; meter[i] = cap[i] }
  }

  /** 被动回复推进 [t0, t0+dt] */
  const advance = (t0: number, dt: number) => {
    if (!(dt > 0)) return
    for (let i = 0; i < n; i++) {
      if (!(rate[i] > 0)) continue
      slots[i].gained += rate[i] * dt
      if (policy === 'whenFull') {
        let elapsed = 0
        while (elapsed < dt) {
          const need = cost[i] - meter[i]
          const tc = need / rate[i]
          if (tc > dt - elapsed + EPS) { meter[i] += rate[i] * (dt - elapsed); break }
          elapsed += Math.max(0, tc)
          meter[i] = cost[i]
          release(i, t0 + elapsed)
        }
        if (meter[i] > cap[i]) { slots[i].wasted += meter[i] - cap[i]; meter[i] = cap[i] }
      } else {
        const next = meter[i] + rate[i] * dt
        if (next > cap[i]) { slots[i].wasted += next - cap[i]; meter[i] = cap[i] } else meter[i] = next
      }
    }
  }

  let t = 0
  const sorted = [...events].filter(e => e.t <= battleTime + EPS).sort((a, b) => a.t - b.t)
  for (const e of sorted) {
    advance(t, e.t - t)
    t = Math.max(t, e.t)
    if ((e.kind === 'action' || e.kind === 'windowAction') && e.slot !== undefined && e.slot < n) {
      gain(e.slot, e.decibel ?? 0, e.t)
    } else if (e.kind === 'stunEnter') {
      for (let i = 0; i < n; i++) gain(i, onEnter[i], e.t)
      if (policy === 'windowEnter') {
        for (let i = 0; i < n; i++) if (meter[i] >= cost[i] - EPS) release(i, e.t)
      }
    }
  }
  advance(t, battleTime - t)
  for (let i = 0; i < n; i++) slots[i].remaining = meter[i]
  return { slots, events: ultEvents.sort((a, b) => a.t - b.t) }
}
