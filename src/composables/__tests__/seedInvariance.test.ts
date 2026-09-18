/**
 * 落点不变性（原「种子不变性」，2026-08 立；2026-09-05 按用户口径改判据）。
 *
 * 原断言：任意初值 → **逐位**同一收敛态。它想防的是不动点滞回（12/3 vs 12/4 那种翻脸），
 * 但把"逐位相等"当成了目标本身——而那只是实数化收敛的**副产品**，不是游戏性质。
 * 实测 124 个预设里 13 队（10%）落点随初值变，其中 7 队只差浮点末位、2 队差 1 次、3 队差 2 次；
 * 而用户可见的稳定性（同配置连续计算不许变）由 warmStart / determinism 逐位守着，本文件不重复承担。
 * ⇒ 判据分两档，见 describe 上方注释。
 *
 * **2026-09-18 追加第三档（批 1-0「债 1b 证伪闸门执行器」）**：全库预设 × 冷/高/低三种子，
 * 次数落点逐位相等 + 时间账只许「守恒式再分配」。它要回答的是一个**债务前提**问题，不是
 * 「再多一条回归」——详见文件末尾 describe 上方注释（绿 ⇒ 债 1b 前提被证伪；红 ⇒ 违反队即
 * 批 1-2 首批目标）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources, clearWarmStartCache, TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import { netFrontlineOccupation } from '@/core/resource/helpers'
import { teamPresets } from '@/data/teamPresets'
import type { ResourceCalcConfig, IterationState } from '@/types/resource'

const captured: ResourceCalcConfig[] = []
vi.mock('@/core/resource', async () => {
  const actual = await vi.importActual<typeof import('@/core/resource')>('@/core/resource')
  return {
    ...actual,
    calcTeamResources: (config: ResourceCalcConfig) => {
      if (captured.length < 4) captured.push(JSON.parse(JSON.stringify(config)))
      return actual.calcTeamResources(config)
    },
  }
})

beforeEach(() => {
  mockStaticFetch()
})

/** 高种子：模拟「从上次收敛态/任意邻域初值出发」的极端情形 */
function inflatedSeed(cfg: ResourceCalcConfig): IterationState[] {
  return cfg.characters.map(c => ({
    basicAttackTime: 5,
    exSpecialCount: 50,
    ultimateCount: 8,
    chainCountTotal: c.chainCountTotalOverride ?? c.chainCountPerStun * 4,
    totalEnergy: 9999,
    totalDecibel: 99999,
    necessaryTime: 50,
    frontlineTime: 60,
    backstageTime: 120,
    comboAlignTime: 10,
  }))
}

