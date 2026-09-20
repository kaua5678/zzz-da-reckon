/**
 * R62 batchA —— **影画轴「边界差一」形态**判据（§R61-J1 第三形态）。
 *
 * 背景：R61 把影画轴的两个形态扫完（「整条未实现」1411 / 「载体零交集」1111）。
 * 本轮查**第三形态**：形状正确但**边界差一** —— `cinemaLevel >= N` 的 N 与原始出处不一致，
 * 或阶梯用 `>` 而非 `>=`（索引写错 1）。
 *
 * 判定口径（沿用 R58/R59/R60/R61 模板，**两侧都钉外部事实**）：
 *   ① **原文层**：从 `data/raw/nanoka_missing/full/<id>.json` 的 `talent[N].desc` 逐字读，
 *      并**把数字解析出来当期望值** —— ★ 期望值**不许取自被测对象**（R61 最贵教训：
 *      写成 `expect(x).toBe(被测模块导出常量)` 时，注入「常量改坏」两边一起变、照样绿）。
 *   ② **行为层**：真 `setupHarness` → 真 `useResourceCalc()` / 真 `computePanelPhases()`，
 *      读**通道量**（R57：通道被钳时端到端恒绿）；每点独立 `setupHarness`。
 *   ③ **判据不许自己重写一遍公式**（R60）：本文件不复制任何实现算式，只断言
 *      「原文事实 == 引擎读出的通道量」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getSkillLevelCoef } from '@/core/skillLevel'

const rawTalent = (id: string, level: number): string => {
  const raw = JSON.parse(readFileSync(
    new URL(`../../../data/raw/nanoka_missing/full/${id}.json`, import.meta.url), 'utf8'))
  return String(raw?.talent?.[String(level)]?.desc ?? '').replace(/<[^>]+>/g, '')
}

/** 读某角色某影画档的 `skillLevelBonus`（真管线） */
async function readSkillLevelBonus(agentId: string, cinemaLevel: number): Promise<number> {
  await setupHarness([
    { agentId, cinemaLevel },
    { agentId: '1211', cinemaLevel: 6 },
    '',
  ])
  const panel = computePanelPhases(0, useConfigStore(), useCatalogStore())!.inCombat as Record<string, unknown>
  return Number(panel.skillLevelBonus ?? 0)
}

