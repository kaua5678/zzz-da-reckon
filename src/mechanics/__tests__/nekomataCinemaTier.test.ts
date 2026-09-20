/**
 * 猫又(1021) **潜能觉醒轴 + 暴击通道** —— R58 结清（两个缺陷叠在同一个函数里）。
 *
 * ## 缺陷 ①（轴误读，与 1181 同族）
 *
 * `nekomata.ts#applyNekoPanel` 把「**潜能觉醒**·猫的报恩」（II~VI = 暴伤 20/30/40/50/60%）
 * 写成 `if (cinemaLevel >= 2) { [20,30,40,50,60][Math.min(cinemaLevel,6) - 2] }`
 * —— 档位取自 `potential_detail`，门控与索引却用 `cinemaLevel`。
 *
 * ## 缺陷 ②（死通道，更严重：影画 4/6 此前**完全没进计算**）
 *
 * 同一函数把暴击类写进 `panel.critDmgBonus` / `panel.critRateBonus`。这两个字段在
 * `PanelValues` 上**零消费者**：`calcDirectDamage` 只读**行级入参** `input.critRateBonus`
 * （来源 `exec.critRateBonus`，由 `patchExecutions` 写入），而 `getTargetedStat(panel,'critRate')`
 * 读的是 `panel.critRate`。⇒ 猫又 C4（暴击率 +14%）与 C6（暴伤 +54%）对伤害的 delta **恒为 0**。
 *
 * ## 判据设计（两层 + 反锁）
 *
 * ① **常量层钉在原文**：读 raw `potential_detail`（**不是** `talent`）断言 II~VI 子句，
 *    再断言实现档位表逐位相等；并**反锁** `talent.4/6.desc` 不含潜能子句、`potential_detail`
 *    不含影画子句 —— 把「轴」钉死。
 * ② **行为层走真管线**：正交四臂 (cinema, potential) ∈ {0,6}×{1,6} 断言 `panel.critDmg`；
 *    **外加端到端可见性判据**（缺陷 ② 的专用尺）：C4 / C6 必须真的抬高 `teamTotalDamage`
 *    —— 旧实现下这两条 delta 恒为 0（本文件第 ③ 例即为此设，是本任最有区分度的一条）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  NEKOMATA_C4_CRIT_RATE,
  NEKOMATA_C6_CRIT_DMG,
  NEKOMATA_POTENTIAL_CRIT_DMG,
} from '@/mechanics/agents/nekomata'

/** 真管线单臂探针：**每次调用都独立 setupHarness**。 */
async function arm(cinemaLevel: number, potentialLevel: number) {
  await setupHarness([{ agentId: '1021', cinemaLevel, potentialLevel }, '', ''])
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 0))
  const panel = calc.panels.value[0] as unknown as Record<string, number>
  return {
    critDmg: panel.critDmg ?? 0,
    critRate: panel.critRate ?? 0,
    damage: calc.teamTotalDamage.value,
  }
}

describe('R58 · 猫又潜能觉醒轴（潜能 II~VI 暴伤 20/30/40/50/60，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', () => {
    const raw = JSON.parse(readFileSync(
      new URL('../../../data/raw/nanoka_missing/full/1021.json', import.meta.url), 'utf8',
    ))
    const byLevel = new Map(
      (Object.values(raw.potential_detail as Record<string, { level: number; desc?: string }>)
        .filter(p => p.desc)).map(p => [p.level, p.desc as string]),
    )
    for (const [lv, pct] of [[2, 20], [3, 30], [4, 40], [5, 50], [6, 60]] as const) {
      const desc = byLevel.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('暴击伤害提升')
      expect(desc!).toContain(`${pct}%`)
      expect(NEKOMATA_POTENTIAL_CRIT_DMG[lv]).toBe(pct)
    }
    expect(NEKOMATA_POTENTIAL_CRIT_DMG[1]).toBe(0)

    // 影画 4/6 的原文子句（缺陷 ② 的常量侧证据：这两个数字来自 talent，不是 potential）
    expect(String(raw.talent['4'].desc)).toContain('暴击率提升7%')
    expect(String(raw.talent['6'].desc)).toContain('暴击伤害提升18%')
    expect(NEKOMATA_C4_CRIT_RATE).toBe(7 * 2) // 2 层满层
    expect(NEKOMATA_C6_CRIT_DMG).toBe(18 * 3) // 3 层满层

    // ★ 反锁「轴」：潜能原文不含影画子句、影画原文不含潜能子句
    for (const k of ['4', '6']) {
      expect(String(raw.talent[k].desc)).not.toContain('肉球突袭')
      expect(String(raw.talent[k].desc)).not.toContain('猫的报恩')
    }
    for (const lv of [2, 3, 4, 5, 6]) {
      expect(byLevel.get(lv)!).not.toContain('磨爪')
      expect(byLevel.get(lv)!).not.toContain('捕食者血统')
    }
  })

  it('② 行为层正交四臂：critDmg 只随 potentialLevel 变，不随 cinemaLevel 变', async () => {
    const c0p1 = await arm(0, 1)
    const c0p6 = await arm(0, 6)
    const c6p1 = await arm(6, 1)
    const c6p6 = await arm(6, 6)

    expect(c0p1.critDmg).toBe(50) // 基础暴伤，潜能 I = 无觉醒
    expect(c0p6.critDmg - c0p1.critDmg).toBe(NEKOMATA_POTENTIAL_CRIT_DMG[6])
    // 影画 6 含 C6 暴伤 54，故 c6 档基线更高；但潜能增量在两档下**一致**
    expect(c6p6.critDmg - c6p1.critDmg).toBe(NEKOMATA_POTENTIAL_CRIT_DMG[6])
    // 反锁：满命 0 潜能**不**给潜能暴伤（旧实现在此给 60 —— 正是「命座轴」证据）
    expect(c6p1.critDmg - c0p1.critDmg).toBe(NEKOMATA_C6_CRIT_DMG)
  })

  it('③ ★端到端可见性：影画4（暴击率+14%）与影画6（暴伤+54%）必须真的抬高伤害', async () => {
    const c3 = await arm(3, 6)
    const c4 = await arm(4, 6)
    const c5 = await arm(5, 6)
    const c6 = await arm(6, 6)

    // 通道量本身（真字段）
    expect(c4.critRate - c3.critRate).toBeCloseTo(NEKOMATA_C4_CRIT_RATE, 6)
    expect(c6.critDmg - c5.critDmg).toBeCloseTo(NEKOMATA_C6_CRIT_DMG, 6)

    // ★ 端到端：旧实现（写 panel.critRateBonus/critDmgBonus 死通道）下这两条 delta **恒为 0**
    expect(c4.damage, '影画4 暴击率 +14% 未进伤害计算（死通道）').toBeGreaterThan(c3.damage)
    expect(c6.damage, '影画6 暴伤 +54% 未进伤害计算（死通道）').toBeGreaterThan(c5.damage)
  })
})
