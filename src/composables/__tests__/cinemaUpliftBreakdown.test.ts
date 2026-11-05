/**
 * 命座提升率的**三分区分解**判据（用户 2026-11-05 裁决）。
 *
 * 这张判据网盯的是「分解有没有说实话」，不是「数字好不好看」。五类断言：
 * ① **恒等式**：资源 × 执行 × 面板 = 总提升（每一级、任何角色）；
 * ② **属性型可解释**：纯面板命座的分解必须把提升**全部**归到 `attrPct`（面板口径与引擎同源）；
 * ③ **执行级不漏报**：面板与资源都不动、伤害却动的命座必须落进 `EXEC`，**不许报 0%**
 *    （负控 = 交接文档点名的 1401C6 / 1181C6 那类）；
 * ④ **资源型不被吞**：加速失衡/积蓄/喧响的命座必须在自由口径下报出非零 `resourcePct`
 *    （锁口径会把它清零 —— 用户 2026-11-05「还是不锁吧」就是为此）；
 * ⑤ **不锁口径**：分析器全程 `stunCountLock === -1`（判据要能抓到有人把锁加回来）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { createAnalysisScenario, withAnalysisScenario } from '@/composables/analysisScenario'
import { analyzeCinemaUplift, UPLIFT_EPSILON_PCT } from '@/composables/cinemaUplift'
import { bindPoolStore, computeCinemaBreakdown, diffPanels, formulaRoleOf, snapshotPanels } from '@/composables/cinemaUpliftBreakdown'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'

/**
 * 逐级取分解读数（**自由口径**：不锁失衡次数）。
 * 与页面同一条路：分级改命座 → 每级拍「伤害池上下文 + 结算面板」→ 对比相邻两级。
 */
async function readBreakdowns(agentId: string, maxLevel = 6) {
  const { config } = await setupHarness([{ agentId }])
  config.enemy.stunCountLock = -1
  const calc = useResourceCalc()
  const shots: Array<{ ctx: ReturnType<typeof bindPoolStore>; panels: ReturnType<typeof snapshotPanels>; raw: ReturnType<typeof snapshotPanels> }> = []
  for (let c = 0; c <= maxLevel; c++) {
    config.setCinemaLevel(0, c)
    config.syncTeammateBuffsFromTeam()
    const ctx = calc.damagePoolContext.value
    shots.push({
      ctx: bindPoolStore(ctx, { 0: c }),
      panels: snapshotPanels(ctx.damagePanels),
      raw: snapshotPanels(ctx.damagePanels),
    })
  }
  const readings = []
  for (let c = 1; c <= maxLevel; c++) {
    const before = shots[c - 1]
    const after = shots[c]
    const b = computeCinemaBreakdown({
      beforeCtx: before.ctx,
      afterCtx: after.ctx,
      beforePanels: [...(before.ctx.damagePanels ?? [])],
      afterPanels: [...(after.ctx.damagePanels ?? [])],
      withPanels: (ctx, next) => calc.damagePoolContextWithPanels(next, ctx),
      slots: [0],
    })
    readings.push({ cinema: c, ...b })
  }
  return { config, calc, readings }
}

describe('命座三分区分解 · 恒等式（判据 4）', () => {
  for (const agentId of ['1401', '1181', '1301', '1011', '1481']) {
    it(`${agentId}：资源 × 执行 × 面板 == 总提升（逐级，误差 ≤ 0.05pp）`, async () => {
      const { readings } = await readBreakdowns(agentId)
      for (const r of readings) {
        const recomposed = ((1 + r.resourcePct / 100) * (1 + r.execPct / 100) * (1 + r.attrPct / 100) - 1) * 100
        expect(
          Math.abs(recomposed - r.totalPct),
          `${agentId} C${r.cinema} 三段连乘 ${recomposed.toFixed(3)} ≠ 总提升 ${r.totalPct.toFixed(3)}`,
        ).toBeLessThan(0.05)
      }
    })
  }
})

