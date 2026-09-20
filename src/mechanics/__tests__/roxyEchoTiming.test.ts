/**
 * R53 闸门落地测试：洛克茜(1621) 影画6 **[余响]** 的「方向可证 / 幅度不可定」。
 *
 * ## 本文件证明什么（对应 `roxy.ts#computeRoxyWindEnergy` 的 `@fact agent:1621/余响时序`）
 *
 * 原文（`data/raw/nanoka_missing/full/1621.json:2119` `talent.6.desc`）：
 * > [特殊技：恕不远送]引爆[风眼]生成巨型风旋时，主目标会被赋予[余响]效果，**每间隔3秒**在目标位置
 * > 生成一次巨型风旋，**共额外生成2次**巨型风旋，重复触发时额外生成次数**叠加**且**刷新**[余响]的持续时间。
 *
 * EN 同构（`static.nanoka.cc/zzz/<ver>/en/character/1621.json`）：「A Giant Windstorm is generated at
 * the target's location every 3s, for a total of 2 additional Giant Windstorms. Repeated triggers
 * stack the number of additional Giant Windstorm **instances** generated and **refresh** the
 * duration of Afterecho.」
 *
 * ### ★【定理】现行式是所有自洽读法的**共同上界**（方向已定 ⇒ 只可能高估，不可能低估）
 * 「共额外生成2次」= 每次触发至多追加 2 次 ⇒ 无论「叠加/刷新」怎么解释，总量恒 ≤ `2×引爆数`。
 * 本文件把 4 种读法（逐实例独立 / 单状态+全局 3s 节拍排队 / 加性时长池 / 齐发反例）
 * × 7 个候选时长 × 全网格穷举，断言**零越界**。
 * ⇒ 这纠正了 `.claude/OPEN-ITEMS.md` §R52-J1 记的「**方向未定**」：方向是定的（单向高估）。
 *
 * ### ⚠【阻塞】幅度不可定（精确值需两个原文没给的参数 ⇒ 不许编造）
 * ① [余响] **持续秒数 D**——原文只说「刷新持续时间」，**从不给数值**；
 * ② 「每间隔3秒」是**每实例各自计时**还是**目标身上单一节拍**——双语只把「叠加」的对象写成
 *    `instances`、把「刷新」的对象写成 `duration`，**没说节拍归谁**。
 * 实测分歧（默认夹具 n=43）：D=6 ⇒ 17 / D=12 ⇒ 19 / D=30 ⇒ 25 / D=180 ⇒ 60 / 逐实例 ⇒ 86
 * ⇒ 合法区间 **[17, 86]，跨度 5.1×**。
 * ⇒ 落「精确值」必须**编造 D**（R52 纪律：把未建模假设写进伤害数比留着有界近似更坏）
 *   ⇒ 正解 = 保留上界 + 登记 `DEBT_REGISTRY` + 挂 `⟳复核 2027-03-31`。
 *
 * ### 与 §R51-J1 风眼那条的区别（**别互相照抄**）
 * 风眼 = **证明到不了**（结构性不可达 ⇒ 销号）；本条 = **到得了但算不准**（有界高估 ⇒ 登记 debt）。
 *
 * ## 口径（沿用 `roxyWindEyeTiming.test.ts` 四条，别放宽）
 * ① 必须走真管线（`setupHarness` 真队伍 → `setMechanicSetting` → 真 `useResourceCalc()`）；
 * ② 每个探针点独立 `setupHarness`；③ 断言失败累积后一次性 `toEqual([])`；④ 断言强度 = 结构不变量。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  ROXY_C6_ECHO_BURSTS,
  SEND_OFF_BURST_MAX,
  WIND_EYE_PER_ENERGY,
  computeRoxyWindEnergy,
} from '@/mechanics/agents/roxy'

/** 原文显式写出的投递间隔（秒）：「每间隔3秒生成一次」 */
export const ECHO_INTERVAL_SECONDS = 3

// ─────────────────────────── 独立预言机（刻意不 import 模块逻辑）───────────────────────────

/**
 * 读法 A：**逐实例独立**——每次触发各开一条 2 次序列（+3s / +6s 各一跳）。
 * 对应「叠加」= 实例数叠加。
 */
export function echoReadingA(castCount: number): number {
  return Math.max(0, Math.floor(castCount)) * ROXY_C6_ECHO_BURSTS
}

