/**
 * 挽昼（1601）v1 占位包 —— 面板层生效判据（2026-10-25 第一刀）。
 *
 * 覆盖：① 初始暴伤 → 初始暴击率 0.35%/1%（整 1% floor、只读局外面板）；
 * ② 极昼 暴击率 +40 / 无视 20% 防御（满覆盖近似）；③ catalog 的锋御两列（锐暴 150 / 锐能 1.5）在库。
 * 资源循环（锐能/残痕/愿力/链齿·旗令/愿核/烬痕）口径见 `sunbringer.ts` 头注释，接线后补判据。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import {
  applySunbringerPanel,
  buildSunbringerCharConfig,
  patchSunbringerExecutions,
  INITIAL_CRIT_DMG_TO_CRIT_RATE,
  PARRY_ASSIST_DAZE_BONUS,
  POLAR_DAY_CRIT_RATE,
  POLAR_DAY_DEF_IGNORE,
} from '@/mechanics/agents/sunbringer'
import type { AgentCharConfigInput, AgentPanelInput, AgentResourceInput } from '@/mechanics/types'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as {
  agents: { id: string, level60: Record<string, number> }[]
  agentSkills: { agentId: string, categories: { moves: { id: string, name: { zhCN: string }, rows: { id: string, values: number[] }[] }[] }[] }[]
}

function runPanel(outOfCombatCritDmg: number) {
  const panel = emptyPanel()
  panel.critRate = 33.8
  panel.critDmg = outOfCombatCritDmg
  const outOfCombatPanel = { ...panel }
  applySunbringerPanel({ panel, outOfCombatPanel } as unknown as AgentPanelInput)
  return { panel, converted: Math.floor(outOfCombatCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE }
}

describe('1601 挽昼 · 招架支援失衡 +50%（nanoka 3.4.1+19997538 新增）', () => {
  it('自身三段招架行都按表值 ×1.5 预缩（引擎取哪一段都不漏）', () => {
    const skills = catalog.agentSkills.find(s => s.agentId === '1601')!
    const parry = skills.categories.flatMap(c => c.moves).filter(m => /招架支援/.test(m.name.zhCN))
    expect(parry.length, 'catalog 里应有招架支援段（轻/重/连续）').toBeGreaterThanOrEqual(1)
    const cfg: Record<string, unknown> = {}
    buildSunbringerCharConfig({
      cfg,
      skills,
      agent: catalog.agents.find(a => a.id === '1601')!,
      cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    const scaled = cfg.sunbringerParryDazeById as Record<string, number>
    for (const m of parry) {
      const base = m.rows.find(r => r.id === 'daze')!.values[0]
      expect(scaled[m.id]).toBeCloseTo(Math.round(base * (1 + PARRY_ASSIST_DAZE_BONUS / 100) * 1000) / 1000, 6)
      expect(scaled[m.id]).toBeGreaterThan(base) // 反空洞：确实变大了，「忘了乘」不会被漏过
    }
  })

  it('命中招架行才打 override，其它行不动（负控）', () => {
    const skills = catalog.agentSkills.find(s => s.agentId === '1601')!
    const parryId = skills.categories.flatMap(c => c.moves).find(m => /招架支援/.test(m.name.zhCN))!.id
    const cfg: Record<string, unknown> = {}
    buildSunbringerCharConfig({
      cfg,
      skills,
      agent: catalog.agents.find(a => a.id === '1601')!,
      cinemaLevel: 0,
    } as unknown as AgentCharConfigInput)
    const rows = [
      { moveId: parryId, dazeMultiplier: 1, count: 1 },
      { moveId: '1601106', dazeMultiplier: 7, count: 1 },
    ] as unknown as AgentResourceInput['executions']
    patchSunbringerExecutions({ cfg, state: {}, executions: rows } as unknown as AgentResourceInput)
    expect(rows[0]!.dazeMultiplierOverride).toBe(true)
    expect(rows[0]!.dazeMultiplier).toBe((cfg.sunbringerParryDazeById as Record<string, number>)[parryId])
    expect(rows[1]!.dazeMultiplierOverride).toBeUndefined()
    expect(rows[1]!.dazeMultiplier).toBe(7)
  })
})

describe('1601 挽昼 · 面板层', () => {
  it('初始暴伤 → 初始暴击率：整 1% floor，且只吃局外面板', () => {
    const { panel, converted } = runPanel(50)
    expect(converted).toBe(17.5)
    expect(panel.critRate).toBeCloseTo(33.8 + 17.5 + POLAR_DAY_CRIT_RATE, 6)
    const { converted: c2 } = runPanel(78.8)
    expect(c2).toBeCloseTo(27.3, 6)
  })

  it('极昼：暴击率 +40、无视 20% 防御', () => {
    const { panel } = runPanel(0)
    expect(panel.critRate).toBeCloseTo(33.8 + POLAR_DAY_CRIT_RATE, 6)
    expect(panel.enemyDefIgnoreDirect).toBeCloseTo(POLAR_DAY_DEF_IGNORE, 6)
  })


/**
 * 2026-11-10：同句原文的两条**只作用于[支援突击]**的效果——
 * ① 支援突击伤害 +20%（招式限定增伤，用户裁决「增伤肯定做啊，挽昼关键机制就在于这个」）；
 * ② 招架+支突的自合轴率滑块（她既能自己接自己、又不打断已有招式 ⇒ 合轴率作用在自己身上）。
 */
