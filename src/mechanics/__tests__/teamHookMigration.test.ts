/**
 * #10 真清偿（棘轮 8→0）的落地测试：把 useResourceCalc 里最后 8 处 `agentId === 'xxxx'` 特判
 * 迁进模块钩子时，**分支与测试一起搬**（样板 d83b18b 的契约）。
 *
 * 为什么这些用例必须存在：护栏只能证明「编排层没有 agentId 分支了」，证明不了「迁走的逻辑还在」——
 * 少了这些断言，把分支删掉（而不是迁走）同样能让棘轮变绿，且 timeGolden 只有预设场景、
 * 未必覆盖「非预设手组队 / 边界命座」。本文件逐条钉住迁移后的落点与其**边界**（不写字段 vs 写 0）。
 */
import { describe, expect, it } from 'vitest'
import { luciaElowenMechanic } from '@/mechanics/agents/luciaElowen'
import { jufufuTigerRoarMechanic } from '@/mechanics/agents/specPanelBuffs'
import { banyueMechanic } from '@/mechanics/agents/banyue'
import { yixuanMechanic } from '@/mechanics/agents/yixuan'
import { corinMechanic } from '@/mechanics/agents/corin'
import { peiluoProminenceMechanic } from '@/mechanics/agents/specPanelBuffs'

/** 构造 applyTeamConfig 入参（只填被测逻辑读到的字段） */
const teamInput = (o: Record<string, unknown>) => ({
  characters: [], team: [], settings: {}, phase: 'build', combatTime: 180,
  exCounts: [], ultimateCounts: [], stunCount: 0, teamEnergyConsumed: 0,
  cinemaLevel: 0, potentialLevel: 6, agent: null, slot: 0,
  ...o,
} as never)

const member = (slot: number, agentId: string, specialty?: string) => ({
  slot, agentId, agent: specialty ? { specialty } : null,
  cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1,
})

describe('橘福福八面威风（原 useResourceCalc jufufuCfg 分支）', () => {
  it('额外能力激活 + 队内有强攻/命破 → 这些角色写 300；支援/击破不写', () => {
    const characters: any[] = [
      { slot: 0, agentId: '1391', panel: { additionalAbilityActive: 1 } },
      { slot: 1, agentId: '1041', panel: {} },   // 强攻
      { slot: 2, agentId: '1471', panel: {} },   // 命破
    ]
    jufufuTigerRoarMechanic.applyTeamConfig!(teamInput({
      slot: 0, characters, cinemaLevel: 0,
      team: [member(0, '1391', 'stun'), member(1, '1041', 'attack'), member(2, '1471', 'rupture')],
    }))
    expect(characters[1].extraSelfDecibelPerUltimate).toBe(300)
    expect(characters[2].extraSelfDecibelPerUltimate).toBe(300)
    // 橘福福自己是击破 → 不写（原实现同款：只给强攻/命破）
    expect(characters[0].extraSelfDecibelPerUltimate).toBeUndefined()
  })

  it('额外能力未激活 → 全员不写（原 `jufufuAA` 守卫）', () => {
    const characters: any[] = [
      { slot: 0, agentId: '1391', panel: { additionalAbilityActive: 0 } },
      { slot: 1, agentId: '1041', panel: {} },
    ]
    jufufuTigerRoarMechanic.applyTeamConfig!(teamInput({
      slot: 0, characters, team: [member(0, '1391', 'stun'), member(1, '1041', 'attack')],
    }))
    expect(characters[1].extraSelfDecibelPerUltimate).toBeUndefined()
  })

  it('非 build 相位不动作（本钩子在 build 写字段，converge/postRound 不得重复写）', () => {
    for (const phase of ['converge', 'postRound']) {
      const characters: any[] = [
        { slot: 0, agentId: '1391', panel: { additionalAbilityActive: 1 } },
        { slot: 1, agentId: '1041', panel: {} },
      ]
      jufufuTigerRoarMechanic.applyTeamConfig!(teamInput({
        slot: 0, characters, phase, team: [member(0, '1391', 'stun'), member(1, '1041', 'attack')],
      }))
      expect(characters[1].extraSelfDecibelPerUltimate).toBeUndefined()
    }
  })
})

