/**
 * R60 · batchC：§R59-J1 结清判据（1101 / 1211 潜能轴 + `atkPct`/`hpPct` 真字段错位）。
 *
 * ## 本批命中三个独立缺陷（全由**行为层**命中，静态尺零贡献 —— 见 §0.5.3 的 R59 结论）
 *
 * ① **1101 珂蕾妲「轴被忽略」**（R59 batchB 同形第三例）：
 *    spec `teamBuffs` 的 `koleda_potential_team_crit` 把 VI 满档写死（sharpCritDmg 12 / critDmg 35），
 *    **不读 `potentialLevel`** ⇒ 滑块（UI 1..6）静默失效、低潜能玩家被高估。
 *    ⚠ 与 1041 的**关键差异**：本效果**不受额外能力门控**（原文无条件「队伍中…」）——
 *    R59 交接把它列为「门控类」是**误判**，本文件 ③ 用空槽队伍逐位相同实测钉死这一点。
 *
 * ② **1211 丽娜「完全未实现」**：模块零 `potential` 引用。
 *    ① 自身穿透率 +1.6%（无条件）；② 全队攻击/防御按自身穿透率转模（档位系数**非等差**）。
 *
 * ③ **`atkPct`/`hpPct` 直写死通道**（1331 薇薇安 C4 / 1441 真斗 C4）：
 *    `applyPanel` 跑在 `calcPanel` **之后** ⇒ 累加器已被 `finalizeCoreStatBonuses` 清掉 ⇒
 *    直写 `panel.atkPct`/`panel.hpPct` 只写了个**零消费者**的旁路字段（R59 已实测坐实）。
 *    ⚠ 修法**不能**用 `applyStat`（会以**当前局内值**为基数整体乘 ⇒ 复现 `panelPhases.ts:522`
 *    记录过的「局内固定加成被错误放大」坑）；正解 = `harumasa.ts:190`/`zhao.ts:75` 同款
 *    「以**局外总值**为基数算增量」。
 *
 * ## 判据分层（沿用 R58/R59 模板 + R59 三条可迁移判据）
 *
 * ① **常量层钉在原文**：读 raw `potential_detail` 断言 II~VI 子句与数字，再断言实现逐位相等。
 * ② **反锁「轴」**：断言 `talent.1..6`（影画原文）**不含**该潜能子句。
 * ③ **行为层四臂正交**：真 `setupHarness` × 4 点（每点独立 setupHarness），读**通道量**。
 * ④ **门控维单独一维**（R59 新增纪律）：1101 断言「无门控队友 ⇒ 潜能照常生效」（与 1041 相反）。
 * ⑤ **`atkPct` 死通道反锁**：断言 `panel.atkPct` **不再是**承载字段（旧实现在此红）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { emptyPanel, panelAt } from '@/core/panel'
import { VIVIAN_C4_ATK_PCT } from '@/mechanics/agents/vivian'
import { ZHENDOU_C4_HP_PCT } from '@/mechanics/agents/zhendou'

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
async function arm(team: Array<Record<string, unknown> | ''>) {
  await setupHarness(team as never)
  const calc = useResourceCalc()
  // R52 坑①：必须在建队 + await setTimeout(0) **之后**读
  await new Promise(r => setTimeout(r, 0))
  const at = (slot: number) => JSON.parse(JSON.stringify(panelAt(calc.panels.value, slot) ?? {})) as Record<string, number>
  return { p0: at(0), p1: at(1), damage: calc.teamTotalDamage.value }
}

describe('R60 · 1101 珂蕾妲潜能觉醒·爆破作业（潜能 II~VI 锐暴 4/6/8/10/12 与 暴伤 11/17/23/29/35，与影画无关）', () => {
  it('① 常量层：spec 闭式逐位复现定稿档位表 + 本仓 raw 仍是滞后占位（出处已换 live nanoka）', async () => {
    const { map, raw } = potentialByLevel('1101')
    const sharpTier = [4, 6, 8, 10, 12]
    const critTier = [11, 17, 23, 29, 35]

    // ⚠⚠ **本条的证据链特殊性（R60 实测，必须写在判据里）**：
    // 本仓 `data/raw/nanoka_missing/full/1101.json` 的 `potential_detail` 是**旧 (Test1) 占位**
    // （「锋御暴击率 8~16% / 非锋御暴伤 16~32%」），**不是**定稿 —— 定稿值来自 **nanoka live 3.2**
    // （R60 复取 `static.nanoka.cc/zzz/3.2/{zh,en}/character/1101.json` 双语逐档核对一致；
    // 中文「锐暴伤害 / 暴击伤害」口径与数值 II~VI 均吻合）。
    // ⇒ 本用例**不能**拿本仓 raw 当定稿出处（那会把定稿误判成错的）。改为两条：
    //   (a) 钉住「本仓 raw 是占位」这个**事实**——若将来 raw 被刷新，本断言会红 ⇒ 提示重新核对定稿；
    //   (b) 断言 **spec 实现闭式 == 定稿档位表**（定稿出处 = spec note 里的 live 抓取记录）。
    for (const lv of [2, 3, 4, 5, 6]) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 本仓 raw 缺失`).toBeTruthy()
      expect(desc!, '本仓 raw 应为滞后占位（刷新后请重新核对定稿并更新本断言）').toContain('(Test1)')
      expect(desc!, '占位文本是「暴击率」而非定稿的「锐暴伤害」').toContain('暴击率提升')
    }

    // (b) 实现闭式**从 spec 读出来跑**（不是在本文件里重写一遍 —— 重写会变成「同义反复」：
    //     注入改坏 spec 的 expression 时本用例照样绿。R60 反向验证 A 组已实测该路径咬合）。
    //     求值器 = 引擎同款（`core/buff.ts#applyEffect` 的 formula 分支 + `dynamicPotentialLevel`）。
    const { getAgentSpec } = await import('@/specs/registry')
    const { applyEffect } = await import('@/core/buff')
    const spec = getAgentSpec('1101')!
    const tb = (spec.teamBuffs ?? []).find(b => b.id === 'koleda_potential_team_crit')!
    expect(tb, 'spec 缺 koleda_potential_team_crit').toBeTruthy()
    const effSharp = tb.effects.find(e => e.stat === 'sharpCritDmg')!
    const effCrit = tb.effects.find(e => e.stat === 'critDmg')!
    const evalSpec = (eff: typeof effSharp, p: number) => {
      // ⚠ `emptyPanel()` 必须用真面板（`panel.critDmg += value` 在空对象上得 NaN —— 本探针
      // 第一版就栽在这），且 `sharpCritDmg`/`critDmg` 的**基线非 0**（50/50）⇒ 必须读**增量**。
      const panel = emptyPanel() as unknown as Record<string, number>
      const before = panel[eff.stat] ?? 0
      applyEffect(panel as never, {
        id: 'probe', type: 'formula', stat: eff.stat as never, mode: 'flat',
        sourceStat: 'potentialLevel', sourcePanelPhase: 'inCombat',
        formula: eff.formula, dynamicSourceValue: p, dynamicPotentialLevel: p,
      } as never, 1)
      return (panel[eff.stat] ?? 0) - before
    }
    for (const [i, lv] of [2, 3, 4, 5, 6].entries()) {
      expect(evalSpec(effSharp, lv), `锐暴档位 Lv${lv}`).toBe(sharpTier[i])
      expect(evalSpec(effCrit, lv), `暴伤档位 Lv${lv}`).toBe(critTier[i])
    }
    // 潜能 I（未觉醒）两侧都必须归零（门控因子）
    expect(evalSpec(effSharp, 1)).toBe(0)
    expect(evalSpec(effCrit, 1)).toBe(0)
    // ★ 反锁「轴」：影画原文（talent.1..6）不含该潜能子句
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('爆破作业')
      expect(strip(String(raw.talent[k].desc))).not.toContain('锐暴伤害提升')
    }
  })

  it('② 行为层正交四臂：critDmg 只随 potentialLevel 变（额外能力门控开）', async () => {
    // 队友 1121 同阵营（白祇重工）+ 同属性（火）⇒ 额外能力门控开
    const A = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 1 }, { agentId: '1121' }])
    const B = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 6 }, { agentId: '1121' }])
    const C = await arm([{ agentId: '1101', cinemaLevel: 6, potentialLevel: 1 }, { agentId: '1121' }])
    const D = await arm([{ agentId: '1101', cinemaLevel: 6, potentialLevel: 6 }, { agentId: '1121' }])
    expect(A.p0.additionalAbilityActive).toBe(1)
    // 通道量（不是端到端）：critDmg 相对基础 50 的增量 = 潜能档位值
    expect(A.p0.critDmg - 50).toBe(0)
    expect(C.p0.critDmg - 50).toBe(0)
    expect(B.p0.critDmg - 50).toBe(35)
    expect(D.p0.critDmg - 50).toBe(35)
    // 锐暴通道同向（锋御队友才吃，这里读 1101 自己面板的字段值）
    expect(A.p0.sharpCritDmg).toBe(50)
    expect(B.p0.sharpCritDmg).toBe(62)
    // ★ 反锁「轴」：同一潜能档下 cinema 0 → 6 **不**改变这两个通道量
    expect(C.p0.critDmg - A.p0.critDmg).toBe(0)
    expect(D.p0.critDmg - B.p0.critDmg).toBe(0)
    // 端到端同向（辅助证据，不作主判据）
    expect(B.damage).toBeGreaterThan(A.damage)
    // 逐档单调（潜能 II..VI）
    const seen: number[] = []
    for (const lv of [2, 3, 4, 5, 6]) {
      seen.push((await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: lv }, { agentId: '1121' }])).p0.critDmg - 50)
    }
    expect(seen).toEqual([11, 17, 23, 29, 35])
  })

  it('③ 门控维：本效果**不受**额外能力门控（空槽队伍读数与带门控队友逐位相同）', async () => {
    // ⚠ 与 1041（潜能挂在额外能力·燎原下）**刻意相反**：1101 原文是「队伍中的[锋御]代理人…」
    //   无条件句 ⇒ 空槽队伍也必须照给。R59 交接把它列为门控类是误判，本断言把差异钉死。
    const off = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 6 }, '', ''])
    const on = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 6 }, { agentId: '1121' }, ''])
    expect(off.p0.additionalAbilityActive).toBe(0)
    expect(on.p0.additionalAbilityActive).toBe(1)
    expect(off.p0.critDmg).toBe(on.p0.critDmg)
    expect(off.p0.sharpCritDmg).toBe(on.p0.sharpCritDmg)
    expect(off.p0.critDmg - 50).toBe(35)
  })

  it('④ 锋御分流：锐暴只作用于锋御（sharpCritDmg 通道），非锋御吃暴伤（critDmg 通道）', async () => {
    // 队友 1611 克拉蕾（catalog specialty = sharpen = 锋御）
    const A = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 1 }, { agentId: '1611' }])
    const B = await arm([{ agentId: '1101', cinemaLevel: 0, potentialLevel: 6 }, { agentId: '1611' }])
    // 锋御队友拿到锐暴 +12
    expect(B.p1.sharpCritDmg - A.p1.sharpCritDmg).toBe(12)
    // 同时（两字段平铺全队）暴伤 +35 也给了——分流由伤害 profile 天然实现（锐暴不吃 critDmg）
    expect(B.p1.critDmg - A.p1.critDmg).toBe(35)
  })
})

describe('R60 · 1211 丽娜潜能觉醒·完美侍奉（大扫除 II~VI）', () => {
  it('① 常量层钉在原文：raw `potential_detail` 含 II~VI 档位系数与上限', async () => {
    const { map, raw } = potentialByLevel('1211')
    const atkCoef = [3, 4.2, 5.5, 6.7, 8]
    const defCoef = [2.5, 3.5, 4.5, 5.5, 6.5]
    for (const [i, lv] of [2, 3, 4, 5, 6].entries()) {
      const desc = map.get(lv)
      expect(desc, `potential Lv${lv} 原文缺失`).toBeTruthy()
      expect(desc!).toContain('穿透率提升1.6%')
      expect(desc!).toContain(`${atkCoef[i]}`)
      expect(desc!).toContain(`${defCoef[i]}`)
      expect(desc!).toContain('576')
      expect(desc!).toContain('468')
    }
    // ★ 反锁「轴」：影画原文不含该潜能子句
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      expect(strip(String(raw.talent[k].desc))).not.toContain('完美侍奉')
      expect(strip(String(raw.talent[k].desc))).not.toContain('大扫除')
    }
    // 实现闭式**从 spec 读出来跑**（不是在本文件里重写一遍 —— 重写会变成「同义反复」：
    // 注入改坏 spec 的 expression 时本用例照样绿。R60 反向验证 E 组实测正是这个缺口）。
    // 求值器 = 引擎同款（`core/buff.ts#applyEffect` 的 formula 分支 + `dynamicPotentialLevel`）。
    const { getAgentSpec } = await import('@/specs/registry')
    const { applyEffect } = await import('@/core/buff')
    const spec = getAgentSpec('1211')!
    const tb = (spec.teamBuffs ?? []).find(b => b.id === 'rina_potential_team_atk_def')!
    expect(tb, 'spec 缺 rina_potential_team_atk_def').toBeTruthy()
    const effAtk = tb.effects.find(e => e.stat === 'atkFlat')!
    const effDef = tb.effects.find(e => e.stat === 'defFlat')!
    /** 跑**真引擎求值**：x = 穿透率，p = 潜能档位 */
    const evalSpec = (eff: typeof effAtk, x: number, p: number) => {
      // `atkFlat`/`defFlat` 经 `applyCoreStatBonus` 落到 `panel.atk`/`panel.def`（不是 `panel.atkFlat`）
      const panel = emptyPanel() as unknown as Record<string, number>
      const before = panel[eff.stat === 'atkFlat' ? 'atk' : 'def'] ?? 0
      applyEffect(panel as never, {
        id: 'probe', type: 'formula', stat: eff.stat as never, mode: 'flat',
        sourceStat: 'penRatio', sourcePanelPhase: 'outOfCombat',
        formula: eff.formula, dynamicSourceValue: x, dynamicPotentialLevel: p,
      } as never, 1)
      const after = panel[eff.stat === 'atkFlat' ? 'atk' : 'def'] ?? 0
      return after - before
    }
    for (const [i, lv] of [2, 3, 4, 5, 6].entries()) {
      // x = 10（远在封顶下）⇒ 读出的就是系数
      expect(evalSpec(effAtk, 10, lv) / 10, `攻击系数 Lv${lv}`).toBeCloseTo(atkCoef[i], 9)
      expect(evalSpec(effDef, 10, lv) / 10, `防御系数 Lv${lv}`).toBeCloseTo(defCoef[i], 9)
    }
    expect(evalSpec(effAtk, 10, 1)).toBe(0)
    expect(evalSpec(effDef, 10, 1)).toBe(0)
    // ★ **上限维单独一维**（R60 反向验证 E 组实测：只测系数时「撤掉 576/468 封顶」不咬合）：
    //   推到高穿透率，断言**恰好封顶**（而不是线性外推）。x = 100 时未封顶值分别为
    //   100×8 = 800 > 576 与 100×6.5 = 650 > 468 ⇒ 必须被钳到 576 / 468。
    expect(evalSpec(effAtk, 100, 6), '攻击上限 576').toBeCloseTo(576, 9)
    expect(evalSpec(effDef, 100, 6), '防御上限 468').toBeCloseTo(468, 9)
    // 边界：刚好在封顶下的点**不**被封顶（防「一律钳到上限」的假实现）
    expect(evalSpec(effAtk, 50, 6)).toBeCloseTo(400, 9) // 50×8 = 400 < 576
    expect(evalSpec(effDef, 50, 6)).toBeCloseTo(325, 9) // 50×6.5 = 325 < 468
  })

  it('② 行为层正交四臂：自身 penRatio 与全队 atk/def 只随 potentialLevel 变', async () => {
    // 队友 1141 同阵营（维多利亚家政）⇒ 额外能力门控开
    const A = await arm([{ agentId: '1211', cinemaLevel: 0, potentialLevel: 1 }, { agentId: '1141' }])
    const B = await arm([{ agentId: '1211', cinemaLevel: 0, potentialLevel: 6 }, { agentId: '1141' }])
    const C = await arm([{ agentId: '1211', cinemaLevel: 6, potentialLevel: 1 }, { agentId: '1141' }])
    const D = await arm([{ agentId: '1211', cinemaLevel: 6, potentialLevel: 6 }, { agentId: '1141' }])
    // 通道量 ①：丽娜自身穿透率 +1.6（潜能 II 起，各档同值）
    expect(B.p0.penRatio - A.p0.penRatio).toBeCloseTo(1.6, 9)
    expect(D.p0.penRatio - C.p0.penRatio).toBeCloseTo(1.6, 9)
    // 通道量 ②：**队友**拿到 atkFlat / defFlat（源面板穿透率 × 档位系数，上限 576/468）
    const mateAtkGain = B.p1.atk - A.p1.atk
    const mateDefGain = B.p1.def - A.p1.def
    expect(mateAtkGain).toBeGreaterThan(0)
    expect(mateDefGain).toBeGreaterThan(0)
    // 上限口径：增量不得超过 576 / 468
    expect(mateAtkGain).toBeLessThanOrEqual(576)
    expect(mateDefGain).toBeLessThanOrEqual(468)
    // ★ 反锁「轴」：同一潜能档下 cinema 0 → 6 不改变这两个转模增量
    expect(C.p1.atk - A.p1.atk).toBe(0)
    expect(D.p1.atk - B.p1.atk).toBe(0)
    expect(C.p1.def - A.p1.def).toBe(0)
    expect(D.p1.def - B.p1.def).toBe(0)
    // 逐档单调（潜能 II..VI）
    const seen: number[] = []
    for (const lv of [2, 3, 4, 5, 6]) {
      seen.push((await arm([{ agentId: '1211', cinemaLevel: 0, potentialLevel: lv }, { agentId: '1141' }])).p1.atk)
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })

  it('③ 门控维：潜能转模**不受**额外能力门控（空槽队伍照常给全队 atk/def）', async () => {
    // 原文②的门控是「[核心被动：迷你毁灭拍档]增益存在期间」，**不是**额外能力。
    // 本仓核心被动按常驻近似（`rina.core_pen_ratio` 无门控）⇒ 潜能②同口径。
    const off = await arm([{ agentId: '1211', cinemaLevel: 0, potentialLevel: 6 }, '', ''])
    const on = await arm([{ agentId: '1211', cinemaLevel: 0, potentialLevel: 6 }, { agentId: '1141' }, ''])
    expect(off.p0.additionalAbilityActive).toBe(0)
    expect(off.p0.penRatio).toBeCloseTo(on.p0.penRatio, 9)
    expect(off.p0.atk).toBeCloseTo(on.p0.atk, 9)
    expect(off.p0.def).toBeCloseTo(on.p0.def, 9)
  })
})

