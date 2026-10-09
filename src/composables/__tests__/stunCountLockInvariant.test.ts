/**
 * 「**锁定队逐位相同**」不变量测试（T115 前置段 ②，2026-10-10）。
 *
 * ## 出处与为什么要先立它
 *
 * `docs/ENGINE_PIPELINE_GUIDE.md` §4 坑 19「未落地·有裁决」逐字要求：
 *
 * > **开工第一步 = 先立不变量测试「`stunCountLock ≥ 0` 的队 A 前后输出逐位相同」并打通**，
 * > 打通前**禁止** `TIME_RATCHET_UPDATE=1` 绕红。
 *
 * 第 2 次尝试的症状是「锁定路径被**退化/降配两条独立调用**各算各的 `eventStunCount`，
 * corin/lycaon 锁 3/4 **实收 2**」——即同一支锁定队在两条路径上看到不同的失衡次数。
 * ⇒ 本文件的判据就是把这个症状钉死：**锁 N ⇒ 用户意图被原样执行（不缩结构）+ A 前后输出逐位相同**。
 *
 * ## 判据（六条）
 *
 * | # | 判据 | 反证形态（实测见报告 §①） |
 * |---|---|---|
 * | A | 锁 N ⇒ **池次数 = N** 且 **`plannedStunCount` = N**（两个独立消费者同口径） | 池不钉锁定值（CC-300 前行为）⇒ 夹具当场红（可琳锁 3 报池 5 / 叶瞬光报池 2） |
 * | B | 锁 N ⇒ **不降配 / 不轴退化**（`interactionScale === undefined`、`axisFallback === false`） | 闸门失效 ⇒ 红（可琳锁 3 掉 `scale=0.5`、叶瞬光掉 `0.0625`） |
 * | C | 锁 N ⇒ 同 store 连算两次 / 全新 store 再算一次，**三者逐位相同**（= 出处要求的「A 前后输出逐位相同」） | 模块级可变状态 / 跨调用 cfg 残留 / 两条独立调用口径分裂 |
 * | D | **反空洞**：同队的**解锁态**必须处于降配态 ⇒ B 不是空断言 | 夹具换成「本来就不降配」的队 ⇒ D 红 |
 * | E | **源码锁**：退化/降配闸门必须读 `lockedStunCount < 0`、池必须钉 `countStun`，且降配搜索主体不得被删 | 闸门改 `true` ⇒ 源码锁红 |
 * | F | **多档**：同队锁 3 / 锁 4 两档都不得降配或退化（漏闸门只漏一档也会现形） | 只在某些锁值上漏闸门 |
 *
 * ## ⚠ 本文件**有意不钉**的两条（= 替用户裁决，见报告 §③ 问题 2/4）
 *
 * 1. **「池口径连携 = 账本口径连携」**。实测（2026-10-10，隔离 worktree，锁定态）：
 *    池 `chainCountPerStun = 3`（boss 缺省）⇒ `stunPool.chainCountTotal = 3N`；
 *    而每槽账本 `chainCountTotal` 走 `chainCountTotalOverride ?? chainCountPerStun(1) × 计数通道`，
 *    且 1051 另有模块声明（锁 4 ⇒ 账本 8）、1531 为 9。**两个口径本来就不等**，这正是坑 19 记的
 *    「连携/破阵按实际失衡次数（用户裁决 A）」**未落地**项（原文：91/125 队两值差 >0.5、
 *    14 队连携行归零而 UI 仍显示池次数 ⇒ 同一 `resourceResult` 自相矛盾）。
 *    本前置段**不修也不钉**它——钉「相等」= 替用户裁决要不要按裁决 A 收口；
 *    钉「不相等」= 给未来的修法上锁。两者都越界。
 * 2. **「锁定态下 `chainCountPerStun` 取 store 原值还是 cfg 兜底值」**。同一处口径（见
 *    `convergence.ts` 的 `interactions` 契约注释：模块侧拿到的是 **store 原值**，而引擎 cfg 上是
 *    `?? (isSupport ? 0 : 1)` 兜底），两者在用户没调过滑块时**不同值**。属问题 2「模块边界」的裁决面。
 *
 * ## 夹具口径
 *
 * 一律**手组队**（不用 `teamPresets`）：预设库会被重生成，id 与内容都漂过
 * （`interactionsLocked.test.ts` 头注释记着「夹具 id 存活但内容变了」的先例）。
 * `heavy` = 手填交互加码（弹 20 / 闪 30）⇒ 制造**结构性溢出**：解锁态必然进非轴降配，
 * 锁定态必须原样保留并如实上报截断。这正是「corin/lycaon 锁 3/4 实收 2」的历史症状域。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'

/**
 * 锁定夹具。`heavy` = 手填交互加码（弹 20 / 闪 30）⇒ 结构性溢出。
 * 覆盖四类动力学：正反馈连续通道（1051）、链数实数化（1531）、轮数实数化（1431）、定点迭代（1591/1631）。
 */
