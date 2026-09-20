/**
 * R61 batchA —— **影画（`talent`）轴**「档位表类实现」判据（3 例）。
 *
 * 背景：R58/R59/R60 三轮把**潜能（`potential_detail`）轴**见底（11/11 分诊完）。R61 换轴，
 * 普查**影画轴**（raw `talent.1..6`）的「声明 implemented 但实现面根本没接」形态。
 * 反向前置：R58 batchA 命中的 1181/1021 是「表来自潜能轴、门控却用 cinema 轴」；
 * 本轮查的是反向形态 —— 「状态表声明影画 N 已实现，但没有任何承载」。
 *
 * 判定口径（沿用 R58/R59/R60 模板，两侧都钉在外部事实上）：
 *   ① **原文层**：从 `data/raw/nanoka_missing/full/<id>.json` 的 `talent[N].desc` 逐字读数字；
 *   ② **行为层**：真 `setupHarness` → 真 `useResourceCalc()`，读**通道量**（不是只看端到端伤害，
 *      R57：通道被钳时端到端恒绿）；每点独立 `setupHarness`。
 *   ⚠ **不许在本文件重写公式**（R60 最贵的一条教训）：本文件不复制任何实现算式，
 *      只断言「原文数字 == 引擎读出的通道量」。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  YUZUHA_C4_ASSIST_BUILDUP_PCT,
  YUZUHA_C4_ASSIST_DMG_PCT,
} from '@/mechanics/agents/yuzuha'

const rawTalent = (id: string, level: number): string => {
  const raw = JSON.parse(readFileSync(new URL(`../../../data/raw/nanoka_missing/full/${id}.json`, import.meta.url), 'utf8'))
  return String(raw?.talent?.[String(level)]?.desc ?? '').replace(/<[^>]+>/g, '')
}

/** 1411 支援突击 moveId：从 catalog 的 assist 分类按英文名取（与引擎 `findAssistFollowUp` 同判据）。 */
const yuzuhaAssistFollowUpMoveId = (): string => {
  const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
  const skills = (catalog.agentSkills ?? []).find((s: { agentId?: unknown }) => String(s.agentId) === '1411')
  const assist = (skills?.categories ?? []).find((c: { id?: string }) => c.id === 'assist')
  const move = (assist?.moves ?? []).find((m: { name?: { en?: string } }) =>
    String(m.name?.en ?? '').toLowerCase().includes('assist follow-up'))
  return String(move?.id ?? '')
}