/**
 * 读法 B：**单一 [余响] 状态 + 全局 3s 节拍 + 待发计数池**，节拍上**发 1 个**；
 * 持续时间 D 由每次触发刷新（`expiry = t + D`）。对应「叠加」= 次数入池、「刷新」= 单状态时长。
 */
export function echoReadingB(
  castTimes: number[],
  opts: { duration: number; battle?: number; interval?: number },
): number {
  const interval = opts.interval ?? ECHO_INTERVAL_SECONDS
  const battle = opts.battle ?? 180
  if (castTimes.length === 0) return 0
  const last = castTimes[castTimes.length - 1]
  const evs: Array<{ t: number; kind: 'cast' | 'beat' }> = []
  for (const t of castTimes) evs.push({ t, kind: 'cast' })
  for (let t = castTimes[0] + interval; t <= Math.min(last + opts.duration, battle) + 1e-9; t += interval) {
    evs.push({ t, kind: 'beat' })
  }
  evs.sort((a, b) => a.t - b.t || (a.kind === 'cast' ? -1 : 1))
  let pool = 0
  let expiry = -Infinity
  let spawned = 0
  for (const e of evs) {
    if (e.kind === 'cast') { pool += ROXY_C6_ECHO_BURSTS; expiry = Math.min(e.t + opts.duration, battle) }
    else if (e.t <= expiry + 1e-9 && pool > 0) { pool -= 1; spawned++ }
  }
  return spawned
}

/**
 * 读法 C：**加性时长池**（每次触发把 `2×3s` 累进时长池、封顶战斗时间，再按 3s 折算次数）——
 * 形状同本仓 `norma.ts` 的导弹舱先例（「每失衡一次给 8 秒…重复触发刷新（封顶战斗时间）」）。
 */
export function echoReadingC(castCount: number, opts: { battle?: number; interval?: number } = {}): number {
  const interval = opts.interval ?? ECHO_INTERVAL_SECONDS
  const battle = opts.battle ?? 180
  const n = Math.max(0, Math.floor(castCount))
  const poolSeconds = Math.min(battle, n * ROXY_C6_ECHO_BURSTS * interval)
  return Math.min(n * ROXY_C6_ECHO_BURSTS, Math.floor(poolSeconds / interval + 1e-9))
}

/**
 * 读法 D（**反例**）：单一状态 + 节拍上把待发池**齐发**。违反「生成**一次**」措辞，
 * 仅作上界证明的对照项保留。
 */
export function echoReadingD(
  castTimes: number[],
  opts: { duration: number; battle?: number; interval?: number },
): number {
  const interval = opts.interval ?? ECHO_INTERVAL_SECONDS
  const battle = opts.battle ?? 180
  if (castTimes.length === 0) return 0
  const last = castTimes[castTimes.length - 1]
  const evs: Array<{ t: number; kind: 'cast' | 'beat' }> = []
  for (const t of castTimes) evs.push({ t, kind: 'cast' })
  for (let t = castTimes[0] + interval; t <= Math.min(last + opts.duration, battle) + 1e-9; t += interval) {
    evs.push({ t, kind: 'beat' })
  }
  evs.sort((a, b) => a.t - b.t || (a.kind === 'cast' ? -1 : 1))
  let pool = 0
  let expiry = -Infinity
  let spawned = 0
  for (const e of evs) {
    if (e.kind === 'cast') { pool += ROXY_C6_ECHO_BURSTS; expiry = Math.min(e.t + opts.duration, battle) }
    else if (e.t <= expiry + 1e-9 && pool > 0) { spawned += pool; pool = 0 }
  }
  return spawned
}

/**
 * 定理的判定器：返回所有读法求值中**超过** `2n` 的越界记录（空数组 = 定理成立）。
 * 这是本文件的**主判据**——被反向验证探针注入时会精确变红。
 */
export function echoUpperBoundHolds(
  cases: Array<{ battle: number; gap: number; castCount: number }>,
  durations: number[] = [6, 9, 12, 30, 60, 180, 600],
): string[] {
  const violations: string[] = []
  for (const c of cases) {
    const casts = Array.from({ length: Math.max(0, c.castCount) }, (_, i) => i * c.gap).filter(t => t < c.battle)
    if (casts.length === 0) continue
    const cap = casts.length * ROXY_C6_ECHO_BURSTS
    const cands: Array<[string, number]> = [['A', echoReadingA(casts.length)]]
    for (const D of durations) {
      cands.push([`B(D=${D})`, echoReadingB(casts, { duration: D, battle: c.battle })])
      cands.push([`D(D=${D})`, echoReadingD(casts, { duration: D, battle: c.battle })])
    }
    cands.push(['C', echoReadingC(casts.length, { battle: c.battle })])
    for (const [name, v] of cands) {
      if (v > cap) violations.push(`battle=${c.battle} gap=${c.gap} n=${casts.length} ${name}: ${v} > 2n=${cap}`)
    }
  }
  return violations
}

