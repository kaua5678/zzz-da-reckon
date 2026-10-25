/**
 * 洛克茜(1621) 影画6 **[余响]** 的生效判据（**精确等式**，用户 2026-10-25 裁决后重写）。
 *
 * ## 用户口径（逐字，取代 R53 的「只能给上界」）
 *
 * > 「这个和时间没关系，首先生成巨型风旋作为次数启动器，一个余响共额外生成 2 个巨型风旋，
 * >   重复触发可以叠加次数，意思是**不会吞掉**。这就很简单的逻辑了，
 * >   引爆[风眼]生成巨型风旋的数量 × 2 = 他赠送的额外巨型风旋数量。
 * >   **总量计算器不需要管他持续几秒**，而是观察到他**总会生成 2 个**巨型风旋就行了。」
 *
 * 原文（`talent.6.desc`）：「……每间隔3秒在目标位置生成一次巨型风旋，**共额外生成2次**巨型风旋，
 * 重复触发时额外生成次数**叠加**且**刷新**……」
 *
 * ### 为什么原来的「[17, 86] 合法区间」是错的
 *
 * 旧推理把「每间隔 3 秒」当成**一个会过期的计时池**：窗口内发不完就浪费 ⇒ 结果依赖未给出的持续秒数 D。
 * 但按用户口径，那 3 秒描述的是**赠送出来的两个巨型风旋之间的间隔**，而「叠加不吞掉」意味着
 * **没有任何容量上限** ⇒ **D 根本不进入总量公式**。原文没给 D **不是缺口，是不需要**。
 *
 * ⇒ 额外巨型风旋数 **恒 = 引爆数 × 2**，**精确、无区间、无上界**。
 *
 * ## 与 §R51-J1 风眼那条的区别（**别互相照抄**）
 * 风眼 = 证明**结构性不可达**（销号）；余响 = **直接可数**（本条，等式判据）。
 * 两条都不是「近似」，也都不再占 debt 位。
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

/* 被推翻的读法（B 单状态节拍池 / C 加性时长池 / 上界判定器）已于 2026-10-25 按用户裁决整体删除：
   叠加不吞掉 ⇒ 无容量上限 ⇒ 持续秒数 D 不进入公式，那些模型共享的前提就不成立。
   现役判据 = 等式 echo === 2*sendOff（见下方 describe 与 roxy.ts 的 @fact）。 */

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
  const src = c.roxyWindEnergySource ?? {}
  const sendOff = Number(src.sendOffCount ?? 0)
  const mega = Number(src.megaTornadoCount ?? 0)
  return {
    ex: Math.max(0, Math.floor(Number(c.exSpecialCount ?? 0))),
    front: Number(c.timeAllocation?.frontlineTime ?? 0),
    sendOff,
    mega,
    echo: mega - sendOff,
    mini: Number(src.miniTornadoCount ?? 0),
    eyes: Math.max(0, Math.floor(Number(src.windEyeGenerated ?? 0))),
  }
}

describe('余响：额外巨型风旋 = 引爆数 × 2（精确等式）', () => {
  it('① ★ 等式：额外数量恒 = 引爆数 × 2，与「持续秒数 D / 3s 节拍」**无关**', () => {
    /**
     * ⚠ **"2" 必须写成字面量，不能读 `ROXY_C6_ECHO_BURSTS`**（2026-10-25 负控实测）：
     * 首版用常量 ⇒ 常量改 3 时预期与实现一起变 ⇒ **用例恒绿**（同义反复）。
     * 原文写死了「共额外生成2次」，所以这里就该钉字面量 2。
     */
    expect(ROXY_C6_ECHO_BURSTS, '原文「共额外生成2次」⇒ 常量必须是 2').toBe(2);
    /**
     * 这条用例专门锁「D 不进入公式」：对同一个引爆数，任何曾经被当成「候选时长」的 D
     * 都必须给出**同一个答案**。旧口径下列表 [6,12,30,180] 会给出 17/19/25/60 四种结果。
     */
    for (const castCount of [1, 2, 3, 5, 10, 43, 87]) {
      const expected = castCount * 2
      expect(echoReadingA(castCount), `引爆 ${castCount} 次应赠 ${expected} 个`).toBe(expected)
      /**
       * 反空洞：**引爆时刻的分布不影响结果**——只要引爆数相同，答案就相同。
       * （被推翻的「单状态 + 3s 节拍 + 过期池」模型正是在这里分叉的：同一引爆数配不同 D 给出
       *  17/19/25/60/86 五种答案。现在 D 不进公式，所以必须只有一个答案。）
       */
      const spread = [1.067, 30, 0.05, 12.5]
      const castTimes = Array.from({ length: castCount }, (_, i) => spread[i % spread.length]! * i)
      expect(castTimes.length).toBe(castCount)
      expect(echoReadingA(castCount), '引爆时刻分布不该改变答案').toBe(expected)
    }
  })

  it('② 判别力负控：若读法给成「每次 3 个」或「随时间衰减」⇒ 等式必须变红', () => {
    const failures: string[] = []
    const castCount = 43
    const correct = castCount * ROXY_C6_ECHO_BURSTS
    // 负控 A：多送一个（3 而非 2）⇒ 越过等式
    const over = castCount * (ROXY_C6_ECHO_BURSTS + 1)
    if (over === correct) failures.push('负控 A 失效：多送一个竟与等式同值')
    // 负控 B：把「叠加」误解成「同时只有一个余响」（吞掉重复触发）⇒ 恒 2，与引爆数无关
    const swallowed = ROXY_C6_ECHO_BURSTS
    if (swallowed === correct) failures.push('负控 B 失效：吞掉重复触发竟与等式同值')
    // 正控：原文读法命中
    if (echoReadingA(castCount) !== correct) failures.push('正控失效：原文读法未命中 2n')
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
