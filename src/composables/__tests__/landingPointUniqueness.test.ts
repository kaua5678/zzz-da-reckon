/**
 * 「**同输入落点唯一**」判据（T115 前置段 ①，2026-10-10）——替代已删的 `seedInvariance.test.ts`。
 *
 * ## 为什么需要重写而不是从 git 复活旧的
 *
 * 手册（`ENGINE_PIPELINE_GUIDE.md` §4 坑 17）曾把 `seedInvariance.test.ts` 列为种子不变性护栏，但该文件
 * 随热启动缓存一起在 **CC-147（`08b4d40d`，2026-09-28）** 删除，同批删的还有 `warmStart.test.ts`。
 * 删除的**前提已变**：旧判据的核心是「换 `initialStates` 注入种子 ⇒ 落点不变」，而 CC-147 把**注入通道本身
 * 删掉了**（`calcTeamResources` 恒从默认零种子起跑，见 `core/resource.ts` 的
 * `@fact engine:收敛环停点规范化`）——旧测试的输入面已不存在，复活它只会得到一条恒绿的假护栏。
 * ⇒ 按**当前架构**重写：落点唯一性现在的可证伪面 = ①全管线同配置重复运行 ②**内层不动点 API 面**的
 * 进入相位（`runInnerLoop(from, ctx)` 的 `from` 仍是活输入）③逐字段初值扰动。
 *
 * ## 判据（四条，都钉「可观测落点」而不是内部实现）
 *
 * | # | 判据 | 反证形态（实测见报告 §①） |
 * |---|---|---|
 * | ① | 全管线：同配置 × 全新 store × 3 次 ⇒ 伤害 + 逐槽落点逐位相同 | 模块级可变状态 / 跨调用 cfg 残留 |
 * | ② | 内层不动点：4 种进入相位（零/均分/高/低初值）⇒ **同一停点** | `integerCycleStop` 退化成「首个入环成员」⇒ `sigrid` 夹具当场红（`uniq=2/4`） |
 * | ③ | 逐字段初值扰动（11 个 `IterationState` 字段各扰一次）⇒ 落点不动 | 同上；比 ② 更细，能抓「只对某个字段敏感」的路径 |
 * | ④ | **活性**：初值真的进映射（`iterate` 的首轮输出随初值变） | 防判据退化成恒等式（CC-147 之前「种子通道断了而判据仍绿」正是这个形态） |
 *
 * ⚠ 判据②③ 为什么必须含**真整数环**夹具：判稳是**严格相等**，真环才走 `integerCycleStop`
 * （`innerLoop.ts`）；若夹具全是 clean 收敛，② 就退化成「不动点唯一」的平凡命题。故 ④ 之外另设
 * **反空洞断言**：夹具集里至少一支 `clean === false`（= 真环被检出），否则判据没被走到。
 *
 * ⚠ **不钉具体数值**：本文件只断言「相等/不等」，不写死次数与伤害——落点数值归 `timeGolden` /
 * `timeFillRatchet`（本仓既定分工），这里钉的是**函数性**（同输入 ⇒ 同输出）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import { runInnerLoop } from '@/core/resource/innerLoop'
import { iterate } from '@/core/resource/helpers'
import type { CharacterOperationConfig, IterationState, ResourceCalcConfig } from '@/types/resource'

/**
 * 手组队夹具（**不用 `teamPresets`**：预设库会被重生成，id 与内容都漂过——
 * `interactionsLocked.test.ts` 头注释记着「夹具 id 存活但内容变了」的先例）。
 * 覆盖已实数化（1051/1531/1431）+ 定点迭代（1591/1631 族）+ 周期环（1611 族）四类动力学。
 */
const FIXTURES: Array<{ name: string; team: string[] }> = [
  { name: 'yidhari(1051) 连续强特通道', team: ['1051', '1141', '1451'] },
  { name: 'billy(1531) 链数实数化', team: ['1531', '1571', '1451'] },
  { name: 'yeshuguang(1431) 轮数实数化', team: ['1431', '1481', '1491'] },
  { name: 'sigrid(1591) 敛枪式定点迭代', team: ['1591', '1481', '1311'] },
  { name: 'claret(1611) 锐能逐轮试', team: ['1611', '1621', '1211'] },
  { name: 'yixuan(1371) 净失衡缩放', team: ['1371', '1481', '1451'] },
]

