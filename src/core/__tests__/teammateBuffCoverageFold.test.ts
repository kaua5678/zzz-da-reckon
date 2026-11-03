/**
 * 队友 Buff **触发型效果的覆盖率自动折算**（用户 2026-10-29 裁决「醉花云15s短buff在非轴模式你可以这么折算」）。
 *
 * 前情（实测）：青衣影画一「满电压醉花 ⇒ 目标防御 −15%，持续 15 秒」与影画六「醉花命中 ⇒ 全属性抗性 −20%，
 * 持续 15 秒」此前按 **100% uptime** 结算，而她在多数队伍里只分到 13%~41% 的前台时间、一局只打出 6~14 轮醉花
 * ⇒ 系统性高估（C6 减抗满覆盖 = 队伤 +20%；折算到 50% 就掉 9% 左右）。
 *
 * 口径（单一事实源 `src/data/teammateBuffTriggerCoverage.ts`）：覆盖率 = min(1, 触发次数 × 时长 / 战斗有效时长)，
 * 触发次数按**触发者该槽收敛后的执行行**（醉花 #1/#2 同 count，取最大值 ⇒ 一轮只算一次）；
 * 轴/非轴同一路径（行数即数据）。判据五条：
 *   ① 纯函数：折算值、0 次触发、战斗时长为 0、未登记效果、时长登记值、同轮多段行不双计；
 *   ② 登记表完整性：登记的 effectId 真在 `teammate-buffs.json` 里且属于声明的 ownerAgentId；
 *   ③ 真管线：青衣队（C6）自动折算值存在且 < 100%；
 *   ④ 通道一致：手调 = 自动同值 ⇒ 伤害**逐位相等**（自动值确实走同一条覆盖率通道）；
 *   ⑤ 手调优先：手调 0 / 100 分别压过自动值（`teammateBuffManualCoverages` 是判据）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import {
  TEAMMATE_BUFF_TRIGGER_COVERAGE,
  teammateBuffTriggerCount,
  teammateBuffTriggerCoverage,
} from '@/data/teammateBuffTriggerCoverage'

const C1_DEF = 'qingyi_cinema_1_enemy_def_reduction'
const C6_RES = 'qingyi_cinema_6_enemy_res_reduction'
const C1_BUFF = 'qingyi.cinema_1_def_reduction'
const C6_BUFF = 'qingyi.cinema_6_res_reduction'
const flush = async () => { await new Promise<void>(r => setTimeout(r, 0)) }

describe('队友 buff 触发型效果覆盖率折算', () => {
  it('① 纯函数：次数 × 时长 / 战斗时长，夹 0–100；未登记/无时长 ⇒ null', () => {
    expect(teammateBuffTriggerCoverage(C6_RES, 6, 180), '6 轮 × 15s / 180s').toBeCloseTo(50, 9)
    expect(teammateBuffTriggerCoverage(C6_RES, 14, 180), '14 轮 ⇒ 封顶').toBe(100)
    expect(teammateBuffTriggerCoverage(C6_RES, 0, 180), '一次没打出来 ⇒ 0').toBe(0)
    expect(teammateBuffTriggerCoverage(C6_RES, 3, 0), '没有战斗时长 ⇒ 不折算').toBeNull()
    expect(teammateBuffTriggerCoverage('qingyi_core_subjugation_stun_multiplier', 9, 180), '未登记 ⇒ 不折算').toBeNull()
    expect(TEAMMATE_BUFF_TRIGGER_COVERAGE[C1_DEF]?.durationSeconds, '登记值 = 原文「持续15秒」').toBe(15)
  })

  it('①b 同轮多段行只算一轮（取各行 count 的最大值，不是求和）', () => {
    const spec = TEAMMATE_BUFF_TRIGGER_COVERAGE[C6_RES]!
    const rows = [
      { moveId: '1251008', count: 6 },
      { moveId: '1251009', count: 6 },
      { moveId: '1251004', count: 198 },
    ] as never
    expect(teammateBuffTriggerCount(spec, rows), '醉花 #1/#2 同 count ⇒ 6 轮（求和会得 12）').toBe(6)
  })

  it('② 登记表完整性：effectId 真在拐力数据里且属于声明的 ownerAgentId', () => {
    const groups = JSON.parse(
      readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8'),
    ) as Array<{ id: string; buffs: Array<{ effects?: Array<{ id?: string }> }> }>
    for (const [effectId, spec] of Object.entries(TEAMMATE_BUFF_TRIGGER_COVERAGE)) {
      const group = groups.find(g => g.id === spec.ownerAgentId)
      expect(group, `登记项 ${effectId} 的 ownerAgentId ${spec.ownerAgentId} 不在拐力数据里`).toBeTruthy()
      const ids = (group!.buffs ?? []).flatMap(b => (b.effects ?? []).map(e => e.id))
      expect(ids, `登记项 ${effectId} 不是 ${spec.ownerAgentId} 的拐力效果 id`).toContain(effectId)
    }
  })

  it('③④⑤ 真管线：自动折算进伤害通道、手调同值逐位相等、手调优先', async () => {
    /**
     * 般岳+青衣(C6)+卢西娅：青衣分到约 22% 前台时间、**8 轮**醉花 ⇒ 折算值 66.67%（8×15/180）。
     *
     * ⚠ 2026-11-03 口径修正：旧值是 6 轮 / 50%——那是「保底 4 嗔火 + 终结技需求未向上取整」时的落点。
     * 两者退场/修正后（minRageCount 删除、ultimateCountNeeded 向上取整），般岳补齐量 60→4 刀，
     * 时间面重排 ⇒ 青衣强特次数 10→8。折算式本身未变（轮次 × 15s ÷ 180s）。
     */
    await setupHarness([{ agentId: '1471' }, { agentId: '1251', cinemaLevel: 6 }, { agentId: '1451' }])
    const config = useConfigStore()
    const calc = useResourceCalc()
    await flush()
    const auto = calc.effectiveTeammateBuffCoverages.value
    expect(auto[C1_DEF], '影画一减防折算值（8 轮 × 15s / 180s）').toBeCloseTo(66.667, 2)
    expect(auto[C6_RES], '影画六减抗折算值').toBeCloseTo(66.667, 2)
    const base = calc.teamTotalDamage.value
    expect(base).toBeGreaterThan(0)

    // ④ 手调 = 自动同值 ⇒ 伤害逐位相等（自动值走的是同一条覆盖率通道，不是只挂在表上）
    config.setTeammateBuffCoverage(C1_BUFF, auto[C1_DEF]!)
    config.toggleTeammateBuff(C1_BUFF, true)
    config.setTeammateBuffCoverage(C6_BUFF, auto[C6_RES]!)
    config.toggleTeammateBuff(C6_BUFF, true)
    await flush()
    expect(calc.teamTotalDamage.value, '自动值 ≠ 手调同值的伤害 ⇒ 折算没进伤害管线').toBeCloseTo(base, 4)
    expect(config.teammateBuffManualCoverages[C1_BUFF], '手调标记').toBeCloseTo(auto[C1_DEF]!, 6)

    // ⑤ 手调 100 ⇒ 高于折算（说明折算真的咬下去了）；手调 0 ⇒ 低于折算
    config.setTeammateBuffCoverage(C1_BUFF, 100)
    config.setTeammateBuffCoverage(C6_BUFF, 100)
    await flush()
    const manualFull = calc.teamTotalDamage.value
    expect(manualFull, '手调 100 必须压过自动折算值').toBeGreaterThan(base)

    config.setTeammateBuffCoverage(C1_BUFF, 0)
    config.setTeammateBuffCoverage(C6_BUFF, 0)
    await flush()
    expect(calc.teamTotalDamage.value, '手调 0 必须生效').toBeLessThan(base)
  }, 300000)
})