describe('判据 1：纯属性命座 —— 面板口径与引擎实测同源（偏差 ≤ 1%）', () => {
  /**
   * 挑「引擎实测 tier === 'ATTR'」的 5 个纯面板命座（不写死名单，按读数筛，
   * 避免有人改了某个角色后判据还在测一个已经不纯的级别）。
   */
  it('纯 ATTR 级的 attrPct 必须吃掉全部提升', async () => {
    const candidates = ['1021', '1031', '1061', '1081', '1111', '1131', '1141', '1191', '1211']
    let checked = 0
    for (const agentId of candidates) {
      const { readings } = await readBreakdowns(agentId)
      for (const r of readings) {
        if (r.tier !== 'ATTR') continue
        checked++
        // 判据 1 的机器化：面板增益 == 总提升（偏差 ≤ 1%）且另两段确实为零
        expect(Math.abs(r.attrPct - r.totalPct), `${agentId}C${r.cinema} 面板 ${r.attrPct} ≠ 总 ${r.totalPct}`).toBeLessThan(1)
        expect(Math.abs(r.resourcePct)).toBeLessThan(0.05)
        expect(Math.abs(r.execPct)).toBeLessThan(0.05)
        // 面板口径必须真的读到了白名单里的公式字段（不是「碰巧相等」）
        expect(r.attrFields.length, `${agentId}C${r.cinema} 判成 ATTR 却没有公式字段变化`).toBeGreaterThan(0)
        if (checked >= 5) break
      }
      if (checked >= 5) break
    }
    expect(checked, '没有筛到任何纯 ATTR 级 —— 判据空转，去查分类器').toBeGreaterThanOrEqual(5)
  })
})

describe('判据 2：执行级命座 —— 必须如实报，不许报 0%', () => {
  it('1401C6 / 1181C6：面板与资源都不动，仍必须报出非零执行级（负控）', async () => {
    for (const agentId of ['1401', '1181']) {
      const { readings } = await readBreakdowns(agentId)
      const c6 = readings.find(r => r.cinema === 6)!
      // 前提：这两级确实「面板无变化、资源无明显变化」（交接文档 2.3 的实测结论，这里逐次复核）
      expect(c6.attrFields, `${agentId}C6 面板意外有公式字段变化`).toHaveLength(0)
      expect(Math.abs(c6.totalPct), `${agentId}C6 伤害零移动 —— 夹具已失效`).toBeGreaterThan(1)
      // 判据：执行级必须接住这段提升（旧实现会报 attr=total，或直接报 0%）
      expect(c6.components, `${agentId}C6 没被识别成执行级`).toContain('EXEC')
      expect(
        Math.abs(c6.execPct),
        `${agentId}C6 执行级 ${c6.execPct.toFixed(2)}% 吃掉不到总提升 ${c6.totalPct.toFixed(2)}% 的一半`,
      ).toBeGreaterThan(Math.abs(c6.totalPct) / 2)
    }
  })

  it('负控：面板无变化 + 伤害有提升 ⇒ 判据必须红（构造一个「假装纯面板」的分解）', async () => {
    const { readings } = await readBreakdowns('1401')
    const c6 = readings.find(r => r.cinema === 6)!
    // 「面板没变 ⇒ 提升为 0」是交接文档点名要被否掉的老口径。构造它，断言判据能抓住：
    const naive = c6.attrFields.length === 0 ? 0 : c6.totalPct
    expect(naive, '负控失效：那个错误口径居然通过了').not.toBeCloseTo(c6.totalPct, 1)
    expect(c6.tier).toBe('EXEC')
  })
})