/** 落点字段全集（`IterationState` 里所有引擎自己解出来的量；`energySource` 快照是派生量，不入判据） */
const LANDING_KEYS = [
  'exSpecialCount', 'ultimateCount', 'basicAttackTime', 'necessaryTime', 'necessaryUncappedTime',
  'frontlineTime', 'backstageTime', 'totalEnergy', 'totalDecibel', 'chainCountTotal',
  'comboAlignTime', 'comboAlignCredit', 'dynamicComboAlignSeconds',
] as const

const enc = (v: unknown) => JSON.stringify(v, (_k, x) =>
  typeof x === 'number'
    ? (Number.isNaN(x) ? '#NaN' : !Number.isFinite(x) ? `#${x}` : Object.is(x, -0) ? '#-0' : x)
    : x)

/** 落点 = 引擎解出来的状态向量（与进入相位无关的那部分） */
function landingOf(states: readonly IterationState[]): string {
  return enc(states.map(s => LANDING_KEYS.map(k => (s as unknown as Record<string, unknown>)[k])))
}

/** 全队快照（含 undefined 键 ⇒ 用 structuredClone 而非 JSON 往返：`exReservedCount !== undefined` 是活判据） */
function snapshotConfig(calc: ReturnType<typeof useResourceCalc>): ResourceCalcConfig {
  return structuredClone(calc.resourceConfig.value!)
}

function ctxOf(cfg: ResourceCalcConfig) {
  return { configs: cfg.characters as CharacterOperationConfig[], config: cfg, maxIter: 100 }
}

/** 4 种进入相位：零种子 / 均分平A / 高次数高资源 / 低次数低资源 */
function seedOf(cfg: ResourceCalcConfig, kind: 'zero' | 'weighted' | 'high' | 'low'): IterationState[] {
  const zero = cfg.characters.map(() => ({
    basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0,
    totalEnergy: 0, totalDecibel: 0, necessaryTime: 0, frontlineTime: 0, backstageTime: 0,
    comboAlignTime: 0, comboAlignCredit: 0,
  } as unknown as IterationState))
  const T = cfg.totalTime
  switch (kind) {
    case 'weighted': return zero.map(s => ({ ...s, basicAttackTime: T / 3, frontlineTime: T / 3 }))
    case 'high': return zero.map(s => ({ ...s, exSpecialCount: 12, ultimateCount: 3, totalEnergy: 900, totalDecibel: 6000 }))
    case 'low': return zero.map(s => ({ ...s, exSpecialCount: 1, ultimateCount: 1, totalEnergy: 120, totalDecibel: 400 }))
    default: return zero
  }
}

const PHASES = ['zero', 'weighted', 'high', 'low'] as const

