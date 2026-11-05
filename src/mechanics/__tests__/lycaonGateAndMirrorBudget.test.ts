import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { getAgentMechanic } from '@/mechanics/registry'
import { capabilityGateMissesOf } from '@/composables/capabilityGateNotice'
import type { ActionCountField } from '@/stores/config'

/**
 * 莱卡恩（1141）围猎的**两条口径判据**（2026-11-04）：
 *
 * 1. **入场券**：`huntCount = min(失衡次数, 弹刀次数)` ⇒ 界面必须能报「围猎未启用 + 需要几次弹刀」
 *    （`capabilityGates` 声明，用户原话「没弹刀就没围猎……误认为莱卡恩弱就不透明了」）；
 * 2. **镜像闪反的时长预算**：镜像次数逐次跟着队友闪反走，但**受围猎窗口（8s × 次数）约束**——
 *    旧式只从平A预算里扣、闪反自身无上限，实测 81 次闪反 = 48.6s 动作塞进 2 次 16s 的围猎，
 *    后台闪反单独产 5.92 条失衡、总失衡 11 次 × 16s ≈ 176s/180s（交接 §二 E 判为**过建模**）。
 */

const FLAGSHIP = 'auto-1611-1141-1211'

/** 该队 + 指定槽0 闪反 / 槽1（莱卡恩）弹刀 */
async function setup(slot0Dodge: number, lycaonParry: number) {
  const { config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  const calc = useResourceCalc()
  const p = teamPresets.find(x => x.id === FLAGSHIP)!
  clearDifficultyLevers({ config, calc })
  applyTeamToStore(config, p)
  config.team[0]!.parryCount = slot0Dodge > 0 ? 1 : 0
  config.team[0]!.dodgeCounterCount = slot0Dodge
  config.team[1]!.parryCount = lycaonParry
  await new Promise(r => setTimeout(r, 90))
  const lycaon = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
  const row = (moveId: string) => lycaon.executions.find(e => e.moveId === moveId)
  return { config, calc, lycaon, row, counts: (slot: number, field: ActionCountField) => Number(config.team[slot]?.[field] ?? 0) }
}

describe('1141 围猎 · 镜像闪反时长预算（2026-11-04）', () => {
  it('★ 极端闪反（槽0 = 81）：镜像次数被围猎窗口封顶，不再把 48.6s 动作塞进 16s 窗口', async () => {
    const { lycaon, row, calc } = await setup(81, 2)
    const ice = row('1141027')
    const mirror = row('1141019')
    expect(ice, '弹刀 2 ⇒ 围猎应有冰舞行').toBeDefined()
    const huntCount = ice!.count / 2
    expect(huntCount).toBeCloseTo(2, 6)
    // 窗口 = 8s × 次数 = 16s；每次镜像 0.6s ⇒ 上限 26 次
    const cap = Math.floor((8 * huntCount) / 0.6 + 1e-9)
    expect(cap).toBe(26)
    expect(mirror!.count, '镜像次数必须 ≤ 围猎窗口能装下的次数').toBeLessThanOrEqual(cap)
    expect(mirror!.count).toBe(cap)
    // 闪反 + 平A ≤ 窗口（两者共享同一份 8s×次数 预算）
    const basicSeconds = lycaon.executions.find(e => e.moveName?.includes('围猎·后台蓄力'))?.totalTime ?? 0
    expect(mirror!.count * 0.6 + basicSeconds, '闪反 + 平A 不得超过围猎窗口').toBeLessThanOrEqual(8 * huntCount + 0.6 + 1e-6)
    // 失衡不再吃掉整场战斗（修前 11 次 × 16s ≈ 176s/180s）
    expect(calc.stunCoverage.value, '失衡窗占比不应接近 100%').toBeLessThan(0.7)
  }, 900000)

  it('★ 镜像次数仍逐次跟随队友闪反（小数量时不被封顶，次数口径不变）', async () => {
    const { row, calc } = await setup(20, 4)
    // ⚠ huntCount 是**收敛后的实数**（外层不动点给 stunCount），不是整数：这里只断言「围猎开得比镜像需要的多」
    const huntCount = row('1141027')!.count / 2
    expect(huntCount).toBeGreaterThan(3)
    expect(huntCount).toBeLessThanOrEqual(4 + 1e-9)
    const cap = Math.floor((8 * huntCount) / 0.6 + 1e-9)
    expect(cap).toBeGreaterThan(20)
    // 队友只打 20 次 ⇒ 全部镜像（没碰到窗口上限）= 旧口径逐位保留
    expect(row('1141019')!.count).toBe(20)
    expect(calc.stunCoverage.value).toBeGreaterThan(0)
  }, 900000)

  it('反空洞：弹刀 0（= 五个 1141 预设的现状）⇒ 围猎整条不产行', async () => {
    const { row } = await setup(81, 0)
    expect(row('1141027')).toBeUndefined()
    expect(row('1141019')).toBeUndefined()
  }, 900000)
})

describe('1141 围猎 · 入场券声明（capabilityGates）', () => {
  it('★ 声明存在且指向用户可改的 parryCount（不是模块私有 cfg）', () => {
    const gates = getAgentMechanic('1141')?.capabilityGates
    expect(gates?.length).toBe(1)
    const gate = gates![0]!
    expect(gate.label).toBe('围猎')
    expect(gate.requirement.field).toBe('parryCount')
    expect(gate.requirement.min).toBe(1)
    expect(gate.unlockHint?.length).toBeGreaterThan(0)
  })

  it('★ 弹刀 0 ⇒ 门未满足（提示：需要弹刀 ≥1 次，当前 0）', async () => {
    const { calc, counts } = await setup(81, 0)
    const misses = capabilityGateMissesOf(calc.resourceResult.value, counts)
    const m = misses.find(x => x.agentId === '1141')!
    expect(m).toBeDefined()
    expect(m.current).toBe(0)
    expect(m.min).toBe(1)
  })

  it('★ 弹刀 > 0 且围猎产出了冰舞行 ⇒ 门满足，一条都不报（反空洞）', async () => {
    const { calc, counts, row } = await setup(20, 2)
    expect(row('1141027'), '前置：围猎应产出冰舞行').toBeDefined()
    const misses = capabilityGateMissesOf(calc.resourceResult.value, counts)
    expect(misses.some(x => x.agentId === '1141')).toBe(false)
  })
})