describe('R60 · `atkPct`/`hpPct` 真字段错位（1331 薇薇安 C4 / 1441 真斗 C4）', () => {
  it('① 1331 影画4：atk 随 c3→c4 真的变，且增量以**局外攻击**为基数（不是当前局内值）', async () => {
    const A = await arm([{ agentId: '1331', cinemaLevel: 3 }, { agentId: '1171' }, ''])
    const B = await arm([{ agentId: '1331', cinemaLevel: 4 }, { agentId: '1171' }, ''])
    // ★ 反锁死通道：承载字段**不再是** `panel.atkPct`（旧实现在此红——它写 atkPct 而 atk 不变）
    expect(A.p0.atkPct).toBeUndefined()
    expect(B.p0.atkPct).toBeUndefined()
    const delta = B.p0.atk - A.p0.atk
    expect(delta).toBeGreaterThan(0)

    // ★ 基数口径（本用例的**载荷**）：必须 = **局外攻击** × 12%，
    //   而**不是**当前局内攻击 × 12%（后者是 `applyStat` 写法会给出的错误值，
    //   即 `panelPhases.ts:522` 记录过的「局内固定加成被错误放大」坑）。
    const { catalog, config } = await setupHarness([{ agentId: '1331', cinemaLevel: 3 }, { agentId: '1171' }, ''] as never)
    config.setCinemaLevel(0, 3)
    const ooc = computePanelPhases(0, config, catalog)!.outOfCombat
    expect(delta).toBeCloseTo(ooc.atk * VIVIAN_C4_ATK_PCT / 100, 9)
    // 明确排除错误基数：局内 atk（= 局外 × 局内乘区 1.2）不是基数
    expect(delta).not.toBeCloseTo(A.p0.atk * VIVIAN_C4_ATK_PCT / 100, 6)
  })

  it('② 1441 影画4：hp 随 c3→c4 真的变（且不再是 hpPct 旁路字段），并进贯穿力基底', async () => {
    const A = await arm([{ agentId: '1441', cinemaLevel: 3 }, { agentId: '1021' }, ''])
    const B = await arm([{ agentId: '1441', cinemaLevel: 4 }, { agentId: '1021' }, ''])
    // ★ 反锁死通道：承载字段**不再是** `panel.hpPct`
    expect(A.p0.hpPct).toBeUndefined()
    expect(B.p0.hpPct).toBeUndefined()
    const delta = B.p0.hp - A.p0.hp
    expect(delta).toBeGreaterThan(0)
    // 增量 = **局外生命** × 8%（同 ① 的基数口径）
    const { catalog, config } = await setupHarness([{ agentId: '1441', cinemaLevel: 3 }, { agentId: '1021' }, ''] as never)
    config.setCinemaLevel(0, 3)
    const ooc = computePanelPhases(0, config, catalog)!.outOfCombat
    expect(delta).toBeCloseTo(ooc.hp * ZHENDOU_C4_HP_PCT / 100, 9)
    // 端到端同向：hp×0.1 进命破贯穿力基底（damage.ts:187）⇒ C4 必须提伤害
    expect(B.damage).toBeGreaterThan(A.damage)
  })

  it('③ 全库同族普查：`panel.atkPct`/`panel.hpPct` 的**可执行**直写点已归零', async () => {
    // R60 实测普查（`grep -rnE "panel\.(atkPct|hpPct|defPct)\s*[+]?=" src/`）：
    // 修复前**只有** vivian.ts:280 与 zhendou.ts:70 两处（`substatOptimizer.ts:443` 读的是
    // `mergedAlloc['hpPct']` = 词条分配，**不是**面板字段，别误判成消费者）。
    // ⚠ 静态扫描器只作**索引**（R59 结论：本仓静态尺双向错）⇒ 此处只断言「**非注释行**零命中」，
    // 行为面判据在 ①②（通道量真的动了）。注释里保留 `panel.atkPct = …` 字样是**有意**的
    //（记录旧写法），故先剥注释再匹配。
    const { readFileSync: rf } = await import('node:fs')
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const vivian = stripComments(rf(new URL('../agents/vivian.ts', import.meta.url), 'utf8'))
    const zhendou = stripComments(rf(new URL('../agents/zhendou.ts', import.meta.url), 'utf8'))
    expect(/panel\.atkPct\s*[+]?=/.test(vivian)).toBe(false)
    expect(/panel\.hpPct\s*[+]?=/.test(zhendou)).toBe(false)
  })
})
