/**
 * 格莉丝（1181）常规循环与机制生效测试（用户口供 2026-08-23）：
 * - 循环 = [A1+A2+A3 连段 1.183s]→特殊技→[A4 1.134s]→特殊技；A 段走通用平A池行（秒均），
 *   模块只发两发电能强化特殊技（伤害/积蓄 = 表值 ×2.3，非数字合成 id 防 enrich 覆盖）。
 * - 能量决定强特比例：强特数 ≤ 引擎按能量收敛次数，其余槽位填普通特殊技（免费）。
 * - AA 感电强化层数滑杆走面板 anomalyDmgBonus；潜能电伤 C2-C6 永续。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import {
  GRACE_EX_CHARGE_MOVE_ID,
  GRACE_SPECIAL_CHARGE_MOVE_ID,
  graceRotationSeconds,
  planGraceRotation,
} from '@/mechanics/agents/grace'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
function useConfigStoreForPanel() { return useConfigStore() }
function useCatalogStoreForPanel() { return useCatalogStore() }

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

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
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  it('循环落位：A 段走通用平A池行、两发电能强化特殊技行积蓄 ×2.3、真实招式 id 不双计', async () => {
    await setupHarness([{ agentId: '1181' }, '', ''])
    const calc = useResourceCalc()
    const grace = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!

    // A 段 = 通用 basic 池行（秒均伤害/积蓄）
    const basic = grace.executions.find(e => e.moveId === 'basic_attack')
    expect(basic).toBeTruthy()
    expect(basic!.totalTime ?? 0).toBeGreaterThan(0)
    // 回归护栏：真实 A1-A4/普通特殊技/强特 id 不作为模块独立行（避免双计）
    for (const id of ['1181001', '1181002', '1181003', '1181004', '1181005', '1181006']) {
      expect(grace.executions.some(e => e.moveId === id)).toBe(false)
    }

    // 两发电能强化特殊技：伤害走表值；积蓄经面板 electricAnomalyBuildUpEfficiency +130 整体缩放
    const exCharge = grace.executions.find(e => e.moveId === GRACE_EX_CHARGE_MOVE_ID)
    const spCharge = grace.executions.find(e => e.moveId === GRACE_SPECIAL_CHARGE_MOVE_ID)
    expect(exCharge ?? spCharge).toBeTruthy()
    if (exCharge) expect(exCharge.damageMultiplier).toBe(334.1)
    if (spCharge) expect(spCharge.damageMultiplier).toBe(85)
    // 特殊技总槽 = 2 × 循环数
    const slots = (exCharge?.count ?? 0) + (spCharge?.count ?? 0)
    expect(slots % 2).toBe(0)
  })

  it('积蓄 +130% 经面板效率区生效：平A池行（A 段）积蓄被 electricAnomalyBuildUpEfficiency 缩放', async () => {
    await setupHarness([{ agentId: '1181' }, '', ''])
    const calc = useResourceCalc()
    const grace = calc.resourceResult.value!.characters.find(c => c.agentId === '1181')!
    const panel = computePanelPhases(0, useConfigStoreForPanel(), useCatalogStoreForPanel())!.inCombat
    expect(panel.electricAnomalyBuildUpEfficiency ?? 0).toBeCloseTo(130, 4)
    const electric = calc.anomalyPoolResult.value?.perElement?.find(p => p.element === 'electric')
    expect(electric).toBeTruthy()
    expect(electric!.totalBuildUp ?? 0).toBeGreaterThan(0)
    void grace
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
