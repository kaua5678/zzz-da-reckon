/**
 * 猫又（1021）呼噜能量 30/40 档穿刺口径生效测试（用户口供 2026-08-23）：
 * - 尾巴失踪术无伤害，30 档价值 = 免费接一次穿刺（净省 10 点）；伤害载体只有绒爪穿刺(1021019)。
 * - 失衡内只能打 40 档长按，失衡外一律 30 档；非轴按占比滑杆（-1=自动覆盖率），轴模式按捏块精确计。
 * - 回归护栏：旧实现把尾巴失踪术错挂终结技 1021012 按其倍率产出行——任何执行行不得再出现该载体。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { planNekomataPierceCasts } from '@/mechanics/agents/nekomata'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

describe('planNekomataPierceCasts（预算分配纯函数）', () => {
  it('占比 0：全部 30 档（每 30 点一发）；占比 1：全部 40 档', () => {
    // 两档都要求施放时 ≥40 呼噜 → 30 档序列沉底 10 点：floor((300−10)/30) = 9 发
    const allDodge = planNekomataPierceCasts(300, { holdBudgetShare: 0 })
    expect(allDodge).toMatchObject({ holdCount: 0, dodgeCount: 9, totalCount: 9, spent: 270 })
    // 占比 1：全按 40 档 floor(300/40)=7；剩余 20 < 40 打不出任何档
    const allHold = planNekomataPierceCasts(300, { holdBudgetShare: 1 })
    expect(allHold).toMatchObject({ holdCount: 7, dodgeCount: 0, totalCount: 7, spent: 280 })
  })

  it('混合占比：先保 40 档预算，剩余全按 30 档', () => {
    // 预算 400、占比 0.5 → 40档预算 200 → 5 次；剩 200 → floor((200−10)/30)=6 次 + 余 10
    const mix = planNekomataPierceCasts(400, { holdBudgetShare: 0.5 })
    expect(mix).toMatchObject({ holdCount: 5, dodgeCount: 6, totalCount: 11, spent: 380 })
  })

  it('轴模式：捏块数精确决定 40 档，其余预算转 30 档', () => {
    // 轴内捏 3 块 → 3×40=120；预算 300 剩 180 → floor((180−10)/30)=5 次 30 档
    expect(planNekomataPierceCasts(300, { axisHoldPicks: 3 }))
      .toMatchObject({ holdCount: 3, dodgeCount: 5, totalCount: 8 })
    // 捏块超出预算承载：封顶到 floor(预算/40)
    expect(planNekomataPierceCasts(100, { axisHoldPicks: 9 }).holdCount).toBe(2)
  })

  it('低预算：不足 40 点时什么都放不出（两档都要求施放时 ≥40 呼噜）', () => {
    expect(planNekomataPierceCasts(39)).toMatchObject({ holdCount: 0, dodgeCount: 0, totalCount: 0 })
    // 69（=初始40+回29）：首发后余 10，回 29 < 30 补不到第二发起跳 → 只能 1 发
    expect(planNekomataPierceCasts(69, { holdBudgetShare: 0 })).toMatchObject({ dodgeCount: 1, spent: 30 })
    expect(planNekomataPierceCasts(70, { holdBudgetShare: 0 })).toMatchObject({ dodgeCount: 2, spent: 60 })
  })
})

describe('猫又全管线集成（harness）', () => {
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

  async function setupNeko() {
    const { config } = await setupHarness([{ agentId: '1021' }, '', ''])
    return config
  }

  function pierceRows(calc: ReturnType<typeof useResourceCalc>) {
    const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    return {
      exec: neko.executions.filter(e => e.moveId === '1021019'),
      rows: calc.damagePoolRows.value.filter(r => r.moveId === '1021019'),
    }
  }

  it('非轴模式：滑杆 -1 自动 / 手动覆盖改变穿刺次数与总伤；无任何 1021012 载体行（旧错挂回归护栏）', async () => {
    const config = await setupNeko()
    const calc = useResourceCalc()
    // 默认 -1 = 自动覆盖率：单猫又队失衡覆盖率趋近 0 → 几乎全部 30 档
    const autoRows = pierceRows(calc)
    expect(autoRows.exec.length).toBeGreaterThan(0)
    expect(autoRows.exec[0]!.count).toBeGreaterThan(0)

    // 占比拉满 1 → 全部走 40 档 → 同预算下次数变少（40 > 30/发）
    config.setMechanicSetting('nekomata.stunCastShare', 1)
    await new Promise(r => setTimeout(r, 50))
    const holdRows = pierceRows(calc)
    expect(holdRows.exec[0]!.count).toBeLessThan(autoRows.exec[0]!.count)

    // 回归护栏：旧实现把尾巴失踪术事件挂在 1021012（终结技）上按其倍率额外产出行；
    // 现在 1021012 只允许出现「通用终结技」一行且次数 = 终结技次数。
    const nekoAll = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    const ultRows = nekoAll.executions.filter(e => e.moveId === '1021012')
    expect(ultRows.length).toBe(1)
    expect(ultRows[0]!.count).toBe(nekoAll.ultimateCount)
  })

  it('穿刺行动作时间按倍率表计入前台（1.5666s/次），伤害倍率取 1021019 的 damage 行', async () => {
    await setupNeko()
    const calc = useResourceCalc()
    const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    const pierce = neko.executions.find(e => e.moveId === '1021019')!
    expect(pierce.actionTime).toBeCloseTo(1.5666, 4)
    expect(pierce.totalTime).toBeCloseTo(pierce.actionTime * pierce.count, 4)
    expect(pierce.damageMultiplier).toBeCloseTo(2527.8, 1)
  })
})
