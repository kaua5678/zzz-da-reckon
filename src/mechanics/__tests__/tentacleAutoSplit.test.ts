/**
 * **寒冰触手 = CD 驱动的后台自动攻击 ⇒ 不靠手捏**（T176，用户口径 2026-10-16）。
 *
 * ## 用户口径（逐字）
 *
 * > 「我说的自动是橘福福后台连携，**扳机后台攻击**，**章鱼触手cd**，卢西亚后台追击」
 * > 「**这个是通用逻辑，我认为自动攻击无需手捏计数，直接全局均匀计数，哪些吃易伤哪些打失衡就有了**」
 *
 * ## 修前缺陷
 *
 * 触手次数本来就是**纯自动**的（`floor(有效战斗时间 / yidhari.tentacleInterval)`，
 * 玩家调**间隔**而非次数），却另挂 `axisExtraBlocks` 手捏块
 * ⇒ 手捏**不改变次数**、**只改变易伤归属**（实测捏×1 让总伤掉 5%）。
 *
 * ## 本文件锁什么
 *
 * ① 触手行带 `autoSplitByStun`（走通用「按失衡时间占比拆」机制）；
 * ② 触手**不再**出现在 `axisExtraBlocks`（候选池不列它）；
 * ③ **行为锁**：轴已生效时，往轴里加触手块**不改变总伤**（加不加逐位相同）。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * 去掉 `yidhari.ts` 触手行的 `autoSplitByStun: true` ⇒ ③ 红（加块会改变总伤）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { agentAxisExtraBlocks } from '@/composables/agentMechanicView'

const TENTACLE = '1051024'
const YIDHARI = '1051'

function teamChar(slot: number, agentId: string, overrides: Record<string, number> = {}) {
  return {
    slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
    parryCount: 6, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1,
    basicAttackTimeWeight: 1, ...overrides,
  }
}

describe('T176 寒冰触手：CD 自动行不靠手捏（用户口径「自动攻击无需手捏计数」）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('① 触手行带 autoSplitByStun（走通用按失衡占比机制）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, YIDHARI) as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    const c0 = calc.resourceResult.value!.characters.find(c => c.slot === 0)!
    const row = c0.executions.find(e => e.moveId === TENTACLE)
    expect(row, `必须有触手执行行（否则本条零覆盖）`).toBeTruthy()
    expect(row!.autoSplitByStun, '★ 触手必须声明 autoSplitByStun（CD 自动行通用机制）').toBe(true)
  })

  it('② 触手不再出现在 axisExtraBlocks（候选池不列，捏了没意义）', async () => {
    await setupHarness([{ agentId: YIDHARI }, '', ''])
    const extra = agentAxisExtraBlocks(YIDHARI, {
      cinemaLevel: 0,
      actionTimeOf: () => 0,
    })
    expect(extra.some(b => b.moveId === TENTACLE), '★ 触手不该再是手捏候选块').toBe(false)
  })

  it('③ 行为锁：轴已生效时，往轴里加触手块**不改变总伤**', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, YIDHARI) as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 2
    /** ⚠ 必须放一个**别的**块：`axisActive` 要求 `resolvedAxes.length > 0`，
     *  否则空轴 ⇒ 轴模式未生效 ⇒ 全队走覆盖率，比出来的差不是触手造成的。 */
    const BASE = { slot: 0, moveId: '1051016', count: 1 }
    const run = async (extra: Record<string, unknown>[]) => {
      config.stunAxes = [{ name: 'x', count: 2, actions: [BASE, ...extra] as never, basicFillerSlot: 0 }]
      await new Promise(r => setTimeout(r, 160))
      const rows = calc.damagePoolRows.value as unknown as { moveId?: string; count?: number; stunMult?: number }[]
      return {
        total: calc.teamTotalDamage.value,
        tent: rows.filter(r => r.moveId === TENTACLE).map(r => `${r.count}:${(r.stunMult ?? 0).toFixed(3)}`).join('+'),
      }
    }
    const none = await run([])
    const one = await run([{ slot: 0, moveId: TENTACLE, count: 1 }])
    const nine = await run([{ slot: 0, moveId: TENTACLE, count: 9 }])
    expect(one.total, '★ 加触手块×1 不得改变总伤（自动行不靠放置）').toBeCloseTo(none.total, 6)
    expect(nine.total, '★ 加触手块×9 不得改变总伤').toBeCloseTo(none.total, 6)
    // 反空洞：触手行必须真的存在且按占比拆（不是「没有行所以相等」）
    expect(none.tent, '触手行必须存在且按占比拆（防「无行所以相等」的空洞）').not.toBe('')
    expect(none.tent.split('+').length, '必须拆成轴内/轴外两段（占比非 0/1）').toBe(2)
  })
})