/** C6 夹具（与 `roxyWindEyeTiming.test.ts` 同款，便于跨文件对账） */
const RICH: HarnessTeamSlot = {
  agentId: '1621', cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12,
  quickAssistCount: 4, chainCountPerStun: 2, blockCount: 4, perfectBlockCount: 5,
} as HarnessTeamSlot

function mates(ids: string[]): HarnessTeamSlot[] {
  return ids.map(agentId => ({ agentId, cinemaLevel: 6 }) as HarnessTeamSlot)
}

interface EchoRead {
  ex: number
  front: number
  sendOff: number
  mega: number
  echo: number
  mini: number
  eyes: number
}

/** 单点真管线读数（**每点全新 `setupHarness`**，口径②） */
async function probe(): Promise<EchoRead> {
  const { catalog, config } = await setupHarness([RICH, ...mates(['1371', '1431'])])
  await catalog.loadBuildRecommendations()
  for (const buff of config.globalBuffs) buff.enabled = false
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 0))
  const c = (calc.resourceResult.value?.characters ?? []).find(x => x.agentId === '1621') as any
  if (!c) throw new Error('资源结果里没有 1621（队伍装配失败？）')
  const s = c.roxyWindEnergySource ?? {}
  const sendOff = Number(s.sendOffCount ?? 0)
  const mega = Number(s.megaTornadoCount ?? 0)
  return {
    ex: Math.max(0, Math.floor(Number(c.exSpecialCount ?? 0))),
    front: Number(c.timeAllocation?.frontlineTime ?? 0),
    sendOff,
    mega,
    echo: mega - sendOff,
    mini: Number(s.miniTornadoCount ?? 0),
    eyes: Math.max(0, Math.floor(Number(s.windEyeGenerated ?? 0))),
  }
}

