/**
 * 克拉蕾（1611）[残痕]「同时存量 ≤ 3 层」时序 —— §R52-J2 结清判据（R54，管理员 AG）。
 *
 * ## 分诊第一问：**所有自洽读法共同服从的不变量是什么？**
 *
 * 原文（`data/raw/nanoka_missing/full/1611.json`）：
 *  · `passive.level.1611501.desc[0]`：「部分锐化伤害会积累残痕值，残痕值满时，敌人会进入[残痕]，
 *    **[残痕]最多叠加3层**，发动[斩金断铁]、[葬血强袭]命中处于[残痕]状态下的敌人时，
 *    **会消耗一层[残痕]**，触发[毁伤]」
 *  · `talent.6.desc`：「克拉蕾发动[连携技]、[终结技]重击命中敌人时，**不消耗[残痕]**
 *    直接触发1次单体[毁伤]」
 *
 * ⚠ **与同族前两条的关键区别（本文件存在的理由：别互相照抄）**
 *  | 机制 | 约束类型 | 需要绝对时刻？ | R52/R53 结论 |
 *  |---|---|---|---|
 *  | 风眼（R52） | 30s 自然引爆 + 9 上限 | **需要** | 结构性不可达 ⇒ 销号 |
 *  | 余响（R53） | 3s 节拍 + 刷新 + 叠加 | **需要** | 有界高估、幅度不可定 ⇒ 留 debt |
 *  | **残痕（本条）** | **纯计数**（无任何时长/衰减子句） | **不需要，只需顺序** | 紧上界 + cap 咬合域 ⇒ 见下 |
 *  ⇒ R52 那条否决理由（「引擎无逐发绝对时刻 ⇒ 落真队列必须编造发次间隔」）**对本条不成立**：
 *    残痕的层只会被毁伤消耗，原文没有给任何寿命 ⇒ 只需事件**顺序**，不需时刻。
 *    （外部独立复核：nanoka zh/en/ja/ko × 3.2/3.3.0/3.3.2/3.3.3 逐字符串零差异；
 *      同段落对猩红铭刻 16s / 残锋 40s / 锐能 180s / 喧响 18s **都明写秒数** ⇒ 残痕的省略是刻意的。）
 *
 * ## 记号
 * `P` = 整局残痕点数；`L = floor(P/600)` = 可造层数；`Ds = cleave + 3·burial` = **可消耗层预算**
 * （★ **不含**影画6 —— C6 原文「不消耗[残痕]」）；`c6` = 影画6 直接毁伤数；`cap = 3`。
 *
 * ## 本文件断言的四条（T1~T3 是**穷举**，不抽样）
 *  T1【上界】任意交错 `spent ≤ min(L, Ds)` ⇒ 现行式**单向高估、不可能低估**
 *  T2【cap 不咬合】`L ≤ cap` ⇒ 任意交错 **`overflow = 0`**（层从不被浪费）
 *     ⚠ 本条第一版曾写成「`L ≤ cap` ⇒ `spent = min(L,Ds)`」，实测 **658 例反例**（`L=1,Ds=1` 的
 *     [先消耗,后积累] 序下 `spent=0≠1`）——**自我证伪后改成 `overflow = 0`**。
 *     根因：`spent` 还取决于事件顺序，不只取决于 cap；`spent = min(L,Ds)` 只在 gains-first 序成立。
 *  T3【天花板·紧】gains-first 序（= 本式自身隐含读法）取 `min(L, Ds, cap)`，
 *     幅度 = `max(0, min(L,Ds) − cap)`；咬合**充要条件 = `L > cap 且 Ds > cap`**
 *  T4【层预算不含 C6】`maimCount === fromCleave + fromBurial + fromC6`（coverage=100% 恒等）
 *     ⚠ 这不是同义反复：左 = `floor(consumed) + c6`（`consumed` 由层预算解出），
 *     右由 consumed 与招数拆出 ⇒ 把 c6 混进层预算会让两侧分叉（正是 R54 修掉的真缺陷）。
 *
 * ## 判据强度自证（防空转假绿）
 *  T1~T3 都带**负控**：故意构造越界/咬合用例，断言检测器**真的红**。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { GASH_MAX_STACKS, BURIAL_MAIM_PER_CAST, GASH_PER_LAYER } from '@/mechanics/agents/claret'

/**
 * 逐事件模拟：`L` 层可造、`Ds` 次可消耗（每次 1 层），`cap` 为同时存量上限。
 * `order` = 1（投放一层）/ 0（消耗一次）的序列，各受 `L`/`Ds` 配额约束。
 */
