/**
 * 格莉丝(1181) **潜能觉醒轴 vs 影画轴** —— R58 结清（缺陷类：轴误读）。
 *
 * ## 缺陷（R58 机械筛 + 四臂正交实验发现）
 *
 * `grace.ts#applyGracePanel` 把「**潜能觉醒**·超频工程引擎」（钢械交响曲 II~VI）写成：
 * ```ts
 * if (cinemaLevel >= 2) { bonus = [10,15,20,25,30][Math.min(cinemaLevel,6) - 2] }
 * ```
 * 档位表取自 **潜能** 轴（raw `potential_detail`），门控与索引却用 **cinemaLevel**。
 * raw 里这两条轴**完全独立**：`talent.1..6` = 影画（再充能弹膛/电致击穿/首席机械师/
 * 爆破电容/「冰冷铁魔女」/起爆扳机），`potential_detail` = 潜能觉醒（钢械交响曲 I~VI）。
 *
 * ⇒ 后果：**潜能等级完全不影响电伤**（四臂正交实测 A/B 恒等、C/D 恒等），
 *   而 0 命满潜能玩家白丢 30%、6 命 0 潜能玩家白拿 30%。
 *
 * ## 判据设计（为什么不是同义反复，两层缺一不可）
 *
 * 硬约束「跨路径恒等式先查同义反复：两边同读一个常量 ⇒ 它不是判据」。故本文件分两层：
 * ① **常量层钉在原文**：直接读 `data/raw/nanoka_missing/full/1181.json` 的
 *    `potential_detail`（不是 `talent`！）断言 II~VI 档子句与数字**存在**，
 *    再断言实现档位表与之**逐位相等** ⇒ 原文改了本测试必红，不是两边同读一个常量。
 *    ⚠ **反锁**：同时断言 `talent.1/2.desc`（影画原文）**不含**该电伤子句 ——
 *    这一条把「轴」钉死，是 R58 缺陷的直接判据（旧实现会在此红）。
 * ② **行为层走真管线 + 正交四臂**：`setupHarness` 真队伍 → 真 `useResourceCalc()`，
 *    (cinema, potential) ∈ {0,6}×{1,6} 四点**每点独立 setupHarness**，断言**通道量**
 *    `panel.electricDmg`（不是只看端到端伤害 —— R57：通道被钳时端到端恒绿）。
 *    正交性本身是判据：`electricDmg` 必须只随 potential 变、不随 cinema 变。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { GRACE_POTENTIAL_ELECTRIC_DMG } from '@/mechanics/agents/grace'

/** 真管线单臂探针：**每次调用都独立 setupHarness**（硬约束：不许复用响应式快照）。 */
async function arm(cinemaLevel: number, potentialLevel: number) {
  await setupHarness([{ agentId: '1181', cinemaLevel, potentialLevel }, '', ''])
  const calc = useResourceCalc()
  // R52 坑①：必须在建队 + await setTimeout(0) **之后**读
  await new Promise(r => setTimeout(r, 0))
  const panel = calc.panels.value[0] as unknown as Record<string, number>
  return { electricDmg: panel.electricDmg ?? 0, damage: calc.teamTotalDamage.value }
}

describe('R58 · 格莉丝潜能觉醒轴（潜能 II~VI 电伤 10/15/20/25/30，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', () => {
    const raw = JSON.parse(readFileSync(
      new URL('../../../data/raw/nanoka_missing/full/1181.json', import.meta.url), 'utf8',
    ))
    const pot = Object.values(raw.potential_detail as Record<string, { level: number; desc?: string }>)
    const byLevel = new Map(pot.filter(p => p.desc).map(p => [p.level, p.desc as string]))

    // 潜能 II~VI 的原文子句与数字（**读 potential_detail，不是 talent**）
    // ⚠ 断言前先剥颜色标签：raw 里「电属性伤害」与「提升」之间夹着 `<color=…>` 标签
    //   （首版直接 toContain('电属性伤害提升') 被自己的原文格式绊红 —— 判据要先归一化）。
    const strip = (s: string) => s.replace(/<[^>]+>/g, '')
    for (const [lv, pct] of [[2, 10], [3, 15], [4, 20], [5, 25], [6, 30]] as const) {
      const desc = byLevel.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(strip(desc!)).toContain('电属性伤害提升')
      expect(strip(desc!)).toContain(`${pct}%`)
      expect(GRACE_POTENTIAL_ELECTRIC_DMG[lv]).toBe(pct)
    }
    // 潜能 I = 无觉醒
    expect(GRACE_POTENTIAL_ELECTRIC_DMG[1]).toBe(0)

    // ★ 反锁「轴」：影画原文（talent.1..6）**不含**该潜能子句 —— 旧实现把轴搞反，会在此红
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(String(raw.talent[k].desc)).not.toContain('钢械交响曲')
      expect(String(raw.talent[k].desc)).not.toContain('电能强化')
    }
    // 且影画 2（旧实现的门控来源）确实与电伤无关
    expect(String(raw.talent['2'].desc)).not.toContain('电属性伤害提升')
  })

  it('② 行为层正交四臂：electricDmg 只随 potentialLevel 变，不随 cinemaLevel 变', async () => {
    const c0p1 = await arm(0, 1)
    const c0p6 = await arm(0, 6)
    const c6p1 = await arm(6, 1)
    const c6p6 = await arm(6, 6)

    // 潜能轴：I → VI 恰好 +30（0 命与 6 命下**同样** +30）
    expect(c0p1.electricDmg).toBe(0)
    expect(c0p6.electricDmg).toBe(GRACE_POTENTIAL_ELECTRIC_DMG[6])
    expect(c6p1.electricDmg).toBe(0)
    expect(c6p6.electricDmg).toBe(GRACE_POTENTIAL_ELECTRIC_DMG[6])
    expect(c0p6.electricDmg - c0p1.electricDmg).toBe(30)
    expect(c6p6.electricDmg - c6p1.electricDmg).toBe(30)

    // 影画轴：同一潜能档下 cinema 0 → 6 **不**改变电伤（旧实现此处会 +30，正是缺陷证据）
    expect(c6p1.electricDmg - c0p1.electricDmg).toBe(0)
    expect(c6p6.electricDmg - c0p6.electricDmg).toBe(0)

    // 端到端同向（辅助证据，不作主判据）：满潜能严格抬高伤害
    expect(c0p6.damage).toBeGreaterThan(c0p1.damage)
  })

  it('③ 逐档单调：潜能 II..VI 的电伤严格递增 10→30（无跳档/无错位）', async () => {
    const seen: number[] = []
    for (const lv of [2, 3, 4, 5, 6]) seen.push((await arm(0, lv)).electricDmg)
    expect(seen).toEqual([10, 15, 20, 25, 30])
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })
})