function fingerprint(rr: ReturnType<typeof calcTeamResources>) {
  return {
    counts: rr.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`),
    basics: rr.characters.map(c => (c.timeAllocation as any).basicAttackTime.toFixed(6)),
    decibels: rr.characters.map(c => ((c as any).decibelSource?.total ?? 0).toFixed(6)),
    converged: rr.converged,
  }
}

async function setupCapture(team: [string, string, string], engines: [string, string, string]) {
  captured.length = 0
  newPinia()
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let s = 0; s < 3; s++) {
    config.setAgent(s, team[s])
    if (engines[s]) config.setWEngine(s, engines[s])
  }
  const calc = useResourceCalc()
  void calc.resourceResult.value
  expect(captured.length).toBeGreaterThan(0)
  return JSON.parse(JSON.stringify(captured[0])) as ResourceCalcConfig
}

/**
 * 落点判据分两档（用户口径 2026-09-05「以游戏逻辑为主，检测也该改」）：
 *
 * - **逐位相等**：只留给**已完成实数化松弛**的角色（伊德海莉 targeted 前例 + 2026-09-06 起
 *   星徽·比利链数实数化）。对它们逐位是可达标准，放松等于放弃已有成果——所以这条不降档。
 * - **游戏等价**（已无用例，保留档位说明）：未实数化的整数结构模块队从荒谬初值出发可以落到
 *   相邻整数组合（"这一轮多打一次强特"本来就是手法差异，不是 bug）；**逐位相等从来不是游戏
 *   性质，而是实数化收敛的副产品**。原比利/琉音样例 2026-09-06 升回逐位后，本档暂无驻场
 *   用例——再有新的整数结构模块队回归到此档。
 */
describe('连续松弛·落点不变性', () => {
  it('伊德海莉+莱卡恩+卢西娅（已实数化）：零种子 vs 高种子 → 逐位同一收敛态', async () => {
    const cfg = await setupCapture(['1051', '1141', '1451'], ['14105', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })
    const fc = fingerprint(cold), fh = fingerprint(hot)
    console.log('cold', JSON.stringify(fc)); console.log('hot ', JSON.stringify(fh))
    expect(fh).toEqual(fc)
    expect(cold.converged).toBe(true)
  })

  it('星徽·比利+琉音+卢西娅（比利链数已实数化）：零种子 vs 高种子 → 逐位同一收敛态', async () => {
    const cfg = await setupCapture(['1531', '1481', '1451'], ['13019', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))!
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })!
    // 2026-09-06 比利链数实数化（1051 骨架）：本队升回逐位档——次数/平A/喧响全部逐位相等
    const fc = fingerprint(cold), fh = fingerprint(hot)
    expect(fh).toEqual(fc)
    // 两种初值都必须过硬不变量：净占用不超战斗时间（超了就是"声称打了 190s"）。
    // 留白不在这里断言——那是 timeFillRatchet 逐队钉的（125 队各有基线）。
    const budget = cfg.totalTime - (cfg.invincibleTime ?? 0)
    const used = netFrontlineOccupation(cold)
    expect(used).toBeLessThanOrEqual(budget + 1)
    expect(cold.converged).toBe(true)
    expect(hot.converged).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 第三档：全库预设 × 冷/高/低三种子 —— 债 1b 的证伪闸门执行器（批 1-0，2026-09-18）
// ---------------------------------------------------------------------------

/**
 * 本档要回答的**不是**「再多一条回归」，而是一个债务前提问题（R22 分诊 §1.5 债 1b）：
 *
 * > 前提假设：「未实数化的整数结构模块，其落点会随初值差 ±1 次强特」。
 *
 * 它的历史依据是 `core/resource/helpers.ts` 可行性封顶处的 `debt:` 注释（「实测琉音 24/23」），
 * 但那是 **2026-09-04 前后的读数**。R22 分诊在 `956d85a` 上复测：104 队次数落点对初值**不敏感**，
 * 唯一变的是 `auto-1591-1571-1211` 的亚秒级时间再分配。⇒ 本档就是那条复测的**机器化**：
 *
 * - **本用例绿** ⇒ 前提假设被**证伪**（找不到任何违反队）⇒ 债 1b 应**销号/降级**，
 *   而不是继续按 10 个模块清单铺开「逐模块实数化」（批 1-2 的收益随之大减）。
 * - **本用例红** ⇒ 前提为真，**失败信息里点名的队就是批 1-2 的首批目标**
 *   （比按模块清单猜更准：红队清单直接给出「谁在移动落点」）。
 *
 * 它为什么必须存在（而不只是再跑一遍分诊探针）：分诊探针在 `/tmp` 里、跑完即弃；
 * 债务注释里的量化依据一旦再次漂移，没有任何机器面会发现。本档把「落点对初值不敏感」
 * 变成**会红的 CI 判据**——这才叫「把注释升级成判据」。
 *
 * 判据三条（对应 R22 分诊「批 1-0」表的 ①②③）：
 * ① **次数落点逐位相等**（主判据）：`exSpecialCount` / `ultimateCount` / `chainCountTotal`
 *    逐槽逐位。这是「游戏性质」面——次数变了就是「这一轮多打一次强特」的手法差异，不是浮点噪声。
 * ② **时间账只许守恒式再分配**：`basicAttackTime` 差 ≤ `TIME_BUDGET_TOLERANCE_SECONDS`
 *    **且** `necessaryTime` 反向等量（一个增、一个减，和不变）。这是**允许**的差异面，
 *    显式写出来而不是「差不多」——分诊实测唯一动的 `auto-1591-1571-1211` 正是此形
 *    （`basicAttackTime −0.742360` + `necessaryTime +0.388220`，**Δ和 −0.354140**，次数逐位不变；
 *    本档复现数字见报告）。**Δ和**才是它的要害：只卡「各自 ≤1s」会把「平A 与必要时间**同向**
 *    各涨 0.6s」（= 总账凭空多 1.2s，非守恒）放过去；故判据② = 反向（`dBasic × dNecessary ≤ 0`）
 *    **且** `|dBasic| ≤ TOL` **且** `|dBasic + dNecessary| ≤ TOL`（分诊那条 Δ和 −0.354 ≠ 0，
 *    所以不能要求 Δ和 精确为 0，只能要求它落在容差内——这正是复用该常量的原因）。
 * ③ 任一队违反 ①② ⇒ 红并列名该队（`preset.name(id)` + 槽位 + `agentId` + 逐字段冷/热读数）。
 *
 * **容差来源**：`TIME_BUDGET_TOLERANCE_SECONDS`（`src/core/resource.ts`，单一事实源）——
 * 规则 11 不许新造常量。口径依据：该常量是「量化（floor 次数）导致的残差属合轴可覆盖」的
 * 既有裁决，欠打回填门控与队伍对比超时判定共用；本档的「允许差异面」与它同源，故复用它。
 * ⚠ 它**不是** `timeGolden` 的容差（那是快照 diff，判据完全不同，别混用——R22 分诊点名的风险）。
 *
 * **四种子**（`cold` 缺省 / `hot` = 既有 `inflatedSeed` / `low` = 全 0 / `calibration` = 分诊原形态）：
 * 规格要求的是**冷/高/低三组**；高与低**不同形**（高种子是「从上次收敛态/邻域出发」，低种子是
 * 「比冷启动更小的下界」——冷种子的平A池、连携数、开局喧响都 > 0），故「低」不是「高」的镜像。
 * 第 4 组「校准」是**实测补的**：前 3 组在本档上时间账差异为**空集**（104 队 × 3 组 = 0 条），
 * 断言② 会退化成永不触发的死判据；校准种子复现了分诊实测唯一会移动落点的那一形态
 * （`auto-1591-1571-1211`），让断言② 有真实样本，并由 `ledgerExercised > 0` 自检钉住活性。
 * 覆盖面因此**只增不减**（3 → 4 组，未减任何一队）。
 *
 * **热启动缓存隔离**：`calcTeamResources` 内建收敛态缓存（`storeWarmStart`，冷调用会写）。
 * 若不隔离，后跑的种子会命中「上一次调用的收敛态」而不只是「本次注入的种子」，断言就不再
 * 只测种子敏感性。故每个种子调用前 `clearWarmStartCache()`——与 `determinism` / `warmStart`
 * 两个专项测试同一手法（`core/resource.ts` 已导出该函数，无需新造）。
 *
 * ⚠ **两个假绿陷阱（本档实测踩过，已在代码里各钉一道兜底断言）**：
 * ① 文件头 `vi.mock` 的拦截器是 `if (captured.length < 4) push(...)`：**不清空缓冲**的话
 *    `captured[0]` 会永远是第一队的 cfg，「104 队」实际是「同一队跑 104 次」⇒ 循环内
 *    `captured.length = 0` + 身份断言（捕获 cfg 的 agentId 必须 == 预设 team）。
 * ② `captured[0]` 之外的调用是**搜索路径上的 cfg**（降配二分/轴搜索，`converged=false`），
 *    拿它当基准会得到整片错误的读数。
 */
describe('全库预设·四种子落点不变性（债 1b 证伪闸门）', () => {
  /**
   * 低种子：**比冷种子更小的初值**（全 0），刻意不与 `inflatedSeed` 同形。
   * 冷种子的平A池 = 按 `timeWeight` 分到的预算、连携 = `chainCountPerStun × 失衡计划`、
   * 喧响 = `initialDecibelGift`，都 > 0 ⇒ 全 0 是一个真正的下界，而不是「高种子取负」。
   */
  function lowSeed(cfg: ResourceCalcConfig): IterationState[] {
    return cfg.characters.map(() => ({
      basicAttackTime: 0,
      exSpecialCount: 0,
      ultimateCount: 0,
      chainCountTotal: 0,
      totalEnergy: 0,
      totalDecibel: 0,
      necessaryTime: 0,
      frontlineTime: 0,
      backstageTime: 0,
      comboAlignTime: 0,
    }))
  }

  /**
   * **校准种子**（第 4 组，R22 分诊探针 `seedCensus2` 的「lo」形态原样）：
   * 平A 给到 60s（远超任何槽的平A池）、必要时间给 0 —— 这是**实测唯一能移动落点**的形态。
   *
   * 为什么必须有它：**断言② 的「允许差异面」在本档前 3 组种子上是空集**（实测 104 队 ×
   * 冷/高/低 = 时间账 0 条差异）。一条「允许某类差异」的断言若从来没有样本落进去，它就是
   * 死判据——将来真出现非守恒再分配时，没人知道这条断言还活着没有。校准种子复现了分诊
   * 实测的那一条（`auto-1591-1571-1211`：`ΔbasicAttackTime −0.742360` /
   * `ΔnecessaryTime +0.388220` / `Δ和 −0.354140`，次数逐位不变），让断言② 有真实样本通过，
   * 并由下面的 `ledgerExercised > 0` 自检把这件事**钉成机器判据**（空集 ⇒ 红）。
   */
  function calibrationSeed(cfg: ResourceCalcConfig): IterationState[] {
    return cfg.characters.map(() => ({
      basicAttackTime: 60,
      exSpecialCount: 0,
      ultimateCount: 0,
      chainCountTotal: 0,
      totalEnergy: 0,
      totalDecibel: 0,
      necessaryTime: 0,
      frontlineTime: 60,
      backstageTime: 120,
      comboAlignTime: 0,
    }))
  }

  /** 主判据指纹：**次数落点逐位**（逐槽，含槽位与 agentId 以便失败时点名到人） */
  function countFingerprint(rr: NonNullable<ReturnType<typeof calcTeamResources>>) {
    return rr.characters.map(c => ({
      slot: c.slot,
      agentId: c.agentId,
      ex: c.exSpecialCount ?? 0,
      ult: c.ultimateCount ?? 0,
      chain: c.chainCountTotal ?? 0,
    }))
  }

  /** 时间账逐槽读数（仅用于断言②与失败信息，不参与主判据） */
  function timeLedger(rr: NonNullable<ReturnType<typeof calcTeamResources>>) {
    return rr.characters.map(c => ({
      slot: c.slot,
      agentId: c.agentId,
      basic: c.timeAllocation.basicAttackTime,
      necessary: c.timeAllocation.necessaryTime,
    }))
  }

  it('全库预设 × 冷/高/低/校准 → 次数落点逐位相等，时间账仅守恒式再分配', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 与 `timeGolden` 同口径：`teamPresets` 已展开难度变体（`expandVariants`），此处只滤槽数
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    expect(presets.length, '全库预设数为 0：`@/data/teamPresets` 未加载').toBeGreaterThan(0)

    /** ① 主判据违反清单（次数落点） */
    const countViolations: string[] = []
    /** ② 允许差异面违反清单（时间账非守恒式再分配） */
    const ledgerViolations: string[] = []
    /** ② 的**活性计数**：真正落进「允许面」的槽数（0 ⇒ 断言② 是死判据，见下方自检） */
    let ledgerExercised = 0
    /** 覆盖计数：确保没有「因错误的原因通过」（预设被静默跳过 = 假绿） */
    let covered = 0
    /** 未取到 cfg 的预设（正常路径应为 0；非 0 说明捕获口径失效，必须显式红而不是静默跳过） */
    const uncaptured: string[] = []

    for (const p of presets) {
      const team = p.team as [string, string, string]
      // ⚠ **必须清空捕获缓冲**：文件头 `vi.mock` 的拦截器是 `if (captured.length < 4) push(...)`
      // ——不清空的话缓冲在第一队之后**永久装满**，`captured[0]` 会一直是**第一队**的 cfg，
      // 于是「104 队」实际是「同一队跑 104 次」（假绿：断言全绿但覆盖面为零；反向验证首轮就是
      // 这么假绿的——伪造 1591 的 ex+1 却报出另外 4 队的队名）。下面还有一道身份断言兜底。
      captured.length = 0
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
      config.applyTeamPreset(team)
      // 触发计算并取本轮 cfg：`captured` 由文件头 `vi.mock` 拦截 `calcTeamResources` 抓取。
      // ⚠ 取 `captured[0]`（与上面两档同法）——预设求值会跑十几次 `calcTeamResources`
      // （外层不动点 / 降配二分 / 轴搜索），后面的调用带的是**搜索路径上的 cfg**（实测
      // `captured[last]` 拿到的是 `converged=false` 的降配/轴探针态，落点读数全错）。
      const rr = calc.resourceResult.value
      expect(rr, `${p.name}(${p.id}) 无资源结果`).toBeTruthy()
      const c = captured[0]
      // 预设是 3 人满槽，cfg 必为 3 槽（空槽压缩口径见 AGENTS §2，本档不覆盖手组队）
      if (!c || !Array.isArray(c.characters) || c.characters.length !== 3) {
        uncaptured.push(`${p.name}(${p.id}) 槽数=${c?.characters?.length ?? 'null'}`)
        continue
      }
      // **身份断言**（防「captured 缓冲没清空 ⇒ 拿别队的 cfg 当本队算」的假绿）：
      // 捕获到的 cfg 必须逐槽就是本预设的三人，否则本用例根本没在测这一队。
      expect(
        c.characters.map(ch => ch.agentId),
        `${p.name}(${p.id}) 捕获到的 cfg 不是本队（captured 缓冲未清空？）`,
      ).toEqual([...team])
      covered++

      const run = (seed?: (cfg: ResourceCalcConfig) => IterationState[]) => {
        clearWarmStartCache() // 隔离热启动缓存（见 describe 注释），只留本次注入的种子
        const clone = JSON.parse(JSON.stringify(c)) as ResourceCalcConfig
        return calcTeamResources(seed ? { ...clone, initialStates: seed(c) } : clone)
      }

      const cold = run()
      expect(cold, `${p.name}(${p.id}) 冷种子无结果`).toBeTruthy()
      const coldCounts = countFingerprint(cold!)
      const coldLedger = timeLedger(cold!)

      for (const [mode, seed] of [['高', inflatedSeed], ['低', lowSeed], ['校准', calibrationSeed]] as const) {
        const rrSeeded = run(seed)
        expect(rrSeeded, `${p.name}(${p.id}) ${mode}种子无结果`).toBeTruthy()
        const otherCounts = countFingerprint(rrSeeded!)
        const otherLedger = timeLedger(rrSeeded!)

        // ---- 判据①：次数落点逐位相等（失败信息带 preset.name/id + 槽位 + agentId + 逐字段差） ----
        for (let s = 0; s < coldCounts.length; s++) {
          const a = coldCounts[s]!, b = otherCounts[s]!
          if (a.ex === b.ex && a.ult === b.ult && a.chain === b.chain) continue
          countViolations.push(
            `${p.name}(${p.id}) ${mode}种子 槽${a.slot} ${a.agentId}: `
            + `exSpecialCount ${a.ex}→${b.ex} (${b.ex - a.ex}) · `
            + `ultimateCount ${a.ult}→${b.ult} (${b.ult - a.ult}) · `
            + `chainCountTotal ${a.chain}→${b.chain} (${b.chain - a.chain})`,
          )
        }

        // ---- 判据②：时间账只许「守恒式再分配」（显式写出允许的差异面） ----
        for (let s = 0; s < coldLedger.length; s++) {
          const a = coldLedger[s]!, b = otherLedger[s]!
          const dBasic = b.basic - a.basic
          const dNecessary = b.necessary - a.necessary
          const dSum = dBasic + dNecessary
          // 允许面 = 三项**同时**成立：① 平A 差在容差内；② 两项反向（再分配而非同向膨胀）；
          // ③ 和也在容差内（守总量）。任一不成立 = 违反，进失败清单点名该队。
          const dBasicWithin = Math.abs(dBasic) <= TIME_BUDGET_TOLERANCE_SECONDS
          const dSumWithin = Math.abs(dSum) <= TIME_BUDGET_TOLERANCE_SECONDS
          const oppositeSign = dBasic * dNecessary <= 0 // 同号（含双正/双负）= 同向，非再分配
          if (dBasicWithin && dSumWithin && oppositeSign) {
            // 真的发生了再分配（两项都动）⇒ 记活性；恒等（两项都没动）不算
            if (dBasic !== 0 || dNecessary !== 0) ledgerExercised++
            continue
          }
          ledgerViolations.push(
            `${p.name}(${p.id}) ${mode}种子 槽${a.slot} ${a.agentId}: `
            + `basicAttackTime ${a.basic.toFixed(6)}→${b.basic.toFixed(6)} (Δ${dBasic.toFixed(6)}) · `
            + `necessaryTime ${a.necessary.toFixed(6)}→${b.necessary.toFixed(6)} (Δ${dNecessary.toFixed(6)}) · `
            + `Δ和=${dSum.toFixed(6)}（容差 ±${TIME_BUDGET_TOLERANCE_SECONDS}s，来源 core/resource.ts#TIME_BUDGET_TOLERANCE_SECONDS）`
            + (dBasicWithin ? '' : ' ⚠ 平A 差超出容差')
            + (oppositeSign ? '' : ' ⚠ 两项同向变化 = 非守恒式再分配')
            + (dSumWithin ? '' : ' ⚠ 和不为零且超出容差'),
          )
        }
      }
    }

    // 覆盖面自检：全库预设必须逐队跑过（少跑 = 假绿；`covered` 与总数不符即红）
    expect(
      { covered, uncaptured },
      `覆盖预设数 ${covered} ≠ 全库 ${presets.length}（有队被静默跳过；未捕获：${uncaptured.join(', ') || '无'}）`,
    ).toEqual({ covered: presets.length, uncaptured: [] })

    // 判据② 的**活性自检**：断言② 是「允许差异面」的判据，若所有槽都恒等（差异集为空），
    // 它就成了永不触发的死判据——将来真出现非守恒再分配时，无法区分「没有违规」与「判据失效」。
    // 校准种子（见上方注释）保证至少有槽落进允许面；为 0 ⇒ 红（说明种子通道已不通，
    // 本档整体退化成「跑 104 次恒等式」，必须先修种子通道再谈绿）。
    expect(
      ledgerExercised,
      '断言② 未被任何槽触发（时间账差异集为空）：种子通道可能已失效，本档退化为恒等式自证',
    ).toBeGreaterThan(0)

    // ---- 判据③：任一队违反 ①② ⇒ 红并列名该队 ----
    expect(
      [...countViolations, ...ledgerViolations],
      [
        `落点随初值变的队：次数 ${countViolations.length} 条 / 时间账 ${ledgerViolations.length} 条`,
        `（覆盖 ${covered} 预设 × 4 种子 = 冷/高/低/校准；容差 TIME_BUDGET_TOLERANCE_SECONDS=${TIME_BUDGET_TOLERANCE_SECONDS}s；`
        + `允许面实际触发 ${ledgerExercised} 槽）`,
        '判据① 次数落点（ex/ult/chain）逐位相等；判据② 时间账只许「basicAttackTime 与 necessaryTime 反向等量」的守恒式再分配。',
        '处置：① 次数违反队 = 批 1-2（逐模块实数化）的首批目标，按队归因到 `src/mechanics/agents/<id>.ts` 的落点封顶；',
        '② 时间账违反队 = 封顶/回填在移动落点且不守恒，先查 `core/resource/helpers.ts` 可行性封顶 + 欠打回填门控；',
        '③ **不要**为了让本用例变绿而放宽容差或改基线（规则 10/17：本用例是债 1b 的证伪闸门，绿=销号依据，红=目标清单）。',
        ...countViolations.slice(0, 40),
        ...ledgerViolations.slice(0, 40),
        countViolations.length + ledgerViolations.length > 80
          ? `…（另有 ${countViolations.length + ledgerViolations.length - 80} 条）` : '',
      ].filter(Boolean).join('\n'),
    ).toEqual([])
  }, 1_800_000)
})
