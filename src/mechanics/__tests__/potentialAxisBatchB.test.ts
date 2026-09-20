/**
 * R59 · 潜能觉醒轴 vs 影画轴（batchB 四角色共用判据骨架）。
 *
 * ## 缺陷类（R58 batchA 同形，R59 batchB 命中四例）
 *
 * 四个模块都**按档位表取值**，但**没读 `potentialLevel`**，而是把 VI 满档写死：
 * ```ts
 * const POTENTIAL_CRIT_DMG = 48            // 1041：潜能 II~VI 本应 16/24/32/40/48
 * panel.impact = (panel.impact ?? 0) * 1.15 // 1141：潜能 II~VI 本应 ×1.05…×1.15
 * assaultCritDmgBonus: POTENTIAL_ASSAULT_CRIT_DMG  // 1261：写死 30（本应 10/15/20/25/30）
 * const POTENTIAL_MASTERY_PER_0_1 = 2.5     // 1171：写死 VI 档（本应 1/1.3/1.6/2/2.5）
 * ```
 * ⇒ **`potentialLevel` 滑块（UI 1..6，默认 6）对这些角色的潜能效果完全无效**：
 *   低潜能玩家被**高估**，且滑块静默失效（判据 4「滑块声明必须有改了确实变测试」的同族缺陷）。
 *
 * ## 判据设计（两层 + 反锁，R58 模板）
 *
 * ① **常量层钉在原文**：直接读 `data/raw/nanoka_missing/full/<id>.json` 的
 *    **`potential_detail`**（不是 `talent`！）断言 II~VI 档子句与数字存在，
 *    再断言实现档位表与之**逐位相等** ⇒ 原文改了本测试必红（不是两边同读一个常量）。
 *    ⚠ **反锁轴**：断言 `talent.1..6`（影画原文）**不含**该潜能子句 —— 旧实现把轴搞反会在此红。
 * ② **行为层正交四臂**：`setupHarness` 真队伍 → 真 `useResourceCalc()`，
 *    (cinema, potential) ∈ {0,6}×{1,6} 四点**每点独立 setupHarness**，断言**通道量**
 *    只随 potential 变、不随 cinema 变（只做逐档差分抓不到轴误读 —— R58 血泪）。
 *
 * ⚠ 断言前先剥颜色标签：raw 的 `<color=…>` 会把 `toContain` 绊红（红的是格式不是语义）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const RAW = (id: string) => JSON.parse(readFileSync(
  new URL(`../../../data/raw/nanoka_missing/full/${id}.json`, import.meta.url), 'utf8',
)) as {
  name: string
  potential_detail: Record<string, { level: number; desc?: string }>
  talent: Record<string, { desc?: string }>
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '')

/** 潜能 II~VI 的原文 desc，按 level 索引（level 1 是空占位）。 */
function potentialByLevel(id: string) {
  const raw = RAW(id)
  const map = new Map<number, string>()
  for (const v of Object.values(raw.potential_detail)) {
    if (v.desc) map.set(v.level, strip(v.desc))
  }
  return { raw, map }
}

/** 真管线单臂探针：**每次调用都独立 setupHarness**（硬约束：不许复用响应式快照）。 */
async function arm(id: string, mate: string, cinemaLevel: number, potentialLevel: number) {
  await setupHarness([
    { agentId: id, cinemaLevel, potentialLevel },
    { agentId: mate },
    '',
  ] as never)
  const calc = useResourceCalc()
  // R52 坑①：必须在建队 + await setTimeout(0) **之后**读
  await new Promise(r => setTimeout(r, 0))
  const panel = JSON.parse(JSON.stringify(calc.panels.value[0] ?? {})) as Record<string, number>
  return { panel, damage: calc.teamTotalDamage.value }
}

/**
 * 四臂正交骨架：断言 `read(panel)` 只随 potential 变、不随 cinema 变。
 * @param expectTier 潜能 II..VI 的期望通道量（长度 5）
 */
async function assertOrthogonal(
  id: string,
  mate: string,
  read: (panel: Record<string, number>) => number,
  expectTier: readonly number[],
) {
  const A = await arm(id, mate, 0, 1)
  const B = await arm(id, mate, 0, 6)
  const C = await arm(id, mate, 6, 1)
  const D = await arm(id, mate, 6, 6)

  // 潜能轴：I → VI 恰好走到满档（0 命与 6 命下**同样**）
  expect(read(A.panel)).toBe(expectTier[0] - expectTier[0]) // 潜能 I = 0
  expect(read(C.panel)).toBe(0)
  expect(read(B.panel)).toBe(expectTier[4])
  expect(read(D.panel)).toBe(expectTier[4])

  // ★ 反锁「轴」：同一潜能档下 cinema 0 → 6 **不**改变该通道量
  //   （旧实现此处会变，正是缺陷证据）
  expect(read(C.panel) - read(A.panel)).toBe(0)
  expect(read(D.panel) - read(B.panel)).toBe(0)

  // 端到端同向（辅助证据，不作主判据）
  expect(B.damage).toBeGreaterThan(A.damage)
  expect(D.damage).toBeGreaterThan(C.damage)

  // 逐档单调：潜能 II..VI 严格递增（无跳档/无错位）
  const seen: number[] = []
  for (const lv of [2, 3, 4, 5, 6]) seen.push(read((await arm(id, mate, 0, lv)).panel))
  expect(seen).toEqual([...expectTier])
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
}

