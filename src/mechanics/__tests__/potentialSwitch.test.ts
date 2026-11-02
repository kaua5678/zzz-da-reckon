/**
 * 潜能开关（2026-11-01 用户口径）+ 1391/1331 v2 潜能激发录入判据。
 *
 * 口径：潜能 = 「档位（potentialLevel 1..6）」× 「开关（potentialEnabled 布尔）」两维。
 * - 关掉开关 ⇒ 消费侧 effective level 恒 I 档（无觉醒），**档位保留**（旧角色关再开回原档）；
 * - 开关只在**声明** \`AgentMechanicModule.potentialSwitch\` 的角色露 UI（1391/1331）；
 *   老角色（11号 1041 等）不声明 ⇒ 无开关、行为逐位不变（用户：「11号这种老角色的就不用加开关了」）。
 *
 * 数据来源 = v2 测试服 \`3.4.2+20052336\`（nanoka \`zzz.new.character\` 点名 1331/1391）：
 * raw 已刷新到该构建，\`potential_detail\` II~VI 同文（用户：「后面可能微调数值」）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { effectivePotentialLevelOf, potentialEnabledOf } from '@/data/potentialLevel'
import { getAgentMechanic } from '@/mechanics'
import { getAgentSpec } from '@/specs/registry'
import {
  VIVIAN_LUOYU_MOVE_ID,
  VIVIAN_XUANLUO_MOVE_ID,
  VIVIAN_POTENTIAL_BUILDUP_EFF,
  VIVIAN_POTENTIAL_MASTERY,
  VIVIAN_POTENTIAL_RELEASE_BONUS,
  vivianMechanic,
} from '@/mechanics/agents/vivian'
import { JUFUFU_POTENTIAL_STUN_BUILDUP, jufufuTigerRoarMechanic } from '@/mechanics/agents/specPanelBuffs'

/**
 * 原始证据：1391 的 v2 包已进正主 raw（无新增招式）；1331 的 v2 包含 catalog 未收录的新招
 * （1331022/1331024，"招式伤害属性对账"会报 orphan）⇒ 只作**版本化证据**，正主 raw 仍是 live 包。
 */
const V2_RAW: Record<string, string> = {
  '1331': '../../../data/raw/nanoka_1331_v2_zh_3.4.2+20052336.json',
}
const RAW = (id: string) => JSON.parse(readFileSync(
  new URL(V2_RAW[id] ?? `../../../data/raw/nanoka_missing/full/${id}.json`, import.meta.url), 'utf8',
)) as { potential_detail: Record<string, { level: number; desc?: string; name?: string }> }

const strip = (s: string) => s.replace(/<[^>]+>/g, '')

/** II~VI 原文（按 level 索引），断言「各档同文」与关键数字。 */
function potentialTexts(id: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const v of Object.values(RAW(id).potential_detail)) {
    if (v.desc) map.set(v.level, strip(v.desc))
  }
  return map
}

/** 真管线单臂：读槽 0 面板（每次独立 setupHarness，不许复用响应式快照）。 */
async function arm(team: Array<Record<string, unknown> | ''>, offSlot?: number) {
  const { config } = await setupHarness(team as never)
  if (offSlot !== undefined) config.team[offSlot].potentialEnabled = false
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 0))
  return { config, panel0: (calc.panels.value?.[0] ?? {}) as unknown as Record<string, number>, damage: Number(calc.teamTotalDamage.value ?? 0) }
}

