/**
 * 难度曲线（降序一般化）生效测试。
 *
 * 用户口径 2026-09-20：「从最优到一般化的变化，比如合轴率降低、交互降低导致大招次数降低等」。
 *
 * 判据（都是用户可观测的量，不是内部实现）：
 *  ① 首档 = 最优（全杠杆拉满），且至少一档真降伤害（**不钉逐档单调**：实测有真实的非单调档，
 *     见用例内注释）；
 *  ② 档位数 == min(maxSteps, 杠杆级数展开数)，且第 0 档 = 最优；
 *  ③ **连锁可见**：降杠杆后关键次数（大招/明心境轮数等）真的变了——这是「不是全算完再排序，
 *     而是引擎自然算出连锁」的证据；
 *  ④ 曲线跑完**不改用户配置**（合轴率/弹刀/轴复位到调用前）；
 *  ⑤ 成本 = 档数（一次计算一档，不试开-回滚）——用 onPoint 回调计数验证。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { descendDifficultyCurve, defaultDescentLevers, summarizeDescent } from '@/composables/difficultyDescent'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

/** 叶瞬光+琉音+照：难度档位在这队上实测跨档最明显（剑势 30→36 触发第 6 次照影） */
async function setupTeam(cinemaLevel = 0) {
  const { config } = await setupHarness([
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
  config.setMechanicSetting('yeshuguang.formAxis', 0)
  config.syncTeammateBuffsFromTeam()
  const calc = useResourceCalc()
  return { config, calc }
}

describe('难度曲线（降序一般化）', () => {
  it('杠杆集只含影响大的项（合轴率/弹刀/轴），闪反与快支不进集', () => {
    const levers = defaultDescentLevers()
    const ids = levers.map(l => l.id)
    expect(ids).toEqual(['absorb', 'parry', 'formAxis'])
    // 顺序 = 优先级：跨档主杠杆（合轴率）先降
    expect(ids[0]).toBe('absorb')
    // 形态轴最后降（同合轴率下 full 恒最高）
    expect(ids[ids.length - 1]).toBe('formAxis')
    // 明确排除（用户：收益低）
    expect(ids).not.toContain('dodge')
    expect(ids).not.toContain('quickAssist')
  })

  it('C0 默认 6 档：首档最优、至少一档真降伤害、档数与回调一致、跑完复位用户配置', async () => {
    const { config, calc } = await setupTeam(0)
    const absorbBefore = config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4)
    const parryBefore = [0, 1, 2].map(s => config.team[s]?.parryCount ?? 0)
    const axisBefore = config.getMechanicSetting('yeshuguang.formAxis', 0)

    const seen: number[] = []
    const r = descendDifficultyCurve({ config, calc }, ['1431', '1481', '1341'], {
      maxSteps: 6,
      onPoint: p => { seen.push(p.step) },
    })

    /**
     * ① **不钉「逐档单调不增」**——实测存在真实非单调（2026-09-20）：
     * 合轴率降到 0 那档伤害反而从 20.80M 回升到 24.09M（不吸收 ⇒ 引擎不再吃队友溢出 ⇒
     * 降配档从 0.25 回到 1.0 ⇒ 交互被还原、截断减少）。这与仓库既有口径同源
     * （`difficultyCurve.ts` 文件头：「x 不保证单调：有的杠杆减少交互次数（难度降、伤害升 = 白拿的优化）」）。
     * 正确的判据 = ①首档是最优（全杠杆拉满）②至少有一档真降了伤害（曲线有信息量）
     * ③档位数与回调一致（成本 = 档数）。
     */
    expect(r.points[0]!.dmg, '第 0 档 = 最优').toBe(r.best)
    const worst = Math.min(...r.points.map(p => p.dmg))
    expect(worst, '至少有一档真降了伤害（否则曲线没信息量）').toBeLessThan(r.best - 1e-6)
    expect(r.points[0]!.degraded).toBeNull()
    // ② 档数 = min(maxSteps, 展开数) 且 = 回调次数（成本 = 档数，无额外试算）
    expect(r.steps).toBeLessThanOrEqual(6)
    expect(seen.length, 'onPoint 每档回调一次 = 增量出结果').toBe(r.steps)
    expect(seen).toEqual(r.points.map(p => p.step))
    // 每档都标了降的是哪个杠杆
    for (const p of r.points.slice(1)) expect(p.degraded, '非首档必须标出降了哪个杠杆').toBeTruthy()

    // ④ 复位：曲线不改用户配置
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.4)).toBe(absorbBefore)
    expect([0, 1, 2].map(s => config.team[s]?.parryCount ?? 0)).toEqual(parryBefore)
    expect(config.getMechanicSetting('yeshuguang.formAxis', 0)).toBe(axisBefore)
  }, 900_000)

  it('③ 连锁可见：降杠杆真的改变了关键次数（不是只换了个伤害数字）', async () => {
    const { config, calc } = await setupTeam(0)
    const r = descendDifficultyCurve({ config, calc }, ['1431', '1481', '1341'], { maxSteps: 6 })

    // 起点与末档的关键次数快照都存在
    const first = r.points[0]!.counts
    const last = r.points[r.points.length - 1]!.counts
    expect(first, '首档必须有关键次数快照').toBeTruthy()
    expect(last, '末档必须有关键次数快照').toBeTruthy()

    // 至少一个关键次数发生了 Δ≥1 的变化（「大招多一次 / 轮数多一轮」这类跃迁）
    const changed = Object.keys(first!).filter(k => Math.abs((last![k] ?? 0) - (first![k] ?? 0)) >= 1)
    expect(changed.length, `应至少有一项关键次数跨档，实测变化项 = ${JSON.stringify(changed)}`).toBeGreaterThan(0)

    // 且伤害确实降了（曲线不是平的）
    const s = summarizeDescent(r)
    expect(s.lossPct, `末档损失率 ${s.lossPct.toFixed(2)}% 应 > 0（否则曲线没信息量）`).toBeGreaterThan(0)
  }, 900_000)
})

