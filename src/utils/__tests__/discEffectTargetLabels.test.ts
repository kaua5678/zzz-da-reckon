/**
 * 定向增伤（`dmgBonus__<招式族>`）必须**如实显示**，不能显示成「通用伤害加成」。
 *
 * 用户 2026-10-18：「拂晓四件套是加普攻伤害，为什么显示的全部增伤？」
 * 引擎侧是对的：`core/buff.ts#applyTargetedStat` 把带 `target` 的 dmgBonus 写进 `dmgBonus__basic`，
 * `core/damage.ts` 按当前招式读回。错的是展示层——驱动盘套装效果行只按 `stat` 取标签，
 * 于是拂晓生花三条「[普通攻击]造成的伤害提升」全显示成「通用伤害加成」，
 * 面板「增伤乘区」与终局面板更是**完全不列** `dmgBonus__*` 这一族（55% 普攻增伤在页面上不可见）。
 *
 * 本测试钉三件事：
 *  ① 套装效果行的标签带招式限定（拂晓生花 = 普通攻击）；
 *  ② 面板确实把定向量写进 `dmgBonus__basic`（与标签指向同一字段，防「标签对了但字段错了」）；
 *  ③ 非定向效果（荆棘玫瑰 dmgBonus）保持「通用伤害加成」，不能被误标。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildDiscEffectRows } from '@/utils/discEffectRows'
import { getStatMeta } from '@/utils/statMeta'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computePanel } from '@/composables/resourceCalc/panelPhases'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { driveDiscSets: { id: string; name?: { zhCN?: string } }[] }
const setById = new Map(catalog.driveDiscSets.map(s => [String(s.id), s]))

describe('定向增伤显示（拂晓生花 = 普通攻击限定）', () => {
  it('拂晓生花 4pc/2pc 三条普攻增伤都标「普通攻击限定」，不再显示成通用增伤', () => {
    const rows = buildDiscEffectRows(setById.get('33300') as never, setById.get('31100') as never, {
      stat: code => getStatMeta(code).label,
    })
    const dmgRows = rows.filter(r => r.stat === 'dmgBonus')
    expect(dmgRows.length, '拂晓生花 2pc + 4pc 两段 = 三条定向增伤行').toBe(3)
    for (const r of dmgRows) {
      expect(r.label, `${r.key} 应标出招式限定`).toContain('普通攻击限定')
      expect(r.label, '不能只说「通用伤害加成」').not.toBe('通用伤害加成')
      expect(r.targeted, '定向行要能标出 target').toBe(true)
    }
    // 河豚电音 2pc 的穿透率不是定向字段，标签不带限定
    const pen = rows.find(r => r.stat === 'penRatio')!
    expect(pen.label).toBe('穿透率')
    expect(pen.targeted).toBeUndefined()
  }, 60000)

  it('非定向增伤（荆棘玫瑰 4pc）保持「通用伤害加成」，不被误标成定向', () => {
    const rows = buildDiscEffectRows(setById.get('34200') as never, undefined, {
      stat: code => getStatMeta(code).label,
    })
    const dmg = rows.find(r => r.stat === 'dmgBonus')!
    expect(dmg.label).toBe('通用伤害加成')
    expect(dmg.targeted).toBeUndefined()
  }, 60000)

  it('引擎侧：希格莉德穿拂晓生花，55% 普攻增伤落在 dmgBonus__basic（与标签同一字段）', async () => {
    const { catalog: cat } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, { agentId: '1211' }])
    const cfg = useConfigStore()
    cfg.team[0]!.driveDisc.fourPieceSetId = '33300'
    cfg.team[0]!.driveDisc.twoPieceSetId = '31100'
    const panel = computePanel(0, cfg, cat) as unknown as Record<string, number>
    // 2pc 15 + 4pc 常驻 20 + 4pc 触发 20（默认满覆盖）
    expect(panel.dmgBonus__basic, '定向普攻增伤必须落在定向字段，不能混进通用 dmgBonus').toBeCloseTo(55, 6)
    // 通用字段里不该有这三段（只有别的来源，如影画4）
    expect(panel.dmgBonus).toBeLessThan(55)
  }, 120000)
})
