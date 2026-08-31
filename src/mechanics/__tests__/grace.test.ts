/**
 * 格莉丝（1181）常规循环与机制生效测试（用户口供 2026-08-23）：
 * - 循环 = [A1+A2+A3 连段 1.183s]→特殊技→[A4 1.134s]→特殊技；A 段走通用平A池行（秒均），
 *   模块只发两发电能强化特殊技（伤害/积蓄 = 表值 ×2.3，非数字合成 id 防 enrich 覆盖）。
 * - 能量决定强特比例：强特数 ≤ 引擎按能量收敛次数，其余槽位填普通特殊技（免费）。
 * - AA 感电强化层数滑杆走面板 anomalyDmgBonus；潜能电伤 C2-C6 永续。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import {
  GRACE_C1_TEAM_ENERGY_PER_CYCLE,
  PULSE_CAP,
  PULSE_PER_GRENADE,
  PULSE_PER_ULT,
  graceRotationSeconds,
  planGraceRotation,
} from '@/mechanics/agents/grace'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
function useConfigStoreForPanel() { return useConfigStore() }
function useCatalogStoreForPanel() { return useCatalogStore() }

describe('planGraceRotation（轮换计划纯函数：每组 = [A1A2A3连段+A4]+2 特殊技槽）', () => {
  it('循环预算 = 连段1.183 + A4 1.134 + 2×强特0.342 = 3.001s；能量充足时全强特', () => {
    const plan = planGraceRotation(30, 99)
    expect(plan.cycles).toBe(9) // floor(30/3.001)=9
    expect(plan.exUsed).toBe(18)
    expect(plan.normalUsed).toBe(0)
  })

  it('能量不足：槽位填普通特殊技（免费），强特封顶于能量收敛次数', () => {
    const plan = planGraceRotation(30, 6)
    expect(plan.cycles).toBe(9)
    expect(plan.exUsed).toBe(6)
    expect(plan.normalUsed).toBe(12)
    expect(planGraceRotation(5, 99).cycles).toBe(1)
    expect(planGraceRotation(0, 5)).toMatchObject({ cycles: 0, exUsed: 0, normalUsed: 0 })
  })

  it('特殊技前台时间 = 仅两发特殊技（A 段由通用 basic 池行表达，避免必要时间=平A池震荡）', () => {
    expect(graceRotationSeconds(9, 0)).toBeCloseTo(18 * 0.2, 4)
    expect(graceRotationSeconds(9, 18)).toBeCloseTo(18 * 0.342, 4)
  })
})

describe('格莉丝全管线集成（harness）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('循环落位：A 段走通用平A池行；特殊技/强特真实 id 行 + 强特附带涡流手雷 + 脉冲兑换脉冲手雷', async () => {
    await setupHarness([{ agentId: '1181' }, '', ''])
    const calc = useResourceCalc()
    const grace = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!

    // A 段 = 通用 basic 池行（秒均伤害/积蓄）
    const basic = grace.executions.find(e => e.moveId === 'basic_attack')
    expect(basic).toBeTruthy()
    expect(basic!.totalTime ?? 0).toBeGreaterThan(0)
    // 回归护栏：A1-A4 不作为模块独立行（避免双计）
    for (const id of ['1181001', '1181002', '1181003', '1181004']) {
      expect(grace.executions.some(e => e.moveId === id)).toBe(false)
    }

    // 两发电能强化特殊技（真实 id）：强特行 + 每发附带[涡流集束手雷]
    const exRow = grace.executions.find(e => e.moveId === '1181006')
    const spRow = grace.executions.find(e => e.moveId === '1181005')
    expect(exRow ?? spRow).toBeTruthy()
    const slots = (exRow?.count ?? 0) + (spRow?.count ?? 0)
    expect(slots % 2).toBe(0)
    const vortex = grace.executions.find(e => e.moveId === '1181020')
    if (exRow && exRow.count > 0) {
      expect(vortex).toBeTruthy()
      expect(vortex!.count).toBe(exRow.count) // 每发强特附一枚涡流手雷
    }

    // [脉冲]：终结×25 层、上限 25（多大都卡住）→ 一次大恒 floor(25/8)=3 枚[脉冲手雷]
    const pulse = grace.executions.find(e => e.moveId === '1181019')
    const ult = grace.ultimateCount ?? 0
    if (ult > 0) {
      expect(pulse).toBeTruthy()
      expect(pulse!.count).toBe(Math.min(Math.floor(Math.min(ult * PULSE_PER_ULT, PULSE_CAP) / PULSE_PER_GRENADE), Math.max(0, slots)))
    }
  })

  it('积蓄 +130% 引擎级招式限定：只特殊技/强特两行吃，面板效率区=0、终结/连携不缩放', async () => {
    await setupHarness([{ agentId: '1181' }, '', ''])
    const calc = useResourceCalc()
    const panel = computePanelPhases(0, useConfigStoreForPanel(), useCatalogStoreForPanel())!.inCombat
    // 回归护栏：面板效率区必须为 0（行级字段承载，不波及全电积蓄）
    expect(panel.electricAnomalyBuildUpEfficiency ?? 0).toBeCloseTo(0, 4)

    const electric = calc.anomalyPoolResult.value?.perElement?.find(p => p.element === 'electric')
    expect(electric).toBeTruthy()
    const masteryCoef = (panel.anomalyMastery ?? 100) / 100
    // 特殊技行：行级效率 +130% 进积蓄效率区加算 → 70.03 × 掌控 × (1 + 1.3)
    const sp = electric!.contributions?.find(c => c.moveId === '1181005')
    expect(sp).toBeTruthy()
    expect(sp!.perHitBuildUp).toBeCloseTo(70.03 * masteryCoef * (1 + 130 / 100), 1)
    // 终结技行不缩放（招式限定证明）：895.7 × 掌控，远小于 ×2.3 的量级
    const ult = electric!.contributions?.find(c => c.moveId === '1181010')
    expect(ult).toBeTruthy()
    expect(ult!.perHitBuildUp).toBeCloseTo(895.7 * masteryCoef, 1)
    expect(ult!.perHitBuildUp).toBeLessThan(895.7 * masteryCoef * 1.3)
  })

  it('脉冲手雷附带异放事件：anomalyEventExecutions 含 release 事件，伤害池按 350 结算', async () => {
    await setupHarness([{ agentId: '1181' }, '', ''])
    const calc = useResourceCalc()
    const grace = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!
    if ((grace.ultimateCount ?? 0) <= 0) return // 无终结则无脉冲手雷
    const evt = grace.anomalyEventExecutions?.find(e => e.eventId === 'grace_pulse_grenade_release')
    expect(evt).toBeTruthy()
    expect(evt!.eventType).toBe('release')
    expect(evt!.element).toBe('dominant') // 异放按目标当前异常状态结算（审计修正 2026-08-24）
    const releaseRow = calc.damagePoolRows.value.find(r => r.type === '异放' && r.name?.includes('脉冲手雷'))
    expect(releaseRow).toBeTruthy()
    expect(['electric','ether','fire','physical','ice','wind']).toContain(releaseRow!.element) // 按目标活跃异常
    expect(releaseRow!.perDamage).toBeGreaterThan(0)
    expect(releaseRow!.totalDamage).toBeGreaterThan(0)
  })

  it('面板：潜能电伤逐命座永续；AA 层数滑杆驱动 anomalyDmgBonus', async () => {
    async function panelFor(cinemaLevel: number, teammate = '') {
      const { config, catalog } = await setupHarness([
        { agentId: '1181', cinemaLevel },
        ...(teammate ? [{ agentId: teammate }] : []),
        '',
      ] as never)
      return computePanelPhases(0, config, catalog)!.inCombat
    }
    const p0 = await panelFor(0)
    expect(p0.electricDmg ?? 0).toBeCloseTo(0, 4) // 无潜能无电伤加成

    const p2 = await panelFor(2)
    expect((p2.electricDmg ?? 0) - (p0.electricDmg ?? 0)).toBeCloseTo(10)
    const p6 = await panelFor(6)
    expect((p6.electricDmg ?? 0) - (p2.electricDmg ?? 0)).toBeCloseTo(20) // 30 − 10

    // AA：丽娜(支援)在队 → 触发；默认满层 2 → +36 anomalyDmgBonus（对比无队友基线）
    const soloAnomaly = p0.anomalyDmgBonus ?? 0
    const withLina = await panelFor(0, '1211')
    expect((withLina.anomalyDmgBonus ?? 0) - soloAnomaly).toBeCloseTo(36)
  })
})

describe('格莉丝影画 C1/C2/C4/C6（2026-08-27 用户口径补录）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('C4 爆破电容：不做面板满覆盖——能量获得效率面板保持 0（回能走单独项）', async () => {
    async function panelFor(cinemaLevel: number) {
      const { config, catalog } = await setupHarness([{ agentId: '1181', cinemaLevel }, '', ''] as never)
      return computePanelPhases(0, config, catalog)!.inCombat
    }
    const p4 = await panelFor(4)
    expect(p4.energyGainEfficiency ?? 0).toBeCloseTo(0, 4) // 招式特定回能，不走 panel 满覆盖
  })

  it('C1 再充能弹膛：converge 阶段给全队每人各 +2/轮换 能量（energySource.initialGift 观察）', async () => {
    async function gifts(cinemaLevel: number) {
      await setupHarness([{ agentId: '1181', cinemaLevel }, { agentId: '1041' }, { agentId: '1101' }] as never)
      const calc = useResourceCalc()
      const out = calc.resourceResult.value!
      return out.characters.map(c => c.energySource.initialGift ?? 0)
    }
    const g0 = await gifts(0)
    const g1 = await gifts(1)
    expect(g0[0]).toBe(g0[1])
    expect(g0[0]).toBe(g0[2])
    const delta = g1.map((v, i) => v - g0[i])
    expect(delta[0]).toBeGreaterThan(0)
    expect(delta[1]).toBe(delta[0]) // 全队三人同额（applyTeamConfig 分发给三槽，含本体）
    expect(delta[2]).toBe(delta[0])
    expect(delta[0] % GRACE_C1_TEAM_ENERGY_PER_CYCLE).toBe(0) // 每轮换每人 +2 的整数倍
  })

  it('C6 起爆扳机：SP 1→2 手雷 / EX 2→3 手雷 + 全场手雷增伤 +100（涡流亦含）', async () => {
    await setupHarness([{ agentId: '1181', cinemaLevel: 6 }, '', ''] as never)
    const calc = useResourceCalc()
    const grace = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!

    const sp = grace.executions.find(e => e.moveId === '1181005')
    const ex = grace.executions.find(e => e.moveId === '1181006')
    const vortex = grace.executions.find(e => e.moveId === '1181020')
    if (sp && sp.count > 0) {
      expect(sp.dmgBonus ?? 0).toBe(100)
      expect(sp.damageMultiplier).toBeCloseTo(170, 2) // 85 × 2 手雷
    }
    if (ex && ex.count > 0) {
      expect(ex.dmgBonus ?? 0).toBe(100)
      expect(ex.damageMultiplier).toBeCloseTo(501.15, 2) // 334.1 × 1.5
      expect(vortex).toBeTruthy()
      expect(vortex!.dmgBonus ?? 0).toBe(100) // 涡流亦 +100% 增伤
    }
    // 异常结算吃到招式限定增伤（通用逻辑）：电元素基础区增伤按积蓄占比加权；
    // 积蓄端：C6 额外手雷段数 SP ×2 / EX ×1.5（transformGraceExecutions 缩放 baseBuildUp）
    const electric = calc.anomalyPoolResult.value?.perElement?.find(p => p.element === 'electric')
    expect(electric).toBeTruthy()
    const spContrib = electric!.contributions?.find(c => c.moveId === '1181005')
    const exContrib = electric!.contributions?.find(c => c.moveId === '1181006')
    if (spContrib) expect(spContrib.baseBuildUp).toBeCloseTo(140.06, 2)
    if (exContrib) expect(exContrib.baseBuildUp).toBeCloseTo(215.01, 2)
  })
})

describe('格莉丝滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('grace.shockStacks → 感电异常增伤差分（applyGracePanel settings 通道，+18%/层×≤2）', async () => {
    const { config } = await setupHarness([{ agentId: '1181' }, { agentId: '1211' }, ''])
    const read = () => {
      const calc = useResourceCalc()
      const p = calc.panels.value[0] as any
      return p?.anomalyDmgBonus ?? 0
    }
    config.setMechanicSetting('grace.shockStacks', 2)
    const on = read()
    config.setMechanicSetting('grace.shockStacks', 0)
    const off = read()
    expect(on - off).toBeCloseTo(36, 1)
    expect(on).toBeGreaterThan(off)
  })
})