/**
 * 降配档单调闸门（用户口径 2026-09-20）：
 * 「合轴率、交互档等正向因子可以单调，不要一个上升一个下降……合轴降低是难度降低伤害降低，
 *  交互升高就是难度升高」。
 *
 * 治的形态（实测 C0）：合轴率 0.20→0.10 时，引擎的自动降配重新求「最大可行档」把交互档从
 * 0.25 **回升**到 0.375（闪反 3→4、伤害 24.21M→24.36M）⇒ 正因子降而伤害升。
 *
 * 判据 = 闸门开启后「降合轴率 ⇒ 该档交互档不增、伤害不增」；关掉（历史行为）作对照。
 */
describe('降配档单调闸门 + 非单调归因（用户口径 2026-09-20）', () => {
  /**
   * 单因素单调（用户：「单因素可以」）：闸门开启后沿**合轴率**这一个因素降下去，
   * 交互档不回升、伤害不回升。
   */
  it('单因素（合轴率）：闸门开启 ⇒ 交互档与伤害单调不增；关掉则复现反转', async () => {
    const run = async (gate: boolean) => {
      const { config, calc } = await setupTeam(0)
      config.setMechanicSetting('yeshuguang.formAxis', 0)
      if (gate) config.interactionScaleMonotone = true
      const rows: Array<{ cap: number; scale: number; dmg: number }> = []
      /**
       * 闸门从「满档」起步，之后由引擎按采纳值单调下调（曲线里的实际用法）。
       * 注意**不能每档重置 ceiling = 1**——那等于把闸门关掉，回升会原样复现。
       */
      if (gate) config.interactionScaleCeiling = 1
      for (const cap of [0.4, 0.3, 0.2, 0.1, 0]) {
        config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
        await new Promise(r => setTimeout(r, 0))
        const rr = calc.resourceResult.value!
        rows.push({ cap, scale: rr.convergence?.interactionScale ?? 1, dmg: calc.teamTotalDamage.value })
      }
      return rows
    }

    const on = await run(true)
    const at020 = on.find(r => r.cap === 0.2)!
    const at010 = on.find(r => r.cap === 0.1)!
    expect(at010.scale, `合轴率 0.20→0.10 交互档不得回升（实测 ${at020.scale} → ${at010.scale}）`).toBeLessThanOrEqual(at020.scale + 1e-9)
    for (let i = 1; i < on.length; i++) {
      expect(on[i]!.dmg, `合轴率 ${on[i - 1]!.cap}→${on[i]!.cap} 伤害不得回升`).toBeLessThanOrEqual(on[i - 1]!.dmg + 1e-6)
    }

    // 对照：关掉闸门 ⇒ 复现历史反转（0.20 → 0.10 交互档回升）——证明闸门是承重的，不是装饰
    const off = await run(false)
    const off020 = off.find(r => r.cap === 0.2)!
    const off010 = off.find(r => r.cap === 0.1)!
    expect(off010.scale, '关掉闸门应复现历史反转（交互档回升）').toBeGreaterThan(off020.scale)
  }, 900_000)

  /**
   * 多因素不强制正相关（用户：「多因素不太可能强制正相关」「这种不单调也包含信息」）：
   * 曲线**允许**出现伤害回升的档，但那一档**必须带归因**（说清是哪个因素、难度降了多少）。
   *
   * 判据 = 凡 `dmg > 上一档` 的档，必带 `nonMonotonic`（kind/难度增量/成因文案）；
   * 且 `summarizeDescent.nonMonotonic` 与实际档数一致。
   */
  it('多因素：伤害回升的档必须带归因（不抹平、不静默）', async () => {
    const { config, calc } = await setupTeam(0)
    const r = descendDifficultyCurve({ config, calc }, ['1431', '1481', '1341'], { maxSteps: 8 })
    let rose = 0
    for (let i = 1; i < r.points.length; i++) {
      const prev = r.points[i - 1]!
      const cur = r.points[i]!
      if (cur.dmg > prev.dmg + 1e-6) {
        rose++
        expect(cur.nonMonotonic, `第 ${i} 档伤害回升（${prev.dmg}→${cur.dmg}）必须带归因`).toBeTruthy()
        expect(cur.nonMonotonic!.kind).toBe('damage-rose')
        expect(cur.nonMonotonic!.damageDelta).toBeGreaterThan(0)
        expect(cur.nonMonotonic!.reason.length, '归因必须是一句可读的成因').toBeGreaterThan(8)
      } else {
        expect(cur.nonMonotonic, `第 ${i} 档未回升，不应有归因`).toBeUndefined()
      }
    }
    const s = summarizeDescent(r)
    expect(s.nonMonotonic, '摘要里的非单调档数必须与实际一致').toBe(rose)
    // 反空洞：本用例的意义在于「真有回升档时能标注」——若全库都单调，判据退化成恒等式，
    // 此时如实提示（不是失败）：说明该队的多因素组合恰好同向。
    if (rose === 0) console.log('[info] 本次采样无伤害回升档（多因素恰好同向）——归因分支未被激活')
  }, 900_000)
})
