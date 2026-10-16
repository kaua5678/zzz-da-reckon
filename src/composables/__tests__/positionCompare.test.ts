/**
 * 位置对比（主C / 击破手 / 辅助，同款限定金）测试：
 * - 同一金档下换位置角色比较可复现；金数确实应用（8 金 > 6 金伤害，多出的命座生效）
 * - 位置按 specialty 识别（主C=attack/anomaly/rupture、击破手=stun、辅助=support/defense）
 * - 失衡值/占比来自失衡池逐槽统计；积蓄量/占比按「异属性赠送归接收人」口径逐槽归因
 * - 主C 自身总伤构成自洽：直伤 + 异放 + 紊乱 + 其他异常 ≡ selfDamage
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computePositionCompare, type ComparePosition } from '@/composables/positionCompare'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetFile } from '@/types/bossPreset'

const bossData = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile

/**
 * 位置对比（T180：**按号位**，用户口径 2026-10-16）。
 *
 * > 「位置对比中，分的职业，但是如果**多个同职业角色在同队就不能分辨了，不智能**，
 * >   希望改成**几号位的自由对比**。」
 *
 * ⚠ 本文件的**语义已从「职业」改为「号位」**（`ComparePosition = 0 | 1 | 2`）。
 * 原用例的 `'main'/'breaker'/'support'` 与 `banyue-liuyin-lucia` 的槽位**恰好一一对应**
 * （般岳=槽0 主C / 琉音=槽1 击破 / 卢西娅=槽2 辅助）⇒ 改号位后断言的角色名**不变**，
 * 只是**选人方式**从「按职业猜第一个匹配」变成「直接点名号位」（无歧义）。
 */
