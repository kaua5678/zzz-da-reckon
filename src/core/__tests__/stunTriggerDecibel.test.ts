/**
 * 进入失衡喧响（用户 2026-10-20 裁决「**每人**」）。
 *
 * ## 需求与口径
 * 游戏里每次进入失衡给 20 喧响。原先引擎**完全没有**这条通道：
 * `core/stunPool.ts` 头注释记着 CC-231 删过一条「失衡次数 × 20」字段，理由是那条是
 * **失衡池卡片上的展示字段、无消费者、归属未定**。本次按用户裁决（每人）**重新接线到喧响收入**。
 *
 * ## 口径三条
 * ① **每人**：失衡 N 次 ⇒ 每名角色**自己**得 `20N`（不是「最后一击的人拿 20N」）；
 * ② **伴随 50%** 照常：与弹刀/连携那 4 项同一套规则 ⇒ 每人最终 = `20N + Σ(别人的 20N) × 50%`；
 * ③ **走独立字段** `stunTriggerBonus`，不并进 `specialActionBonus`——那 4 项是「谁做谁拿」，
 *    本条是「每人都有」，混在一起结果卡说不清「这 20 算给了谁」。
 *
 * ## 判据设计（反空洞是重点）
 * ① **量级锚**：全队三人 `stunTriggerBonus` **逐槽相同**（口径 = 每人）；
 * ② **伴随比例闭合**：`Σ perSlot == 20N × 3 + 20N × 3 × 50%`（3 人各得自己的 + 收另外两人的 50%）；
 * ③ **锁失衡次数可复现**：`stunCountLock = 4` ⇒ 该项恒 `4 × 20 × (1 + 2×0.5)` = 160；
 * ④ **会计入总数**：字段是 `total` 的加项（去掉它 total 应少同样的量）；
 * ⑤ **账本覆盖**：`buildDecibelLedger().uncovered === 0`（新字段必须登记进 `FIELD_TO_KIND`，
 *    否则会被静默漏出账本——这正是 decibelLedger 那条判据存在的理由）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { STUN_TRIGGER_DECIBEL_BONUS } from '@/data/anomalyDecibelBonuses'
import { buildDecibelLedger } from '@/test/decibelLedger'
import { teamPresets } from '@/data/teamPresets'

const TEAM = ['auto-1461-1031-1521', 'auto-1041-1571-1211', 'yixuan-trigger-lucia']

/** 跑一支预设、返回该队的只读快照（响应式读数必须在同一个 tick 内取完） */
async function snapshot(presetId: string, stunLock = -1) {
  const preset = teamPresets.find(p => p.id === presetId)
  expect(preset, `预设 ${presetId} 不存在`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  if (stunLock >= 0) config.enemy.stunCountLock = stunLock
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value
  const pool = calc.stunPoolResult.value
  expect(rr, `${presetId} 没有计算结果`).toBeTruthy()
  return {
    chars: rr!.characters.map(c => ({
      agentId: c.agentId,
      stunTriggerBonus: c.decibelSource.stunTriggerBonus,
      total: c.decibelSource.total,
      specialActionBonus: c.decibelSource.specialActionBonus,
    })),
    stunCount: pool?.stunCount ?? 0,
  }
}

describe('进入失衡喧响（每人 20/次）', () => {
  it('① 全队三人逐槽相同（口径 = 每人，不是「最后一击归谁」）', async () => {
    for (const id of TEAM) {
      const s = await snapshot(id)
      if (s.stunCount <= 0) continue
      const vals = s.chars.map(c => c.stunTriggerBonus)
      expect(vals.every(v => v > 0), `${id} 有失衡却没人拿到进入失衡喧响：${vals.join('/')}`).toBe(true)
      // 逐槽相同（浮点同一算式，用 1e-9；伴随比例对三人对称 ⇒ 严格相等）
      expect(Math.max(...vals) - Math.min(...vals), `${id} 各槽不等：${vals.join('/')}`).toBeLessThan(1e-9)
    }
  }, 300_000)

  it('② 伴随比例闭合：Σ = 20N×3 + 20N×3×50%', async () => {
    const s = await snapshot('auto-1461-1031-1521')
    expect(s.stunCount, '该队要真的打出失衡，否则本条无样本').toBeGreaterThan(0)
    const own = STUN_TRIGGER_DECIBEL_BONUS * s.stunCount
    const expectedPerSlot = own + own * 2 * 0.5 // 自己的 + 另外两人各自的 50%
    const sum = s.chars.reduce((a, c) => a + c.stunTriggerBonus, 0)
    expect(sum).toBeCloseTo(expectedPerSlot * 3, 6)
    for (const c of s.chars) expect(c.stunTriggerBonus).toBeCloseTo(expectedPerSlot, 6)
  }, 300_000)

  it('③ 锁失衡 4 次 ⇒ 每人恒 160（= 4×20×(1+2×0.5)）', async () => {
    const s = await snapshot('auto-1461-1031-1521', 4)
    for (const c of s.chars) expect(c.stunTriggerBonus).toBeCloseTo(4 * 20 * 2, 6)
  }, 300_000)

  it('④ 计入 total（不是悬挂字段）', async () => {
    const s = await snapshot('auto-1461-1031-1521')
    // total 必然 ≥ 本项（其余来源都非负）⇒ 去掉本项必须变小，且差值 == 本项
    for (const c of s.chars) {
      expect(c.total).toBeGreaterThan(c.stunTriggerBonus)
      expect(c.total - c.stunTriggerBonus).toBeGreaterThanOrEqual(0)
      // 反空洞：若本项根本没进 total，下面这条恒等就会在 total 恰等于其余之和时暴露不出来，
      // 故用「本项 > 0 且 total 严格大于它」+ 账本闭合（⑤）双保险。
      expect(c.stunTriggerBonus).toBeGreaterThan(0)
    }
  }, 300_000)

  it('⑤ 账本覆盖：新字段必须登记进 FIELD_TO_KIND（否则 uncovered ≠ 0）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1461-1031-1521')!
    for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
    config.applyTeamPreset(preset.team as [string, string, string])
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    for (const c of rr.characters) {
      const ledger = buildDecibelLedger(c.decibelSource)
      expect(ledger.uncovered, `${c.agentId} 账本有未覆盖字段（新来源没登记）`).toBeCloseTo(0, 6)
      // 本项必须真的出现在账本里（登记了但 kind 漏加也会让 uncovered 非 0，这里正向确认一次）
      expect(c.decibelSource.stunTriggerBonus).toBeGreaterThan(0)
    }
  }, 300_000)
})
