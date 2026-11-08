/**
 * **连续失衡进结算侧**（kStar 判据 + 覆盖率吃「末窗时钟截短」）。
 *
 * 口径与实测：`docs/mcp-cinema-interval-uplift.md` §5.9 ⑥⑦⑧；预测与逐条对账：
 * `.zc/perf/PREDICTION-continuous-engine.md`；任务书 `.claude/TASK-continuous-stun-engine.md`。
 *
 * ## 修的是什么（缺口）
 * 分析层（`cinemaUpliftFrontier#scanKFrontier`）早就会「末窗截短兑现」，但**结算侧**（`solveTeam`）的
 * kStar 判据是 `floor(cont) ≥ K` ⇒ 交付的 K 永远 ≤ floor(cont) ⇒ `K×W ≤ effTime` ⇒ **时钟截断在结算侧
 * 构造不出来**（全库 `clippedByClock=0`）。本卡把同一条机制接进 kStar 与覆盖率。
 *
 * ## 判据（逐条带负控 / 反空洞）
 * ① **该升的升且按比例**：`auto-1371-1481-1451` C4 交付 K 从 2 升到 3，伤害落在
 *    「钉 K2 < 自由 < 钉 K3」带内（不是整窗跳变，也不是 K2 的照抄）；
 * ② **负控（真 A/B）**：`PROBE_STUN_CONT_TRUNC=off` ⇒ 同一格退回 K2 —— 证明①的上升**由本卡的判据造成**
 *    （负控与正例跑同一份代码、只差一个旗标；这是本文件最有力的一条）；
 * ③ **负控②（δ ≥ W 不采纳）**：`auto-1501-1511-1491` C4 的 K=4（钉窗实测 cont 2.288、δ≈60s ≫ W=25）
 *    在 `continuousStunClip` 上必须返回 null，且 C4 的交付池窗不得升到 4；
 * ④ **反空洞**：升 K 的那一格必须**真的经由**攒条截短路径——断 `capacityResolved===true`（走 kStar 结算）
 *    **且** 同源恒等式 `δ = K×W − 覆盖率×effTime`（逐位 ≈1e-9），**且** 展示侧读的 clip 与引擎报的 δ 相等；
 * ⑤ **core 纯函数三态**（0 / δ / null）+ 自洽性代数；
 * ⑥ **源码锁**：δ 的算式只此一份（不许在任何调用方重写）。
 *
 * ⚠ **已知口径（写在这里免得被当成缺陷）**：交付帧的池被 `withStunCountRebuilt` 按 K 重建 ⇒
 * 交付帧上 `continuousStunCount` **恒等于 K**，δ 读不出来。故反空洞断的是「δ 与覆盖率的差逐位一致」
 * 而不是「重算 δ」；δ 的原始值由 `convergence.stunContinuityClip` 如实上报。
 * ⚠ **锁必须在 `applyTeamToStore` 之后设**（装配会把 `enemy.stunCountLock` 复位；本文件第一版踩过，
 * 导致「钉 K4」的 cont 读成了自由收敛值 2.8899 而不是 2.2884）。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { continuousStunClip, continuousStunCount } from '@/core/stunPool'
import { deliveredStunWindowClip } from '@/composables/resourceCalc/solveTeam'

const PRESET = 'auto-1371-1481-1451'
const C4 = 4

interface Frame {
  dmg: number
  pool: number
  cont: number
  coverage: number
  capacityResolved: boolean
  continuityClip: number
  overflow: number
  windowDuration: number
  effectiveTime: number
}

let H: Awaited<ReturnType<typeof setupHarness>>

/** 采一帧：`lock` 缺省 -1 = 自由收敛；**必须**在 `applyTeamToStore` 之后写（装配会复位锁）。 */
function frameOf(presetId: string, cinema: number, lock = -1): Frame {
  applyTeamToStore(H.config, teamPresets.find(p => p.id === presetId)!)
  H.config.setCinemaLevel(0, cinema)
  H.config.syncTeammateBuffsFromTeam()
  H.config.enemy.stunCountLock = lock
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  const pool = calc.stunPoolResult.value!
  return {
    dmg: calc.teamTotalDamage.value,
    pool: pool.stunCount,
    cont: continuousStunCount(pool),
    coverage: calc.stunCoverage.value,
    capacityResolved: rr.convergence.capacityResolved === true,
    continuityClip: rr.convergence.stunContinuityClip ?? 0,
    overflow: rr.overflowSeconds ?? 0,
    windowDuration: calc.windowDuration.value,
    effectiveTime: calc.stunEffectiveTime.value,
  }
}

beforeAll(async () => {
  H = await setupHarness(['', '', ''], { productionBasicWeights: true })
})
/** 旗标一改就必须绕过记忆化（键不含进程环境变量）⇒ 每条用例收尾复位 */
afterEach(() => {
  setCalcOutputMemoEnabled(true)
  H.config.enemy.stunCountLock = -1
  delete process.env.PROBE_STUN_CONT_TRUNC
})