const LOCK_FIXTURES: Array<{ name: string; team: string[]; lock: number; heavy: boolean }> = [
  { name: '可琳 1061（历史症状队）', team: ['1061', '1141', '1011'], lock: 3, heavy: true },
  { name: '莱卡恩 1141（历史症状队）', team: ['1141', '1011', '1191'], lock: 4, heavy: true },
  { name: '叶瞬光 1431 簇（结构性溢出最重）', team: ['1431', '1481', '1491'], lock: 3, heavy: true },
  { name: '伊德海莉 1051（连续强特通道）', team: ['1051', '1141', '1451'], lock: 4, heavy: true },
  { name: '希格莉德 1591（定点迭代）', team: ['1591', '1481', '1311'], lock: 3, heavy: false },
  { name: '仪玄 1371（净失衡缩放）', team: ['1371', '1481', '1451'], lock: 3, heavy: false },
]

const enc = (v: unknown) => JSON.stringify(v, (_k, x) =>
  typeof x === 'number'
    ? (Number.isNaN(x) ? '#NaN' : !Number.isFinite(x) ? `#${x}` : Object.is(x, -0) ? '#-0' : x)
    : x)

/** 「输出」= 伤害 + 逐槽落点 + 收敛出口 + 截断明细 + 池次数（= 出处要求的「A 前后输出」的可观测面） */
function outputOf(calc: ReturnType<typeof useResourceCalc>): string {
  const rr = calc.resourceResult.value!
  return enc([
    calc.teamTotalDamage.value,
    rr.characters.map(c => [
      c.agentId, c.exSpecialCount, c.ultimateCount, c.chainCountTotal,
      c.timeAllocation.basicAttackTime, c.timeAllocation.necessaryTime, c.timeAllocation.frontlineTime,
    ]),
    rr.plannedStunCount,
    calc.stunPoolResult.value?.stunCount ?? -1,
    rr.convergence?.outerExit, rr.convergence?.interactionScale ?? null, rr.convergence?.axisFallback ?? false,
    rr.overflowSeconds ?? 0,
    (rr.truncationCuts ?? []).map(c => [c.slot, c.moveId, c.countBefore, c.countAfter, c.cutSeconds]),
  ])
}

type Fixture = (typeof LOCK_FIXTURES)[number]

async function withLock(f: Fixture, lock: number) {
  const { catalog, config } = await setupHarness(
    f.team.map(agentId => ({
      agentId,
      ...(f.heavy ? { parryCount: 20, dodgeCounterCount: 30 } : {}),
    })),
  )
  await catalog.loadBuildRecommendations()
  config.interactionsLocked = false // 双保险：本判据只测「锁失衡次数」，不叠加「锁交互」
  config.enemy.stunCountLock = lock
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  expect(rr, `${f.name} 无资源结果`).toBeTruthy()
  return { calc, config, rr: rr! }
}

