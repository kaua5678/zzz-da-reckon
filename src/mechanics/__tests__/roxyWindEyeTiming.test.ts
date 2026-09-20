/**
 * R52 闸门落地测试：风眼「同时存量≤9 / 30s 自然引爆 / 超限最早引爆」时序口径。
 *
 * ## 本文件证明什么（对应 `roxy.ts#computeRoxyWindEnergy` 的 `@fact agent:1621/风眼时序`）
 *
 * R51 把这条登记为 `debt:`（「需要逐事件时序队列」，总量口径表达不了）。R52 把队列**真建出来**：
 * 本文件内嵌一个**独立预言机**（原文直译的逐事件 FIFO，不 import 模块的风眼逻辑），喂引擎自己
 * 产出的数量，逐位对账。结论是**结构性的**，不是「影响小」：
 *
 * 1. 单发风眼上界 = `min(WIND_ENERGY_MAX=3, floor(单轮耗能/25)) × eyeRate` ≤ 3（默认 rate=1）；
 * 2. 每次恕不远送恰引爆 `SEND_OFF_BURST_MAX`=3 个 ⇒ 队列**每发清空**，长度恒 ≤ 3 < 9
 *    ⇒ 9 上限与 30s 自爆**不可达**；
 * 3. 默认 `spinSeconds=2.5`（耗能 85 ⇒ `floor(85/25)`=3）且 `eyeRate=1`
 *    ⇒ 风眼数恒 = 3 × 发数 ⇒ `floor(总/3)` 是**精确解**（连余数项都恒 0）。
 *
 * ## ★ 天花板也是可观测的（不是「边界」空话）——两条负控 + 一条天花板扫描
 * 光证「默认档零 delta」是**弱**命题（恒等返回的预言机也能过）。故：
 *  - 负控 A：`eyeRate=2`（单发 6 > 3）⇒ 预言机**必须**与现行式分叉（9 上限真咬合），
 *    证明「上限闸门」不是死的；
 *  - 负控 B：`spinSeconds=0.5`（单发 1.09 < 3）⇒ 局末余留眼让 `mini` **必须**分叉，
 *    证明「余数天花板」不是空话；同时 9 上限在其下仍不咬合（结构性）。
 *
 * ## 口径（沿用 `mechanicSettingsEffect.test.ts` 四条，别放宽）
 * ① 必须走真管线（`setupHarness` 真队伍 → `setMechanicSetting` → 真 `useResourceCalc()`）；
 * ② 每个探针点独立 `setupHarness`（跨值复用会因收敛态污染产出假 no-delta）；
 * ③ 断言失败累积后一次性 `toEqual([])`；④ 断言强度 = 结构不变量 / 闭式恒等式。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { WIND_EYE_MAX, SEND_OFF_BURST_MAX, ROXY_C6_ECHO_BURSTS } from '@/mechanics/agents/roxy'

const EYE_LIFE_SECONDS = 30
/** 单发恰 3 眼的 spinSeconds 下界：耗能 = 10 + spin×30 ≥ 75 ⇒ spin ≥ 65/30 */
const SPIN_FOR_FULL_THREE = 65 / 30
/** 单发 > 3 的 eyeRate 下界：floor(3×rate) ≥ 4 ⇒ rate > 4/3（负控 A 用的采样点须高于它） */
export const EYE_RATE_FOR_OVERFLOW = 4 / 3

/** 原文直译的逐事件 FIFO 预言机（**独立实现**，刻意不 import 模块的风眼逻辑） */
export function windEyeFifo(
  trace: Array<{ t: number; eyes: number }>,
  opts: { cap?: number; life?: number } = {},
): { sendOff: number; mini: number; overflow: number; expired: number; alive: number; maxConcurrent: number } {
  const cap = opts.cap ?? WIND_EYE_MAX
  const life = opts.life ?? EYE_LIFE_SECONDS
  const q: number[] = []
  let overflow = 0
  let expired = 0
  let sendOff = 0
  let mini = 0
  let maxConcurrent = 0
  for (const ev of trace) {
    // 到点自爆（原文「持续30秒后自动引爆」）
    while (q.length > 0 && q[0] + life <= ev.t) { q.shift(); expired++ }
    for (let i = 0; i < ev.eyes; i++) {
      q.push(ev.t)
      // 超限挤爆队首（原文「超出上限后最早生成的会自动引爆」= FIFO）
      if (q.length > cap) { q.shift(); overflow++ }
    }
    maxConcurrent = Math.max(maxConcurrent, q.length)
    // 恕不远送：触发条件「场上风眼 + 自身风能 ≥ 3」（风能已被敬请安息消耗 ⇒ 退化为风眼 ≥ 3）
    if (q.length >= SEND_OFF_BURST_MAX) {
      const hit = Math.min(SEND_OFF_BURST_MAX, q.length)
      for (let i = 0; i < hit; i++) q.shift()
      sendOff++
      // 不足 3 个才出小旋风（原文：3 个同命中改为 1 阵巨旋风）
      if (hit < SEND_OFF_BURST_MAX) mini += hit
    }
  }
  return { sendOff, mini, overflow, expired, alive: q.length, maxConcurrent }
}