describe('判据①：Δ<W 时 K 上升，且伤害落在「钉 K2 < 自由 < 钉 K3」带内', () => {
  it('auto-1371-1481-1451 C4：交付 K 从 2（改动前）升到 3', () => {
    const f = frameOf(PRESET, C4)
    expect(f.pool, '结算侧必须按截短后的第 3 窗交付（改动前为 K2）').toBe(3)
    expect(f.continuityClip, '且必须报出攒条侧截短 δ > 0').toBeGreaterThan(0)
    expect(f.continuityClip, 'δ 不得超过一窗上限').toBeLessThanOrEqual(f.windowDuration)
  })

  it('伤害按比例：钉 K2 < 自由收敛 < 钉 K3（实测 27.695 / 31.540 / 31.547 M）', () => {
    const pin2 = frameOf(PRESET, C4, 2)
    const pin3 = frameOf(PRESET, C4, 3)
    const free = frameOf(PRESET, C4)
    expect(pin3.dmg, '前置：钉 K3 必须高于钉 K2（多一窗易伤）').toBeGreaterThan(pin2.dmg)
    // 若结算侧只是把 K2 的读数抄过来 ⇒ 第一条红；若它按**整窗**虚高（覆盖 3 整窗）⇒ 第二条红。
    expect(free.dmg, `自由收敛低于钉 K2（截短被算亏了）：${(free.dmg / 1e6).toFixed(3)}M vs ${(pin2.dmg / 1e6).toFixed(3)}M`)
      .toBeGreaterThan(pin2.dmg)
    expect(free.dmg, `自由收敛超过钉 K3（δ>0 却说整窗）：${(free.dmg / 1e6).toFixed(3)}M vs ${(pin3.dmg / 1e6).toFixed(3)}M`)
      .toBeLessThan(pin3.dmg)
    // 且「按比例」而不是「掉一窗」：自由收敛必须**贴近**钉 K3 而不是钉 K2（δ=0.175s 只差 0.8%）
    expect(free.dmg / pin3.dmg, 'δ 只有 0.175s ⇒ 应贴近整窗，而不是像掉一窗那样落到 K2').toBeGreaterThan(0.99)
  })
})

describe('判据②：负控 —— 旗标关掉退回改动前（真 A/B，同一份代码只差一个旗标）', () => {
  it('PROBE_STUN_CONT_TRUNC=off ⇒ C4 退回 K2、不报 δ、伤害更低', () => {
    const on = frameOf(PRESET, C4)
    expect(on.pool, '正例：旗标开时交付 K3').toBe(3)
    setCalcOutputMemoEnabled(false)
    process.env.PROBE_STUN_CONT_TRUNC = 'off'
    try {
      const off = frameOf(PRESET, C4)
      expect(off.pool, '负控：旗标关时必须退回改动前的 K2').toBe(2)
      expect(off.continuityClip, '负控：旗标关时不得报 δ').toBe(0)
      expect(off.dmg, '负控：退回的读数必须显著低于正例（差的就是那一窗）').toBeLessThan(on.dmg)
    } finally {
      delete process.env.PROBE_STUN_CONT_TRUNC
      setCalcOutputMemoEnabled(true)
    }
  })
})

describe('判据③：负控 —— δ ≥ W 一律不采纳', () => {
  it('auto-1501-1511-1491 C4 的 K=4：cont 2.288、δ≈60s ≫ W=25 ⇒ 判不适用', () => {
    // 前置：钉 K=4 的那一帧才是「按 4 窗排」的读数（交付帧被重建过，cont 恒等于 K）
    const pinned = frameOf('auto-1501-1511-1491', C4, 4)
    expect(pinned.pool, '前置：钉 K4 时池报 4（引擎按 4 窗排）').toBe(4)
    expect(pinned.cont, '负控前提：K=4 的 cont 远小于 4（实测 2.288）').toBeLessThan(2.5)
    const delta = continuousStunClip({
      cont: pinned.cont, k: 4, windowDuration: pinned.windowDuration, effectiveTime: pinned.effectiveTime,
    })
    expect(delta, 'δ ≥ W ⇒ 必须返回 null（不适用），而不是一个「可截短」的数').toBeNull()
    // 结论：该格交付不得升到第 4 窗
    const free = frameOf('auto-1501-1511-1491', C4)
    expect(free.pool, '交付池窗不得升到 4（第 4 窗一秒都分不到）').toBeLessThanOrEqual(3)
  })
})