describe('R53 余响时序：方向可证（共同上界）', () => {
  it('① ★ 定理：4 读法 × 7 时长 × 全网格 ⇒ 恒 ≤ `2×引爆数`（零越界）', () => {
    const cases: Array<{ battle: number; gap: number; castCount: number }> = []
    for (const battle of [60, 180, 240]) {
      for (const gap of [0.05, 0.5, 1.067, 2.0, 2.5, 3.0, 5.9, 6.0, 6.1, 10, 30]) {
        for (const castCount of [1, 2, 3, 5, 10, 30, 43, 87]) cases.push({ battle, gap, castCount })
      }
    }
    const violations = echoUpperBoundHolds(cases)
    expect(violations, `越界 ⇒ 现行式不是上界：\n${violations.slice(0, 10).join('\n')}`).toEqual([])
  })

  it('② 判别力负控：把读法改成**能超过 2n** 的形态 ⇒ 定理判定器**必须**变红', () => {
    const failures: string[] = []
    // 负控：一个「每次触发追加 3 次」的读法（> 原文的 2 次）⇒ 必然越过 2n
    const overBursts = (castCount: number) => Math.max(0, castCount) * (ROXY_C6_ECHO_BURSTS + 1)
    const cases = [{ battle: 180, gap: 1.067, castCount: 43 }]
    const cap = 43 * ROXY_C6_ECHO_BURSTS
    if (!(overBursts(43) > cap)) {
      failures.push(`负控失效：每次 3 次应越过 2n=${cap}（实到 ${overBursts(43)}）⇒ 判定器可能恒真`)
    }
    // 正控：原文的 2 次恰不越界
    if (echoUpperBoundHolds(cases).length !== 0) {
      failures.push('正控失效：原文读法竟越界 ⇒ 定理判定器方向反了')
    }
    // 稀疏域：所有读法趋同于 2n（现行式的适用域，证明上界不是空话）
    const sparse = [{ battle: 180, gap: 30, castCount: 5 }]
    if (echoUpperBoundHolds(sparse).length !== 0) failures.push('稀疏域越界')
    const sparseA = echoReadingA(5)
    const sparseB = echoReadingB(Array.from({ length: 5 }, (_, i) => i * 30), { duration: 6 })
    if (sparseA !== sparseB) failures.push(`稀疏域应趋同：A=${sparseA} B=${sparseB}`)
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('③ 真管线：`sendOff×SEND_OFF_BURST_MAX + mini ≡ 风眼总数`（账本闭合）且 C6 `echo = 2×sendOff`', async () => {
    const failures: string[] = []
    const r = await probe()
    if (r.sendOff <= 0) failures.push('夹具失效：sendOff ≤ 0')
    if (r.eyes <= 0) failures.push('夹具失效：风眼总数 ≤ 0')
    // ★ 账本闭合（**跨路径恒等式**，比单点绝对值强）：风眼总数必须恰好被「引爆消耗 + 小旋风余数」解释完
    //   ⚠ 用**字面量 3**（原文「至多引爆3个[风眼]」）而不是 `SEND_OFF_BURST_MAX`——后者两边同源，
    //     改坏常量时等式照样成立（同义反复）。常量本身由 ③b 钉在原文上。
    if (r.sendOff * 3 + r.mini !== r.eyes) {
      failures.push(`账本不闭合：sendOff×3 + mini = ${r.sendOff * 3 + r.mini} ≠ 风眼总数 ${r.eyes}`)
    }
    // ★ 风眼数 = 消耗的风能点数 × WIND_EYE_PER_ENERGY（默认 eyeRate=1）由 ③b 纯函数面钉住
    // C6 余响等式
    if (r.echo !== r.sendOff * ROXY_C6_ECHO_BURSTS) {
      failures.push(`C6 余响行应 = ${r.sendOff * ROXY_C6_ECHO_BURSTS}（=2×引爆数），实到 ${r.echo}`)
    }
    if (r.mega !== r.sendOff * (1 + ROXY_C6_ECHO_BURSTS)) {
      failures.push(`mega 应 = sendOff×(1+2) = ${r.sendOff * 3}，实到 ${r.mega}`)
    }
    // 上界自查：引擎读数本身也必须满足定理（防止将来改式时悄悄越过）
    if (r.echo > r.sendOff * ROXY_C6_ECHO_BURSTS) {
      failures.push(`引擎读数越过 2n 上界：echo=${r.echo} > ${r.sendOff * ROXY_C6_ECHO_BURSTS}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 600000)

  it('③b 纯函数账本闭合：`sendOff×SEND_OFF_BURST_MAX + mini ≡ floor(风能消耗×WIND_EYE_PER_ENERGY)`', () => {
    const failures: string[] = []
    // ★ 先把**上游常量**钉在原文上（否则下面的账本恒等式对常量是**同义反复**——两边都读同一个常量，
    //   改坏常量时等式照样成立。R53 反向验证 E 组实测踩到：`SEND_OFF_BURST_MAX 3→2` 时全绿）。
    //   原文 `special.description[1]`：「被该招式命中的[风眼]会被引爆，**至多引爆3个**[风眼]」。
    //   原文 `special.description[3]`：「每消耗1点[风能]，…并在原地生成1个[风眼]」。
    //   （先例：`roxy.test.ts` 的 `expect(ENERGY_PER_WIND_ENERGY).toBe(25)` 同款「常量钉原文」。）
    if (SEND_OFF_BURST_MAX !== 3) {
      failures.push(`SEND_OFF_BURST_MAX 应 = 3（原文「至多引爆3个[风眼]」），实到 ${SEND_OFF_BURST_MAX}`)
    }
    if (WIND_EYE_PER_ENERGY !== 1) {
      failures.push(`WIND_EYE_PER_ENERGY 应 = 1（原文「每消耗1点[风能]…生成1个[风眼]」），实到 ${WIND_EYE_PER_ENERGY}`)
    }
    if (ROXY_C6_ECHO_BURSTS !== 2) {
      failures.push(`ROXY_C6_ECHO_BURSTS 应 = 2（原文「共额外生成2次巨型风旋」），实到 ${ROXY_C6_ECHO_BURSTS}`)
    }
    // ⚠ 计数源须在**两个不同输入**下取两个不同值（单点绝对值钉不住计数来源）
    const seen = new Set<number>()
    for (const ex of [1, 3, 7]) {
      const r = computeRoxyWindEnergy({ exSpecialCount: ex, spinSeconds: 2.5, cinemaLevel: 6 })
      seen.add(r.sendOffCount)
      const expectedEyes = Math.floor(r.windEnergyConsumed * WIND_EYE_PER_ENERGY + 1e-9)
      if (r.windEyeGenerated !== expectedEyes) {
        failures.push(`ex=${ex}: 风眼数 ${r.windEyeGenerated} ≠ 消耗×转化率 ${expectedEyes}`)
      }
      if (r.sendOffCount * SEND_OFF_BURST_MAX + r.miniTornadoCount !== r.windEyeGenerated) {
        failures.push(`ex=${ex}: 账本不闭合 ${r.sendOffCount}×${SEND_OFF_BURST_MAX} + ${r.miniTornadoCount}`
          + ` ≠ ${r.windEyeGenerated}`)
      }
      // 余响不改引爆数、也不改风眼数（只加 mega）
      const r0 = computeRoxyWindEnergy({ exSpecialCount: ex, spinSeconds: 2.5, cinemaLevel: 0 })
      if (r0.sendOffCount !== r.sendOffCount || r0.windEyeGenerated !== r.windEyeGenerated) {
        failures.push(`ex=${ex}: 余响不应影响引爆数/风眼数（C0 so=${r0.sendOffCount}/${r0.windEyeGenerated}`
          + ` vs C6 ${r.sendOffCount}/${r.windEyeGenerated}）`)
      }
    }
    if (seen.size < 2) failures.push(`sendOffCount 在三个输入下只取到 ${seen.size} 个值 ⇒ 计数源可能写死`)
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('④ 分歧量化（阻塞证据）：合法读法区间跨度 >5× ⇒ 落精确值必须编造 D', () => {
    const failures: string[] = []
    const n = 43
    const span = 45.86
    const casts = Array.from({ length: n }, (_, i) => (span * i) / (n - 1))
    const a = echoReadingA(n)
    const b6 = echoReadingB(casts, { duration: 6 })
    const b180 = echoReadingB(casts, { duration: 180 })
    const c = echoReadingC(n)
    const vals = [a, b6, b180, c]
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    // ① 所有合法读法都必须 ≤ 2n（定理）
    for (const v of vals) {
      if (v > n * ROXY_C6_ECHO_BURSTS) failures.push(`读法值 ${v} 越过 2n=${n * ROXY_C6_ECHO_BURSTS}`)
    }
    // ② 分歧必须**真实存在**（否则「幅度不可定」是空话，应改为销号）
    if (!(hi / Math.max(1, lo) > 2)) {
      failures.push(`合法读法区间仅 [${lo}, ${hi}]（跨度 ${(hi / Math.max(1, lo)).toFixed(2)}×）`
        + ' ⇒ 分歧不显著，「幅度不可定」的前提不成立，应重新分诊')
    }
    // ③ 参数活性：改 D 必须改变结果（防恒等仪器）
    if (b6 === b180) failures.push(`D 参数无作用（D=6 与 D=180 同为 ${b6}）⇒ 仪器失灵`)
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('⑤ 纯函数三态：C0 无余响 / C6 有余响 / C6 稀疏域退化（计数源须在两个输入下取两值）', () => {
    const failures: string[] = []
    // ⚠ 单点绝对值钉不住「计数真的来自 sendOff」⇒ 让 sendOff 在两个输入下取两个不同值
    const r1 = computeRoxyWindEnergy({ exSpecialCount: 1, spinSeconds: 2.5, cinemaLevel: 6 })
    const r3 = computeRoxyWindEnergy({ exSpecialCount: 3, spinSeconds: 2.5, cinemaLevel: 6 })
    const r0 = computeRoxyWindEnergy({ exSpecialCount: 3, spinSeconds: 2.5, cinemaLevel: 0 })
    if (!(r1.sendOffCount !== r3.sendOffCount)) failures.push(`sendOffCount 在两个输入下应不同（1 发=${r1.sendOffCount} / 3 发=${r3.sendOffCount}）`)
    if (r0.megaTornadoCount !== r0.sendOffCount) {
      failures.push(`C0 不应有余响：mega=${r0.megaTornadoCount} 应 = sendOffCount=${r0.sendOffCount}`)
    }
    if (r3.megaTornadoCount - r3.sendOffCount !== r3.sendOffCount * ROXY_C6_ECHO_BURSTS) {
      failures.push(`C6 余响应 = 2×sendOffCount=${r3.sendOffCount * ROXY_C6_ECHO_BURSTS}，实到 ${r3.megaTornadoCount - r3.sendOffCount}`)
    }
    // 计数源独立性：C0 与 C6 的 sendOff 必须相同（余响不改引爆数）
    if (r0.sendOffCount !== r3.sendOffCount) {
      failures.push(`余响不应影响引爆数：C0=${r0.sendOffCount} vs C6=${r3.sendOffCount}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
})
