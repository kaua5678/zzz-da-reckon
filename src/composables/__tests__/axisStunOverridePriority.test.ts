/**
 * **轴模式下「模块自报满易伤」优先于轴内外拆分**（T173，用户口径 2026-10-15）。
 *
 * ## 用户口径（逐字）
 *
 * > 「叶瞬光的**特殊机制**导致她**可以直接调用失衡易伤**，所以**无需束缚于失衡**。
 * >   他有**自己的失衡体系**，不是按照轴内外拆分」
 *
 * ## 修前缺陷（实测，非推断）
 *
 * `damagePoolDirect` 的分支链里 `isAxis && axisSlots.has(slot)` **无条件先命中**
 * ⇒ 按 `axisSplitFor` 拆「轴内吃易伤 / 轴外不吃」，**从不问模块的 `stunOverrideForMove`**
 * （那个只在兜底臂被问，而兜底臂要求 `!axisSlots.has(slot)`）。
 *
 * 后果（叶瞬光手组队锁 1 窗，`.zc/perf` 一次性探针）：
 * | 轴配置 | 总伤 | 1431 行里吃满易伤(1.3) |
 * |---|---|---|
 * | 不放任何块 | 2.7356M | **8 / 11** |
 * | 放斩妄 1431027 | 2.0351M | **1 / 12** |
 * | 放逐云 1431025（真喧响大） | 2.0047M | **0 / 11** |
 * | 放**别的槽**的块 | 1.9585M | **0 / 11** |
 *
 * ⇒ **放任何块**都让叶瞬光的满易伤大面积失效——而模块头注释写着
 * 「无需失衡轴：白毛（明心境）关键伤害**一律满易伤**」，
 * 且 `damagePoolBatchR17c.test.ts:102` **明确锁了**「`isAxis` 真假都认领」。
 * **即：设计意图是轴模式下也认领，但生产路径绕过了它**——原判据只单测了 hook 本身、
 * 没测**接线**，所以一直是绿的（本条补的正是接线）。
 *
 * ## 本文件锁什么
 *
 * ① **叶瞬光**：轴模式（槽位已进轴）下，关键招仍吃满易伤（**不再**被轴内外拆分掉）；
 * ② **雨果**（对照）：其 `stunOverrideForMove` 在 `isAxis=true` 时**刻意返回 null**
 *    ⇒ 仍走轴内外拆分 ⇒ **两处不对称口径原样保留**（不许顺手统一）；
 * ③ 反空洞：断言里必须有「非关键招仍会被拆分」的证据，防「全都满易伤」的退化。
 *
 * ## 负控（删除被锁行为后本测试确实变红）
 *
 * 把 `damagePoolDirect` 里那句 `const axisClaimed = mechanic?.stunOverrideForMove?.({...isAxis: true})`
 * 的判断去掉（回到无条件 `axisSplitFor`）⇒ ① 红（叶瞬光关键招掉回 1.0）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { yeshuguangMechanic } from '@/mechanics/agents/yeshuguang'
import { hugoMechanic } from '@/mechanics/agents/hugo'

function teamChar(slot: number, agentId: string, overrides: Record<string, number> = {}) {
  return {
    slot, agentId, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 1,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
    parryCount: 6, blockCount: 0, dodgeCounterCount: 10, quickAssistCount: 3, chainCountPerStun: 1,
    basicAttackTimeWeight: 1, ...overrides,
  }
}

describe('T173 轴模式下「模块自报满易伤」优先（用户口径：叶瞬光不按轴内外拆分）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('① 叶瞬光：轴里放块后，关键招仍吃满易伤（修前只剩 1/12）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, '1431') as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    // 轴里放「斩妄开天」（收尾）。用户口径：它**吃得到易伤**，打完才退出明心境。
    config.stunAxes = [{
      name: 'x', count: 1,
      actions: [{ slot: 0, moveId: '1431027', count: 1 }] as never,
      basicFillerSlot: 0,
    }]
    const rows = calc.damagePoolRows.value as unknown as { moveId?: string; stunMult?: number }[]
    const yx = rows.filter(r => r.moveId && /^1431/.test(r.moveId))
    expect(yx.length, '叶瞬光应有执行行（否则本条零覆盖）').toBeGreaterThan(0)
    const full = yx.filter(r => r.stunMult === 1.3).length
    expect(full, `★ 轴模式下叶瞬光关键招必须吃满易伤（修前只有 1 行，实测 ${full} 行）`)
      .toBeGreaterThanOrEqual(8)
  })

  it('② 雨果对照：轴模式下**不认领** ⇒ 仍走轴内外拆分（不对称口径不许统一）', () => {
    // 单元级：两处口径必须不同
    expect(hugoMechanic.stunOverrideForMove!({ slot: 0, moveId: '1291015', isAxis: true } as never),
      '雨果 isAxis=true 必须返回 null（走轴内外拆分）').toBeNull()
    expect(yeshuguangMechanic.stunOverrideForMove!({ slot: 0, moveId: '1431027', isAxis: true } as never),
      '叶瞬光 isAxis=true 必须仍认领（明心境自成体系）').toEqual({ stunOverride: 1, note: ' · 明心境满易伤' })
  })

  it('③ 反空洞：非关键招**仍会被轴内外拆分**（防「全都满易伤」的退化）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const calc = useResourceCalc()
    config.team[0] = teamChar(0, '1431') as never
    config.team[1] = teamChar(1, '1251') as never
    config.team[2] = teamChar(2, '1271') as never
    config.useStunAxis = true
    config.enemy.stunCountLock = 1
    config.stunAxes = [{
      name: 'x', count: 1,
      actions: [{ slot: 0, moveId: '1431027', count: 1 }] as never,
      basicFillerSlot: 0,
    }]
    const rows = calc.damagePoolRows.value as unknown as { moveId?: string; stunMult?: number }[]
    const yx = rows.filter(r => r.moveId && /^1431/.test(r.moveId))
    // 非白名单招（如 1431016 普攻变体）**不在** YESHUGUANG_FULL_STUN_MOVES ⇒ 仍按轴内外拆
    const notFull = yx.filter(r => r.moveId !== '1431027' && r.stunMult !== 1.3)
    expect(notFull.length, '必须有行仍低于满易伤（否则本条退化成「全都 1.3」）').toBeGreaterThan(0)
  })
})
