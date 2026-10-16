/**
 * **本角色不用失衡内轴 ⇒ 它槽里的轴块一律丢弃**（T178，用户裁决 2026-10-16）。
 *
 * ## 用户裁决（逐字）
 *
 * > 「因为**我已经捏了他的3种强化状态的流程了**。**失衡次数是用来计数连携的**。
 * >   所以**她已经有自己的所谓爆发轴了**。**可以禁止她用失衡内的轴**」
 * > （追加）「完善的解决办法是给叶瞬光单独开一个**强化状态捏轴**，代替失衡捏轴。
 * >   但是我捏的 3 种轴已经很完善了，也懒得加功能，所以**直接禁止就行**，
 * >   也没人会在叶瞬光的队伍里捏失衡轴。」
 *
 * ## 本文件锁什么
 *
 * ① **引擎侧**：落在「声明 `axisExcluded` 的槽」里的轴块被丢弃（别人槽的块照常）；
 * ② **展示层**：`agentExcludedFromAxis` 对声明者为真、对其他角色为假；
 * ③ **没越权**：`axisHiddenMoves` 的角色（伊德海莉 `1051012`）**不受影响**
 *    —— 它有 6 处预设真捏着且有产出，**不能**被本判据连带丢弃；
 * ④ **反空洞**：轴里必须有**别的槽**的块仍在，否则「全丢」也能让 ① 变绿。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * 去掉 `roundInputs#isStaleAxisActionFor` 里那句 `if (own && getAgentMechanic(own)?.axisExcluded) return true`
 * ⇒ ① 红（她的块不再被丢）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { agentExcludedFromAxis } from '@/composables/agentMechanicView'

const YESHUGUANG = '1431'

function teamChar(slot: number, agentId: string, overrides: Record<string, number> = {}) {
  return {
    slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
    parryCount: 6, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1,
    basicAttackTimeWeight: 1, ...overrides,
  }
}

describe('T178 叶瞬光禁用失衡内轴（用户裁决「可以禁止她用失衡内的轴」）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('② 声明面：叶瞬光为真，其他角色（雨果/伊德海莉/般岳）为假', () => {
    expect(agentExcludedFromAxis(YESHUGUANG), '★ 叶瞬光必须声明 axisExcluded').toBe(true)
    for (const other of ['1291', '1051', '1471']) {
      expect(agentExcludedFromAxis(other), `${other} 不应被误禁`).toBe(false)
    }
    expect(agentExcludedFromAxis(null), '空槽不得为真').toBe(false)
  })

  it('① 引擎侧：她的轴块被丢弃，**别人槽的块照常**（含反空洞）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, YESHUGUANG) as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
    // 她的槽（0）+ 别人的槽（1）各放一块
    config.stunAxes = [{
      name: 'x', count: 2,
      actions: [
        { slot: 0, moveId: '1431027', count: 1 },
        { slot: 1, moveId: '1251015', count: 1 },
      ] as never,
      basicFillerSlot: 0,
    }]
    const ax = calc.effectiveStunAxes.value
    const placed = ax.flatMap(a => a.actions.map(x => `${x.slot}:${x.moveId}`))
    expect(placed.some(p => p.startsWith('0:')), '★ 叶瞬光槽里的块必须被丢弃').toBe(false)
    expect(placed.some(p => p.startsWith('1:')), '反空洞：别人槽的块必须仍在（否则「全丢」也变绿）').toBe(true)
  })

  it('③ 没越权：`axisHiddenMoves` 的角色（伊德海莉）不被本判据连带丢弃', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, '1051') as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
    // 1051012 是伊德海莉的 axisHiddenMoves 块（6 处预设真捏着，且有产出）
    config.stunAxes = [{ name: 'x', count: 2, actions: [{ slot: 0, moveId: '1051012', count: 1 }] as never, basicFillerSlot: 0 }]
    const ax = calc.effectiveStunAxes.value
    const placed = ax.flatMap(a => a.actions.map(x => x.moveId))
    expect(placed.includes('1051012'), '★ 伊德海莉的 hidden 块**不该**被 axisExcluded 连带丢弃（它是 moveId 级隐藏，不是整槽禁用）').toBe(true)
  })
})