describe('R59 · 1041「11号」潜能觉醒·绝焰（潜能 II~VI 暴伤 16/24/32/40/48，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', async () => {
    const { SOLDIER11_POTENTIAL_CRIT_DMG } = await import('@/mechanics/agents/soldier11')
    const { raw, map } = potentialByLevel('1041')
    for (const [lv, pct] of [[2, 16], [3, 24], [4, 32], [5, 40], [6, 48]] as const) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('自身暴击伤害提升')
      expect(desc!).toContain(`${pct}%`)
      expect(SOLDIER11_POTENTIAL_CRIT_DMG[lv]).toBe(pct)
    }
    expect(SOLDIER11_POTENTIAL_CRIT_DMG[1]).toBe(0)
    // ★ 反锁「轴」：影画原文（talent.1..6）不含该潜能子句
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('绝焰')
      expect(strip(String(raw.talent[k].desc))).not.toContain('潜能觉醒')
    }
  })

  it('② 行为层正交四臂：critDmg 只随 potentialLevel 变（额外能力门控开）', async () => {
    // 队友 1171 同属性火 ⇒ 额外能力·燎原触发（潜能效果挂在该门控下）
    await assertOrthogonal('1041', '1171', p => p.critDmg - 50, [16, 24, 32, 40, 48])
  })

  it('③ 门控维：额外能力未触发（无同属性/同阵营队友）时，潜能暴伤整条不生效', async () => {
    // 空槽队伍 ⇒ additionalAbilityActive=0 ⇒ 潜能暴伤与燎原增伤都不该出现。
    // 这一维独立于「档位维」：只改档位索引不会让本断言红，只有门控被拆掉才红
    //（反向验证 F 组注入「去掉门控」实测：仅靠 ② 抓不到本形态）。
    const off = await arm('1041', '', 0, 6)
    expect(off.panel.additionalAbilityActive).toBe(0)
    expect(off.panel.critDmg).toBe(50) // 基础暴伤，潜能 +48% 未生效
  })
})

describe('R59 · 1141 莱卡恩潜能觉醒·掠冰（潜能 II~VI 冲击力 5/7.5/10/12.5/15，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', async () => {
    const { LYCAON_POTENTIAL_IMPACT_PCT } = await import('@/mechanics/agents/lycaon')
    const { raw, map } = potentialByLevel('1141')
    for (const [lv, pct] of [[2, 5], [3, 7.5], [4, 10], [5, 12.5], [6, 15]] as const) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('冲击力提升')
      expect(desc!).toContain(`${pct}%`)
      expect(LYCAON_POTENTIAL_IMPACT_PCT[lv]).toBe(pct)
    }
    expect(LYCAON_POTENTIAL_IMPACT_PCT[1]).toBe(0)
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('掠冰')
      expect(strip(String(raw.talent[k].desc))).not.toContain('潜能觉醒')
    }
  })

  it('② 行为层正交四臂：impact 只随 potentialLevel 变（比值与档位表一致）', async () => {
    // 面板 impact 是乘算通道 ⇒ 读「相对潜能的比值」而不是绝对值。
    const { LYCAON_POTENTIAL_IMPACT_PCT } = await import('@/mechanics/agents/lycaon')
    const A = await arm('1141', '1191', 0, 1)
    const B = await arm('1141', '1191', 0, 6)
    const C = await arm('1141', '1191', 6, 1)
    const D = await arm('1141', '1191', 6, 6)
    // 潜能 VI 相对 I 的冲击力倍率 = 1.15（旧实现下 A==B ⇒ 比值恒 1，此断言会红）
    expect(B.panel.impact / A.panel.impact).toBeCloseTo(1 + LYCAON_POTENTIAL_IMPACT_PCT[6] / 100, 6)
    expect(D.panel.impact / C.panel.impact).toBeCloseTo(1 + LYCAON_POTENTIAL_IMPACT_PCT[6] / 100, 6)
    // ★ 反锁：同一潜能档下 cinema 0 → 6 不改变 impact（C6 只加 dmgBonus）
    expect(C.panel.impact).toBeCloseTo(A.panel.impact, 6)
    expect(D.panel.impact).toBeCloseTo(B.panel.impact, 6)
    // 端到端同向
    expect(B.damage).toBeGreaterThan(A.damage)
    // 逐档单调
    const seen: number[] = []
    for (const lv of [1, 2, 3, 4, 5, 6]) seen.push((await arm('1141', '1191', 0, lv)).panel.impact)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })
})