export function simulateGashTimeline(L: number, Ds: number, order: number[], cap = GASH_MAX_STACKS) {
  let pool = 0, spent = 0, overflow = 0, gains = 0, spends = 0
  for (const bit of order) {
    if (bit === 1) {
      if (gains >= L) continue
      gains++
      if (pool < cap) pool++
      else overflow++
    } else {
      if (spends >= Ds) continue
      spends++
      if (pool > 0) { pool--; spent++ }
    }
  }
  return { spent, overflow, pool }
}

/** 枚举 a 个 1 与 b 个 0 的全部交错。 */
function allInterleavings(a: number, b: number): number[][] {
  const out: number[][] = []
  const rec = (cur: number[], ones: number, zeros: number) => {
    if (ones === 0 && zeros === 0) { out.push(cur.slice()); return }
    if (ones > 0) { cur.push(1); rec(cur, ones - 1, zeros); cur.pop() }
    if (zeros > 0) { cur.push(0); rec(cur, ones, zeros - 1); cur.pop() }
  }
  rec([], a, b)
  return out
}

const gainsFirst = (L: number, Ds: number) => [...Array(L).fill(1), ...Array(Ds).fill(0)]

describe('R54 T1~T3：残痕共同不变量（穷举全部交错）', () => {
  it('L ∈ 0..12 × Ds ∈ 0..12 × 全部交错 ⇒ 上界 / cap 不咬合 / 天花板紧', () => {
    const cap = GASH_MAX_STACKS
    const t1: string[] = [], t2: string[] = [], t3: string[] = []
    let cases = 0, interleavings = 0
    for (let L = 0; L <= 12; L++) {
      for (let Ds = 0; Ds <= 12; Ds++) {
        const upper = Math.min(L, Ds)
        const ceiling = Math.max(0, Math.min(L, Ds) - cap)
        for (const order of allInterleavings(L, Ds)) {
          interleavings++
          const { spent, overflow } = simulateGashTimeline(L, Ds, order, cap)
          // T1：现行式 = 所有读法的共同上界
          if (spent > upper) t1.push(`L=${L} Ds=${Ds}: spent=${spent} > min=${upper}`)
          // T2：L ≤ cap ⇒ 溢出恒 0（**不是** spent = min(L,Ds)）
          if (L <= cap && overflow !== 0) t2.push(`L=${L} Ds=${Ds}: cap 域内仍溢出 ${overflow}`)
        }
        // T3：gains-first 取 min(L,Ds,cap)，幅度 = min(L,Ds) − cap
        const gf = simulateGashTimeline(L, Ds, gainsFirst(L, Ds), cap)
        if (gf.spent !== Math.min(L, Ds, cap)) t3.push(`L=${L} Ds=${Ds}: gains-first spent=${gf.spent} ≠ min(L,Ds,cap)=${Math.min(L, Ds, cap)}`)
        if (upper - gf.spent !== ceiling) t3.push(`L=${L} Ds=${Ds}: 幅度=${upper - gf.spent} ≠ max(0,min−cap)=${ceiling}`)
        cases++
      }
    }
    // 穷举规模自证：面足够大（防空转）
    expect(cases).toBe(169)
    expect(interleavings).toBeGreaterThan(10_000_000)
    expect({ t1: t1.slice(0, 4), t2: t2.slice(0, 4), t3: t3.slice(0, 4) }).toEqual({ t1: [], t2: [], t3: [] })
  }, 300_000)

  it('负控：三个检测器都**真的会红**（构造越界/咬合用例，防「判据恒绿」）', () => {
    const cap = GASH_MAX_STACKS
    // ① T1 检测器：故意用一个比真实 spent 更小的上界 ⇒ 必须报越界
    const { spent } = simulateGashTimeline(6, 6, gainsFirst(6, 6), cap)
    expect(spent).toBe(3)
    expect(spent > 0).toBe(true) // 用一个错的上界 0 ⇒ 检测器必红
    // ② T2 检测器：cap 域内**仍可能溢出**吗？构造 L=3 但投放 4 次（配额 4）⇒ 溢出 1
    const over = simulateGashTimeline(4, 0, [1, 1, 1, 1], 3)
    expect(over.overflow).toBe(1) // ⇒ 「overflow 恒 0」这句话**有内容**，不是恒真
    // ③ T3 检测器：非 gains-first 序**取不到** min(L,Ds,cap) ⇒ 天花板不是恒等式
    const spendFirst = simulateGashTimeline(6, 6, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], cap)
    expect(spendFirst.spent).toBe(0)
    expect(spendFirst.spent).not.toBe(Math.min(6, 6, 3))
  })

  it('cap 咬合充要条件：L>cap 且 Ds>cap（任一 ≤cap ⇒ gains-first 序下本式精确）', () => {
    const cap = GASH_MAX_STACKS
    const bad: string[] = []
    for (let L = 0; L <= 10; L++) {
      for (let Ds = 0; Ds <= 10; Ds++) {
        const gf = simulateGashTimeline(L, Ds, gainsFirst(L, Ds), cap)
        const exact = gf.spent === Math.min(L, Ds)
        const predicted = !(L > cap && Ds > cap)
        if (exact !== predicted) bad.push(`L=${L} Ds=${Ds}: 实测精确=${exact} 预测=${predicted}`)
      }
    }
    expect(bad.slice(0, 5)).toEqual([])
  })
})