/** 把「总风眼数」按发次拆成逐发序列（引擎无逐发时刻 ⇒ 均匀铺在前台；对抗性取最早） */
function spreadEyes(casts: number, eyesTotal: number, span: number): Array<{ t: number; eyes: number }> {
  const n = Math.max(0, Math.floor(casts))
  if (n === 0) return []
  const base = Math.floor(eyesTotal / n)
  let rem = eyesTotal - base * n
  const per: number[] = []
  for (let i = 0; i < n; i++) { per.push(base + (rem > 0 ? 1 : 0)); if (rem > 0) rem-- }
  return per.map((eyes, i) => ({ t: n > 1 ? (span * i) / (n - 1) : 0, eyes }))
}

/** C6 夹具：默认手法下 `megaTornadoCount = sendOff × (1 + 余响 2)` 需要 C6 才是倍率 */
const RICH: HarnessTeamSlot = {
  agentId: '1621', cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12,
  quickAssistCount: 4, chainCountPerStun: 2, blockCount: 4, perfectBlockCount: 5,
} as HarnessTeamSlot

function mates(ids: string[]): HarnessTeamSlot[] {
  return ids.map(agentId => ({ agentId, cinemaLevel: 6 }) as HarnessTeamSlot)
}

interface RoxyRead {
  ex: number
  front: number
  eyes: number
  sendOff: number
  mini: number
  mega: number
  perCast: number
}

/** 单点真管线读数（**每点全新 `setupHarness`**，口径②） */
async function probe(settings: Record<string, number>): Promise<RoxyRead> {
  const { catalog, config } = await setupHarness([RICH, ...mates(['1371', '1431'])])
  await catalog.loadBuildRecommendations()
  for (const buff of config.globalBuffs) buff.enabled = false
  const calc = useResourceCalc()
  for (const [id, v] of Object.entries(settings)) config.setMechanicSetting(id, v)
  await new Promise(r => setTimeout(r, 0))
  const c = (calc.resourceResult.value?.characters ?? []).find(x => x.agentId === '1621') as any
  if (!c) throw new Error('资源结果里没有 1621（队伍装配失败？）')
  const s = c.roxyWindEnergySource ?? {}
  const ex = Math.max(0, Math.floor(Number(c.exSpecialCount ?? 0)))
  const eyes = Math.max(0, Math.floor(Number(s.windEyeGenerated ?? 0)))
  return {
    ex,
    front: Number(c.timeAllocation?.frontlineTime ?? 0),
    eyes,
    sendOff: Number(s.sendOffCount ?? 0),
    mini: Number(s.miniTornadoCount ?? 0),
    mega: Number(s.megaTornadoCount ?? 0),
    perCast: ex > 0 ? eyes / ex : 0,
  }
}

const EYE_RATE = '1621.roxy_wind_eye.wind_eye_from_cannon.rate'
const SPIN = 'roxy.spinSeconds'