describe('判据④：反空洞 —— 升 K 的那一格真的经由攒条截短路径', () => {
  it('auto-1371-1481-1451 C4：capacityResolved + 同源恒等式 δ = K×W − 覆盖率×effTime', () => {
    const f = frameOf(PRESET, C4)
    expect(f.capacityResolved, '必须走 kStar 结算（不靠 outerExit 猜：两种实现下都报 stable）').toBe(true)
    expect(f.continuityClip, 'δ 必须 > 0（否则这一格是被别的路径推上去的）').toBeGreaterThan(0)
    /**
     * **同源恒等式**：`覆盖率 × effTime = K×W − δ`。两条通路（结算侧报的 `stunContinuityClip` 与
     * 伤害侧读的 `stunCoverage`）若各算一份，这里必然不闭合。
     */
    const implied = f.pool * f.windowDuration - f.coverage * f.effectiveTime
    expect(Math.abs(f.continuityClip - implied),
      `δ 与覆盖率不同源：报 ${f.continuityClip.toFixed(6)}s / 隐含 ${implied.toFixed(6)}s`).toBeLessThan(1e-9)
    // 展示侧同源：UI 用的是同一个算式（显示=计算），不许各拼一份
    const rr = useResourceCalc().resourceResult.value!
    expect(deliveredStunWindowClip(rr, f.windowDuration)).toBe(f.continuityClip)
  })
})

describe('判据⑤：core 纯函数三态（0 / δ / null）+ 自洽性代数', () => {
  it('cont ≥ K ⇒ 0；δ ∈ (0,W) ⇒ δ；δ ≥ W 或 T ≤ 0 ⇒ null', () => {
    const W = 18, eff = 180
    expect(continuousStunClip({ cont: 3.2, k: 3, windowDuration: W, effectiveTime: eff })).toBe(0)
    const d = continuousStunClip({ cont: 2.95, k: 3, windowDuration: W, effectiveTime: eff })!
    expect(d).toBeGreaterThan(2.13)
    expect(d).toBeLessThan(2.14)
    /**
     * **「为什么它不是放宽」的机器证据**：δ 的定义就是「把 δ 秒还给攒条刚好够开 K 窗」——
     * 可开窗数 = `cont·(T+δ)/T` 必须**恰好**等于 K（代数恒等，不是近似）。
     */
    const t = eff - 3 * W
    expect(2.95 * (t + d) / t).toBeCloseTo(3, 9)
    expect(continuousStunClip({ cont: 2.2, k: 3, windowDuration: W, effectiveTime: eff }), 'δ ≥ W').toBeNull()
    expect(continuousStunClip({ cont: 0.5, k: 11, windowDuration: W, effectiveTime: eff }), 'T ≤ 0').toBeNull()
  })
})

describe('判据⑥：源码锁 —— δ 的算式只此一份', () => {
  it('调用方不得重写 (k/cont − 1) 形态的截短算式', () => {
    const files = ['src/composables/resourceCalc/solveTeam.ts', 'src/composables/cinemaUpliftFrontier.ts']
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8').split('\n')
      src.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/\/\s*(cont|contAtK)\s*-\s*1\b/.test(code)) offenders.push(`${f}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, `截短算式出现第二份（必须走 core/stunPool#continuousStunClip）：\n${offenders.join('\n')}`)
      .toEqual([])
  })
})

describe('判据⑦：截短档「让得出 δ 秒」才采纳（假截短负控）', () => {
  it('auto-1431-1481-1491 C2 K=2：装配溢出 5.93s ≫ δ 0.94s ⇒ 不采纳，交付退回 K1', () => {
    /**
     * **这一格是全库 19 个升 K 格里唯一一条反例的守门人**。
     * 机制：K=2 那一轮已经因为「必要行装不下」被装配期砍了 4 行（5.93s），末窗缩短幅度**本来就由它决定**
     * ⇒ 再叠一个 δ 就是「没有秒数真的被扣两次」⇒「第 K 窗被时钟截短 δ 秒」这句话不成立。
     * 实测：不加这条判据时 K2 交付 37.446M，**低于** K1 的 37.541M（−0.25%）。
     */
    const f = frameOf('auto-1431-1481-1491', 2)
    expect(f.pool, '装配溢出已超 δ ⇒ 不得靠截短升到 K2').toBe(1)
    expect(f.continuityClip, '且不得报出 δ（这一格没有真的截短可让）').toBe(0)
    // 反空洞：负控对象真的存在——钉 K2 那一帧的装配溢出确实远大于 δ
    const pinned = frameOf('auto-1431-1481-1491', 2, 2)
    expect(pinned.pool, '前置：钉 K2 时池报 2').toBe(2)
    expect(pinned.overflow, '前置：该帧装配溢出 5.93s').toBeGreaterThan(5)
    const d = continuousStunClip({ cont: pinned.cont, k: 2, windowDuration: pinned.windowDuration, effectiveTime: pinned.effectiveTime })
    expect(d, 'δ 本身是有效的截短量（0.94s < W）').not.toBeNull()
    expect(pinned.overflow, '判据触发条件：装配溢出 > δ').toBeGreaterThan(d!)
  })
})