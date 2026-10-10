/**
 * 「**同输入落点唯一**」判据（T115 前置段 ①，2026-10-10）——替代已删的 `seedInvariance.test.ts`；
 * **T132 复核后四条全留**（结论、实测证据与否决留痕见下方「T132 复核」段）。
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
 * | ② | 内层不动点：4 种进入相位（零/均分/高/低初值）⇒ **同一停点** | 停点选取键退化成「首个入环成员」⇒ `sigrid` 当场红（实测 `uniq=2/4`）。⚠ 只钉**相位无关**，不钉具体选取键（见 T132 复核） |
 * | ③ | 逐字段初值扰动（13 个 `IterationState` 字段各扰一次）⇒ 落点不动 | 同上；比 ② 更细，能抓「只对某个字段敏感」的路径 |
 * | ④ | **活性**：初值真的进映射（`iterate` 的首轮输出随初值变） | 防判据退化成恒等式（CC-147 之前「种子通道断了而判据仍绿」正是这个形态） |
 *
 * ⚠ 判据②③ 为什么必须含**真整数环**夹具：判稳是**严格相等**，真环才走 `integerCycleStop`
 * （`innerLoop.ts`）；若夹具全是 clean 收敛，② 就退化成「不动点唯一」的平凡命题。故 ④ 之外另设
 * **反空洞断言**：夹具集里至少一支 `clean === false`（= 真环被检出），否则判据没被走到。
 *
 * ⚠ **不钉具体数值**：本文件只断言「相等/不等」，不写死次数与伤害——落点数值归 `timeGolden` /
 * `timeFillRatchet`（本仓既定分工），这里钉的是**函数性**（同输入 ⇒ 同输出）。
 *
 * ## T132 复核（2026-10-10）：四条**全留**，但②③④的**理由被改写**（原理由已过期）
 *
 * 用户裁决「简化它：只留基本检查」。**否决 (A) 只留 ①**，理由 = 实测 ②③④ 仍在守真东西（下表），
 * 且 ②③ 是**唯一**能拦住某些退化的网。**但原头注释给 ②③ 的理由（防种子通道）确已过期**，
 * 故就地改写为实测支持的理由——这是「改判据的理由」，不是「删判据」。
 *
 * ### 反证实测（隔离 worktree `c7530301`，逐个改引擎后跑；「生产网」= timeGolden + timeFillRatchet
 * + determinism + allAgentsGuards + allAgentsSweep + stunCountLockInvariant + floatNoiseCycle
 * + comboAlignBudget + dynamicComboAlign + yidhariInteractionGrid + timeLedgerInvariants
 * + decibelRowParity + energyRowParity + truncationRefold + comboAlignLedgerInvariant，共 15 文件 366 例）
 *
 * | 改动（模拟退化） | 本文件 | 生产网 | 谁唯一拦住 |
 * |---|---|---|---|
 * | `innerLoop.ts` 判稳改 ε（`1e-9` 或 `1e-6`） | ②③ 红 | **全绿** | **只有 ②③** |
 * | `integerCycleStop` 改「首个入环成员」`members[0]` | ②③ 红 | 红 | 两者 |
 * | `integerCycleStop` 退回 CC-326 前口径（全体 `jsonMinMember`） | **全绿** | 红 | 只有生产网 |
 * | `runInnerLoop` 完全忽略 `from` | **全绿** | 红 | 只有生产网 |
 * | `iterate` 忽略 `prevStates` | ②④ 红（**③ 绿**） | 红 | 两者 |
 * | `iterate` 读陈旧 `prevStates.necessaryTime` / `backstageTime` | ②③ 红 | 红 | 两者 |
 *
 * **②③ 的真实主体 = 「内层停点只依赖环本身，与进入相位无关」**，不是「防种子通道」：
 * ① ε 判稳是**唯一只有 ②③ 能拦**的退化（生产网全绿——因为生产在 pass0 恒喂同一相位，
 *    ε 留下的 ~1e-12 残差在**那条路径**上不改变终局；只有换相位才暴露）⇒ ②③ 是这条的**专属网**；
 * ② `runInnerLoop(from, ctx)` 的 `from` 在生产**不是死输入**：探针实测 1431 簇 236 次调用里
 *    **177 次**收到非默认相位（折叠环 pass>0 喂的是上一轮收敛态，非零种子）、1051 58/78、
 *    1591 11/14、1531 4/8 ⇒ 「换相位 ⇒ 同停点」是**活性质**（它保证多 pass 折叠环良定义）。
 *
 * ### 诚实边界（别把 ②③ 说大了）
 * · **原头注释的理由是错的**：CC-147 已删注入种子通道 ⇒ ②③ 不防「种子通道」，防的是**停点选取键**；
 *   且它们**拦不住真正的 CC-326 回退**（`jsonMinMember(members)` 仍是相位无关的，故 ②③ 全绿——
 *   那一档归 timeGolden）。②③ 钉的是**相位无关**这个更窄的性质。
 * · **该性质不是全域定律**：200 个随机相位下 1051 出现**第 2 个落点**（与零相位差 `7.1e-15` 相对
 *   `3.6e-15`，纯 ulp 噪声）⇒ ②③ 的「4 相位逐位相同」是**所选相位**成立，不是任意相位成立。
 *   若将来有人改 `PHASES` 的取值，② 可能因 ulp 噪声变红——**那是判据脆，不是引擎坏**（先查这里）。
 * · **④ 不是 ②③ 的附属**：`iterate` 忽略 `prevStates` 时 **③ 仍绿**（ref 与扰动同走坏路径 ⇒ ③
 *   自己退化成恒等式），是 **④** 抓出来的 ⇒ ④ 有独立检测力，删 ②③ 也不能删 ④。
 *
 * ### 否决记录（规则 16③：试过又放弃的方案）
 * · **(A) 只留 ①、删 ②③④** —— **否决**。反例 = ε 判稳：删掉后该退化**无任何网可拦**（15 文件
 *   366 例 + timeGolden/timeFillRatchet 全绿）；且 `from` 在生产是活输入（177/236），删 ②③ 等于
 *   把「多 pass 折叠环良定义」这条性质变成无人守。
 * · **什么条件下该重新考虑删**：① 若将来 `runInnerLoop` 的调用方全部改成只喂默认零种子（`from`
 *   不再是上一轮收敛态），②③ 的相位无关性才真的失去生产对象；② 若 ε 判稳被正式裁决采纳
 *   （那要先改 `innerLoop.ts` 的判稳注释与 `engine:判稳含平A时间` 口径），②③ 的专属检测力随之归零。
 *   两条都未发生 ⇒ 保留。**加回来/删掉的判据都以此段为准，别只凭「原始 bug 已不可能」就删。**
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
   * ② 内层不动点：4 种进入相位 ⇒ 同一停点。
   * **它守的是「相位无关」这条性质本身**（T132 实测）：`runInnerLoop(from, ctx)` 的 `from` 在生产是
   * **活输入**（折叠环 pass>0 喂上一轮收敛态；探针实测 1431 簇 236 次调用里 177 次非默认相位），
   * 且这是**唯一**能拦住「判稳改 ε」的网（生产网 15 文件 366 例全绿而本条红）。
   * ⚠ 它**不**钉 `integerCycleStop` 的具体选取键——退回 CC-326 前口径时本条仍绿（那一档归 timeGolden）；
   * 详见文件头「T132 复核」段。
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
   * ③ 逐字段初值扰动：13 个 `IterationState` 字段各单独扰一次 ⇒ 落点不动。
   * 比②更细：②只扰 4 个组合（实际非零的只有 6 个字段），③覆盖全部 13 个，能抓「只对某个字段敏感」的路径。
   * ⚠ T132 实测：13 个里**只有 4 个**（ex/ult/bat/chainCountTotal）真进 `iterate` 首轮映射，其余 9 个
   * 对该扰动是恒真式（无害：它们是**负向**断言——真有人把 `necessaryTime` 当输入读，③ 会红，
   * 反证实测 G 已验）。**③ 有独立检测力**：`iterate` 忽略 `prevStates` 时 ②④ 红而 **③ 仍绿**
   * （ref 与扰动同走坏路径 ⇒ ③ 自己退化成恒等式）——故 ③ 与 ④ 互补，不是重复。
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
   * T132 实测：`iterate` 忽略 `prevStates` 时 **②④ 红而 ③ 绿** ⇒ ④ 有独立检测力（不是 ②③ 的附属），
   * 删 ②③ 也不能删 ④。详见文件头「T132 复核」段。
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
