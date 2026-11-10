/**
 * CC-197：爱芮绝对音准直伤行走通用「模块必做动作」通道（extraNecessaryAction，时间进账本估计）。
 * 守卫：① 直伤行存在且与异放事件次数同源；② 影画6 全部强化版并吃 +40%；
 * ③ 派发器把单个/数组统一成数组、丢弃 count ≤ 0；④ 正反馈最强的队净占用不超预算（毛前台可 > 180，合轴抵扣后净 ≤ 180）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { extraNecessaryActionOf } from '@/core/resource/rowAccounting'
import { aireExtraNecessaryActions } from '@/mechanics/agents/aire'

const PITCH = new Set(['1501007', '1501008'])

async function run(cinemaLevel: number) {
  await setupHarness([
    { agentId: '1501', cinemaLevel },
    { agentId: '1221' },
    { agentId: '1311' },
  ], { recommendedBuild: true })
  const rr: any = useResourceCalc().resourceResult.value
  const ch = rr?.characters.find((c: any) => c.agentId === '1501')
  const rows = (ch?.executions ?? []).filter((e: any) => PITCH.has(e.moveId))
  return { ch, rows }
}

describe('CC-197 爱芮绝对音准直伤（通用必做动作通道）', () => {
  it('C0：直伤行存在（necessary、耗时 = 次数 × actionTime、倍率表回填），次数 = 异放事件次数', async () => {
    const { ch, rows } = await run(0)
    const n = rows.reduce((s: number, e: any) => s + e.count, 0)
    expect(n).toBeGreaterThan(0)
    expect(new Set(rows.map((e: any) => e.moveId))).toEqual(PITCH)
    for (const e of rows) {
      expect(e.timeBucket).toBe('necessary')
      expect(e.totalTime).toBeCloseTo(e.count * e.actionTime, 9)
      expect(e.damageMultiplier ?? 0).toBeGreaterThan(0)
      // 未显式给喧响/回能 ⇒ 回落倍率表（#3/#5 表值 27.5 / 3.6）
      expect(e.decibelRecovery).toBeGreaterThan(0)
      expect(e.energyRecovery).toBeGreaterThan(0)
    }
    const release = (ch?.anomalyEventExecutions ?? []).find((e: any) => e.eventId === 'aire_absolute_pitch_release')
    expect(release?.count).toBe(n)
  }, 120000)

  it('C6：妄想时刻不退出 ⇒ 首次放大之后的强化版（1501008）+40%，之前的 #3 保持普通版', async () => {
    /**
     * CC-561：强化版只在[妄想时刻]内存在，而妄想时刻从**首次放大**（缺省 30s）才开始，
     * 故 C6 的绝对音准直伤行会拆成两段：普通 #3（1501007，不强化、不吃 +40%）+ 强化版（1501008，+40%）。
     * 旧断言 `rows.length === 1` 编码的是「进场即妄想时刻」。
     */
    const { rows } = await run(6)
    const byMove = new Map<string, any>(rows.map((e: any) => [e.moveId as string, e]))
    expect(byMove.has('1501008')).toBe(true)
    expect(byMove.get('1501008').dmgBonus ?? 0).toBeGreaterThanOrEqual(40)
    const normal = byMove.get('1501007')
    if (normal) {
      expect(normal.dmgBonus ?? 0).toBe(0)
      expect(normal.count).toBeLessThan(byMove.get('1501008').count)
    }
    expect(rows.every((e: any) => e.timeBucket === 'necessary')).toBe(true)
  }, 120000)

  it('派发器：数组统一、count ≤ 0 丢弃；无 state ⇒ 爱芮不声明', () => {
    const cfg: any = { agentId: '1501', battleTime: 180, aireCinemaLevel: 0, airePitchActionTime: 1, aireEnhancedPitchActionTime: 1 }
    const state: any = { exSpecialCount: 10, chainCountTotal: 4, ultimateCount: 3, basicAttackTime: 0 }
    expect(extraNecessaryActionOf(cfg)).toEqual([])
    const list = extraNecessaryActionOf(cfg, state)
    // 应援能量 10×3+4×4 = 46 → 23；全场应援 3×3 = 9 ⇒ 32；强化占比 3×15/180 = 0.25 ⇒ 8
    expect(list.map(a => [a.moveId, a.count])).toEqual([['1501007', 24], ['1501008', 8]])
    expect(aireExtraNecessaryActions(cfg, undefined)).toBeNull()
    // CC-561：C6 空应援能量时只剩「首次放大后每 6s 一层」= floor((180−0−30)/6)=25 层；
    // 强化占比 = (180−30)/180 = 5/6 ⇒ 强化 21 段 + 普通 #3 4 段（旧口径恒 30 全强化）
    expect(extraNecessaryActionOf({ ...cfg, 'setting:aire.absolutePitchCount': 0, aireCinemaLevel: 6 }, { ...state, ultimateCount: 0, exSpecialCount: 0, chainCountTotal: 0 })
      .map(a => [a.moveId, a.count])).toEqual([['1501007', 4], ['1501008', 21]])
    // 首次放大滑块置 0（= 进场即妄想时刻）⇒ 恢复旧口径：30 段全强化
    expect(extraNecessaryActionOf(
      { ...cfg, 'setting:aire.absolutePitchCount': 0, aireCinemaLevel: 6, 'setting:aire.firstUltTime': 0, invincibleTime: 0 },
      { ...state, ultimateCount: 0, exSpecialCount: 0, chainCountTotal: 0 },
    ).map(a => [a.moveId, a.count])).toEqual([['1501008', 30]])
  })

  it('正反馈最强的队（1501-1511-1411）：净占用不超预算、无截断', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    const team = ['1501', '1511', '1411']
    for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
    const rr: any = useResourceCalc().resourceResult.value
    const t = buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: (_a, s) => `s${s}` })
    expect(t.overflow).toBeLessThanOrEqual(1e-6)
    expect(t.slack).toBeGreaterThanOrEqual(-1e-6)
    expect(rr.convergence?.timeTruncatedSeconds ?? 0).toBeLessThanOrEqual(1e-6)
  }, 120000)
})