describe('R61 batchA · 影画轴「档位表类实现」判据', () => {
  /**
   * 1411 柚叶 影画4·恶作剧开始：支援突击伤害 +30%、属性异常积蓄效率 +20%。
   *
   * 缺陷形态（R61 实测）：状态表把 C4 声明为 `implemented_approximation` 并**指名**
   * 「已由 teammate-buffs 接入」，但该条在全库并不存在（catalog 1411 组无 C4 条、
   * spec `teamBuffs` 为空数组、`grep 1411017/1411024` 零命中）⇒ 整条从未进计算。
   */
  it('1411 影画4：原文 +30%/+20% 必须真的落在支援突击行的通道量上（dmgBonus / anomalyBuildUp）', async () => {
    // ① 原文层：raw talent.4 逐字含这两个数字
    const desc = rawTalent('1411', 4)
    expect(desc, 'raw talent.4 未含支援突击伤害 +30%').toContain('伤害提升30%')
    expect(desc, 'raw talent.4 未含属性异常积蓄效率 +20%').toContain('积蓄效率提升20%')

    // ② 行为层：真管线读通道量（parryCount>0 才有支援突击行）
    const readAssistRows = async (cinemaLevel: number) => {
      await setupHarness([
        { agentId: '1411', cinemaLevel, parryCount: 6, dodgeCounterCount: 0, quickAssistCount: 0 },
        '',
        '',
      ])
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const out = calc.resourceResult.value
      const self = out?.characters?.find(c => c.agentId === '1411')
      const assistId = yuzuhaAssistFollowUpMoveId()
      expect(assistId, '1411 未解析出支援突击 moveId（测试前提不成立）').toBeTruthy()
      const rows = (self?.executions ?? []).filter(e => e.moveId === assistId)
      expect(rows.length, '支援突击行未生成').toBeGreaterThan(0)
      return { row: rows[0], assistId }
    }

    const c3 = await readAssistRows(3)
    const c4 = await readAssistRows(4)

    // C3（未到档）：通道量必须是基准值，不带影画4 的加成
    expect(c3.row.dmgBonus ?? 0, 'C3 不应带影画4 增伤').toBe(0)

    // C4：伤害通道 = 基准 + 30（原文数字）
    expect(c4.row.dmgBonus ?? 0, `C4 支援突击 dmgBonus 应为 +${YUZUHA_C4_ASSIST_DMG_PCT}`).toBe(YUZUHA_C4_ASSIST_DMG_PCT)

    // C4：积蓄通道 = C3 基准 × (1 + 20%)（原文数字；含蓄积会被 enrich 回填 ⇒ 必须 override）
    const c3BuildUp = Number(c3.row.anomalyBuildUp ?? 0)
    expect(c3BuildUp, '支援突击行无表值积蓄 ⇒ 测试前提不成立').toBeGreaterThan(0)
    const expected = c3BuildUp * (1 + YUZUHA_C4_ASSIST_BUILDUP_PCT / 100)
    expect(Number(c4.row.anomalyBuildUp ?? 0), 'C4 支援突击积蓄未按 +20% 缩放').toBeCloseTo(expected, 6)
    expect(c4.row.anomalyBuildUpOverride, 'C4 积蓄未置 override ⇒ 会被 enrich 回填覆盖').toBe(true)
    expect(Number(c4.row.totalAnomalyBuildUp ?? 0), 'totalAnomalyBuildUp 未同步').toBeCloseTo(expected * Number(c4.row.count ?? 0), 6)

    // ★ 招式限定反锁：本条**不得**写成 panel.dmgBonus —— 那会把「招式限定」做成「全伤害」，
    // 外溢到强特/终结/彩糖花火…。判据读**面板通道量**。
    // ⚠ R61 实测：只读 `exec.dmgBonus` 的反锁是**盲的** —— 注入「applyPanel 写 panel.dmgBonus」
    //   时 exec 侧毫无变化、该断言照样绿（面板泄漏只在 panel 上留痕）。
    const panelDmgBonusAt = async (cinemaLevel: number) => {
      const { config } = await setupHarness([
        { agentId: '1411', cinemaLevel, parryCount: 6, dodgeCounterCount: 0, quickAssistCount: 0 }, '', '',
      ])
      await new Promise(r => setTimeout(r, 0))
      const panel = computePanelPhases(0, config, useCatalogStore())?.inCombat as Record<string, number> | null
      return Number(panel?.dmgBonus ?? 0)
    }
    expect(
      await panelDmgBonusAt(4),
      '影画4 增伤被写进了 panel.dmgBonus（招式限定被做成全伤害，会外溢到全部招式）',
    ).toBe(await panelDmgBonusAt(3))
  }, 300_000)

  /**
   * 1411 影画4 反锁：档位门槛 —— C0/C1/C2/C3 都不得吃到，只有 C4+ 生效。
   * 防「忘了门控 ⇒ 0 命白拿」这个 R58 batchA 命中过的形态（那次的错法正是门控用了别的轴）。
   */
  it('1411 影画4 门控：C3 及以下一律不吃增伤（防「0 命白拿」）', async () => {
    for (const cinemaLevel of [0, 1, 2, 3]) {
      await setupHarness([
        { agentId: '1411', cinemaLevel, parryCount: 6, dodgeCounterCount: 0, quickAssistCount: 0 }, '', '',
      ])
      const calc = useResourceCalc()
      await new Promise(r => setTimeout(r, 0))
      const self = calc.resourceResult.value?.characters?.find(c => c.agentId === '1411')
      const assistId = yuzuhaAssistFollowUpMoveId()
      const row = (self?.executions ?? []).find(e => e.moveId === assistId)
      expect(row, `C${cinemaLevel} 支援突击行缺失`).toBeTruthy()
      expect(row?.dmgBonus ?? 0, `C${cinemaLevel} 不应带影画4 增伤`).toBe(0)
    }
  }, 300_000)

  /**
   * 反锁「轴」：本条效果来自**影画**轴（`talent.4`），不是潜能轴。
   * 断言 `potential_detail` 不含该子句 —— 若有人把承载误挪到潜能轴，这条会红。
   */
  it('1411 影画4 反锁轴：该子句只在 talent（影画）轴，不在 potential_detail（潜能）轴', () => {
    const cinemaDesc = rawTalent('1411', 4)
    const raw = JSON.parse(readFileSync(new URL('../../../data/raw/nanoka_missing/full/1411.json', import.meta.url), 'utf8'))
    const potentialText = JSON.stringify(raw?.potential_detail ?? '')
    expect(cinemaDesc).toContain('支援突击')
    expect(potentialText, '潜能轴出现了影画4 的支援突击子句（轴串了）').not.toContain('支援突击：夹心硬糖射击')
  })
})
