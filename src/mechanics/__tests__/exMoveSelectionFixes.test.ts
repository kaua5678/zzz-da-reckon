/**
 * 三条「招式选中/发放」缺口修复的生效判据（2026-10-27，用户逐条点名）。
 *
 * 共同形态：**招式在倍率表里、模块注释也写着它，但引擎选中的是别的一段**（或整段不选）——
 * 表现为「伤害静默偏低、无任何报错」。三条各自独立、删任一处修复都会红：
 *  ① 悠真 1201023 地网·巡弋（强特主招；修前引擎选 1201010 地网）
 *  ② 伊芙琳 1321012 束裂式·终型 #2 引爆段（修前未登记融合 ⇒ 整段丢失）
 *  ③ 佩洛伊斯 1551009 日华耗能 40（修前三源无耗能 ⇒ exSpecialCount=0、整招不发）
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { HARUMASA_EX_MOVE_ID, HARUMASA_EX_ENERGY_COST } from '@/mechanics/agents/harumasa'
import { PEILUO_EX_ENERGY_COST } from '@/mechanics/agents/specPanelBuffs'
import { findMoveById } from '@/data/moveTableQueries'
import { fusedGroupMetrics } from '@/core/resource/moveLookup'
import { readFileSync } from 'node:fs'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
const skillsOf = (id: string) => cat.agentSkills.find((s: any) => String(s.agentId) === id)!

async function charOf(agentId: string, team: string[] = [agentId, '1251', '1031']) {
  await setupHarness(team.map(a => ({ agentId: a, cinemaLevel: 0 })) as any)
  const calc = useResourceCalc()
  return calc.resourceResult.value!.characters.find(c => c.agentId === agentId)!
}

describe('招式选中/发放缺口（2026-10-27）', () => {
  it('① 悠真：强特主招 = 地网·巡弋 1201023（不是地网 1201010），行 actionTime 取巡弋表值', async () => {
    const c = await charOf('1201')
    expect(c.exSpecialMoveId, '主招必须是巡弋').toBe(HARUMASA_EX_MOVE_ID)
    expect(HARUMASA_EX_MOVE_ID).toBe('1201023')
    expect(c.exSpecialCount, '反空洞：确有强特').toBeGreaterThan(0)
    const row = c.executions.find((e: any) => String(e.moveId) === '1201023')
    expect(row, '巡弋行必须物化').toBeTruthy()
    const patrol = findMoveById(skillsOf('1201'), '1201023')!
    expect(Number((row as any).actionTime), '行时长 = 巡弋表值 1.333s').toBeCloseTo(Number(patrol.actionTime), 6)
    expect(c.executions.some((e: any) => String(e.moveId) === '1201010' && Number(e.count) > 0),
      '地网（未强化版）不应再被当成主招发放').toBe(false)
    expect((c as any).exSpecialEnergyConsume, '耗能同价 60').toBe(HARUMASA_EX_ENERGY_COST)
  }, 180000)

  it('② 伊芙琳：束裂式·终型一次发动 = 缠绕#1 + 引爆#2（融合组存在且总倍率/时长 = 两段和）', async () => {
    // 纯数据判据：融合组整段量
    const fused = fusedGroupMetrics(skillsOf('1321') as any, '1321011')
    expect(fused, '1321011 必须登记融合组').toBeTruthy()
    const m1 = findMoveById(skillsOf('1321'), '1321011')!
    const m2 = findMoveById(skillsOf('1321'), '1321012')!
    expect(fused!.actionTime, '时长 = 1.133 + 0.416').toBeCloseTo(Number(m1.actionTime) + Number(m2.actionTime), 6)
    // 真管线：行上 damageMultiplier 也是两段和（enrich 按融合组回填）
    const c = await charOf('1321')
    const row = c.executions.find((e: any) => String(e.moveId) === '1321011' && Number(e.count) > 0)
    expect(row, '强特行必须物化').toBeTruthy()
    const dmg1 = Number((m1.rows as any[]).find(r => r.id === 'damage')!.values[0])
    const dmg2 = Number((m2.rows as any[]).find(r => r.id === 'damage')!.values[0])
    expect(Number((row as any).damageMultiplier), '行倍率 = 1082.4 + 120.1').toBeCloseTo(dmg1 + dmg2, 4)
  }, 180000)

  it('③ 佩洛伊斯：日华耗能 40 ⇒ 强特真的发放（修前 0 次）', async () => {
    const c = await charOf('1551')
    expect(PEILUO_EX_ENERGY_COST).toBe(40)
    expect((c as any).exSpecialEnergyConsume, 'cfg 里必须写进 40').toBe(PEILUO_EX_ENERGY_COST)
    expect(c.exSpecialCount, '反空洞：能量够就必须打出强特').toBeGreaterThan(0)
    const row = c.executions.find((e: any) => String(e.moveId) === '1551009' && Number(e.count) > 0)
    expect(row, '日华行必须物化').toBeTruthy()
    expect(Number((row as any).totalTime), '日华占前台（1.75s × 次数）').toBeGreaterThan(1)
  }, 180000)
})
