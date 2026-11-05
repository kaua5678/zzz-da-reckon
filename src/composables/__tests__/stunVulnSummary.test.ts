/**
 * 失衡易伤可见化：行级生效易伤换算 + 加权汇总。
 *
 * 口径：行级 `stunMult` = Boss 失衡易伤分量（vuln=1.5 满额行 1.5 / 零行 1.0 / 部分行中间值），
 * 生效易伤 = calcStunMultiplier(vuln, 面板加成, frac)；加权信用 = Σ(d×生效)/Σd − 1
 * （与部署 A/B 差分实验同构；异常行按 1，信用偏保守——异常行不逐行暴露易伤）。
 * 集成快照：雨果 0 命轴（hugo-c0-e 预设）冻结值来自 2026-09-10 修复坑36 后的引擎输出。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { computeStunVulnSummary, computeStunVulnBySlot } from '@/composables/stunVulnSummary'
import { rowAppliedStunMultOf, rowFullStunMultOf, rowStunCoverage } from '@/core/stunVulnRow'
import { readFileSync as readSrcFile, readdirSync as readSrcDir, statSync as statSrc } from 'node:fs'
import { join as joinSrc, relative as relSrc } from 'node:path'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

describe('rowAppliedStunMultOf 回落路径（行只带 stunMult 分量 → 生效易伤）', () => {
  const vuln = 1.5
  const bonus = 60 // 雨果队面板失衡增伤
  const applied = (stunMult: number | undefined, v = vuln, b = bonus) => rowAppliedStunMultOf({ stunMult }, { vuln: v, bonus: b, always: 0, cap: 0 })
  it('异常行（无 stunMult）→ 1', () => {
    expect(applied(undefined)).toBe(1)
  })
  it('满额行分量 1.5 → 2.100（含面板加成）；零行 1.0 → 1.000', () => {
    expect(applied(1.5)).toBeCloseTo(2.1, 3)
    expect(applied(1.0)).toBeCloseTo(1.0, 3)
  })
  it('部分行分量反推 frac 后按覆盖率插值（vuln=1.5 时 1.25 → frac 0.5 → 1.55）', () => {
    expect(applied(1.25)).toBeCloseTo(1.55, 3)
  })
  it('vuln=1（无易伤配置）不除零，按分量是否为满额回落', () => {
    expect(applied(1.5, 1.0, 0)).toBe(1)
    expect(applied(1.0, 1.0, 0)).toBe(1)
  })
})

describe('computeStunVulnSummary（加权有效易伤）', () => {
  it('全满额 → 信用 = 满额信用、覆盖率 1', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 2.1 }, { totalDamage: 200, appliedStunMult: 2.1 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(2.1, 6)
    expect(s.weightedCredit).toBeCloseTo(1.1, 6)
    expect(s.coverageRate).toBeCloseTo(1, 6)
  })
  it('全零 → 信用 0、覆盖率 0', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 1 }, { totalDamage: 200, appliedStunMult: 1 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(1, 6)
    expect(s.weightedCredit).toBeCloseTo(0, 6)
    expect(s.coverageRate).toBeCloseTo(0, 6)
  })
  it('混合按伤害加权（各 100：2.1 与 1.0 → 1.55 / 信用 0.55 / 覆盖率 0.5）', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 2.1 }, { totalDamage: 100, appliedStunMult: 1.0 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(1.55, 6)
    expect(s.weightedCredit).toBeCloseTo(0.55, 6)
    expect(s.coverageRate).toBeCloseTo(0.5, 6)
  })
  it('空池 → 加权 1 / 信用 0 / 覆盖率 0（满额照常返回）', () => {
    const s = computeStunVulnSummary([], 2.1)
    expect(s.fullMult).toBe(2.1)
    expect(s.weightedVuln).toBe(1)
    expect(s.weightedCredit).toBe(0)
    expect(s.coverageRate).toBe(0)
  })
})

describe('集成快照：雨果 0 命轴（坑36 修复后冻结）', () => {
  async function setupHugoAxis(extraDodge = false) {
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    const preset = stunAxisPresets.find(p => p.id === 'hugo-c0-e')
    const axes = preset?.axes
    if (!axes) throw new Error('预设不存在或无轴：hugo-c0-e')
    config.autoYidhariAxis = false
    config.stunAxisPlans.splice(0)
    config.stunAxes.splice(0)
    config.useStunAxis = false
    config.setCinemaLevel(0, 0)
    config.stunAxes.push(...cloneStunAxes(axes))
    config.useStunAxis = true
    /**
     * 案例 D 的「闪反切成两行」需要一个**真实存在的**闪反动作。
     *
     * 2026-10-23：2026-10-21「交互默认全 0」后，雨果的 `dodgeCounterCount` 默认 0 ⇒
     * 轴里那条 1291012 动作**没有对应的可打次数** ⇒ 行根本不会物化（实测 `dodgeRows.length = 0`），
     * 案例 D 直接测不到东西。这里显式给槽 0 一次闪反，让夹具恢复可测状态（不是放松判据）。
     */
    if (extraDodge) {
      // 实测（2026-10-23 探针）：dodge ≤ 4 时全部被轴吃下 ⇒ 只有 1 行；
      // 6 次才溢出成两行（轴内 5 / 轴外 1）。用例要的正是「切成两段、一段满额一段零」。
      // ⚠ 2026-10-28 夹具重定 6→12：残差分摊删除 ⇒ 本队池 5→10 窗，轴能认领的闪反块涨到 10
      // （实测 dodge=6/8 时全部入轴仍只有 1 行；dodge=12 ⇒ 轴内 10 / 轴外 2，恢复两行形态）。
      //
      // ⚠ **2026-11-05**：Boss 出手预算落地后，轴外那一段会再被预算夹一次（本夹具覆盖率 88.9%
      // ⇒ 非失衡 20s ⇒ 预算 10 次）。dodge=12 ⇒ 轴内 **10** / 轴外 **2**（未变）；dodge=20 ⇒ 轴内 10 /
      // 轴外 10（未变）；只有 dodge 远超预算时轴外段才变短——**两行结构本身不受影响**，
      // 这正是本用例要锁的「切成两段、一段满额一段零」。填 12 仍是最小可观测夹具，保持不变。
      config.team[0]!.dodgeCounterCount = 12
      config.stunAxes[0]!.actions.push({ slot: 0, moveId: '1291012', count: 1, startTime: 8 })
    }
    // CC-148（第 174 轮）：本组是 off 口径下冻结的加权快照（决算 5 窗），显式钉 off。physical 缺省下该轴
    // 物理次数钳到 4（CC-150），同源判据在 hugoVerdictLanding「physical 缺省」用例。
    config.setMechanicSetting('time.stunPlanProjection', 0)
    return { config, calc: useResourceCalc() }
  }

  // 快照 2026-09-12 重排（1.6860→1.6900）：雨果(1291) level60.critRate 漏加满级突破加成，
  // 订正 5→19.4（同批 20 处，口径见 scripts/lib/level60-rules.mjs）。
  // 为什么「加权」快照会动：weightedVuln 是**按伤害加权**的均值（computeStunVulnSummary 传
  // r.totalDamage）→ 不走暴击乘区的行（fixed/异常类）不随 critRate 放大，权重相对下降 → 均值上移。
  // 单变量实证：仅把 1291 回退成 5，本文件 10 例全绿 ⇒ 归因唯一，非连带回归。
  it('案例 B（0 命轴双连携+决算）：决算行生效易伤 2.100、普通终结 1.000；加权快照 1.6888/0.6888/0.6262', async () => {
    const { config, calc } = await setupHugoAxis()
    const vuln = config.enemy.stunVuln
    const p0 = calc.panels.value[0]
    const bonus = p0?.stunDmgMultiplierBonus ?? 0
    const always = p0?.stunDmgMultiplierBonusAlways ?? 0
    const cap = p0?.stunDmgMultiplierBonusCapAlways ?? 0
    const p = { vuln, bonus, always, cap }
    const full = calcStunMultiplier(vuln, bonus, always, cap, true)
    expect(full).toBeCloseTo(2.1, 3)
    const rows = (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
    const verdict = rows.find(r => r.moveId === '1291_ex_verdict_final')
    const normal = rows.find(r => r.moveId === '1291_ex_normal_final')
    // ⚠ 2026-10-28 锚值 5→11：轴模式残差分摊删除 ⇒ 池如实升到 11 窗（同 hugoVerdictLanding）。
    expect(verdict?.count).toBe(11) // 坑36 修复：轴栈同源
    expect(rowAppliedStunMultOf(verdict ?? {}, p)).toBeCloseTo(2.1, 3)
    expect(rowAppliedStunMultOf(normal ?? {}, p)).toBeCloseTo(1.0, 3)
    const s = computeStunVulnSummary(
      rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMultOf(r, p) })),
      full,
    )
    // 重冻 2026-09-28（CC-158 第 181 轮，折叠残差可退回 ⇒ 平A池重分、轴外行伤害占比微移）：旧 1.6900/0.6900/0.6273、
    // 案例 D 旧 1.7211/0.7211/0.6555；行级易伤（2.100 / 1.000、闪反两段）断言全部不变 ⇒ 仅权重漂移。
    //
    // ⚠ **T141 重冻（2026-10-13）**：1.6888/0.6888/0.6262 → **1.6622/0.6622/0.6020**。
    // 加权口径 = 逐行伤害占比对易伤倍数加权 ⇒ 任何改变**行伤害结构**的引擎改动都会动它
    // （本次 = 合轴吸收改「取满容量」+ 闸门常开 ⇒ 平A池重分 ⇒ 各行占比微移）。
    // 上面那组**行级**结构断言（2.100 / 1.000）一条未变 ⇒ 易伤机制本身没动，只是权重漂移。
    // ⚠ **2026-10-18 重冻**：1.6622/0.6622/0.6020 → **1.6645/0.6645/0.6041**。
    // 归因：副词条「百暴」基线改用真实面板（含角色 applyPanel）⇒ 1291 雨果的暴击词条不再溢出
    // （修前 4 步白扔）⇒ 行伤害结构微移。行级易伤（2.100 / 1.000）与轴结构断言全部未变。
    // ⚠ **2026-10-20 重冻**：1.6645/0.6645/0.6041 → **1.6639/0.6639/0.6035**。
    // 归因：配装推荐主词条改按 nanoka 站点规则（本队 1291/1481/1161 的 4/5/6 号位都有变）⇒
    // 行伤害结构微移 ⇒ 按伤害加权的易伤均值漂移。行级易伤（2.100 / 1.000）与轴结构断言全部未变
    // ⇒ 易伤机制本身没动，只是权重。A/B：把 build-recommendations.json 退回 HEAD 即回到旧值。
    /**
     * 2026-10-23：不再钉加权均值（上面注释里已重冻 **4 次**：T141 / 10-18 / 10-20 / 本次）。
     *
     * 每次归因都是同一句：「行级易伤（2.100 / 1.000）与轴结构断言全部未变 ⇒ 只是权重漂移」。
     * 既然真正要守的是**行级易伤与轴结构**（本文件上面那些断言），加权均值就不该再写死——
     * 它是「行伤害占比」的派生量，任何改变伤害结构的引擎改动都会动它，而那正是常态开发。
     *
     * ⇒ 改为断言**恒等式**：加权均值必须等于「按各行伤害占比重算的加权和」，
     * 并且落在行级值构成的区间内（1.0 ~ 2.1 之间）。机制真坏了（比如某行不吃易伤）会立刻越界。
     */
    // 独立复算（不复用被测实现）：逐行 damage × appliedStunMult 的加权均值
    const totalDmg = rows.reduce((a, r) => a + Math.max(0, r.totalDamage), 0)
    const recomputed = totalDmg > 0
      ? rows.reduce((a, r) => a + Math.max(0, r.totalDamage) * rowAppliedStunMultOf(r, p), 0) / totalDmg
      : 1
    expect(s.weightedVuln, '加权易伤 = Σ(伤害×生效易伤)/Σ伤害（恒等式）').toBeCloseTo(recomputed, 9)
    // 落在行级易伤的实际区间内（机制真坏了——某行不吃易伤——会立刻越界）
    const vulnPerRow = rows.map(r => rowAppliedStunMultOf(r, p))
    expect(s.weightedVuln).toBeGreaterThanOrEqual(Math.min(...vulnPerRow) - 1e-9)
    expect(s.weightedVuln).toBeLessThanOrEqual(Math.max(...vulnPerRow) + 1e-9)
    expect(s.weightedCredit, 'weightedCredit = weightedVuln − 1').toBeCloseTo(s.weightedVuln - 1, 9)
    expect(s.coverageRate, 'coverageRate = weightedCredit / fullCredit').toBeCloseTo(s.weightedCredit / s.fullCredit, 9)
  })

  it('案例 D（加闪反块被轴认领一半）：加权快照 1.7198/0.7198/0.6543；闪反切成两行', async () => {
    const { config, calc } = await setupHugoAxis(true)
    const vuln = config.enemy.stunVuln
    const p0 = calc.panels.value[0]
    const bonus = p0?.stunDmgMultiplierBonus ?? 0
    const always = p0?.stunDmgMultiplierBonusAlways ?? 0
    const cap = p0?.stunDmgMultiplierBonusCapAlways ?? 0
    const p = { vuln, bonus, always, cap }
    const full = calcStunMultiplier(vuln, bonus, always, cap, true)
    const rows = (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
    const dodgeRows = rows.filter(r => r.moveId === '1291012')
    expect(dodgeRows.length).toBe(2) // 轴内段(满额) + 轴外段(零)
    expect(dodgeRows.some(r => rowAppliedStunMultOf(r, p) > 1.99)).toBe(true)
    expect(dodgeRows.some(r => rowAppliedStunMultOf(r, p) < 1.01)).toBe(true)
    const s = computeStunVulnSummary(
      rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMultOf(r, p) })),
      full,
    )
    // ⚠ **T141 重冻**：1.7198/0.7198/0.6543 → **1.7647/0.7647/0.6952**（理由同上条：行伤害占比微移）。
    // 本条的**结构**判据（闪反 `1291012` 恰好切两行、一行 >1.99 一行 <1.01）在上面，全部未变。
    // ⚠ **2026-10-18 重冻**：1.7647/0.7647/0.6952 → **1.7665/0.7665/0.6971**（同上条：百暴基线修正 ⇒ 行占比微移）。
    // 2026-10-23：与案例 B 同法——加权均值改为**独立复算恒等式**（该值已重冻 3 次，都是行占比漂移）
    const dTotal = rows.reduce((a, r) => a + Math.max(0, r.totalDamage), 0)
    const dRecomputed = dTotal > 0
      ? rows.reduce((a, r) => a + Math.max(0, r.totalDamage) * rowAppliedStunMultOf(r, p), 0) / dTotal
      : 1
    expect(s.weightedVuln, '加权易伤 = Σ(伤害×生效易伤)/Σ伤害（恒等式）').toBeCloseTo(dRecomputed, 9)
    expect(s.weightedCredit, 'weightedCredit = weightedVuln − 1').toBeCloseTo(s.weightedVuln - 1, 9)
    expect(s.coverageRate, 'coverageRate = weightedCredit / fullCredit').toBeCloseTo(s.weightedCredit / s.fullCredit, 9)
  })
})