describe('判据 3：资源型命座 —— 净增益读数与动作次数增量同向（判据 5：不锁口径）', () => {
  it('加速失衡/积蓄类命座在自由口径下必须报出非零资源增益', async () => {
    // 1301C6 = +208%（实测）；锁口径下会被清零 —— 这就是用户「还是不锁吧」的理由
    const { readings, config } = await readBreakdowns('1301')
    const c6 = readings.find(r => r.cinema === 6)!
    expect(Math.abs(c6.totalPct)).toBeGreaterThan(50)
    expect(Math.abs(c6.resourcePct), '资源型收益被吞了（多半是有人把锁加回来）').toBeGreaterThan(1)
    // 全程自由口径：分析结束后 store 里的锁必须还是 -1
    expect(config.enemy.stunCountLock, '有人在分析里把失衡次数锁回去了').toBe(-1)
  })

  it('锁口径会吞掉资源型收益（把锁加回来 ⇒ 资源读数塌成 0）', async () => {
    /**
     * 实测夹具 `banyue-roxy-lucia`：自由口径 C0 2 窗 → C6 3 窗（多打的这一窗正是用户点名的
     * 「加速失衡」收益）。锁回 C0 的 2 窗后，C6 的累计提升从 **73.0%** 掉到 **57.5%**。
     * 用同一支队、同一对命座，只换尺子 ⇒ 差值就是被锁吞掉的那条通道。
     */
    const preset = teamPresets.find(p => p.id === 'banyue-roxy-lucia')
    expect(preset, '夹具队伍 banyue-roxy-lucia 不在预设库里了').toBeTruthy()
    const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    applyTeamToStore(config, preset!)
    const calc = useResourceCalc()
    const shoot = (slotLevel: number, lock: number) => {
      for (let s = 0; s < 3; s++) config.setCinemaLevel(s, s === 0 ? slotLevel : 0)
      config.syncTeammateBuffsFromTeam()
      config.enemy.stunCountLock = lock
      const ctx = calc.damagePoolContext.value
      return { ctx: bindPoolStore(ctx, { 0: slotLevel }), panels: [...ctx.damagePanels] }
    }
    const gainOf = (lock: number) => {
      const c0 = shoot(0, lock)
      const c6 = shoot(6, lock)
      return computeCinemaBreakdown({
        beforeCtx: c0.ctx, afterCtx: c6.ctx,
        beforePanels: c0.panels, afterPanels: c6.panels,
        withPanels: (ctx, next) => calc.damagePoolContextWithPanels(next, ctx),
        slots: [0],
      })
    }
    const free = gainOf(-1)
    const freeWindows = calc.stunPoolResult.value?.stunCount ?? 0
    expect(freeWindows, '该队在 C0 打不出失衡 —— 锁口径对比失效').toBeGreaterThan(0)
    const locked = gainOf(freeWindows)
    config.enemy.stunCountLock = -1

    expect(Math.abs(free.totalPct), '自由口径提升异常小 —— 夹具漂移').toBeGreaterThan(20)
    expect(
      Math.abs(locked.totalPct),
      `锁口径 ${locked.totalPct.toFixed(2)}% 没被压下去（自由 ${free.totalPct.toFixed(2)}%）—— 锁失效了？`,
    ).toBeLessThan(Math.abs(free.totalPct) - 5)
    // 被吞掉的这部分必须在**资源段**上体现（用户「不锁」的理由就是这条通道）
    expect(
      Math.abs(free.resourcePct),
      `自由口径资源段 ${free.resourcePct.toFixed(2)}% 不该比锁口径 ${locked.resourcePct.toFixed(2)}% 还小`,
    ).toBeGreaterThan(Math.abs(locked.resourcePct))
  })
})

describe('判据：面板字段分类口径（白名单边界）', () => {
  it('资源通道字段不冒充伤害公式字段；技能等级是执行级不是属性', async () => {
    expect(formulaRoleOf('energyGainEfficiency'), '能量效率不在伤害公式里').toBeNull()
    expect(formulaRoleOf('impact'), '冲击力是资源/时间通道，不是伤害公式').toBeNull()
    expect(formulaRoleOf('skillLevelBonus'), '技能等级改的是倍率，不是属性').toBeNull()
    expect(formulaRoleOf('dmgBonus')).toBe('增伤区')
    expect(formulaRoleOf('critRate')).toBe('暴击区')
    // 元素族：白名单按 core 口径不登记，但它们是伤害乘区（判据必须认得）
    expect(formulaRoleOf('enemyPhysicalResReduction'), '元素减抗是伤害乘区').not.toBeNull()
    expect(formulaRoleOf('physicalDmg')).not.toBeNull()
    // 定向后缀按 base 判定（finalDmgBonus__chain 仍属「最终伤害」族 ⇒ 元素族/白名单都按 base 看）
    expect(formulaRoleOf('enemyIceResReduction__basic')).not.toBeNull()
  })

  it('diffPanels 三分桶：公式 / 资源 / 执行互不重叠', () => {
    const before = new Map([[0, { slot: 0, dmgBonus: 10, energyGainEfficiency: 0, skillLevelBonus: 0, impact: 100 } as never]])
    const after = new Map([[0, { slot: 0, dmgBonus: 30, energyGainEfficiency: 12, skillLevelBonus: 2, impact: 130 } as never]])
    const diff = diffPanels(before, after)
    expect(diff.attrFields.map(f => f.stat)).toEqual(['dmgBonus'])
    expect(diff.resourceFields.map(f => f.stat).sort()).toEqual(['energyGainEfficiency', 'impact'])
    expect(diff.execFields.map(f => f.stat)).toEqual(['skillLevelBonus'])
  })
})