describe('潜能开关 · 归一口（档位 × 开关两维）', () => {
  it('potentialEnabledOf：缺省 true（历史角色行为不变），只有显式 false 才算关', () => {
    expect(potentialEnabledOf(undefined)).toBe(true)
    expect(potentialEnabledOf(null)).toBe(true)
    expect(potentialEnabledOf(true)).toBe(true)
    expect(potentialEnabledOf(false)).toBe(false)
    expect(potentialEnabledOf('false')).toBe(false)
  })

  it('effectivePotentialLevelOf：关掉 ⇒ 恒 I 档，**档位本身保留**', () => {
    expect(effectivePotentialLevelOf(6, true)).toBe(6)
    expect(effectivePotentialLevelOf(2, undefined)).toBe(2)
    expect(effectivePotentialLevelOf(6, false)).toBe(1)
    expect(effectivePotentialLevelOf(undefined, undefined)).toBe(6)
  })

  it('声明面：只有 1391/1331 露开关；老角色（1041/1191/1141）不声明 = 行为逐位不变', () => {
    expect(getAgentMechanic('1391')?.potentialSwitch).toBe(true)
    expect(getAgentMechanic('1331')?.potentialSwitch).toBe(true)
    expect(getAgentMechanic('1041')?.potentialSwitch).toBeUndefined()
    expect(getAgentMechanic('1191')?.potentialSwitch).toBeUndefined()
    expect(getAgentMechanic('1141')?.potentialSwitch).toBeUndefined()
  })

  it('缺省开关 = 开（setAgent 模板）；关掉不改档位', async () => {
    const { config } = await setupHarness([{ agentId: '1041' }, '', ''] as never)
    // 夹具 TEST_BASE_CHAR 不声明该字段（生产 defaultCharacter 声明 true）⇒ 断言**缺省语义 = 开**
    expect(potentialEnabledOf(config.team[0].potentialEnabled)).toBe(true)
    expect(config.team[0].potentialLevel).toBe(6)
    config.setPotentialEnabled(0, false)
    expect(config.team[0].potentialEnabled).toBe(false)
    expect(config.team[0].potentialLevel, '关开关不得毁掉档位').toBe(6)
  })
})

describe('v2 原文出处（1391/1331 潜能 II~VI 同文）', () => {
  it('1391 潜能觉醒·侠肝义胆：连携/终结 10%/30% + 虎威失衡 50% + 失衡易伤 25%', () => {
    const texts = potentialTexts('1391')
    expect([...texts.keys()].sort()).toEqual([2, 3, 4, 5, 6])
    const distinct = new Set(texts.values())
    expect(distinct.size, 'II~VI 应同文（v2 占位口径）').toBe(1)
    const t = texts.get(2)!
    expect(t).toContain('最终伤害提升10%/30%')
    expect(t).toContain('失衡提升50%')
    expect(t).toContain('失衡易伤倍率提升25%')
  })

  it('1331 潜能觉醒·星月诗篇：落羽生花积蓄 50% + 异常掌控 30 + 异放 50%', () => {
    const texts = potentialTexts('1331')
    const distinct = new Set(texts.values())
    expect(distinct.size).toBe(1)
    const t = texts.get(2)!
    expect(t).toContain('异常积蓄效率提升50%')
    expect(t).toContain('异常掌控提升30点')
    expect(t).toContain('伤害提升50%')
  })
})

describe('1331 潜能：开关差分（面板通道量）', () => {
  it('开 minus 关 = 异常掌控 +30 / 异放专用独立增伤 +50（积蓄 +50 走行级、不在面板）', async () => {
    const on = await arm([{ agentId: '1331' }, { agentId: '1211' }, ''])
    const off = await arm([{ agentId: '1331' }, { agentId: '1211' }, ''], 0)
    expect((on.panel0.anomalyMastery ?? 0) - (off.panel0.anomalyMastery ?? 0)).toBeCloseTo(VIVIAN_POTENTIAL_MASTERY, 6)
    expect((on.panel0.anomalyReleaseDmgBonus ?? 0) - (off.panel0.anomalyReleaseDmgBonus ?? 0)).toBeCloseTo(VIVIAN_POTENTIAL_RELEASE_BONUS, 6)
    // 招式限定的积蓄 +50 不得进元素面板（那会波及悬落等以太招）
    expect(on.panel0.etherAnomalyBuildUpEfficiency ?? 0).toBe(off.panel0.etherAnomalyBuildUpEfficiency ?? 0)
  })

  it('落羽生花行级积蓄 +50%（招式限定；悬落不吃；关开关归零）', () => {
    const st = (moveId: string, pot: number) => {
      const anomalyExecs = [{ moveId, count: 1, baseBuildUp: 100, element: 'ether', slot: 0, moveName: 'x' }]
      vivianMechanic.transformSkillExecutions!({ anomalyExecs, potentialLevel: pot } as never)
      return (anomalyExecs[0] as { buildUpEfficiencyBonusPct?: number }).buildUpEfficiencyBonusPct ?? 0
    }
    expect(st(VIVIAN_LUOYU_MOVE_ID, 6)).toBe(VIVIAN_POTENTIAL_BUILDUP_EFF)
    expect(st(VIVIAN_XUANLUO_MOVE_ID, 6), '悬落不吃招式限定积蓄').toBe(0)
    expect(st(VIVIAN_LUOYU_MOVE_ID, 1)).toBe(0)
  })
})