describe('1601 支援突击 +20% 与招架+支突合轴率（2026-11-10）', () => {
  it('① 招式限定增伤：只抬支援突击那一行（dmgBonus 累加 +20），别的行原样', () => {
    const executions = [
      { moveId: '1601013', dmgBonus: 0 },
      { moveId: '1601106', dmgBonus: 5 },
      { moveId: '1601110' },
    ]
    patchSunbringerExecutions({
      cfg: { assistFollowUpMoveId: '1601013' },
      state: {},
      executions,
    } as unknown as AgentResourceInput)
    expect(executions[0]!.dmgBonus).toBe(20)
    // 负控 1：别的行不动（强特 1601106 的既有 +5 原样保留，说明是**累加**不是覆盖）
    expect(executions[1]!.dmgBonus).toBe(5)
    // 负控 2：没有支援突击行的角色/轮次不会被塞一个假 dmgBonus
    expect((executions[2] as { dmgBonus?: number }).dmgBonus).toBeUndefined()
  })

  it('② 合轴率写进「时间账真正读」的两个 cfg 字段：默认 60%，可调，夹在 0~100', () => {
    const skills = catalog.agentSkills.find(s => s.agentId === '1601')!
    const agent = catalog.agents.find(a => a.id === '1601')!
    const build = (raw?: number) => {
      const cfg: Record<string, unknown> = raw === undefined ? {} : { 'setting:sunbringer.parryComboAlign': raw }
      buildSunbringerCharConfig({ cfg, skills, agent, cinemaLevel: 0 } as unknown as AgentCharConfigInput)
      return cfg as { defensiveAssistComboAlignRatio: number; assistFollowUpComboAlignRatio: number }
    }
    // 默认 = 60%（不是 0）：滑块声明即默认值，读侧不再手抄
    expect(build().defensiveAssistComboAlignRatio).toBeCloseTo(0.6, 9)
    expect(build().assistFollowUpComboAlignRatio).toBeCloseTo(0.6, 9)
    // 两段用**同一个值**（用户口径：一个滑块管「招架+支突」）
    const v30 = build(30)
    expect(v30.defensiveAssistComboAlignRatio).toBeCloseTo(0.3, 9)
    expect(v30.assistFollowUpComboAlignRatio).toBeCloseTo(0.3, 9)
    // 夹取：0 / 超上界 / 负数
    expect(build(0).defensiveAssistComboAlignRatio).toBe(0)
    expect(build(150).defensiveAssistComboAlignRatio).toBe(1)
    expect(build(-20).defensiveAssistComboAlignRatio).toBe(0)
  })

  it('③ 端到端：合轴率进的是时间账（comboAlignCredit），且在队伍里真能变成更多招式', async () => {
    const read = async (team: { agentId: string }[], v: number) => {
      const { config } = await setupHarness(team)
      config.setActionCount(0, 'parryCount', 6)
      config.setMechanicSetting('sunbringer.parryComboAlign', v)
      // 设置在 store 里写入后，资源环要等一次 tick 才重算（与 mechanicSettingsEffect 同款）
      await new Promise(r => setTimeout(r, 0))
      const calc = useResourceCalc()
      const slot0 = calc.resourceResult.value!.characters.find(c => c.slot === 0)!
      const ta = slot0.timeAllocation as unknown as { comboAlignCredit: number; basicAttackTime: number }
      const rows = (slot0.executions ?? [])
        .filter(e => String(e.moveId).startsWith('16012') || String(e.moveId) === '1601013')
        .map(e => ({
          id: String(e.moveId),
          car: Number((e as { comboAlignRatio?: number }).comboAlignRatio ?? 0),
          bonus: Number((e as { dmgBonus?: number }).dmgBonus ?? 0),
        }))
      return { credit: Number(ta?.comboAlignCredit ?? 0), basic: Number(ta?.basicAttackTime ?? 0), damage: calc.teamTotalDamage.value, rows }
    }

    // 单人队：只看账本。抵扣随滑块**线性**增长（0 关断、30/60 成比例）——不在这里复述
    // 「charge 有几段」那套内部量，那属于引擎口径，断言写成比例关系才不会被无关改动带红。
    const soloOff = await read([{ agentId: '1601' }], 0)
    const solo30 = await read([{ agentId: '1601' }], 30)
    const soloOn = await read([{ agentId: '1601' }], 60)
    expect(soloOff.credit, '0% 时不该有任何抵扣').toBe(0)
    expect(soloOn.credit, '60% 必须有抵扣').toBeGreaterThan(0)
    expect(soloOn.credit).toBeCloseTo(solo30.credit * 2, 6)
    // 两行都拿到同一个比例（一个滑块管「招架+支突」）
    expect(soloOn.rows.length, '招架行与支援突击行都要在').toBeGreaterThanOrEqual(2)
    for (const row of soloOn.rows) expect(row.car, `${row.id} 应吃到 0.6`).toBeCloseTo(0.6, 9)
    for (const row of soloOff.rows) expect(row.car, `${row.id} 0% 时应为 0`).toBe(0)
    // 增伤接线也要在**真管线**里可见（纯函数单测证明不了 cfg→行 这一跳）
    const followRow = soloOn.rows.find(r => r.id === '1601013')
    expect(followRow, '支援突击行必须在执行计划里').toBeTruthy()
    expect(followRow!.bonus, '支援突击行要拿到 +20 增伤').toBe(20)

    // 三人队：腾出的时间在队伍里才真正变成产出。⚠ 不要断言「平A 时间变多」——她的模块会先把
    // 富余时间填给聚锋/强化特殊技（`solveSunbringerLoops` 的时间预算顺序），平A 反而不是第一顺位。
    // 判的是用户那句话的结果：「流出更多时间 ⇒ 多打招式」⇒ 队伍总伤害上升。
    const trio = [{ agentId: '1601' }, { agentId: '1611' }, { agentId: '1661' }]
    const teamOff = await read(trio, 0)
    const teamOn = await read(trio, 60)
    expect(teamOn.credit).toBeGreaterThan(teamOff.credit)
    expect(teamOn.damage, '让出的时间要变成更多招式（队伍总伤害上升）').toBeGreaterThan(teamOff.damage)
  }, 180000)
})

  it('catalog 锋御两列在库：锐暴 150 / 锐能 1.5（缺了会静默掉乘区）', () => {
    const agent = catalog.agents.find(a => a.id === '1601')!
    expect(agent.level60.sharpCritDmg).toBe(150)
    expect(agent.level60.sharpnessRegen).toBe(1.5)
  })
})