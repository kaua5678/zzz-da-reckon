/**
 * 减防通道归属回归 —— 蕾米埃尔「影画二 15%」与菲欧妮「影画六 40%」（2026-10-31）。
 *
 * 背景：外部战斗日志（zzz.analytics.moe combat-log/2，29 份 CNBetaWin3.4.1）从 `effective_def` 反算出
 * 一条独立减防通道 `DefenceRatio`，来源标注为 `Remielle_Talent02_TeamModifier`(−15%) 与
 * `Pheony_Talent_04 (default modifier)`(−40%)。仓内 grep `DefenceRatio` 零命中 ⇒ 曾疑「漏建模」。
 *
 * **结论：两条都已建模，且各自落在正确通道上**；日志的 Talent 标号与游戏影画号不一致，不能拿标号当依据：
 *  - 蕾米埃尔 **影画二「倾落喧嚣」**（原文 `talent/2`）：「队伍中[异常]角色对[幻色]效果下的敌人造成
 *    属性异常伤害时，无视目标15%的防御力」⇒ `teammate-buffs` `1581.cinema_2.prismatic_anomaly_def_ignore`
 *    → `enemyAnomalyDefReduction: 15`（**异常专用**通道，不进直伤；蕾米本人也吃，原文「队伍中[异常]角色」含自己）。
 *  - 菲欧妮 **影画六**「菲欧妮触发的[异放]效果无视敌人40%防御力」⇒ `phoenix.ts#phoenixReleaseModifier`
 *    → `releaseModifier`（**异放限定、self 作用域**，不挂面板）。原文**影画四**只有「额外触发一次异放、固定
 *    600% 倍率」，**没有任何减防**；40% 在原文里唯一命中影画六。
 *
 * 本用例锁的是**通道归属与作用域**，不是复述数值写法：把 15% 挪到 `enemyDefReduction`（直伤也吃）、
 * 把 40% 挪到面板或改成 `releaseModifierScope: 'team'`（队友异放也吃）、或按日志标号把 40% 挂到影画四，这里都会红。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { releaseModifierSelf } from '@/composables/resourceCalc/damagePool'
import { calcAnomalyDamage } from '@/core/damage'
import { emptyPanel } from '@/core/panel'
import { phoenixMechanic, PHOENIX_C6_RELEASE_DEF_IGNORE } from '@/mechanics/agents/phoenix'

const REMIELLE_C2_ANOMALY_DEF_IGNORE_BUFF = '1581.cinema_2.prismatic_anomaly_def_ignore'

/** 3 异常队（蕾米 + 维琳娜 + 柏妮思）：蕾米额外能力 tier=3，队里另两人都是[异常]角色 */
async function setupRemielle(cinemaLevel: number) {
  const result = await setupHarness([
    { agentId: '1581', cinemaLevel, parryCount: 0, dodgeCounterCount: 0 },
    { agentId: '1561', parryCount: 0, dodgeCounterCount: 0 },
    { agentId: '1171', parryCount: 0, dodgeCounterCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

/** 菲欧妮队（火异常 + 双[异常]队友，额外能力门控满足） */
async function setupPhoenix(cinemaLevel: number) {
  const result = await setupHarness([
    { agentId: '1641', cinemaLevel, parryCount: 0, dodgeCounterCount: 0 },
    { agentId: '1561', parryCount: 0, dodgeCounterCount: 0 },
    { agentId: '1171', parryCount: 0, dodgeCounterCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('减防通道归属：蕾米影画二 15%（异常专用）· 菲欧妮影画六 40%（异放限定）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('蕾米影画二 15%：只进 enemyAnomalyDefReduction，不进 enemyDefReduction（直伤不得吃）', async () => {
    const { config, catalog } = await setupRemielle(2)
    const self = computePanelPhases(0, config, catalog)!.inCombat
    expect(self.enemyAnomalyDefReduction).toBeCloseTo(15, 5)
    // 原文限定「造成属性异常伤害时」⇒ 通用减防通道必须保持 0，否则直伤被高估
    expect(self.enemyDefReduction).toBeCloseTo(0, 5)
    // 原文「队伍中[异常]角色」⇒ 异常队友同样吃（无 excludeTargetAgentIds）
    const mate = computePanelPhases(1, config, catalog)!.inCombat
    expect(mate.enemyAnomalyDefReduction).toBeCloseTo(15, 5)
    expect(mate.enemyDefReduction).toBeCloseTo(0, 5)
  })

  it('蕾米影画二：C0 无此效果（命座门控）；C2 关掉该 buff 后归零', async () => {
    const c0 = await setupRemielle(0)
    expect(computePanelPhases(0, c0.config, c0.catalog)!.inCombat.enemyAnomalyDefReduction).toBeCloseTo(0, 5)

    const c2 = await setupRemielle(2)
    c2.config.toggleTeammateBuff(REMIELLE_C2_ANOMALY_DEF_IGNORE_BUFF, false)
    expect(computePanelPhases(0, c2.config, c2.catalog)!.inCombat.enemyAnomalyDefReduction).toBeCloseTo(0, 5)
  })

  it('蕾米影画二 15% 真的进异常结算：差分 = 防御区比值 794/(794+def×0.85) ÷ 794/(794+def)', () => {
    const base = { ...emptyPanel(), atk: 1000, anomalyProficiency: 100 }
    const run = (panel: typeof base) => calcAnomalyDamage({
      panel, element: 'fire', baseMultiplier: 100, enemyDefense: 953,
      enemyDefReduction: 0, enemyDefFlatReduction: 0, enemyResistance: 0, enemyResReduction: 0,
    }).damage
    const off = run(base)
    const on = run({ ...base, enemyAnomalyDefReduction: 15 })
    const expected = (794 / (794 + 953 * 0.85)) / (794 / (794 + 953))
    expect(on / off).toBeCloseTo(expected, 9)
    // 反向：把它误挂到通用减防通道，差异必须可分辨（防「两条通道等价」的错口径）
    const wrongChannel = run({ ...base, enemyDefReduction: 15 })
    expect(wrongChannel).toBeCloseTo(on, 9) // 异常结算里两通道同区加算 ⇒ 数值相同…
    expect((wrongChannel / off)).toBeCloseTo(expected, 9) // …但直伤侧完全不同，见上一条用例
  })

  it('菲欧妮影画六 40%：只走 releaseModifier 且为 self 作用域（不挂面板、不给队友异放）', async () => {
    const { config } = await setupPhoenix(6)
    const self = releaseModifierSelf(phoenixMechanic, config.team, [])
    expect(phoenixMechanic.releaseModifier!({ self }).enemyDefReduction)
      .toBeCloseTo(PHOENIX_C6_RELEASE_DEF_IGNORE, 5)
    expect(PHOENIX_C6_RELEASE_DEF_IGNORE).toBe(40)
    // 缺省（未声明释放作用域）= self ⇒ 只有菲欧妮自己的异放行吃；声明 'team' 会让队友异放白吃 40%
    expect(phoenixMechanic.releaseModifierScope ?? 'self').toBe('self')
  })

  it('菲欧妮影画六：C0 不产生减防；C6 面板 enemyDefReduction 仍为 0（40% 不得串到直伤/标准异常）', async () => {
    const c0 = await setupPhoenix(0)
    expect(phoenixMechanic.releaseModifier!({ self: releaseModifierSelf(phoenixMechanic, c0.config.team, []) }).enemyDefReduction ?? 0)
      .toBeCloseTo(0, 5)
    expect(computePanelPhases(0, c0.config, c0.catalog)!.inCombat.enemyDefReduction).toBeCloseTo(0, 5)

    const c6 = await setupPhoenix(6)
    expect(computePanelPhases(0, c6.config, c6.catalog)!.inCombat.enemyDefReduction).toBeCloseTo(0, 5)
  })


  it('蕾米影画二 15% 只给[异常]角色（原文「队伍中[异常]角色」）：击破/支援队友不吃', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1581', cinemaLevel: 2, parryCount: 0, dodgeCounterCount: 0 },
      { agentId: '1511', parryCount: 0, dodgeCounterCount: 0 }, // 南宫羽 = 击破
      { agentId: '1411', parryCount: 0, dodgeCounterCount: 0 }, // 柚叶 = 支援
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const self = computePanelPhases(0, config, catalog)!.inCombat
    expect(self.enemyAnomalyDefReduction, '蕾米本人是[异常]，照吃').toBeCloseTo(15, 5)
    for (const slot of [1, 2]) {
      const mate = computePanelPhases(slot, config, catalog)!.inCombat
      expect(mate.enemyAnomalyDefReduction, `槽 ${slot} 非[异常]特化不得吃这 15%`).toBeCloseTo(0, 5)
    }
  })

  it('原文影画四不含减防（防按日志 Talent_04 标号反推）：C4 蕾米的减防仍只来自影画二的 15%', async () => {
    const c4 = await setupRemielle(4)
    const panel = computePanelPhases(0, c4.config, c4.catalog)!.inCombat
    expect(panel.enemyAnomalyDefReduction).toBeCloseTo(15, 5)
    expect(panel.enemyDefReduction).toBeCloseTo(0, 5)

    const phoenixC4 = await setupPhoenix(4)
    expect(phoenixMechanic.releaseModifier!({ self: releaseModifierSelf(phoenixMechanic, phoenixC4.config.team, []) }).enemyDefReduction ?? 0)
      .toBeCloseTo(0, 5)
  })
})
