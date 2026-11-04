/**
 * 轴内「[表]」直读的**覆盖口径**锁（用户 2026-11-04「命座 × 难度曲线 · 区间提升」专项的
 * 引擎侧一半；口径与实测全文见 `docs/mcp-cinema-interval-uplift.md`，坑条目 `ENGINE_PIPELINE_GUIDE` §4 坑 62）。
 *
 * ## 钉的是哪条口径
 *
 * `axisTableDirectMove` 的判据 ② 是**按 moveId 的存在性**判的：`backed = Set(executions.moveId)`。
 * 于是「模块产 1 行」=「这一招整条由模块结算」，`[表]` 直读行整体消失。
 *
 * 本文件把这个**现状**钉成断言（不是钉「它是对的」）——因为它是 C3→C4 −11.8% 的那条通道，
 * 任何改动都会在这里红，逼改动方回到专项文档确认口径，而不是悄悄改掉。
 *
 * ## 为什么必须带反空洞
 *
 * 只断言「有 1 行 ⇒ 不直读」在没有模块行的夹具上恒真（`backed` 是空集时它本来就会返回 val）。
 * 所以第二组断言必须同时证明：**空 backed ⇒ 直读成立**、且返回的倍率是正的技能表值。
 *
 * ⚠ 这里**刻意不 import catalog / store**（纯函数 + 手搓 skills 夹具）：
 * 卡的是判定规则本身，不是某一份数据；数据侧的形状由 `axisTableDirectCc393.test.ts` 负责。
 */
import { describe, expect, it } from 'vitest'
import { axisTableDirectMove } from '@/composables/resourceCalc/axisTableDirect'
import type { AgentSkills, SkillMove } from '@/types/catalog'

/** 一个最小的「特殊技」招式：只有 damageMultiplier 行 */
function move(id: string, dmg: number): SkillMove {
  return {
    id,
    name: { zhCN: `招式${id}`, en: `move${id}` },
    rows: [{ id: 'damage', kind: 'damageMultiplier', values: [dmg] }],
  } as unknown as SkillMove
}

const skills = {
  categories: [{ id: 'special', moves: [move('1371022', 1343.9), move('1371026', 233.3)] }],
} as unknown as AgentSkills

describe('轴内 [表] 直读：存在性门（覆盖口径）', () => {
  it('★ 模块该招**一行都没有** ⇒ [表] 直读成立，倍率取技能表', () => {
    const hit = axisTableDirectMove('1371', skills, '1371022', new Set<string>())
    expect(hit, '空 backed 时必须能直读——这是直读存在的意义').not.toBeNull()
    expect(hit!.multiplier).toBeGreaterThan(0)
    expect(hit!.categoryId).toBe('special')
  })

  it('★ 模块产了 **1 行**该招 ⇒ [表] 直读整体关闭（现状口径：存在性，不看条数）', () => {
    const hit = axisTableDirectMove('1371', skills, '1371022', new Set(['1371022']))
    expect(hit, '只要 backed 命中该 moveId，就整条交给模块结算').toBeNull()
  })

  it('★ 存在性门的**作用范围只有那个 moveId**：同角色另一招不受牵连', () => {
    const backed = new Set(['1371022'])
    expect(axisTableDirectMove('1371', skills, '1371026', backed), '1371026 没被 backed 命中 ⇒ 仍可直读').not.toBeNull()
  })

  it('反空洞：非数字 moveId / 负倍率 不会被直读（判定没有退化成恒真）', () => {
    expect(axisTableDirectMove('1371', skills, 'basic_attack', new Set())).toBeNull()
    const zeroSkills = {
      categories: [{ id: 'special', moves: [move('1379999', 0)] }],
    } as unknown as AgentSkills
    expect(axisTableDirectMove('1371', zeroSkills, '1379999', new Set())).toBeNull()
  })
})