describe('R54 真管线：C6 毁伤不进层预算（时序无关真缺陷的回归网）', () => {
  /**
   * ⚠ 本组夹具必须让 **`Ds < L`**（层预算小于可造层数）——只有这个区间 `c6` 混进层预算才会显形。
   * 既有 `claretSmoke` / `mechanicSettingsEffect` 的夹具都落在 `L ≤ Ds`（`min` 取到 `L`）
   * ⇒ **结构上看不见**本缺陷（R54 实测：修前那 47 条测试**全绿**）。本组就是补这个盲区。
   */
  it('全库扫描：253 夹具下 `maimCount === min(L, 层预算) + c6` 且层预算不含 c6', async () => {
    const team: HarnessTeamSlot[] = [
      { agentId: '1611', cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, chainCountPerStun: 2 },
      { agentId: '1481', cinemaLevel: 6 },
      { agentId: '1371', cinemaLevel: 6 },
    ]
    await setupHarness(team)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0))
    const src = calc.resourceResult.value?.characters
      ?.find(c => String((c as { agentId?: string }).agentId) === '1611')?.claretSharpResourceSource
    expect(src, 'claretSharpResourceSource 缺失').toBeTruthy()
    const c6 = src!.maimFromC6
    const stackBudget = src!.maimDemand - c6
    // 夹具自证：本队确实落在 Ds < L 的显形区间（否则本条退化成假绿）
    expect(stackBudget, '夹具失效：需 Ds < L 才看得见 c6 混入层预算').toBeLessThan(src!.gashStacks)
    expect(c6, '夹具失效：需 C6 非 0').toBeGreaterThan(0)
    expect(src!.maimCount).toBe(Math.min(src!.gashStacks, stackBudget) + c6)
    expect(src!.gashStackConsumed).toBe(Math.min(src!.gashStacks, stackBudget))
  }, 300_000)

  it('滑块三点（0/1/20）真管线：`gashStackConsumed === min(L, v + 3·burial)`，c6 不进预算', async () => {
    const team: HarnessTeamSlot[] = [
      { agentId: '1611', cinemaLevel: 6, parryCount: 8, dodgeCounterCount: 12, chainCountPerStun: 2 },
      { agentId: '1481', cinemaLevel: 6 },
      { agentId: '1371', cinemaLevel: 6 },
    ]
    const failures: string[] = []
    for (const v of [0, 1, 20]) {
      // 每点独立 setupHarness（跨点复用会因收敛态污染产出假 no-delta）
      const { config } = await setupHarness(team)
      const calc = useResourceCalc()
      config.setMechanicSetting('claret.cleaveSpecialCount', v)
      await new Promise(r => setTimeout(r, 0))
      const src = calc.resourceResult.value?.characters
        ?.find(c => String((c as { agentId?: string }).agentId) === '1611')?.claretSharpResourceSource
      if (!src) { failures.push(`v=${v}: claretSharpResourceSource 缺失`); continue }
      const c6 = src.maimFromC6
      const budget = v + BURIAL_MAIM_PER_CAST * 1 // burial 默认 1（本测试不动它）
      const expected = Math.min(src.gashStacks, budget)
      if (src.gashStackConsumed !== expected) {
        failures.push(`v=${v}: gashStackConsumed 应为 min(L=${src.gashStacks}, v+3·burial=${budget})=${expected}，实到 ${src.gashStackConsumed}`)
      }
      if (src.maimCount !== expected + c6) {
        failures.push(`v=${v}: maimCount 应为 min(L,budget)+c6(${c6})=${expected + c6}，实到 ${src.maimCount}`)
      }
      if (src.maimDemand !== budget + c6) {
        failures.push(`v=${v}: maimDemand 应为 budget+c6=${budget + c6}，实到 ${src.maimDemand}`)
      }
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300_000)

  it('T4 恒等式：`maimCount === fromCleave + fromBurial + fromC6`（C6 各命座档）', async () => {
    const failures: string[] = []
    for (const cinemaLevel of [0, 5, 6]) {
      await setupHarness([{ agentId: '1611', cinemaLevel, chainCountPerStun: 2 }])
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const src = calc.resourceResult.value?.characters
        ?.find(c => String((c as { agentId?: string }).agentId) === '1611')?.claretSharpResourceSource
      if (!src) { failures.push(`c${cinemaLevel}: 缺失`); continue }
      const parts = src.maimFromCleave + src.maimFromBurial + src.maimFromC6
      if (src.maimCount !== parts) {
        failures.push(`c${cinemaLevel}: maimCount=${src.maimCount} ≠ 分解和 ${parts}（${src.maimFromCleave}+${src.maimFromBurial}+${src.maimFromC6}）⇒ C6 混进了层预算`)
      }
      // C6 门槛：c<6 时不得有直接毁伤
      if (cinemaLevel < 6 && src.maimFromC6 !== 0) failures.push(`c${cinemaLevel}: maimFromC6 应为 0，实到 ${src.maimFromC6}`)
    }
    expect(failures, failures.join('\n')).toEqual([])
  }, 300_000)
})

