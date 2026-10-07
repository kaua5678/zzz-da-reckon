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
import { computeStunVulnSummary, computeStunVulnBySlot, rowAppliedStunMultOf, rowFullStunMultOf, rowStunCoverage } from '@/composables/stunVulnSummary'
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
    if (extraDodge) config.stunAxes[0].actions.push({ slot: 0, moveId: '1291012', count: 1, startTime: 8 })
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
    expect(verdict?.count).toBe(5) // 坑36 修复：轴栈同源
    expect(rowAppliedStunMultOf(verdict ?? {}, p)).toBeCloseTo(2.1, 3)
    expect(rowAppliedStunMultOf(normal ?? {}, p)).toBeCloseTo(1.0, 3)
    const s = computeStunVulnSummary(
      rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMultOf(r, p) })),
      full,
    )
    // 重冻 2026-09-28（CC-158 第 181 轮，折叠残差可退回 ⇒ 平A池重分、轴外行伤害占比微移）：旧 1.6900/0.6900/0.6273、
    // 案例 D 旧 1.7211/0.7211/0.6555；行级易伤（2.100 / 1.000、闪反两段）断言全部不变 ⇒ 仅权重漂移。
    expect(s.weightedVuln).toBeCloseTo(1.6888, 3)
    expect(s.weightedCredit).toBeCloseTo(0.6888, 3)
    expect(s.coverageRate).toBeCloseTo(0.6262, 3)
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
    expect(s.weightedVuln).toBeCloseTo(1.7198, 3)
    expect(s.weightedCredit).toBeCloseTo(0.7198, 3)
    expect(s.coverageRate).toBeCloseTo(0.6543, 3)
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
  it('源码锁：由 stunMult 反推覆盖率的式子全仓只有 stunVulnSummary.ts 一处', () => {
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
    expect(hits.map(h => h.split(':')[0])).toEqual(['composables/stunVulnSummary.ts'])
  })
})