describe('卢西娅 4命帷幕 + 回血→伊德海莉（原 luciaCfg 两个内联块）', () => {
  it('C4：全队写 100/覆盖率；C0 不写（引擎按「无字段」语义处理）', () => {
    const c4: any[] = [{ slot: 0, agentId: '1451', panel: {} }, { slot: 1, agentId: '1041', panel: {} }]
    luciaElowenMechanic.applyTeamConfig!(teamInput({
      slot: 0, characters: c4, cinemaLevel: 4, settings: { 'lucia.c4CurtainCoverage': 0.5 },
    }))
    expect(c4[0].luciaC4DecibelPerTrigger).toBe(100)
    expect(c4[1].luciaC4DecibelPerTrigger).toBe(100)
    expect(c4[0].luciaC4CurtainCoverage).toBe(0.5)

    const c0: any[] = [{ slot: 0, agentId: '1451', panel: {} }]
    luciaElowenMechanic.applyTeamConfig!(teamInput({ slot: 0, characters: c0, cinemaLevel: 0 }))
    expect(c0[0].luciaC4DecibelPerTrigger).toBeUndefined()
  })

  it('回血：换算比 = 卢西娅生命 / 伊德海莉生命，×覆盖滑块；伊德海莉不在队则不写', () => {
    const chars: any[] = [
      { slot: 0, agentId: '1451', panel: { skillLevelBonus: 0, hp: 8000 } },
      { slot: 1, agentId: '1051', panel: { hp: 4000 } },
    ]
    luciaElowenMechanic.applyTeamConfig!(teamInput({
      slot: 0, characters: chars, settings: { 'lucia.healingCoverage': 0.5 },
    }))
    // 12级终结技 → 12.8%/大；× 0.5 覆盖 × (8000/4000)
    const expected = 12.8 * 0.5 * (8000 / 4000)
    expect(chars[1].yidhariExternalHealPerUltPct).toBeCloseTo(expected, 10)

    const noYidhari: any[] = [{ slot: 0, agentId: '1451', panel: { skillLevelBonus: 0, hp: 8000 } }]
    luciaElowenMechanic.applyTeamConfig!(teamInput({ slot: 0, characters: noYidhari }))
    expect(noYidhari[0].yidhariExternalHealPerUltPct).toBeUndefined()
  })

  it('settings 缺省时用注册默认（c4=1 / healing=0.5）——与 getMechanicSetting(id, default) 等价', () => {
    const chars: any[] = [
      { slot: 0, agentId: '1451', panel: { skillLevelBonus: 0, hp: 8000 } },
      { slot: 1, agentId: '1051', panel: { hp: 8000 } },
    ]
    luciaElowenMechanic.applyTeamConfig!(teamInput({ slot: 0, characters: chars, cinemaLevel: 4, settings: {} }))
    expect(chars[0].luciaC4CurtainCoverage).toBe(1)
    expect(chars[1].yidhariExternalHealPerUltPct).toBeCloseTo(12.8 * 0.5 * 1, 10)
  })
})

describe('轴窗口覆盖钩子（原四个 findIndex computed）', () => {
  const axis = (actions: any[]) => [{ name: '轴1', actions }]
  const skills = { categories: [{ id: 'basic', moves: [{ id: 'b1' }, { id: 'b2' }] }] }
  const overlayInput = (o: Record<string, unknown>) => ({
    slot: 0, axes: [], cinemaLevel: 0, getAgentSkills: () => skills, ...o,
  } as never)

  it('般岳明王：无轴不参与；有轴按二连块窗口加权；C6 满覆盖 → 空表不参与', () => {
    expect(banyueMechanic.axisWindowOverlays!(overlayInput({ axes: [] }))).toBeNull()
    const axes = axis([
      { slot: 0, moveId: 'banyue-combo', count: 1, startTime: 0 },
      { slot: 0, moveId: '1471010', count: 1, startTime: 2 },  // 窗内
    ])
    const res: any = banyueMechanic.axisWindowOverlays!(overlayInput({ axes }))
    expect(res.banyueMingwangStacks.get('1471010')).toBe(2)
    // C6：computeBanyueMingwangStacks 直接返回空 → 钩子按「空表 = 不参与」返 null
    expect(banyueMechanic.axisWindowOverlays!(overlayInput({ axes, cinemaLevel: 6 }))).toBeNull()
  })

  it('仪玄凝神：终结技块开 15s 窗；触发块自身不享受；无轴不参与', () => {
    expect(yixuanMechanic.axisWindowOverlays!(overlayInput({ axes: [] }))).toBeNull()
    const axes = axis([
      { slot: 0, moveId: '1371014', count: 1, startTime: 0 },
      { slot: 0, moveId: '1371009', count: 1, startTime: 3 },
    ])
    const res: any = yixuanMechanic.axisWindowOverlays!(overlayInput({ axes }))
    expect(res.yixuanNingshenMap.get('1371009').critDmg).toBe(40)
    expect(res.yixuanNingshenMap.has('1371014')).toBe(false)
  })

  it('佩洛伊斯阳炎：上分支开 21s 窗，仅上分支/决算受益；无轴不参与', () => {
    expect(peiluoProminenceMechanic.axisWindowOverlays!(overlayInput({ axes: [] }))).toBeNull()
    const axes = axis([
      { slot: 0, moveId: '1551015', count: 1, startTime: 0 },
      { slot: 0, moveId: '1551016', count: 1, startTime: 5 },
    ])
    const res: any = peiluoProminenceMechanic.axisWindowOverlays!(overlayInput({ axes }))
    expect(res.peiluoKagerouMap.get('1551016')).toBe(40)
  })

  it('可琳扫除帮手：轴内招式 +35%，普攻段归并到 basic_attack 聚合行键；无轴不参与', () => {
    expect(corinMechanic.axisWindowOverlays!(overlayInput({ axes: [] }))).toBeNull()
    const axes = axis([
      { slot: 0, moveId: 'b1', count: 1, startTime: 0 },       // 倍率表 basic 段 → 归并
      { slot: 0, moveId: '1061009', count: 1, startTime: 1 },  // 非 basic → 原键
    ])
    const res: any = corinMechanic.axisWindowOverlays!(overlayInput({ axes }))
    expect(res.corinStunBonusMap.get('basic_attack')).toBe(35)
    expect(res.corinStunBonusMap.get('1061009')).toBe(35)
    expect(res.corinStunBonusMap.has('b1')).toBe(false)
  })
})