describe('1391 潜能：招式级失衡 +50%（exec 通道，招式限定）', () => {
  const stunOf = (moveId: string, potentialLevel: number) => {
    const executions = [{ moveId, count: 1 }] as never[]
    jufufuTigerRoarMechanic.patchExecutions!({ cfg: { panel: { potentialLevel } }, executions } as never)
    return (executions[0] as { stunBuildUpBonus?: number }).stunBuildUpBonus ?? 0
  }

  it('虎威 1391005 与 山君鼎戏·「虎威」1391022 各 +50；其他招（旋转 1391010）不吃', () => {
    expect(stunOf('1391005', 6)).toBe(JUFUFU_POTENTIAL_STUN_BUILDUP)
    expect(stunOf('1391022', 6)).toBe(JUFUFU_POTENTIAL_STUN_BUILDUP)
    expect(stunOf('1391010', 6)).toBe(0)
  })

  it('无潜能（effective level 1）⇒ 招式级失衡归零', () => {
    expect(stunOf('1391005', 1)).toBe(0)
    expect(stunOf('1391022', 1)).toBe(0)
  })

  it('开关差分（端到端）：1391 在队时关掉潜能 ⇒ 最终伤害乘区/失衡/易伤三条一起归零，总伤下降', async () => {
    const on = await arm([{ agentId: '1391' }, { agentId: '1181' }, { agentId: '1211' }])
    const off = await arm([{ agentId: '1391' }, { agentId: '1181' }, { agentId: '1211' }], 0)
    expect(on.damage).toBeGreaterThan(0)
    expect(on.damage, '关潜能 ⇒ 1391 总伤下降').toBeGreaterThan(off.damage)
  })

  it('spec teamBuffs 的两条潜能 buff：连携 +10 / 终结 +30 / 失衡易伤 +25，均经 potentialLevel formula 通道', () => {
    const buffs = (getAgentSpec('1391')?.teamBuffs ?? []) as Array<{ id: string; effects?: Array<Record<string, any>> }>
    const byAggId = new Map<string, Record<string, any>>()
    for (const b of buffs) for (const e of (b.effects ?? [])) byAggId.set(String(e.id), e)
    expect(byAggId.get('jufufu-potential-chain-dmg')?.stat, '最终伤害是独立乘区，不是 skillDmgBonus').toBe('finalDmgBonus')
    expect(byAggId.get('jufufu-potential-chain-dmg')?.formula?.expression).toBe('min(1, max(0, x - 1)) * 10')
    expect(byAggId.get('jufufu-potential-chain-dmg')?.targetSkillType).toBe('chain')
    expect(byAggId.get('jufufu-potential-ult-dmg')?.stat).toBe('finalDmgBonus')
    expect(byAggId.get('jufufu-potential-ult-dmg')?.formula?.expression).toBe('min(1, max(0, x - 1)) * 30')
    expect(byAggId.get('jufufu-potential-ult-dmg')?.targetSkillType).toBe('ultimate')
    expect(byAggId.get('jufufu-potential-stun-vuln')?.stat).toBe('stunDmgMultiplierBonus')
    expect(byAggId.get('jufufu-potential-stun-vuln')?.formula?.expression).toBe('min(1, max(0, x - 1)) * 25')
  })
})