describe('R52 风眼时序：逐事件 FIFO 队列 vs 引擎总量口径', () => {
  it('★ 负控 A：`eyeRate` > 4/3（单发 >3）时预言机**必须**与现行式分叉（9 上限真咬合）', async () => {
    const failures: string[] = []
    const r = await probe({ [SPIN]: 2.5, [EYE_RATE]: 2 })
    if (!(2 > EYE_RATE_FOR_OVERFLOW)) failures.push('负控 A 的采样点 rate=2 未超过阈值 4/3 ⇒ 该负控已失效')
    if (!(r.perCast > SEND_OFF_BURST_MAX)) {
      failures.push(`eyeRate=2 时单发应 >${SEND_OFF_BURST_MAX}（实到 ${r.perCast.toFixed(3)}）——前提不成立`)
    }
    const fifo = windEyeFifo(spreadEyes(r.ex, r.eyes, r.front))
    if (fifo.overflow === 0) {
      failures.push(`单发 ${r.perCast.toFixed(2)}>3 时 9 上限**竟未咬合** ⇒ 预言机的上限闸门是死的`)
    }
    if (!(fifo.sendOff < r.sendOff)) {
      failures.push(`eyeRate=2 时预言机 sendOff(${fifo.sendOff}) 应 < 现行式(${r.sendOff})`
        + ' ⇒ 两口径必须可分叉，否则默认档的「零 delta」是仪器失灵而非真结论')
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('★ 负控 B：`spinSeconds`=0.5（单发 <3）时余留眼让 `mini` **必须**分叉；9 上限仍不咬合', async () => {
    const failures: string[] = []
    const r = await probe({ [SPIN]: 0.5, [EYE_RATE]: 1 })
    if (!(r.perCast < SEND_OFF_BURST_MAX)) {
      failures.push(`spinSeconds=0.5 时单发应 <3（实到 ${r.perCast.toFixed(3)}）`)
    }
    const fifo = windEyeFifo(spreadEyes(r.ex, r.eyes, r.front))
    if (fifo.mini === r.mini) {
      failures.push(`单发 ${r.perCast.toFixed(3)}<3 时小旋风应分叉（现行式 mini=${r.mini} / FIFO mini=${fifo.mini}）`
        + ' ⇒ 天花板必须可观测，否则「边界」是空话')
    }
    // ★ 但 9 上限在单发 <3 时**仍然**不可达（这是结构性论证的一半）
    if (fifo.overflow !== 0) {
      failures.push(`单发 ${r.perCast.toFixed(3)}<3 时 9 上限竟咬合了 ${fifo.overflow} 次 ⇒ 结构性论证有误`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300000)

  it('① 结构性不变量：`spinSeconds` ≥ 65/30 ⇒ 单发恰 3 ⇒ 风眼总数 ≡ 0 (mod 3)', async () => {
    const failures: string[] = []
    for (const spin of [2.25, 2.5, 3, 4, 6, 10]) {
      const r = await probe({ [SPIN]: spin, [EYE_RATE]: 1 })
      if (r.perCast !== SEND_OFF_BURST_MAX) {
        failures.push(`spinSeconds=${spin}: 单发应恰 ${SEND_OFF_BURST_MAX}，实到 ${r.perCast.toFixed(3)}`)
      }
      if (r.ex > 0 && r.eyes % SEND_OFF_BURST_MAX !== 0) {
        failures.push(`spinSeconds=${spin}: 单发恰 3 ⇒ 总眼数应为 3 的倍数，实到 ${r.eyes}（${r.ex} 发）`)
      }
      if (spin < SPIN_FOR_FULL_THREE) failures.push(`采样点 spin=${spin} 低于阈值 ${SPIN_FOR_FULL_THREE.toFixed(4)}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  it('② 等价性（默认 rate=1）：逐事件 FIFO 与引擎 `sendOff` / `mini` **逐位相同**', async () => {
    const failures: string[] = []
    let checked = 0
    for (const spin of [2.25, 2.5, 3, 4, 6, 10]) {
      const r = await probe({ [SPIN]: spin, [EYE_RATE]: 1 })
      const fifo = windEyeFifo(spreadEyes(r.ex, r.eyes, r.front))
      checked++
      if (fifo.sendOff !== r.sendOff) failures.push(`spin=${spin}: sendOff 引擎=${r.sendOff} FIFO=${fifo.sendOff}`)
      if (fifo.mini !== r.mini) failures.push(`spin=${spin}: mini 引擎=${r.mini} FIFO=${fifo.mini}`)
      // 两条不可达性 —— 本条的**主结论**
      if (fifo.overflow !== 0) failures.push(`spin=${spin}: 9 上限咬合了 ${fifo.overflow} 次 ⇒ 不可达性被证伪`)
      if (fifo.expired !== 0) failures.push(`spin=${spin}: 30s 自爆咬合了 ${fifo.expired} 次 ⇒ 不可达性被证伪`)
      // 机制：单发 ≤3 且每发清空 ⇒ 并发峰值 ≤3（离 9 有 3 倍余量）
      if (fifo.maxConcurrent > SEND_OFF_BURST_MAX) {
        failures.push(`spin=${spin}: 并发峰值 ${fifo.maxConcurrent} > ${SEND_OFF_BURST_MAX} ⇒ 上界论证有误`)
      }
    }
    if (checked === 0) failures.push('未采集到任何采样点（夹具失效）')
    expect(failures, failures.join('\n')).toEqual([])
  }, 900000)

  it('③ 闭式恒等式：`sendOff×3 + mini ≡ 风眼总数`，且 C6 `mega = sendOff×(1+余响)`', async () => {
    const failures: string[] = []
    for (const spin of [2.25, 2.5, 4]) {
      const r = await probe({ [SPIN]: spin, [EYE_RATE]: 1 })
      if (r.sendOff * SEND_OFF_BURST_MAX + r.mini !== r.eyes) {
        failures.push(`spin=${spin}: ${r.sendOff}×3 + ${r.mini} ≠ ${r.eyes}（账本不闭合）`)
      }
      // 默认手法无余数 ⇒ 小旋风恒 0
      if (r.mini !== 0) failures.push(`spin=${spin}: 默认手法小旋风应恒 0，实到 ${r.mini}`)
      // C6 夹具：巨型风旋 = 每次恕不远送（3 眼同命中）× (1 + 余响 2)
      const expectMega = r.sendOff * (1 + ROXY_C6_ECHO_BURSTS)
      if (r.mega !== expectMega) failures.push(`spin=${spin}: C6 mega 应 ${expectMega}，实到 ${r.mega}`)
      // 风眼数走的是「消耗的风能点数」而不是「按总量钳到 9」——后者会让 sendOff 塌成 ≤3
      if (!(r.sendOff > WIND_EYE_MAX / SEND_OFF_BURST_MAX)) {
        failures.push(`spin=${spin}: sendOff=${r.sendOff} 疑似被当成「9 总量上限」（应远大于 ${WIND_EYE_MAX / SEND_OFF_BURST_MAX}）`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  it('④ 预言机自身的判别力（纯函数负控：cap / life / 正控三态都咬合）', () => {
    const failures: string[] = []
    // cap 负控：混合 (3,2) 序列在 cap=4 下必须咬合
    const hold = Array.from({ length: 20 }, (_, i) => ({ t: i * 1.09, eyes: i % 2 === 0 ? 3 : 2 }))
    if (windEyeFifo(hold, { cap: 4 }).overflow === 0) failures.push('cap=4 时混合序列竟无溢出 ⇒ cap 参数是死的')
    // life 负控：间隔 31s > 30s ⇒ 必过期
    if (windEyeFifo(Array.from({ length: 10 }, (_, i) => ({ t: i * 31, eyes: 1 }))).expired === 0) {
      failures.push('间隔 31s 时竟无过期 ⇒ life 参数是死的')
    }
    // 上限负控：单发 6 眼 ⇒ 必咬合
    if (windEyeFifo(Array.from({ length: 20 }, (_, i) => ({ t: i * 1.09, eyes: 6 }))).overflow === 0) {
      failures.push('单发 6 眼时竟无溢出 ⇒ 9 上限是死的')
    }
    // 正控：单发恰 3 ⇒ 任何间隔下 sendOff 恒 = 发数、零溢出零过期
    for (const gap of [0.01, 1.09, 29.99]) {
      const r = windEyeFifo(Array.from({ length: 50 }, (_, i) => ({ t: i * gap, eyes: 3 })))
      if (r.sendOff !== 50 || r.overflow !== 0 || r.expired !== 0) {
        failures.push(`单发恰 3 间隔 ${gap}s：应 50/0/0，实到 ${r.sendOff}/${r.overflow}/${r.expired}`)
      }
    }
    // ★ 天花板下界：单发 >3 时闭式给出「第几发开始超 9」（c_k = k×(e−3) > 9）
    //   为防「边界」写成空话，这里直接断言闭式与模拟互证。
    const e6 = Array.from({ length: 40 }, (_, i) => ({ t: i * 1.09, eyes: 6 }))
    const r6 = windEyeFifo(e6)
    const kStar = Math.ceil((WIND_EYE_MAX + 1) / (6 - SEND_OFF_BURST_MAX)) // e=6 ⇒ 第 4 发
    if (r6.overflow === 0) failures.push('e=6 密集时闭式预测必溢出，实测零溢出 ⇒ 闭式与模拟不一致')
    if (!(kStar === 4)) failures.push(`闭式 k* 应为 4，实到 ${kStar}`)
    expect(failures, failures.join('\n')).toEqual([])
  })
})
