/**
 * 探针：非轴模式下「失衡易伤」是否进入伤害计算（生效性 + 覆盖率折扣 + 显示值一致性）。
 *
 * 问题（用户 2026-09）：非轴模式（useStunAxis=false）的伤害计算里看不到失衡易伤，是否生效？
 * 判据三问：
 *  ① 生效性：同队同面板，只切 `enemy.stunVuln`（1.5 → 1.0），行级 perDamage / 池明细是否随之变化；
 *  ② 折扣口径：实际生效倍率是否 = 1 + (基础倍率−1 + 失衡易伤加成/100) × 失衡覆盖率；
 *  ③ 显示一致性：行级 `stunMult`（Excel「失衡易伤」列）是否等于实际生效倍率。
 *
 * 跑法：PROBE_NONAXIS=1 npx vitest run src/composables/__tests__/nonAxisStunVulnProbe.test.ts
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

describe('探针：非轴模式失衡易伤生效性', () => {
  it.runIf(process.env.PROBE_NONAXIS)('非轴：生效性 / 覆盖率折扣 / stunMult 列一致性', async () => {
    // 槽位 1 = 莱卡恩（1141）：给全队挂 失衡易伤 +35%（teammate-buffs），用于检验加成通道是否进乘区
    const { config } = await setupHarness(
      [{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }],
      { recommendedBuild: true },
    )
    const calc = useResourceCalc()
    config.useStunAxis = false

    const snapshot = (label: string) => {
      const all = (calc.damagePoolRows.value ?? []).filter(r => (r.multiplier ?? 0) > 0 && r.count > 0)
      const total = calc.teamTotalDamage.value ?? 0
      const per = new Map<string, DamagePoolRow>(all.map(r => [r.id, r]))
      const dd = calc.anomalyPoolResult.value?.disorderDamage?.details?.[0]
      console.log(
        `\n[${label}] stunVuln=${config.enemy.stunVuln} 总伤=${(total / 1e6).toFixed(4)}M` +
        ` | 池紊乱明细[0] settlement=${dd ? (dd as any).settlementMultiplier.toFixed(4) : '-'} perEvent=${dd ? Math.round((dd as any).perEventDamage) : '-'}` +
        ` | 直伤行=${all.filter(r => r.type === '直伤').length} 异常行=${all.filter(r => r.type !== '直伤').length}`,
      )
      return { all, per, total }
    }

    config.enemy.stunVuln = 1.5
    const a = snapshot('A: stunVuln=1.5')
    config.enemy.stunVuln = 1.0
    const b = snapshot('B: stunVuln=1.0')

    const stunCount = Number((calc.stunPoolResult.value as any)?.stunCount ?? 0)
    const effectiveTime = Math.max(0, (config.enemy.battleTime ?? 180) - (config.enemy.invincibleTime ?? 0))
    const cov = effectiveTime > 0 ? Math.min(1, (stunCount * calc.windowDuration.value) / effectiveTime) : 0
    console.log(`\n失衡覆盖率（复算 stunCount=${stunCount} × 窗口${calc.windowDuration.value}s / 有效${effectiveTime}s）= ${cov.toFixed(4)}`)
    console.log('面板失衡易伤加成: ' + calc.panels.value.map((p, i) => `s${i}(${config.team[i]?.agentId || '-'}) +${p?.stunDmgMultiplierBonus ?? 0}`).join(' | '))

    const compare = (rows: DamagePoolRow[], limit: number, title: string) => {
      console.log(`\n${title}：`)
      for (const ra of rows.slice(0, limit)) {
        const rb = b.per.get(ra.id)
        const panel = calc.panels.value[ra.slot]
        const expected = calcStunMultiplier(1.5, panel?.stunDmgMultiplierBonus ?? 0, panel?.stunDmgMultiplierBonusAlways ?? 0, panel?.stunDmgMultiplierBonusCapAlways ?? 0, cov)
        const full = Math.max(0, 1.5 + ((panel?.stunDmgMultiplierBonus ?? 0) + (panel?.stunDmgMultiplierBonusAlways ?? 0)) / 100)
        console.log(
          `  ${ra.type} ${ra.name.slice(0, 14).padEnd(16)} s${ra.slot}` +
          ` | stunMult列=${ra.stunMult === undefined ? '未设置(Excel 记 1)' : ra.stunMult.toFixed(4)}` +
          ` | 实际 1.5/1.0=${rb ? (ra.perDamage / rb.perDamage).toFixed(4) : '行不匹配'}` +
          ` | 期望(1.5)=${expected.toFixed(4)} 满易伤=${full.toFixed(4)}`,
        )
      }
    }
    compare(a.all.filter(r => r.type === '直伤'), 3, '直伤行对照')
    compare(a.all.filter(r => r.type !== '直伤'), 4, '异常行对照')

    const ratio = b.total > 0 ? a.total / b.total : 0
    console.log(`\n① 生效性：总伤 1.5/1.0 = ${ratio.toFixed(4)}（=1 即完全不生效）`)

    expect(a.total).toBeGreaterThan(0)
    expect(b.total).toBeGreaterThan(0)
    expect(ratio).toBeGreaterThan(1)
  }, 1800000)
})