describe('同输入落点唯一（替代 seedInvariance；CC-147 删注入通道后按当前架构重写）', () => {
  /**
   * ① 全管线：同一份配置，**全新 store** 各跑一次 ⇒ 伤害与逐槽落点逐位相同。
   * 这一条覆盖「模块级可变状态 / 上一支队伍的残留 cfg 键 / 记忆化串味」——
   * 与 `allAgentsGuards` ③「历史无关」互补：那里查的是**同 store 走 B→A**，这里查**全新 store 重复**。
   */
  it('① 全管线：全新 store × 3 次 ⇒ 伤害 + 逐槽落点逐位相同', async () => {
    const drift: string[] = []
    try {
      setCalcOutputMemoEnabled(false) // 记忆化会把同一对象还回来 ⇒ 重复运行判据会退化成恒等式
      for (const f of FIXTURES) {
        const runs: string[] = []
        for (let i = 0; i < 3; i++) {
          const { catalog } = await setupHarness(f.team.map(agentId => ({ agentId })))
          await catalog.loadBuildRecommendations()
          const calc = useResourceCalc()
          const rr = calc.resourceResult.value
          expect(rr, `${f.name} 无资源结果`).toBeTruthy()
          runs.push(enc([
            calc.teamTotalDamage.value,
            rr!.characters.map(c => [
              c.exSpecialCount, c.ultimateCount, c.chainCountTotal,
              c.timeAllocation.basicAttackTime, c.timeAllocation.necessaryTime, c.timeAllocation.frontlineTime,
            ]),
            rr!.convergence?.outerExit,
            rr!.overflowSeconds ?? 0,
          ]))
        }
        if (new Set(runs).size !== 1) drift.push(`${f.name}（${new Set(runs).size} 个不同落点）`)
      }
    } finally {
      setCalcOutputMemoEnabled(true)
    }
    expect(drift, `同配置重复运行落点漂移：${drift.join('; ')}`).toEqual([])
  }, 900_000)

  /**
   * ② 内层不动点：4 种进入相位 ⇒ 同一停点。**这是本文件的主判据**——
   * `runInnerLoop(from, ctx)` 的 `from` 仍是活输入（CC-147 删的是 `calcTeamResources` 的注入通道，
   * 不是内层 API），所以「换初值落点不变」在当前架构下**仍可证伪**，且它正是真整数环
   * `integerCycleStop`（不透支成员中次数最多者 + JSON 字典序兜底）的设计目标。
   */
  it('② 内层不动点：4 种进入相位（零/均分/高/低初值）⇒ 同一停点', async () => {
    const drift: string[] = []
    const cycleTeams: string[] = []
    for (const f of FIXTURES) {
      const { catalog } = await setupHarness(f.team.map(agentId => ({ agentId })))
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      const cfg0 = snapshotConfig(calc)
      const landings = new Map<string, string>()
      for (const kind of PHASES) {
        // 每个相位用**独立克隆**：避免把「同一 cfg 被上一相位写过诊断量」当成相位效应
        const r = runInnerLoop(seedOf(cfg0, kind), ctxOf(structuredClone(cfg0)))
        landings.set(kind, landingOf(r.end))
        if (r.clean === false) cycleTeams.push(`${f.name}/${kind}`)
      }
      const uniq = new Set(landings.values())
      if (uniq.size !== 1) {
        drift.push(`${f.name}（${[...landings].map(([k, v]) => `${k}=${v}`).join(' ')}）`)
      }
    }
    // 反空洞：判据必须真的走到过「真整数环停点」这条路径，否则②只是「不动点唯一」的平凡命题
    expect(cycleTeams.length, '夹具集里没有任何一支落进真整数环 ⇒ 判据② 未覆盖 integerCycleStop，请换夹具').toBeGreaterThan(0)
    expect(drift, `落点随进入相位变化（不动点不唯一）：${drift.join('; ')}`).toEqual([])
  }, 900_000)

  /**
   * ③ 逐字段初值扰动：11 个 `IterationState` 字段各单独扰一次 ⇒ 落点不动。
   * 比②更细：②只扰 4 个组合，③能抓「只对某个字段敏感」的路径（例如 `comboAlignCredit` 被当输入读）。
   */
  it('③ 逐字段初值扰动 ⇒ 落点不动（每个 IterationState 字段各扰一次）', async () => {
    const PERTURB = [
      'exSpecialCount', 'ultimateCount', 'basicAttackTime', 'necessaryTime', 'necessaryUncappedTime',
      'frontlineTime', 'backstageTime', 'totalEnergy', 'totalDecibel', 'chainCountTotal',
      'comboAlignTime', 'comboAlignCredit', 'dynamicComboAlignSeconds',
    ] as const
    const drift: string[] = []
    for (const f of FIXTURES) {
      const { catalog } = await setupHarness(f.team.map(agentId => ({ agentId })))
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      const cfg0 = snapshotConfig(calc)
      const ref = landingOf(runInnerLoop(seedOf(cfg0, 'zero'), ctxOf(structuredClone(cfg0))).end)
      for (const key of PERTURB) {
        const seed = seedOf(cfg0, 'zero').map(s => ({
          ...s,
          [key]: key === 'basicAttackTime' || key === 'frontlineTime' ? 40 : 7,
        }))
        const got = landingOf(runInnerLoop(seed, ctxOf(structuredClone(cfg0))).end)
        if (got !== ref) drift.push(`${f.name}/${key}`)
      }
    }
    expect(drift, `落点对初值字段敏感（这些字段被当输入读了）：${drift.join(', ')}`).toEqual([])
  }, 900_000)

  /**
   * ④ 活性（反空洞）：初值**真的**进映射——`iterate` 的首轮输出必须随初值变。
   * 没有这一条，②③ 在「初值被忽略」时也会全绿（那正是 CC-147 之前「种子通道断了而判据仍绿」的形态）。
   */
  it('④ 活性：初值真的进映射（iterate 首轮输出随初值变）', async () => {
    const dead: string[] = []
    for (const f of FIXTURES) {
      const { catalog } = await setupHarness(f.team.map(agentId => ({ agentId })))
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      const cfg0 = snapshotConfig(calc)
      const a = enc(iterate(ctxOf(cfg0).configs, seedOf(cfg0, 'zero'), structuredClone(cfg0)))
      const b = enc(iterate(ctxOf(cfg0).configs, seedOf(cfg0, 'high'), structuredClone(cfg0)))
      if (a === b) dead.push(f.name)
    }
    expect(dead, `初值不进映射（判据②③ 会退化成恒等式）：${dead.join(', ')}`).toEqual([])
  }, 900_000)
})