describe('锁定队逐位相同（坑 19 前置：stunCountLock ≥ 0 ⇒ 用户意图原样执行 + A 前后逐位相同）', () => {
  /** A：两个独立消费者（池次数 = 伤害侧 / `plannedStunCount` = 展示侧）都必须 = 锁定值 */
  it('A 锁 N ⇒ 池次数 = N 且 plannedStunCount = N（两个消费者同口径）', async () => {
    const violations: string[] = []
    for (const f of LOCK_FIXTURES) {
      const { calc, rr } = await withLock(f, f.lock)
      const pool = calc.stunPoolResult.value?.stunCount ?? -1
      if (pool !== f.lock) violations.push(`${f.name}：池次数 ${pool} ≠ 锁 ${f.lock}`)
      if (rr.plannedStunCount !== f.lock) violations.push(`${f.name}：plannedStunCount ${rr.plannedStunCount} ≠ 锁 ${f.lock}`)
    }
    expect(violations, `锁定语义被破坏：\n  ${violations.join('\n  ')}`).toEqual([])
  }, 900_000)

  /** B：锁 N ⇒ 结构不动（不降配、不轴退化）——「锁定 = 用户明确意图，引擎不改结构」 */
  it('B 锁 N ⇒ 不降配（interactionScale=undefined）且不轴退化（axisFallback=false）', async () => {
    const violations: string[] = []
    for (const f of LOCK_FIXTURES) {
      const { rr } = await withLock(f, f.lock)
      if (rr.convergence?.interactionScale !== undefined) {
        violations.push(`${f.name}：锁定态被降配（interactionScale=${rr.convergence.interactionScale}）`)
      }
      if (rr.convergence?.axisFallback === true) violations.push(`${f.name}：锁定态被轴退化（axisFallback=true）`)
    }
    expect(violations, `锁定态结构被改动：\n  ${violations.join('\n  ')}`).toEqual([])
  }, 900_000)

  /**
   * C：**出处逐字要求的那一条**——「`stunCountLock ≥ 0` 的队 A 前后输出逐位相同」。
   * 同一队、同一锁：① 同一 store 连算两次（强制关记忆化，否则第二次拿的是缓存对象、判据退化）
   * ② 全新 store 再算一次。三者必须逐位相同。
   */
  it('C 同 store 连算两次 + 全新 store 一次 ⇒ 三者逐位相同（A 前后输出逐位相同）', async () => {
    const drift: string[] = []
    try {
      setCalcOutputMemoEnabled(false)
      for (const f of LOCK_FIXTURES) {
        const { calc, config } = await withLock(f, f.lock)
        const before = outputOf(calc)
        // 同一 store「后」：显式扰动锁值再复位，逼 computed 重算（关记忆化只挡 `calcOutputMemo` 一层）
        const lock = config.enemy.stunCountLock
        config.enemy.stunCountLock = -1
        void calc.resourceResult.value
        config.enemy.stunCountLock = lock
        const after = outputOf(calc)
        const fresh = await withLock(f, f.lock)
        const freshOut = outputOf(fresh.calc)
        if (before !== after) drift.push(`${f.name}：同 store 前后不同`)
        if (before !== freshOut) drift.push(`${f.name}：同 store 与全新 store 不同`)
      }
    } finally {
      setCalcOutputMemoEnabled(true)
    }
    expect(drift, `锁定队输出不逐位相同：${drift.join('; ')}`).toEqual([])
  }, 900_000)

  /**
   * D：**反空洞**——`heavy` 夹具的**解锁态**必须处于降配态，否则 B 是空断言。
   * 实测解锁态降配档（2026-10-10，隔离 worktree）：可琳 0.375 / 莱卡恩 0.375 / 叶瞬光 0.125 /
   * 伊德海莉 0.5。两支 `heavy=false`（希格莉德 / 仪玄）本就不降配 ⇒ 只对 `heavy` 要求。
   */
  it('D 反空洞：heavy 夹具的解锁态必须处于降配态（否则判据 B 是空断言）', async () => {
    const vacuous: string[] = []
    for (const f of LOCK_FIXTURES) {
      if (!f.heavy) continue
      const { rr } = await withLock(f, -1)
      if (rr.convergence?.interactionScale === undefined) {
        vacuous.push(`${f.name}（解锁态未降配 ⇒ 锁它证明不了什么，换更重的交互加码或换队）`)
      }
    }
    expect(vacuous, `夹具反空洞失败：${vacuous.join('; ')}`).toEqual([])
  }, 900_000)

  /**
   * E：**源码锁**（规则 16①：口径必须挂在活代码上）。
   * 反证形态：把 `lockedStunCount < 0` 改成 `true` ⇒ A/B 变红（实测可琳掉 `scale=0.5`、
   * 叶瞬光掉 `0.0625`、伊德海莉掉 `0.5` 且 `axisFallback=true`）；把池钉那行删掉 ⇒ 池不再 = N。
   */
  it('E 源码锁：闸门按 lockedStunCount 判 / 池钉 countStun / 降配搜索主体仍在', () => {
    const strip = (p: URL) => readFileSync(p, 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    const solveSrc = strip(new URL('../resourceCalc/solveTeam.ts', import.meta.url))
    expect(solveSrc, '锁定闸门必须按 lockedStunCount 判（不得写死 true/false）')
      .toMatch(/if \(lockedStunCount < 0\) \{/)
    expect(solveSrc, '降配搜索主体不得被删（解锁态仍服务难度曲线）')
      .toMatch(/selectDownscaleScale\(candidates/)
    // 池钉到计数通道值的那一行在 convergence.ts（CC-300/CC-305 口径），不在 solveTeam.ts
    const convSrc = strip(new URL('../resourceCalc/convergence.ts', import.meta.url))
    expect(convSrc, '锁定失衡时池次数必须钉到计数通道值（删掉即「锁 3 实收 2」复发）')
      .toMatch(/const lockForPool = stunLockN >= 0 \? countStun : undefined/)
  })

  /** F：同队多档锁定（3/4）都不得降配或退化——抓「只在某些锁值上漏闸门」 */
  it('F 同队锁 3 / 锁 4 两档都不得降配或轴退化', async () => {
    const violations: string[] = []
    for (const f of LOCK_FIXTURES) {
      for (const lock of [3, 4]) {
        const { calc, rr } = await withLock(f, lock)
        if ((calc.stunPoolResult.value?.stunCount ?? -1) !== lock) violations.push(`${f.name} lock=${lock}：池次数偏离`)
        if (rr.plannedStunCount !== lock) violations.push(`${f.name} lock=${lock}：plannedStunCount 偏离`)
        if (rr.convergence?.interactionScale !== undefined) violations.push(`${f.name} lock=${lock}：被降配`)
        if (rr.convergence?.axisFallback === true) violations.push(`${f.name} lock=${lock}：被轴退化`)
      }
    }
    expect(violations, `多档锁定下有档位漏闸门：${violations.join('; ')}`).toEqual([])
  }, 900_000)
})