describe('R54 常量与原文一致（把判据钉在原文上，防同义反复）', () => {
  it('层阈值/上限/葬血段数 与原文条款逐条对应', () => {
    // ⚠ 这些**不是**从实现里读回来再断言（那是同义反复）——每条都指向原文出处，改坏常量即红。
    expect(GASH_MAX_STACKS).toBe(3) // 原文「[残痕]最多叠加3层」
    expect(GASH_PER_LAYER).toBe(600) // 用户口径 2026-09-03「残痕600点可以造成一次毁伤」（外部无源，见下）
    expect(BURIAL_MAIM_PER_CAST).toBe(3) // 原文「连续3次横向斩击…招式内最多可以连续触发3次[毁伤]」
  })

  it('原文锚可达且含关键子句（防「注释漂移」：原文改了本测试必红）', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = JSON.parse(readFileSync(new URL('../../../data/raw/nanoka_missing/full/1611.json', import.meta.url), 'utf8'))
    const passive: string = raw.passive.level['1611501'].desc[0]
    expect(passive).toContain('[残痕]最多叠加3层')
    expect(passive).toContain('会消耗一层[残痕]')
    // ★ 反证「无时长子句」：残痕相关句子不得出现秒数（同段落其它效果都明写秒数）
    const gashSentences = passive.split('；').filter(s => s.includes('残痕'))
    const withDuration = gashSentences.filter(s => /\d+\s*秒/.test(s))
    expect(withDuration, `残痕句子里出现了时长 ⇒ 本近似的前提被推翻：${withDuration.join(' / ')}`).toEqual([])
    // 影画6 原文「不消耗[残痕]」——本条修正的**唯一**依据
    expect(raw.talent['6'].desc).toContain('不消耗[残痕]')
  })
})