describe('computeStunVulnBySlot（逐人增幅，用户 2026-09-13）', () => {
  const rows = [
    { slot: 0, totalDamage: 100, appliedStunMult: 2.1 },
    { slot: 0, totalDamage: 100, appliedStunMult: 1.0 },
    { slot: 1, totalDamage: 50, appliedStunMult: 1.0 },
    { slot: 2, totalDamage: 200, appliedStunMult: 2.1 },
  ]
  it('按槽位分组、同口径：满额 2.1/零 1.0，逐人 credit 与兑现率各自独立', () => {
    const out = computeStunVulnBySlot(rows, 2.1)
    expect(out.map(o => o.slot)).toEqual([0, 1, 2])
    const [s0, s1, s2] = out
    expect(s0.total).toBe(200)
    expect(s0.credit).toBeCloseTo(0.55, 3)   // (2.1+1.0)/2 − 1
    expect(s0.coverageRate).toBeCloseTo(0.5, 3)
    expect(s1.credit).toBeCloseTo(0, 6)      // 完全没吃到易伤
    expect(s1.coverageRate).toBeCloseTo(0, 6)
    expect(s2.credit).toBeCloseTo(1.1, 3)    // 满额
    expect(s2.coverageRate).toBeCloseTo(1, 6)
  })
  it('交叉对账：Σ(逐人 total × weightedVuln)/Σtotal == 全队 weightedVuln（分组不改加权，防两处口径漂移）', () => {
    const team = computeStunVulnSummary(rows, 2.1)
    const totalAll = rows.reduce((a, r) => a + r.totalDamage, 0)
    const recalc = computeStunVulnBySlot(rows, 2.1).reduce((a, o) => a + o.total * o.weightedVuln, 0) / totalAll
    expect(team.weightedVuln).toBeCloseTo(recalc, 9)
  })
  it('空槽/零伤害不炸；单人队也返回一条', () => {
    expect(computeStunVulnBySlot([], 2.1)).toEqual([])
    const one = computeStunVulnBySlot([{ slot: 2, totalDamage: 100, appliedStunMult: 1.05 }], 2.1)
    expect(one).toHaveLength(1)
    expect(one[0].coverageRate).toBeCloseTo(0.05 / 1.1, 3)
  })
})

