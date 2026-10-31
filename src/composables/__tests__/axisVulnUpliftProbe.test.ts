/**
 * 探针：**手动捏轴 vs 无轴，失衡易伤贡献提高了多少**（用户 2026-10-16 立项）。
 *
 * ## 用户口径（逐字）
 *
 * > 「我预设了一些队伍的轴，想知道**没捏轴的无轴易伤贡献**和**完整 4 失衡手动轴**相比，手动捏轴把
 * >  易伤贡献提高了多少？算出并记录下来供人参考，如果发现手动预设的**总是提高了同一个值**的话，
 * >  我将把所有自动易伤预设乘这个提升，这样就不用我每个队伍都捏轴了。如果不是同一个数左右，
 * >  也能看到一个**区间**，这样手动可以调整至合理区间，简单代替手动捏轴的劳累。」
 *
 * 参考表（实测数字 + 口径）见 `docs/axis-vuln-uplift-reference.md`。
 *
 * ## 三个臂（只切轴状态与保底，其它输入不动）
 *
 * | 臂 | 轴 | 保底 | 语义 |
 * |---|---|---|---|
 * | **A** | 命中的轴预设 | 预设声明的 | **有轴**（= 用户捏好的那套） |
 * | **C** | 无 | 清空 | **无轴**（= 用户说的「没捏轴」） |
 * | **D** | 无 | 清空 + `enemy.stunCountLock = A 的失衡次数` | 隔离「轴把伤害塞进窗口」与「轴多换了一次失衡」 |
 *
 * 拆解：**总提升 = 结构项（A/D）× 次数项（D/C）**。
 *
 * ## 两个必须分清的量（口径，别混）
 *
 * - **信用提升倍数** = A 的加权易伤信用 ÷ C 的信用 —— 用户问的「易伤贡献提高了多少」，**不是**伤害倍数；
 * - **总伤提升** = A 总伤 ÷ C 总伤 —— 易伤只占总伤的一个乘区，所以它**永远小于**信用倍数。
 *
 * 加权易伤信用与结果页「信用 +x / 满额 +y」同一实现（`stunVulnSummary#computeStunVulnSummary`）。
 *
 * ## 跑法
 *
 * ```bash
 * PROBE_AXIS_VULN=1 npx vitest run src/composables/__tests__/axisVulnUpliftProbe.test.ts
 * PROBE_AXIS_VULN=1 PROBE_AXIS_VULN_JSON=1 …   # 追加一行机器可读 JSON
 * PROBE_AXIS_VULN=1 PROBE_AXIS_VULN_TEAMS=<预设id,…> …   # 限定队伍
 * ```
 *
 * 不设 `PROBE_AXIS_VULN` 时空跑（普通 `vitest run` 不受影响）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { teamPresets } from '@/data/teamPresets'
import { applyBossRoom } from '@/composables/bossRoom'
import { applyTeamToStore } from '@/composables/teamCompare'
import { computeStunVulnSummary } from '@/composables/stunVulnSummary'
import { rowAppliedStunMultOf } from '@/core/stunVulnRow'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { panelAt } from '@/core/panel'
import { stunAxisPresets, prefillPresetGuarantee, selectAutoStunAxisPreset } from '@/data/stunAxisPresets'
import { AUTO_AXIS_PRESET_HINTS } from '@/mechanics'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

const ACTIVE = process.env.PROBE_AXIS_VULN === '1'
const F = (v: number, n = 4) => v.toFixed(n)
const NL = String.fromCharCode(10)
type Calc = ReturnType<typeof useResourceCalc>
type Cfg = ReturnType<typeof useConfigStore>

interface Arm {
  label: string
  total: number
  stunCount: number
  coverage: number
  fullMult: number
  weightedVuln: number
  credit: number
  coverageRate: number
  meanDirectCoverage: number
}

function readArm(calc: Calc, config: Cfg, label: string): Arm {
  const rows = (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
  const p0 = panelAt(calc.panels.value, 0)
  const bonus = {
    vuln: config.enemy.stunVuln,
    bonus: p0?.stunDmgMultiplierBonus ?? 0,
    always: p0?.stunDmgMultiplierBonusAlways ?? 0,
    cap: p0?.stunDmgMultiplierBonusCapAlways ?? 0,
  }
  const fullMult = calcStunMultiplier(bonus.vuln, bonus.bonus, bonus.always, bonus.cap, true)
  const s = computeStunVulnSummary(
    rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMultOf(r, bonus) })), fullMult)
  const direct = rows.filter(r => r.type === '直伤')
  const directDmg = direct.reduce((a, r) => a + r.totalDamage, 0)
  return {
    label,
    total: calc.teamTotalDamage.value ?? 0,
    stunCount: calc.stunPoolResult.value?.stunCount ?? 0,
    coverage: calc.stunCoverage.value,
    fullMult,
    weightedVuln: s.weightedVuln,
    credit: s.weightedCredit,
    coverageRate: s.coverageRate,
    meanDirectCoverage: directDmg > 0 ? direct.reduce((a, r) => a + r.totalDamage * (r.stunCoverage ?? 0), 0) / directDmg : 0,
  }
}

const fmtArm = (a: Arm) => a.label + ': 总伤 ' + (a.total / 1e6).toFixed(2) + 'M 失衡 ' + F(a.stunCount, 2)
  + ' 覆盖 ' + F(a.coverage) + ' 加权易伤 ' + F(a.weightedVuln) + ' 信用 ' + F(a.credit)
  + ' 兑现率 ' + F(a.coverageRate)

const quantile = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]!
const describe1 = (name: string, arr: number[]) => arr.length === 0 ? name + ' n=0' : name
  + ' n=' + arr.length + ' min=' + F(quantile(arr, 0), 3) + ' p25=' + F(quantile(arr, 0.25), 3)
  + ' 中位=' + F(quantile(arr, 0.5), 3) + ' p75=' + F(quantile(arr, 0.75), 3)
  + ' max=' + F(quantile(arr, 1), 3) + ' 均值=' + F(arr.reduce((a, b) => a + b, 0) / arr.length, 3)

describe.runIf(ACTIVE)('探针：手动轴 vs 无轴的易伤贡献提升', () => {
  it('逐队三臂读数 + 提升倍数分布（参考表数据源）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const config = useConfigStore()
    const data = await catalog.loadBossPresets()
    const pairs: { boss: BossPreset; phase: BossPresetPhase }[] = []
    for (const b of data.bosses ?? []) {
      const ca = b.phases.find(p => p.modeType === 'critical_assault')
      const ph = ca ?? b.phases[0]
      if (ph) pairs.push({ boss: b, phase: ph })
    }
    pairs.sort((a, b) => (b.phase.begin || b.phase.phaseId).localeCompare(a.phase.begin || a.phase.phaseId))
    const { boss, phase } = pairs[0]!
    console.log('口径：Boss ' + boss.name + '(' + boss.id + ') · ' + phase.label
      + ' · monster.stunVuln=' + boss.monster.stunVuln + ' · 单窗 ' + boss.monster.stunTime + 's'
      + ' · 轴预设 ' + stunAxisPresets.length + ' 条')

    const ids = (process.env.PROBE_AXIS_VULN_TEAMS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const targets = ids.length > 0 ? teamPresets.filter(p => ids.includes(p.id)) : teamPresets
    const G = ['guarantee.stun', 'guarantee.fury']
    const records: Record<string, unknown>[] = []
    const out: string[] = []
    for (const preset of targets) {
      const matched = selectAutoStunAxisPreset(
        preset.team as (string | undefined)[], { 0: 0, 1: 0, 2: 0 }, stunAxisPresets, AUTO_AXIS_PRESET_HINTS)
      if (!matched) continue
      applyBossRoom(config, boss, phase)
      config.timeWeightStrategy = 'static'
      const baseG: Record<string, number> = {}
      for (const k of G) baseG[k] = config.getMechanicSetting(k, 0)
      const arm = (label: string, withAxis: boolean): Arm => {
        config.setAxisState({ stunAxes: [], stunAxisPlans: [], useStunAxis: false })
        config.autoYidhariAxis = false
        config.enemy.stunCountLock = -1
        for (const k of G) config.setMechanicSetting(k, 0)
        applyTeamToStore(config, preset)
        if (withAxis) { config.applyStunAxisPreset(matched); prefillPresetGuarantee(config, matched) }
        return readArm(calc, config, label)
      }
      const A = arm('A 有轴', true)
      const C = arm('C 无轴', false)
      // D：无轴 + 锁定 A 的失衡次数（隔离「结构」与「次数」两半）
      const D = arm('D 无轴锁A次数', false)
      config.enemy.stunCountLock = A.stunCount
      Object.assign(D, readArm(calc, config, 'D 无轴锁' + F(A.stunCount, 0) + '次'))
      config.enemy.stunCountLock = -1
      config.autoYidhariAxis = true
      for (const k of G) config.setMechanicSetting(k, baseG[k] ?? 0)

      const gainCredit = C.credit > 1e-9 ? A.credit / C.credit : NaN
      const gainDamage = C.total > 1e-9 ? A.total / C.total : NaN
      const gainStruct = D.credit > 1e-9 ? A.credit / D.credit : NaN
      const gainCount = C.credit > 1e-9 ? D.credit / C.credit : NaN
      out.push([
        preset.id + ' ' + preset.name + ' | 轴=' + matched.id + ' (' + matched.name + ')',
        '  ' + fmtArm(A),
        '  ' + fmtArm(C),
        '  ' + fmtArm(D),
        '  → 信用 ' + F(C.credit) + '→' + F(A.credit) + ' = ' + (Number.isFinite(gainCredit) ? F(gainCredit, 3) + '×' : 'n/a')
          + ' | 总伤 ' + F(gainDamage, 3) + '× | 失衡 ' + F(C.stunCount, 0) + '→' + F(A.stunCount, 0)
          + ' | 满额信用 ' + F(A.fullMult - 1, 2)
          + ' | 结构项 ' + F(gainStruct, 3) + '× × 次数项 ' + F(gainCount, 3) + '×',
      ].join(NL))
      records.push({
        presetId: preset.id, name: preset.name, axisPresetId: matched.id, axisPresetName: matched.name,
        A, C, D, gainCredit, gainDamage, gainStruct, gainCount,
      })
    }
    console.log(out.join(NL))

    const srt = (key: string) => records.map(r => r[key] as number).filter(Number.isFinite).sort((a, b) => a - b)
    const credits = srt('gainCredit')
    const damages = srt('gainDamage')
    const structs = srt('gainStruct')
    const counts = srt('gainCount')
    console.log('')
    console.log('== 汇总（' + records.length + ' 队）==')
    console.log(describe1('信用提升 A/C ', credits))
    console.log(describe1('总伤提升 A/C ', damages))
    console.log(describe1('  结构项 A/D', structs))
    console.log(describe1('  次数项 D/C', counts))
    const flat = records.filter(r => Math.abs((r.gainCredit as number) - 1) < 1e-9).map(r => r.presetId)
    console.log('零提升队（' + flat.length + '）：' + (flat.join(', ') || '—'))
    if (process.env.PROBE_AXIS_VULN_JSON) console.log('AXISVULNJSON ' + JSON.stringify(records))
    expect(records.length).toBeGreaterThan(0)
  }, 3_600_000)
})
