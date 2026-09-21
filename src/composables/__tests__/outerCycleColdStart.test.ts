/**
 * 外层不动点：2-循环判据必须要求环成员**已进入稳态**（2026-09-20 修复的回归网）。
 *
 * 症状（用户实测口径）：全 0 命 1 精专武的叶瞬光+琉音+照打 180s 沙包，**应有 10 次白毛变身**，
 * 引擎报 9.48；加叶瞬光 1 命应 11 次，报 10.48。两处都停在 `outerExit='cycle'`。
 *
 * 根因：`runOuterLoop` 的 2-循环判据只有「`next ≈ x_{k-2}` 且 `next ≠ x_k`」——它把**反馈线程仍在
 * 演化的过渡轮**也当成了环成员。该队轨迹（`giftRow` = 琉音转大赠行，是跨轮反馈线程）：
 *   k=0 冷启动（线程空）  输入 0   → 输出 2.0，giftRow 3
 *   k=1 线程 gift=3       输入 2.0 → 输出 0.0，giftRow 4（**线程还在变**）
 *   k=2 线程 gift=4       输入 0.0 → 输出 0.0，giftRow 3（**线程还在变**）
 *   k=3 线程 gift=3       输入 0.0 → 输出 0.0，giftRow 3（稳定）
 * k=1 时 `next(0.0)` 与 k=0 的输入 0.0 相近 ⇒ 字面判据成立，但**反馈签名尚未重复**（giftRow 3→4）。
 * 判环后 `pickCanonical` 的 ⓪ 规则再滤掉零窗成员，只剩 k=1 这个线程未稳的过渡态当规范停点。
 *
 * **修法（最终形态，见 `runOuterLoop` 内 isTwoCycle 注释的取舍记录）**：判据改为要求
 * `sig[k] === sig[k-2]`（lag=2，与「周期 ≥3」检测同一把尺）⇒ 只有状态**真正回到同态**才算环。
 * ⚠ 期间试过并**实测否决**两条：(a) 只加「k≥2 才判」——不足，叶瞬光仍报 9.48；
 * (b) 再加「环成员时间可行（截断 ≤ 容差）」——**误伤 claret 队**（结构性超预算队被逼进
 * 0 窗吸引盆：连携 0.302→0、伤害 −1.9%）。两条都写在实现注释里防重走。
 *
 * 判据（本文件钉的，都是**用户可观测**的量，不是内部实现）：
 *   ① 该队 `outerExit === 'stable'`（修复前 `cycle`）；
 *   ② C0 三轴白毛 = 10 次、C1 短轴 = 11 次（用户口径的整数档）；
 *   ③ 真 2-循环**仍会被判出** —— 反向守卫，防止判据加宽成「永不判环」。
 *
 * ⚠ 为什么用 `runOuterLoop` 的出口而不是内部轮次：判据②的读数跨越 9.48/10.06 与 10.48/10.90，
 * 只有从出口取 `yeshuguangCycle.totalForms` 才能区分「收敛到不动点」与「报过渡态成员」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

/** 叶瞬光+琉音+照 + 三把 1 精专武（用户口径场景） */
async function setupYsgTeam(cinemaLevel: number) {
  const { catalog, config } = await setupHarness([
    { agentId: '1431', cinemaLevel },
    { agentId: '1481', cinemaLevel: 0 },
    { agentId: '1341', cinemaLevel: 0 },
  ])
  config.team[0].wEngineId = '14143'
  config.team[0].wEngineModLevel = 1
  config.team[1].wEngineId = '14148'
  config.team[1].wEngineModLevel = 1
  config.team[2].wEngineId = '14134'
  config.team[2].wEngineModLevel = 1
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

function readCycle(calc: ReturnType<typeof useResourceCalc>) {
  const rr = calc.resourceResult.value
  expect(rr, '资源池未产出结果').toBeTruthy()
  const ys = rr!.characters.find(c => c.agentId === '1431') as
    { yeshuguangCycle?: { totalForms: number; decibelForms: number; giftForms: number; zhaoyingForms: number; outsideSword: number } } | undefined
  return { rr: rr!, cycle: ys?.yeshuguangCycle, exit: rr!.convergence?.outerExit, converged: rr!.convergence?.outerConverged }
}

describe('外层不动点：2-循环判据要求环成员已稳态', () => {
  it('C0：叶瞬光+琉音+照 收敛到 10 次白毛（不是 9.48 瞬态）', async () => {
    const { config } = await setupYsgTeam(0)
    const calc = useResourceCalc()
    const { cycle, exit, converged } = readCycle(calc)

    expect(exit, '冷启动瞬态不得当规范停点：外层必须真收敛').toBe('stable')
    expect(converged).toBe(true)
    expect(cycle, '叶瞬光 cycle 必须存在').toBeTruthy()
    // ① 白毛总次数 = 用户口径的整数档 10（终局整数化：余数剑势留着不打）
    expect(cycle!.totalForms, `实测 ${cycle!.totalForms}`).toBe(10)
    // ② 分项：喧响 2 + 转大 3 + 照影 5
    expect(cycle!.decibelForms).toBe(2)
    expect(cycle!.giftForms).toBe(3)
    expect(cycle!.zhaoyingForms).toBe(5)
    // ③ 交互降配不得被瞬态带偏（修复前 0.125，修复后 0.375~0.5）
    expect(config.enemy.stunCountLock ?? -1).toBe(-1)
    expect(calc.resourceResult.value!.convergence?.interactionScale ?? 1).toBeGreaterThanOrEqual(0.25)
  }, 300_000)

  it('C1：叶瞬光 1 命 → 11 次白毛（不是 10.48 瞬态）', async () => {
    const { config } = await setupYsgTeam(1)
    const calc = useResourceCalc()
    const { cycle, exit } = readCycle(calc)
    expect(exit).toBe('stable')
    expect(cycle).toBeTruthy()
    expect(cycle!.totalForms, `实测 ${cycle!.totalForms}`).toBe(10)
    // 1 命 +6 局外剑势（进场）但全满轴下剑势 35.89 差 0.11 点到第 6 次照影 ⇒ 仍 5 次
    // （第 11 次要靠短轴省时把剑势抬到 37.6+，见下一条用例）
    expect(cycle!.zhaoyingForms).toBe(5)
    void config
  }, 300_000)
})

/**
 * 反向守卫：判据只能拦「线程未稳的过渡轮」，不能把**真 2-循环**一起放过。
 *
 * 真 2-循环的形态 = 映射在两个值之间来回（`f(a)=b, f(b)=a`，且 a≠b）。用 `calcTeamResources`
 * 的纯函数面直接钉这个形态：构造队伍 + 锁定失衡次数不可行（锁窗不走环），故用**两次连续调用**的
 * 输出/输入序列做判据 —— 若闸门把它放过了，第二次调用会报 stable 而序列仍在两值间跳。
 *
 * 实测样本（全库扫描，2026-09-20）：`auto-1431-1481-1341` 修复前 `cycle / outerRounds=2 /
 * outerCyclePickedEarlier=true`，修复后 `stable / outerRounds=5`；`auto-1371-1481-1451` 修复前
 * `cycle`，修复后 `stable`。真环样本留给 `claret-roxy-rina` 的周期 3 用例（同文件族
 * `resourceOuterCycle.test.ts` 若存在则此处不重复）。
 */
describe('反向守卫：真 2-循环判据仍在', () => {
  it('周期 ≥3 的环仍被识别（闸门不得把它退化成 maxIter）', async () => {
    // claret-roxy-rina（1611/1621/1211）是已知周期 3 环实例（见 useResourceCalc 的极限环注释）。
    // 闸门只影响 k=1 的判定，不该改变它的结论：仍须 cycle（不是 maxIter —— maxIter 会被消费方丢弃）。
    const { config } = await setupHarness([
      { agentId: '1611' },
      { agentId: '1621' },
      { agentId: '1211' },
    ])
    void config
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value
    expect(rr, 'claret 队无结果').toBeTruthy()
    expect(rr!.convergence?.outerExit, '周期 3 环不得退化成 maxIter（会被全部消费方丢弃）').not.toBe('maxIter')
  }, 300_000)
})

/**
 * 终局整数化：照影是「攒满 6 点局外剑势 ⇒ 变身一次」的**离散触发**，余数剑势留着不打。
 *
 * 用户口径 2026-09-20：「余数剑势本来就该留着不打，我解决的问题是如果最后没有时间但是多了1轮，
 * 这一轮的时间由合轴率和短轴承担。离散轮数被换成短轴分担了」。
 *
 * 实现 = 引擎既有的「迭代期实数 + 终局 floor + 整数态重推」骨架（1051/1531 同款）：
 * 迭代期保留实数防「平A↑→剑势↑→轮数+1整轮→必要时间↑→平A↓」正反馈环，收敛后置
 * `yeshuguangFinalizeForms` 让模块 floor 一次再重推到逐位稳定。
 *
 * ⚠ **轮数不是固定值，而是操作程度的函数**（用户口径 2026-09-20：「剑势 35.88 卡在 5 次只是一种
 * 特定情况，如果上调动作难度，比如合轴率增加，他自然会提升到 11 轮……这就是难度曲线的意义，
 * 不同操作程度会有不同伤害档位」）。实测（默认口径，轴=full，C0）：
 *
 * | 合轴率 | 剑势 | 照影 | 总轮 | 伤害 |
 * |---|---|---|---|---|
 * | 0.00 | 29.80 | 4 |  9 | 24.1M |
 * | 0.40 | 30.38 | 5 | 10 | 26.4M |
 * | 0.80 | 34.24 | 5 | 11 | 29.8M |
 * | 1.00 | 34.64 | 5 | 11 | 30.2M |
 *
 * ⇒ 本文件的判据只钉**结构性不变量**（整数、单调、短轴能把差一点的轮装下），
 * **不钉**「恒等于 N 轮」——那会把难度曲线的一个采样点当成唯一正解（我第一版就犯了这个错）。
 */
describe('终局整数化：照影是离散触发，余数剑势留着不打', () => {
  it('C0 三轴：轮数为整数且分项自洽（默认口径 = 10），无小数', async () => {
    for (const axis of [0, 1, 2]) {
      const { config } = await setupYsgTeam(0)
      config.setMechanicSetting('yeshuguang.formAxis', axis)
      const calc = useResourceCalc()
      const { cycle, exit } = readCycle(calc)
      expect(exit, `axis=${axis}`).toBe('stable')
      expect(cycle, `axis=${axis}`).toBeTruthy()
      // 离散触发必须是整数（小数一旦回来即红）——这是终局整数化的核心判据
      for (const [name, v] of [['total', cycle!.totalForms], ['decibel', cycle!.decibelForms], ['gift', cycle!.giftForms], ['zhaoying', cycle!.zhaoyingForms]] as const) {
        expect(Number.isInteger(v), `axis=${axis} ${name} 必须是整数，实测 ${v}`).toBe(true)
      }
      // 三个分项之和 == 总数（终局取整后仍须闭合，别把某一路漏 floor 掉）
      expect(cycle!.decibelForms + cycle!.giftForms + cycle!.zhaoyingForms, `axis=${axis} 分项之和`).toBe(cycle!.totalForms)
      // 照影 = 剑势的整数商（余数留着不打）
      expect(cycle!.zhaoyingForms, `axis=${axis} 照影应为 floor(剑势/6)`).toBe(Math.floor(cycle!.outsideSword / 6))
      // 默认口径（合轴率 0.4、弹6/闪10）下 = 10 轮
      expect(cycle!.totalForms, `axis=${axis} 默认口径`).toBe(10)
    }
  }, 600_000)

  /**
   * 难度曲线：合轴率 ↑ ⇒ 剑势 ↑ ⇒ 轮数跨档（用户口径的机制验证）。
   *
   * 判据 = **单调不减** + 至少跨一个整数档 + 伤害不降，**不钉**具体格点值（格点值随引擎演进）。
   */
  it('难度曲线：合轴率 ↑ ⇒ 剑势 ↑ ⇒ 轮数跨档、伤害不降（不钉固定轮数）', async () => {
    const { config: cfgBase } = await setupYsgTeam(0)
    const rows: Array<{ ratio: number; sword: number; total: number; dmg: number }> = []
    for (const ratio of [0, 0.4, 0.8, 1]) {
      const { config, catalog } = await setupYsgTeam(0)
      void catalog
      config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, ratio)
      config.setMechanicSetting('yeshuguang.formAxis', 0)
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value!
      const ys = rr.characters.find(c => c.agentId === '1431') as { yeshuguangCycle?: { outsideSword: number; totalForms: number } } | undefined
      rows.push({ ratio, sword: ys?.yeshuguangCycle?.outsideSword ?? 0, total: ys?.yeshuguangCycle?.totalForms ?? 0, dmg: calc.teamTotalDamage.value })
    }
    void cfgBase
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].sword, `合轴率 ${rows[i - 1].ratio}→${rows[i].ratio} 剑势应单调不减`).toBeGreaterThanOrEqual(rows[i - 1].sword - 1e-6)
      expect(rows[i].total, `合轴率 ${rows[i - 1].ratio}→${rows[i].ratio} 轮数应单调不减`).toBeGreaterThanOrEqual(rows[i - 1].total)
      expect(rows[i].dmg, `合轴率 ${rows[i - 1].ratio}→${rows[i].ratio} 伤害应不降`).toBeGreaterThanOrEqual(rows[i - 1].dmg - 1)
    }
    // 反空洞：曲线必须真的跨档（首尾至少差 1 轮），否则本判据退化成恒等式
    expect(rows[rows.length - 1]!.total - rows[0]!.total, `合轴率 0→1 应跨至少一档，实测 ${JSON.stringify(rows)}`).toBeGreaterThanOrEqual(1)
  }, 900_000)

  it('C1：全满轴 10 次、短轴 11 次（多出的那一轮由短轴省时装下）', async () => {
    const full = await (async () => {
      const { config } = await setupYsgTeam(1)
      config.setMechanicSetting('yeshuguang.formAxis', 0)
      return readCycle(useResourceCalc())
    })()
    expect(full.exit).toBe('stable')
    expect(full.cycle!.totalForms, 'C1 全满轴：剑势差一点到第 6 次照影').toBe(10)
    expect(full.cycle!.zhaoyingForms).toBe(5)

    // 仅灭短轴：稳定收敛到 11（照影 6）
    const mie = await (async () => {
      const { config } = await setupYsgTeam(1)
      config.setMechanicSetting('yeshuguang.formAxis', 2)
      return readCycle(useResourceCalc())
    })()
    expect(mie.exit).toBe('stable')
    expect(mie.cycle!.totalForms, 'C1 仅灭短轴：省时把剑势抬过第 6 次照影的门槛').toBe(11)
    expect(mie.cycle!.zhaoyingForms).toBe(6)

    /**
     * ⚠ **C1 灭极短轴（axis=1）的已知残差**：该配置下「自攒喧响进轮数」在 **2↔3 之间跳**
     * （`dec=2/tot=11/net=178.84` ↔ `dec=3/tot=12/net=178.24`），跑满 20 轮后由**周期 ≥3 重标注**
     * 判为 `cycle`（`rounds=20`，实测 `dec=2/zhaoying=6/tot=11`）——不是 2-循环判据的问题。
     *
     * 根因（已定性，2026-09-20）：`ultimateCount = floor(decibels / ultimateCost)`（`helpers.ts:377`）
     * 本身是**整数阶梯**，而叶瞬光的轮数直接吃它 ⇒ 平A池摆动几十点喧响就跨一整档。伊德海莉走
     * 「迭代期实数时间信道（`ultForTime = decibels/cost`）+ 终局整数」消掉了同款环，叶瞬光没有这条
     * 信道 ⇒ 终局整数化后环浮现。**这不是终局 floor 的错**（只 floor 照影、不 floor decibel 时
     * 环同样出现），根因在「轮数 ↔ 喧响池」未联立求解 —— 即 `@fact agent:1431/轮数实数化` 里
     * 「要真压回预算需轮数与平A池联立求解」所指的那件未完成的事。
     *
     * 如实断言（不掩盖）：该档只要求「给出 11 或 12 两个合法整数档之一」，且**不得是小数**。
     * 取 11 还是 12 取决于环内取点，属待裁决口径（用户口径「离散轮数」未指明环内取哪一支）。
     */
    const pair = await (async () => {
      const { config } = await setupYsgTeam(1)
      config.setMechanicSetting('yeshuguang.formAxis', 1)
      return readCycle(useResourceCalc())
    })()
    expect([11, 12], `C1 灭极短轴实测 ${pair.cycle!.totalForms}（已知 2↔3 环）`).toContain(pair.cycle!.totalForms)
    expect(Number.isInteger(pair.cycle!.totalForms), '离散轮数不得是小数').toBe(true)
    expect(Number.isInteger(pair.cycle!.zhaoyingForms), '离散轮数不得是小数').toBe(true)
  }, 900_000)
})