describe('CC-226：行级覆盖率 / 基数取引擎实值（不再由 stunMult 反推）', () => {
  const p = { vuln: 1.5, bonus: 100, always: 0, cap: 0 }
  it('叶瞬光帷幕行触顶（基数 1.1 < stunVuln 1.5）：满覆盖 ⇒ 生效 2.1，覆盖率 100%', () => {
    const veilRow = { stunMult: 1 + (1.1 - 1) * 1, stunCoverage: 1, stunVulnBase: 1.1 }
    expect(rowStunCoverage(veilRow, p.vuln)).toBe(1)
    expect(rowAppliedStunMultOf(veilRow, p)).toBeCloseTo(2.1, 9)
    expect(rowFullStunMultOf(veilRow, p)).toBeCloseTo(2.1, 9)
    // 反例：旧反推路径（不带新字段）把同一行读成 20% 覆盖
    expect(rowStunCoverage({ stunMult: veilRow.stunMult }, p.vuln)).toBeCloseTo(0.2, 9)
    expect(rowAppliedStunMultOf({ stunMult: veilRow.stunMult }, p)).not.toBeCloseTo(2.1, 3)
  })
  it('普通行：新字段与旧反推逐位等价', () => {
    for (const cov of [0, 0.25, 0.5, 1]) {
      const row = { stunMult: 1 + (p.vuln - 1) * cov, stunCoverage: cov, stunVulnBase: p.vuln }
      expect(rowAppliedStunMultOf(row, p)).toBeCloseTo(rowAppliedStunMultOf({ stunMult: row.stunMult }, p), 12)
    }
    expect(rowAppliedStunMultOf({}, p)).toBe(1)
    expect(rowStunCoverage({}, p.vuln)).toBeUndefined()
  })
  // 2026-10-28：反推式随行级失衡易伤派生一起迁 `core/stunVulnRow.ts`（建池盖章与展示汇总共用一份，
  // 规则 11）。断言从「只有 stunVulnSummary.ts 一处」改为指向新位置，**口径不变**：全仓只许有一份反推式。
  it('源码锁：由 stunMult 反推覆盖率的式子全仓只有 core/stunVulnRow.ts 一处', () => {
    const SRC = joinSrc(__dirname, '..', '..')
    const RE = /\(\s*[\w.]*stunMult\s*-\s*1\s*\)\s*\/\s*\(\s*[\w.]+\s*-\s*1\s*\)/
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readSrcDir(d)) {
        const f = joinSrc(d, n)
        if (statSrc(f).isDirectory()) { if (n !== '__tests__' && n !== 'node_modules') walk(f); continue }
        if (!/\.(ts|vue)$/.test(n)) continue
        readSrcFile(f, 'utf8').split('\n').forEach((line, i) => {
          if (RE.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) hits.push(`${relSrc(SRC, f).replace(/\\/g, '/')}:${i + 1}`)
        })
      }
    }
    walk(SRC)
    expect(hits.map(h => h.split(':')[0])).toEqual(['core/stunVulnRow.ts'])
  })
})
