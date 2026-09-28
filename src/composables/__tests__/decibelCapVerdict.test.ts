/**
 * R65-J1 首案裁决（2026-09-22，会话 mcp-r65j1）：橘福福(1391) 额外能力·八面威风之
 * 「队伍喧响上限 +1000」在**当前整局总量口径下零消费者**——「不做」是正确口径决策，不是缺陷。
 * 证据链全文：docs/mcp-r65j1-decibel-cap-verdict.md。
 *
 * 证据链（全部 2026-09-22 实测）：
 * 1. 整局总量口径：`ultimateCount = Math.floor(decibels[i] / cfg.ultimateCost)`
 *    （src/core/resource/helpers.ts:391/605）——无上限项；`ultimateCost` 是**角色级消耗**
 *    （默认 3000、佩洛伊斯 2000），上限字段不存在。
 * 2. 全仓**没有**喧响上限建模。原先唯一的建模 `simulateDecibelTrack`（src/core/resourceTrack.ts，
 *    时间轴喧响轨原型，生产零调用点）属于已否决的方向 A（事件时间轴），已于 CC-187 删除。
 * 3. +300/ult 那一半**已接**：`jufufuTigerRoarMechanic.applyTeamConfig`（build 相位）给
 *    队伍全体强攻/命破角色（含自身）写 `extraSelfDecibelPerUltimate=300`，消费点
 *    src/core/resource/helpers.ts:327 + resourceIncome.ts:281。
 * 4. 门控语义：`evalTeamConditions` **自身不算**（teamCondition.ts `m.slot === ownSlot → false`）
 *    ⇒ 1391 自身命破不触发额外能力，需队友中有强攻/命破。
 *
 * ★ 本文件是「未来闸门」：闸门 = 上面「大招次数 = floor(总喧响/ultimateCost)」那条行为判据。
 * 谁引入喧响上限口径，它就会红——届时先裁决角色级喧响上限口径（1391 +1000 及其同类），
 * 换成新口径判据并更新 1391.json note（步骤见 docs/mcp-r65j1-decibel-cap-verdict.md §4）。
 * （原「形状面」字符串判据随 CC-187 删除：它看守的 simulateDecibelTrack 已不存在。）
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { ULTIMATE_COST_DEFAULT } from '@/core/resource'
import { jufufuTigerRoarMechanic } from '@/mechanics/agents/specPanelBuffs'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { getAgentSpec } from '@/specs/registry'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

function teamChar(slot: number, agentId: string, cinemaLevel = 0, overrides: Record<string, unknown> = {}) {
  return {
    slot,
    agentId,
    cinemaLevel,
    wEngineId: '',
    wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {} as any, subStatAllocation: {} },
    parryCount: 6,
    blockCount: 0,
    dodgeCounterCount: 10,
    quickAssistCount: 3,
    chainCountPerStun: 1,
    basicAttackTimeWeight: 1,
    ...overrides,
  }
}

describe('R65-J1 裁决：喧响上限 +1000 在整局总量口径下零消费者（1391 额外能力·八面威风）', () => {
  it('门控语义：自身（命破）不算「队伍有强攻/命破」；队友中有强攻/命破才触发', () => {
    const spec = getAgentSpec('1391')!
    expect(spec.additionalAbility?.teamConditions, '前提：1391 spec 声明了 teamConditions').toBeTruthy()
    const mk = (slot: number, agentId: string, specialty: string) =>
      ({ slot, agentId, agent: { id: agentId, specialty } }) as any
    // 1391 自身命破 + 支援/防御两名 ⇒ 门控关（自身不算）
    const off = [mk(0, '1391', 'rupture'), mk(1, '1451', 'support'), mk(2, '1121', 'defense')]
    expect(evalAdditionalAbility(off, 0, { id: '1391' } as any, spec.additionalAbility!)).toBe(false)
    // 比利(1081，强攻)在队 ⇒ 门控开
    const on = [mk(0, '1391', 'rupture'), mk(1, '1081', 'attack'), mk(2, '1451', 'support')]
    expect(evalAdditionalAbility(on, 0, { id: '1391' } as any, spec.additionalAbility!)).toBe(true)
  })

  it('行为面：+300/ult 通道活着（唯一已接的一半）——build 钩子给全体强攻/命破角色（含自身）300；门控关时无人得', () => {
    const team = [
      { slot: 0, agentId: '1391', agent: { specialty: 'rupture' } },
      { slot: 1, agentId: '1081', agent: { specialty: 'attack' } },
      { slot: 2, agentId: '1451', agent: { specialty: 'support' } },
    ] as any
    const mkCfg = (slot: number, active: number) => ({ slot, panel: { additionalAbilityActive: active } }) as any
    const on = [mkCfg(0, 1), mkCfg(1, 0), mkCfg(2, 0)]
    jufufuTigerRoarMechanic.applyTeamConfig!({ cfg: on[0], phase: 'build', characters: on, team } as any)
    expect(on[0].extraSelfDecibelPerUltimate).toBe(300) // 1391 自身命破——原文「该角色获得 300 点」含自身
    expect(on[1].extraSelfDecibelPerUltimate).toBe(300) // 1081 强攻
    expect(on[2].extraSelfDecibelPerUltimate).toBeUndefined() // 1451 支援不得
    const off = [mkCfg(0, 0), mkCfg(1, 0), mkCfg(2, 0)]
    jufufuTigerRoarMechanic.applyTeamConfig!({ cfg: off[0], phase: 'build', characters: off, team } as any)
    for (const c of off) expect(c.extraSelfDecibelPerUltimate).toBeUndefined()
  })

  it('行为面：converge 相位把全队终结总次数递给 1391（C2 威势通道）；≤0 写 undefined（不覆盖 build 初值）', () => {
    const cfgOn = { slot: 0 } as any
    jufufuTigerRoarMechanic.applyTeamConfig!({ cfg: cfgOn, phase: 'converge', characters: [cfgOn], team: [], threads: { teamUltimateForJufufu: 7 } } as any)
    expect(cfgOn.jufufuTeamUltimateCount).toBe(7)
    const cfgZero = { slot: 0, jufufuTeamUltimateCount: 3 } as any
    jufufuTigerRoarMechanic.applyTeamConfig!({ cfg: cfgZero, phase: 'converge', characters: [cfgZero], team: [], threads: { teamUltimateForJufufu: 0 } } as any)
    expect(cfgZero.jufufuTeamUltimateCount).toBeUndefined() // 消费端 `??` 回落 build 初值
  })

  it('行为面：整局总量口径钉死——大招次数 = floor(总喧响/ultimateCost)，无上限项（真管线 1391+1081+1451）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs() // 就绪门：teammate-buffs 未加载时 resourceConfig 为 null
    const config = useConfigStore()
    config.team[0] = teamChar(0, '1391', 0)
    config.team[1] = teamChar(1, '1081', 0)
    config.team[2] = teamChar(2, '1451', 0)

    const calc = useResourceCalc()
    const out = calc.resourceResult.value!
    expect(out).not.toBeNull()
    for (const c of out.characters) {
      // 好评转大（source='gift'）白送终结技、不耗喧响，先剔除再对齐口径（与 decibelUltimateCount.test.ts 同源）
      const giftUlt = (c.executions ?? []).reduce(
        (s, e) => s + (((e as any).source === 'gift' ? e.count : 0) ?? 0), 0,
      )
      expect(
        Math.abs((c.ultimateCount - giftUlt) - Math.floor(c.decibelSource.total / ULTIMATE_COST_DEFAULT)),
        `${c.agentId}: 大招次数必须 = floor(总喧响/ultimateCost)（无上限项；若未来引入 cap 口径本条会红 = 需先裁决角色级上限）`,
      ).toBeLessThanOrEqual(1)
    }
  })
})
