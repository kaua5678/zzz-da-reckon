/**
 * 知更鸟（1661）离场守护·全队固定防御 + 登场值循环的判据（2026-10-25）。
 *
 * 判据四臂（用户 2026-10-25 交付要求 + spec 1661.json notes 点名）：
 *   ① HP < 16000 ⇒ 0；② 每满 1000 一档；③ 封顶；④ Buff 强化点 ×1.25。
 * 外加：模块接线面（sourcePanels 真读知更鸟局外生命 → 全队 inCombatDefFlat），
 * 以及登场值循环（追击 +20 / 上限 120 / ≥100 触发登场技）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { emptyPanel } from '@/core/panel'
import { panelAt } from '@/core/panel'
import {
  robinGuardDefBonus,
  solveRobinEntry,
  ROBIN_DEF_HP_THRESHOLD,
  ROBIN_ENTRY_MAX,
  ROBIN_ENTRY_PER_AFTERSHOCK,
  ROBIN_AFTERSHOCK_CD_SECONDS,
} from '@/mechanics/agents/robin'

describe('1661 知更鸟 · 离场守护防御（纯函数四臂）', () => {
  it('① HP < 16000 ⇒ 0（含恰好 16000）', () => {
    expect(robinGuardDefBonus({ hp: 10330.787, buffPointActive: false })).toBe(0)
    expect(robinGuardDefBonus({ hp: ROBIN_DEF_HP_THRESHOLD, buffPointActive: false })).toBe(0)
    // 负控：跨过门槛一档就该有值（否则上两行可能因公式恒 0 而假绿）
    expect(robinGuardDefBonus({ hp: ROBIN_DEF_HP_THRESHOLD + 1000, buffPointActive: false })).toBe(80)
  })

  it('② 每满 1000 一档（Lv12 = 每档 80，余数不足一档不计）', () => {
    expect(robinGuardDefBonus({ hp: 17000, buffPointActive: false })).toBe(80)
    expect(robinGuardDefBonus({ hp: 17999.9, buffPointActive: false })).toBe(80)
    expect(robinGuardDefBonus({ hp: 18000, buffPointActive: false })).toBe(160)
    expect(robinGuardDefBonus({ hp: 20500, buffPointActive: false })).toBe(320)
  })

  it('③ 封顶 800（Lv12；更低的技能等级上限按 440 + 30Lv 一起降）', () => {
    expect(robinGuardDefBonus({ hp: 26000, buffPointActive: false })).toBe(800)
    expect(robinGuardDefBonus({ hp: 40000, buffPointActive: false })).toBe(800)
    // 技能等级 1：每档 47、上限 470 —— 两处都随等级变（原文两个 CAL 各自含 AvatarSkillLevel）
    expect(robinGuardDefBonus({ hp: 40000, buffPointActive: false, skillLevel: 1 })).toBe(470)
  })

  it('④ Buff 强化点 ×1.25（作用在已封顶的量上）', () => {
    expect(robinGuardDefBonus({ hp: 18000, buffPointActive: true })).toBeCloseTo(200, 6)
    expect(robinGuardDefBonus({ hp: 40000, buffPointActive: true })).toBeCloseTo(1000, 6)
    // 门槛以下仍然 0（×1.25 不能把 0 放大出值）
    expect(robinGuardDefBonus({ hp: 15000, buffPointActive: true })).toBe(0)
  })
})

// ⚠ 追击由「队伍中**其他**操作中的角色命中」触发 ⇒ 单人队 0 次（`teammateFrontlineSeconds` = 0）
const WITH_MATE = { teammateFrontlineSeconds: 100 }

describe('1661 知更鸟 · 登场值循环（追击 +20 / 上限 120 / ≥100 触发登场技）', () => {
  it('无队友（Σ 队友前台 = 0）⇒ 追击 0 次、登场技 0 次（原文「队伍中其他操作中的角色」）', () => {
    expect(solveRobinEntry({ combatTime: 180 })).toEqual({ aftershockCount: 0, entryValue: 0, entrySkillCount: 0 })
    expect(solveRobinEntry({ combatTime: 180, teammateFrontlineSeconds: 0 }).aftershockCount).toBe(0)
  })
  it('追击次数 = floor(有效战斗时间 / 8)；每 5 次追击触发 1 次登场技', () => {
    const none = solveRobinEntry({ combatTime: ROBIN_AFTERSHOCK_CD_SECONDS - 0.001, ...WITH_MATE })
    expect(none).toEqual({ aftershockCount: 0, entryValue: 0, entrySkillCount: 0 })
    const one = solveRobinEntry({ combatTime: 40, ...WITH_MATE })
    expect(one.aftershockCount).toBe(5)
    expect(one.entrySkillCount).toBe(1)
    expect(one.entryValue).toBe(0) // 5 × 20 = 100，正好消耗完
    const partial = solveRobinEntry({ combatTime: 8 * 4, ...WITH_MATE })
    expect(partial.aftershockCount).toBe(4)
    expect(partial.entryValue).toBe(80) // 不足 100 ⇒ 不触发
    expect(partial.entrySkillCount).toBe(0)
  })

  it('120 是「同时持有」上限、不是整局总量：长局仍按 5 次追击 1 次登场技线性累加', () => {
    const long = solveRobinEntry({ combatTime: 8 * 30, ...WITH_MATE })
    expect(long.aftershockCount).toBe(30)
    expect(long.entrySkillCount).toBe(6) // 600 点 / 100
    expect(long.entryValue).toBeLessThanOrEqual(ROBIN_ENTRY_MAX)
    // 反空洞：整局攒出的登场值总量（30 × 20 = 600）确实远超「同时持有」上限 120
    expect(long.aftershockCount * ROBIN_ENTRY_PER_AFTERSHOCK).toBeGreaterThan(ROBIN_ENTRY_MAX * 4)
  })
})

describe('1661 知更鸟 · 管线接线（sourcePanels → 全队 inCombatDefFlat）', () => {
  it('堆生命到 16000 以上时，全队每槽的 def 都涨；没堆时不动', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1661' }, { agentId: '1601' }, { agentId: '1101' }])
    const calc = useResourceCalc()
    const robinSlot = 0
    // 基线（白板局外生命 10330.787 < 16000 ⇒ 整条不生效）
    const baseline = [0, 1, 2].map(i => panelAt(calc.panels.value, i)?.def ?? 0)
    // 把知更鸟堆到 26000 局外生命：推荐主词条无法精确命中，直接改面板输入不可行 ⇒ 用驱动盘主词条 + 副词条
    const char = config.team[robinSlot]!
    char.driveDisc.mainStats = { ...char.driveDisc.mainStats, 5: 'hpPct' }
    char.driveDisc.subStatAllocation = { ...char.driveDisc.subStatAllocation, hpPct: 30, hpFlat: 20 }
    config.syncTeammateBuffsFromTeam()
    const after = [0, 1, 2].map(i => panelAt(calc.panels.value, i)?.def ?? 0)
    // 三槽都应按同一个固定值上涨（知更鸟本人也吃——原文「全队角色」）
    const deltas = after.map((d, i) => d - baseline[i])
    expect(new Set(deltas.map(d => Math.round(d * 1e6) / 1e6)).size, `逐槽防御增量应相同：${deltas.join(' / ')}`).toBe(1)
    expect(deltas[0]).toBeGreaterThan(0)
    void catalog
  }, 120000)

  it('直接派发 teamPanelEffects：源面板局外生命决定数值、缺省面板不加', async () => {
    await setupHarness([{ agentId: '1661' }, '', ''])
    const { getAgentMechanic } = await import('@/mechanics/registry')
    const mod = getAgentMechanic('1661')
    expect(mod?.teamPanelEffects).toBeTypeOf('function')
    const agent = (await import('@/stores/catalog')).useCatalogStore().getAgent('1661')!
    const panel = emptyPanel()
    const outOfCombat = emptyPanel()
    outOfCombat.hp = 20000 // 4 档 × 80 = 320
    const sourcePanels = { 0: { outOfCombat } }
    mod!.teamPanelEffects!({
      slot: 0, agent, cinemaLevel: 0, team: [{ slot: 0, agentId: '1661', agent, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }],
      targetSlot: 1, targetAgent: agent, panel, settings: { 'robin.buffPointActive': 1 },
      sourcePanels,
    })
    // 4 档 × 80 = 320，Buff 点 ×1.25 = 400
    expect(panel.def).toBeCloseTo(400, 6)
    // 负控：不在 sourcePanels 里 ⇒ 读不到生命 ⇒ 不加（不许编造默认值）
    const bare = emptyPanel()
    mod!.teamPanelEffects!({
      slot: 0, agent, cinemaLevel: 0, team: [], targetSlot: 1, targetAgent: agent, panel: bare,
      settings: { 'robin.buffPointActive': 1 },
    })
    expect(bare.def).toBe(0)
  }, 60000)
})