describe('位置对比（1/2/3 号位，同款限定金）', () => {
  async function runPosition(presetId: string, position: ComparePosition, gold = 6) {
    const preset = teamPresets.find(p => p.id === presetId)
    expect(preset).toBeDefined()
    const boss = bossData.bosses[0] as BossPreset
    const phase = boss.phases[0]
    await setupHarness([
      { agentId: preset!.team[0] },
      { agentId: preset!.team[1] },
      { agentId: preset!.team[2] },
    ])
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const calc = useResourceCalc()
    return computePositionCompare({ config: useConfigStore(), calc }, [preset!], boss, phase, { gold, position })
  }

  it('2 号位（击破）：金数应用 + 号位识别 + 失衡值/占比输出', async () => {
    const r6 = await runPosition('banyue-liuyin-lucia', 1, 6)
    const r8 = await runPosition('banyue-liuyin-lucia', 1, 8)
    expect(r6).toHaveLength(1)
    expect(r6[0].position).toBe(1)
    expect(r6[0].agentName).toBe('琉音') // 2 号位 = 击破手琉音（按号位点名，不再按职业猜）
    // 8 金比 6 金多了般岳/卢西娅命座 → 总伤不低于
    expect(r8[0].totalDamage).toBeGreaterThanOrEqual(r6[0].totalDamage)
    // 失衡值/占比：来自逐槽失衡池（后台招式贡献已计入）
    expect(r8[0].daze).toBeGreaterThanOrEqual(0)
    expect(r8[0].dazeShare).toBeGreaterThan(0)
    expect(r8[0].dazeShare).toBeLessThanOrEqual(100)
  }, 120000)

  it('3 号位（辅助）：卢西娅可识别，积蓄/失衡占比落在合理区间', async () => {
    const rows = await runPosition('banyue-liuyin-lucia', 2)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.position).toBe(2)
    expect(r.agentName).toContain('卢西娅')
    expect(r.buildUpShare).toBeGreaterThanOrEqual(0)
    expect(r.buildUpShare).toBeLessThanOrEqual(100)
    expect(r.dazeShare).toBeLessThanOrEqual(100)
  }, 120000)

  it('1 号位（主C）：号位识别 + 自身总伤构成自洽（直伤+异放+紊乱+其他异常）+ 占比区间', async () => {
    const rows = await runPosition('banyue-liuyin-lucia', 0)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.position).toBe(0)
    expect(r.agentName).toBe('般岳') // 队内 rupture 主C
    expect(r.selfDamage).toBeGreaterThan(0)
    // 自身总伤构成自洽（浮点容差）
    const composed = r.directDamage + r.releaseDamage + r.disorderDamage + r.anomalyOtherDamage
    expect(Math.abs(composed - r.selfDamage)).toBeLessThan(Math.max(1, r.selfDamage * 1e-9))
    expect(r.buildUpShare).toBeGreaterThanOrEqual(0)
    expect(r.buildUpShare).toBeLessThanOrEqual(100)
    expect(r.dazeShare).toBeGreaterThanOrEqual(0)
    expect(r.dazeShare).toBeLessThanOrEqual(100)
  }, 120000)

  it('★ T180：同队**两个同职业**也能分别对比（修前只认第一个匹配槽位）', async () => {
    /**
     * ## 锁什么（用户 2026-10-16 报的缺陷）
     *
     * > 「位置对比中，分的职业，但是如果**多个同职业角色在同队就不能分辨了，不智能**，
     * >   希望改成**几号位的自由对比**。」
     *
     * 修前 `findPositionSlot` 按职业遍历 + **返回第一个匹配** ⇒ 同职业时永远只认第一个。
     * 实测该缺陷真实存在：全库 **28+ 支预设队含同职业重复**。
     *
     * 本用例取 `auto-1541-1561-1581`（三人职业**全是 `anomaly`**，即主C系）
     * ⇒ 按号位点 0 与 1 必须得到**两个不同角色**（修前两者都会解析到槽 0 = 同一人）。
     *
     * ## 负控（改回按职业取第一个后本测试确实变红）
     *
     * 把 `findPositionSlot` 改回「按职业遍历返回首个」⇒ 槽0 与槽1 都会解析到 1541 ⇒ 红。
     */
    const preset = teamPresets.find(p => p.id === 'auto-1541-1561-1581')
    expect(preset, '夹具队必须存在').toBeDefined()
    const boss = bossData.bosses[0] as BossPreset
    const phase = boss.phases[0]
    await setupHarness([
      { agentId: preset!.team[0] },
      { agentId: preset!.team[1] },
      { agentId: preset!.team[2] },
    ])
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const [r0] = computePositionCompare({ config: useConfigStore(), calc: useResourceCalc() }, [preset!], boss, phase, { gold: 6, position: 0 })
    const [r1] = computePositionCompare({ config: useConfigStore(), calc: useResourceCalc() }, [preset!], boss, phase, { gold: 6, position: 1 })
    expect(r0.position).toBe(0)
    expect(r1.position).toBe(1)
    expect(r0.agentId, '★ 1 号位必须是该槽的人').toBe(preset!.team[0])
    expect(r1.agentId, '★ 2 号位必须是该槽的人（修前会和 1 号位解析到同一人）').toBe(preset!.team[1])
    expect(r0.agentId, '★ 两个同职业号位必须给出**不同**角色').not.toBe(r1.agentId)
  }, 300000)

  it('CC-339：2/3 号位拐力差分后不误开未解锁命座 buff，三号位失衡次数与失衡/积蓄占比总和同源一致', async () => {
    const [mainRow] = await runPosition('banyue-liuyin-lucia', 0, 6)
    const [breakerRow] = await runPosition('banyue-liuyin-lucia', 1, 6)
    const [supportRow] = await runPosition('banyue-liuyin-lucia', 2, 6)
    expect(breakerRow.stunCount).toBe(mainRow.stunCount)
    expect(supportRow.stunCount).toBe(mainRow.stunCount)
    expect(breakerRow.totalDamage).toBeCloseTo(mainRow.totalDamage, 5)
    expect(supportRow.totalDamage).toBeCloseTo(mainRow.totalDamage, 5)
    expect(mainRow.dazeShare + breakerRow.dazeShare + supportRow.dazeShare).toBeCloseTo(100, 1)
  }, 120000)
})