describe('R59 · 1261 简潜能觉醒·致命舞步（潜能 II~VI 强击暴伤 10/15/20/25/30，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', async () => {
    const { JANE_POTENTIAL_ASSAULT_CRIT_DMG } = await import('@/mechanics/agents/jane')
    const { raw, map } = potentialByLevel('1261')
    for (const [lv, pct] of [[2, 10], [3, 15], [4, 20], [5, 25], [6, 30]] as const) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('暴击伤害额外提升')
      expect(desc!).toContain(`${pct}%`)
      expect(JANE_POTENTIAL_ASSAULT_CRIT_DMG[lv]).toBe(pct)
    }
    expect(JANE_POTENTIAL_ASSAULT_CRIT_DMG[1]).toBe(0)
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('致命舞步')
      expect(strip(String(raw.talent[k].desc))).not.toContain('潜能觉醒')
    }
  })

  it('② 行为层正交四臂：janeAssaultCritDmgBonus 只随 potentialLevel 变', async () => {
    await assertOrthogonal('1261', '1281', p => p.janeAssaultCritDmgBonus ?? 0, [10, 15, 20, 25, 30])
  })
})

describe('R59 · 1171 柏妮思潜能觉醒·沸点派对（潜能 II~VI per-0.1 系数 1/1.3/1.6/2/2.5，与影画无关）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 子句，且实现档位表逐位相等', async () => {
    const {
      BURNICE_POTENTIAL_MASTERY_PER_0_1, BURNICE_POTENTIAL_DMG_PER_0_1,
    } = await import('@/mechanics/agents/burnice')
    const { raw, map } = potentialByLevel('1171')
    const mastery = [[2, 1], [3, 1.3], [4, 1.6], [5, 2], [6, 2.5]] as const
    const dmg = [[2, 1], [3, 1.25], [4, 1.5], [5, 1.75], [6, 2]] as const
    for (const [lv, per] of mastery) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('异常掌控额外提升')
      expect(desc!).toContain('造成的伤害提升')
      expect(desc!).toContain('异常掌控最多提升25点')
      expect(desc!).toContain('造成的伤害最多提升20%')
      expect(BURNICE_POTENTIAL_MASTERY_PER_0_1[lv]).toBe(per)
    }
    for (const [lv, per] of dmg) expect(BURNICE_POTENTIAL_DMG_PER_0_1[lv]).toBe(per)
    expect(BURNICE_POTENTIAL_MASTERY_PER_0_1[1]).toBe(0)
    expect(BURNICE_POTENTIAL_DMG_PER_0_1[1]).toBe(0)
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('沸点派对')
      expect(strip(String(raw.talent[k].desc))).not.toContain('潜能觉醒')
    }
  })

  it('② 行为层：门控开（初始回能 ≥1.8）时 per-0.1 系数随档位单调增；门控关时全档恒 0', async () => {
    const { computeBurniceMechanic } = await import('@/mechanics/agents/burnice')
    const base = {
      exSpecialCount: 10, totalTime: 120, atk: 2000, anomalyProficiency: 200,
      cinemaLevel: 0, energyRegen: 2.2, ultimateCount: 1,
      singleSpraySeconds: 1.89, doubleSpraySeconds: 2.274,
    }
    const rows = [2, 3, 4, 5, 6].map(p => computeBurniceMechanic({ ...base, potentialLevel: p }))
    const mastery = rows.map(r => r.potentialAnomalyMasteryBonus)
    const dmg = rows.map(r => r.potentialDmgBonus)
    for (let i = 1; i < mastery.length; i++) expect(mastery[i]).toBeGreaterThan(mastery[i - 1])
    for (let i = 1; i < dmg.length; i++) expect(dmg[i]).toBeGreaterThan(dmg[i - 1])
    // 潜能 I 无觉醒
    const p1 = computeBurniceMechanic({ ...base, potentialLevel: 1 })
    expect(p1.potentialAnomalyMasteryBonus).toBe(0)
    expect(p1.potentialDmgBonus).toBe(0)
    // ★ 门控关闭（回能 < 1.8）⇒ 全档恒 0（门控不被档位绕过）
    for (const p of [1, 6]) {
      const off = computeBurniceMechanic({ ...base, energyRegen: 1.2, potentialLevel: p })
      expect(off.potentialAnomalyMasteryBonus).toBe(0)
      expect(off.potentialDmgBonus).toBe(0)
    }
    // ★ 反锁「轴」：同档位下 cinemaLevel 不改变潜能通道量
    for (const c of [0, 6]) {
      const s = computeBurniceMechanic({ ...base, cinemaLevel: c, potentialLevel: 6 })
      expect(s.potentialAnomalyMasteryBonus).toBe(computeBurniceMechanic({ ...base, cinemaLevel: 0, potentialLevel: 6 }).potentialAnomalyMasteryBonus)
      expect(s.potentialDmgBonus).toBe(computeBurniceMechanic({ ...base, cinemaLevel: 0, potentialLevel: 6 }).potentialDmgBonus)
    }
  })
})