describe('分析器集成：每级都带 breakdown，且与 gainPct 恒等', () => {
  it('analyzeCinemaUplift 的 entry.breakdown 与 entry.gainPct 满足三段连乘', async () => {
    await setupHarness([{ agentId: '1401' }])
    const rows = await withAnalysisScenario(s => analyzeCinemaUplift(s, { targetStunCount: 0, slots: [0] }))
    const entries = rows[0].entries
    expect(entries).toHaveLength(6)
    for (const e of entries) {
      const recomposed = ((1 + e.breakdown.resourcePct / 100) * (1 + e.breakdown.execPct / 100) * (1 + e.breakdown.attrPct / 100) - 1) * 100
      expect(
        Math.abs(recomposed - e.gainPct),
        `C${e.to}: 分解 ${recomposed.toFixed(2)}% ≠ gainPct ${e.gainPct.toFixed(2)}%`,
      ).toBeLessThan(0.05)
    }
  })

  /**
   * ★ 锁口径下 `gainPct` 与 `breakdown` 必须也是同一个现场（2026-11-05 修的真缺陷）。
   *
   * 修前：`gainPct` 在**锁窗内**读（R1 同场景纪律），`breakdown` 在**锁窗外**单独读
   * ⇒ 两个现场不同，资源型命座对不上。实测：1181C6 页面 59.45% vs 分解连乘 71.02%（差 11.6pp）、
   * 1011C2 3.65% vs 16.26%（差 12.6pp）。这条用例就是那批读数的回归锁。
   */
  it('★ 锁口径下分解与 gainPct 同现场（资源型命座也不例外）', async () => {
    for (const agentId of ['1011', '1181', '1301']) {
      await setupHarness([{ agentId }])
      const calc = useResourceCalc()
      const lock = calc.stunPoolResult.value?.stunCount ?? 0
      expect(lock, `${agentId} 夹具打不出失衡 —— 锁口径用例失真`).toBeGreaterThan(0)
      const rows = await withAnalysisScenario(s => analyzeCinemaUplift(s, { targetStunCount: lock, slots: [0] }))
      for (const e of rows[0].entries) {
        const b = e.breakdown
        const recomposed = ((1 + b.resourcePct / 100) * (1 + b.execPct / 100) * (1 + b.attrPct / 100) - 1) * 100
        expect(
          Math.abs(recomposed - e.gainPct),
          `${agentId}C${e.to}（锁 ${lock} 窗）：分解连乘 ${recomposed.toFixed(2)}% ≠ gainPct ${e.gainPct.toFixed(2)}%`
          + ' —— 分解与伤害读数不是同一个现场',
        ).toBeLessThan(0.05)
      }
    }
  })

  it('不锁口径（判据 5）：分析器跑完的场景锁值必须仍是自由态', async () => {
    await setupHarness([{ agentId: '1401' }])
    const scenario = createAnalysisScenario()
    try {
      expect(scenario.config.enemy.stunCountLock).toBe(-1)
      await analyzeCinemaUplift(scenario, { targetStunCount: 0, slots: [0] })
      expect(scenario.config.enemy.stunCountLock, '分析器把失衡次数锁回去了').toBe(-1)
    } finally {
      scenario.dispose()
    }
  })

  it('自检三态用分解判：资源通道命座不许再被记成「面板 ok」', async () => {
    // 1011C1 = 能量获得效率 +12%（长在面板上、只动资源）⇒ 必须是 execLevel，不是 ok
    await setupHarness([{ agentId: '1011' }])
    const rows = await withAnalysisScenario(s => analyzeCinemaUplift(s, { targetStunCount: 0, slots: [0] }))
    const c1 = rows[0].entries.find(e => e.to === 1)!
    expect(c1.changedFields, '夹具漂移：C1 已经不再改面板字段').toContain('energyGainEfficiency')
    expect(c1.breakdown.tier.split('+')).not.toContain('ATTR')
    expect(c1.warn, '资源通道命座被记成面板 ok（旧的「面板有变化就 ok」判据）').toBe('execLevel')
    expect(UPLIFT_EPSILON_PCT).toBeGreaterThan(0)
  })
})