describe('R62 batchA · 影画轴「边界差一」判据', () => {
  /**
   * ★★ 核心判据：**原始出处声明的技能等级提升量**必须先解析出来当期望值。
   *
   * 安东 1111 影画3/5 的 raw 原文逐字是「[普通攻击]、[闪避]、[支援技]、[特殊技]、[连携技] 技能等级+2」
   * ⇒ **每一档都只 +2**，累计上界 = 3命 +2、5命再 +2 ⇒ 技能等级 14 → 16。
   */
  it('1111 影画3/5：raw 原文每档 +2 ⇒ 技能等级 14/16（上界 16），不得双计到 16/20', async () => {
    // ① 原文层：逐档解析「技能等级+N」——期望值钉在 raw 文本上，**不读被测模块的任何导出常量**
    const bonusRaw: Record<number, number> = {}
    for (const lv of [3, 5]) {
      const desc = rawTalent('1111', lv)
      const m = desc.match(/技能等级\+(\d+)/)
      expect(m, `raw talent.${lv} 未解析出「技能等级+N」：${desc}`).toBeTruthy()
      bonusRaw[lv] = Number(m![1])
    }
    expect(bonusRaw[3], `raw talent.3 声明 +2，实到 ${bonusRaw[3]}`).toBe(2)
    expect(bonusRaw[5], `raw talent.5 声明 +2，实到 ${bonusRaw[5]}`).toBe(2)

    // ② 行为层：真管线逐档读通道量
    const slb0 = await readSkillLevelBonus('1111', 0)
    const slb2 = await readSkillLevelBonus('1111', 2)
    const slb3 = await readSkillLevelBonus('1111', 3)
    const slb4 = await readSkillLevelBonus('1111', 4)
    const slb5 = await readSkillLevelBonus('1111', 5)
    const slb6 = await readSkillLevelBonus('1111', 6)

    // 未达标档一律 0（防「0 命白拿」——R58 batchA 命中的正是「门控用了别的轴」）
    expect(slb0, 'c0 不该有技能等级加成').toBe(0)
    expect(slb2, 'c2 不该有技能等级加成').toBe(0)

    // ★ 累计 = raw 逐档声明之和（c3 → +2，c5 → 再 +2）
    expect(slb3, `c3 应为 raw 声明的 +${bonusRaw[3]}`).toBe(bonusRaw[3])
    expect(slb4, 'c4 继承 c3（影画累进，R55 教训：别假设 C4 不给 C3 的东西）').toBe(bonusRaw[3])
    expect(slb5, `c5 应为 raw 声明累计 +${bonusRaw[3] + bonusRaw[5]}`).toBe(bonusRaw[3] + bonusRaw[5])
    expect(slb6, 'c6 继承 c5').toBe(bonusRaw[3] + bonusRaw[5])

    // ③ **上界维**（R60 教训：有上限的效果必须单独断言「上限维」）：
    //     技能等级三档 12/14/16 ⇒ 提升量上界 = 4（raw 两档各 +2 之和）
    const cap = bonusRaw[3] + bonusRaw[5]
    expect(cap, 'raw 两档合计上界').toBe(4)
    for (const [lv, slb] of [[0, slb0], [2, slb2], [3, slb3], [4, slb4], [5, slb5], [6, slb6]] as const) {
      expect(slb, `c${lv} 的 skillLevelBonus ${slb} 超出 raw 声明的上界 ${cap}`).toBeLessThanOrEqual(cap)
    }

    // ④ **通道量的下游后果**：技能等级系数必须是 14 级档，不是 16 级档
    //     （期望值来自 raw 推出的等级，**不是**读 `getSkillLevelCoef` 再反推）
    const expectCoef14 = (12 + bonusRaw[3] + 10) / 22 // = 24/22 = 1.090909…
    expect(getSkillLevelCoef(slb3).damageCoef).toBeCloseTo(expectCoef14, 10)
    expect(getSkillLevelCoef(slb3).skillLevel).toBe(12 + bonusRaw[3])
    expect(getSkillLevelCoef(slb5).skillLevel).toBe(12 + bonusRaw[3] + bonusRaw[5])
  })

  /**
   * ★ 负控（同一判据在**别的角色**上必须给「正确」读数）：
   * 1581 蕾米埃尔的 catalog `cinemaBuffs` **有** effect 级 `skillLevelBonus`
   * ⇒ `agentHasCinemaSkillLevelBuff` 豁免成立 ⇒ 通用规则不加，模块/catalog 单写者。
   * 若本判据在 1581 上也读出 4/8，说明它量的不是「安东的双计」而是别的东西。
   */
  it('1581 负控：catalog 有 effect 级 skillLevelBonus ⇒ 单写者，c3=2 / c5=4（不与 1111 同型）', async () => {
    const slb3 = await readSkillLevelBonus('1581', 3)
    const slb5 = await readSkillLevelBonus('1581', 5)
    expect(slb3, '1581 c3 应为 2（豁免成立，只写一遍）').toBe(2)
    expect(slb5, '1581 c5 应为 4（豁免成立，只写一遍）').toBe(4)
  })

  /**
   * ★ 反锁：**通用规则的豁免条件是「catalog 有 effect」，不是「描述文本有技能等级」**。
   * 本判据把这条口径钉成机器事实 —— 若将来有人把 `agentHasCinemaSkillLevelBuff` 改成
   * 认描述文本（或给安东 catalog 补上 effect），本用例会红（那时 1111 会变成 1581 那样单写者，
   * c3=2 仍是 2 —— 所以本条改为断言**安东 catalog 的 C3/C5 条目 effects 为空**，
   * 这才是「豁免必须由模块自己让位」的前提）。
   */
  it('反锁：1111 catalog 的 C3/C5 cinemaBuffs effects 为空 ⇒ 通用规则不会豁免它（双计的前提）', () => {
    const catalog = JSON.parse(readFileSync(
      new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
    const agent = (catalog.agents ?? []).find((a: { id?: unknown }) => String(a.id) === '1111')
    expect(agent, 'catalog 未找到 1111').toBeTruthy()
    const cinemaBuffs = agent.combatBuffs?.cinemaBuffs ?? []
    for (const lv of [3, 5]) {
      const entry = cinemaBuffs.find((c: { cinemaLevel?: number }) => c.cinemaLevel === lv)
      expect(entry, `catalog 1111 缺影画${lv}条目（前提不成立）`).toBeTruthy()
      const slbEffects = (entry.buff?.effects ?? []).filter(
        (e: { stat?: string }) => e.stat === 'skillLevelBonus')
      // ★ 这条是**前提断言**：只要 effects 里没有 skillLevelBonus，通用规则就不会跳过 1111
      //   ⇒ 若模块再写一遍就是双计。两条路都自洽：要么 effects 有（则模块不得写），
      //   要么 effects 无（则模块也不得写）。本用例锁死「effects 无」，即锁死「模块必须让位」。
      expect(slbEffects.length, `catalog 1111 影画${lv} 的 effects 出现了 skillLevelBonus`
        + '——此时应改为让 catalog 走通用通道，并同步复核本判据').toBe(0)
    }
  })

  /**
   * ★ 端到端（走真 `useResourceCalc()`；**只作辅助，主判据是上面的通道量** —— R57）。
   *
   * ⚠⚠ **本任实测踩到的判据设计坑（写下来防下任重踩）**：首版这里断言的是
   * 「C5→C6 伤害必须非零移动」，理由是「双计把技能等级顶到封顶之上 ⇒ C6 无增量」。
   * **实测该断言在修复后仍然红**（c5 == c6 == 1,264,475），因为 C5→C6 零移动的**真因是
   * R61 已定性的另一条缺陷**：1111 影画6 的载体 moveId（`1111006/7/8/1015`）
   * **在执行计划里从不出现**（爆发状态未建模）⇒ 载体集零交集 ⇒ 端到端恒 0
   * （见 `cinemaAxisBatchA.test.ts` batchB + `docs/MECHANICS_IMPLEMENTATION.md` 安东段）。
   * ⇒ **一个端到端读数被两条独立缺陷共因**，它**分辨不出**是哪一条 ⇒ 不能当判据。
   *
   * 正解 = 断言**双计独有的后果**：技能等级不得越过 raw 推出的上界（16）。
   * 修复前 c5 给出 20 级（越界）；修复后 c5 给出 16 级（取到上界，恰好合法）。
   */
  it('1111 端到端：真管线读出的技能等级不得越过 raw 上界（12 + 两档各 +2 = 16）', async () => {
    const readLevel = async (cinemaLevel: number) => {
      await setupHarness([
        { agentId: '1111', cinemaLevel },
        { agentId: '1211', cinemaLevel: 6 },
        '',
      ])
      const { useResourceCalc } = await import('@/composables/useResourceCalc')
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const panel = computePanelPhases(0, useConfigStore(), useCatalogStore())!.inCombat as Record<string, unknown>
      expect(Number(calc.teamTotalDamage.value ?? 0), `c${cinemaLevel} 伤害应 > 0（反空洞下限）`)
        .toBeGreaterThan(0)
      return getSkillLevelCoef(Number(panel.skillLevelBonus ?? 0)).skillLevel
    }
    // raw 上界：12（基数）+ 2（影画3）+ 2（影画5）= 16，`skillLevel.ts` 头注释亦明确 16 是上界
    const RAW_CAP = 12 + 2 + 2
    expect(await readLevel(0), 'c0 应为 12 级').toBe(12)
    expect(await readLevel(2), 'c2 应为 12 级').toBe(12)
    expect(await readLevel(3), 'c3 应为 14 级（raw +2）').toBe(14)
    expect(await readLevel(4), 'c4 应为 14 级').toBe(14)
    expect(await readLevel(5), `c5 应为 ${RAW_CAP} 级（raw 两档累计）`).toBe(RAW_CAP)
    expect(await readLevel(6), `c6 应为 ${RAW_CAP} 级（不得越界）`).toBe(RAW_CAP)
  })
})
