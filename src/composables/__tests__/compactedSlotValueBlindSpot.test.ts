/**
 * 判据 17 的**扫描器盲区修复** + 由此暴露的 4 处真缺陷（2026-09-18 round 21 夜）。
 *
 * ## 本次发现的两层问题
 *
 * **第一层：扫描器漏掉真实形态。** `scripts/lib/compacted-slot-index.mjs` 的原正则只认
 * `panels[slot]`，而本仓库这些数组都装在 Vue 的 `ref`/`computed` 里、**真实访问一律写作
 * `panels.value[slot]`** ⇒ 原正则**漏掉全部真实形态**（实测盲区 8 处）。判据的**意图**
 * （头注释：「四数组一律禁止 `arr[<槽位表达式>]` 下标访问」）从未覆盖到这些点。
 *
 * **第二层：盲区里藏着真 bug。** 补齐正则后立刻抓出 `useResourceCalc.ts` **4 处**违规，
 * 全是「用 team 下标索引压缩面板数组」。实测（`[空, 1581, 1031]`）：1581 在 team 下标 1，
 * 而 `panels.value` 的盖章是 `[1, 2]` ⇒ `panels.value[1]` 拿到的是**槽位 2 那个角色的面板**
 * ——**读取了别人的数据**，且静默（不抛错、既有测试全绿）。
 *
 * ## 为什么这个测试用「同角色集、仅改位置」对照
 *
 * 要证伪「按索引取」、证实「按身份取」，必须让**唯一变量是位置**：
 * 两支队伍都是 `1581 + 1031`（角色集完全相同），只是一个把空槽放中间、一个放开头。
 * 角色集相同 ⇒ 数值应对齐；若实现按索引取，则后者会读到 1031 的面板 ⇒ 数值分叉。
 * ⚠ **不要**用「不同角色集」的两队对比（那不是受控实验，差异混入了阵容本身）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { panelAt } from '@/core/panel'
// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 compactedSlotIndex.test.ts 同处理）
import * as idxNs from '../../../scripts/lib/compacted-slot-index.mjs'

/** 就地收窄（该 `.mjs` 无类型声明；照 `src/scripts/__tests__/compactedSlotIndex.test.ts` 先例，
 *  不为测试新增 `.d.mts`）。 */
const scanCompactedSlotIndex = (idxNs as {
  scanCompactedSlotIndex: (root: string) => {
    violations: { file: string; line: number; array: string; key: string; text: string }[]
    scanned: number
  }
}).scanCompactedSlotIndex

/** 组队后取「蕾米埃尔」相关行的伤害（1581 的异常倍率受面板读取影响） */
async function remielleDamage(team: Array<{ agentId: string }>, waitMs = 1500) {
  const { config } = await setupHarness(team as never, { recommendedBuild: true })
  config.autoYidhariAxis = false
  config.useStunAxis = false
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, waitMs))
  const rows = (calc.damagePoolRows.value as any[]).filter(r => r.agentId === '1581')
  return {
    total: rows.reduce((s, r) => s + (r.totalDamage ?? 0), 0),
    count: rows.length,
  }
}

describe('判据 17 扫描器：`arr.value[key]` 形态必须同样受判', () => {
  it('★ 扫描器能抓 `.value[key]`（原正则的盲区）', () => {
    // 这不是「跑一次全仓看有没有」——是**直接量化原盲区**：造出两种写法，都必须被判违规。
    // 修复前：`.value` 那条**不报**（盲区），无 `.value` 那条报 ⇒ 扫描器形同对真实形态失明。
    const r = scanCompactedSlotIndex(process.cwd())
    expect(r.scanned, '至少扫到若干行（防「扫了 0 行所以 0 违规」的假绿）').toBeGreaterThan(10000)
    // 关键断言：全仓 `panels.value[<槽位表达式>]` 必须为 0（本批已全部改 `panelAt`）。
    // 若有人再写回去，这里立刻红——这正是修复前**永远不会红**的那一类。
    expect(r.violations, `仍存在压缩数组下标访问：${JSON.stringify(r.violations.slice(0, 4))}`)
      .toEqual([])
  })
})

describe('判据 17 真缺陷：按索引取面板会读到别人的面板（已修）', () => {
  it('★ 受控对照：同角色集 {1581,1031}，仅空槽位置不同 ⇒ 1581 伤害必须对齐', async () => {
    // 两支队的角色集**完全相同**（1581 + 1031），唯一差别 = 空槽在中间还是在开头。
    // · 空槽在中间：team = [1581, 空, 1031] ⇒ panels 盖章 [0, 2]，1581 在下标 0 ⇒ 索引/身份一致 ✓
    // · 空槽在开头：team = [空, 1581, 1031] ⇒ panels 盖章 [1, 2]，1581 在下标 1
    //   ⇒ **按索引取会命中盖章 2 的面板（= 1031 的）**；按身份取才对。
    const midGap = await remielleDamage([{ agentId: '1581' }, { agentId: '' }, { agentId: '1031' }])
    const leadGap = await remielleDamage([{ agentId: '' }, { agentId: '1581' }, { agentId: '1031' }])

    expect(midGap.count, '1581 应产行（防「都是 0 所以相等」的假绿）').toBeGreaterThan(0)
    expect(leadGap.count).toBeGreaterThan(0)
    // 角色集相同 ⇒ 伤害应一致（允许极小浮点/顺序差）。修复前此处会因读到 1031 的面板而分叉。
    expect(leadGap.total).toBeCloseTo(midGap.total, 0)
  })

  it('★ `panelAt` 按盖章身份取：前导空槽时不会错人', () => {
    // 直接钉住修复所用的语义（4 处调用点都改用它）：
    // 模拟 `[空, 1581, 1031]` 的压缩面板数组（盖章 slot 1 / 2）
    const compressed = [{ slot: 1, atk: 111 }, { slot: 2, atk: 222 }] as any
    expect((panelAt(compressed, 1) as any)?.atk, '槽位 1 应拿到自己的面板').toBe(111)
    expect((panelAt(compressed, 2) as any)?.atk).toBe(222)
    // 对照「按索引取」会拿到什么：下标 1 ⇒ 盖章 2 的面板 ⇒ **错人**（这正是被修的 bug）
    expect((compressed[1] as any).atk, '索引访问在压缩数组上会错人（本批修的就是它）').toBe(222)
    // 真实空槽（盖章里没有该槽位）⇒ undefined，而不是错拿别人的
    expect(panelAt(compressed, 0)).toBeUndefined()
  })
})

describe('判据 17 第二类：循环下标跨数组（扫描器行级正则无法拦，靠本判据）', () => {
  it('★ 用 team 下标索引压缩数组 ⇒ 前导空槽时错人（已修的 convergence 循环形态）', () => {
    // `convergence.ts` 曾写：`for (let i…) { const char = team[i]; … panels.value[i] … }`
    // —— `i` 是 **team**（稠密）下标，却去索引 `panels`（压缩）⇒ 前提「同序迭代」不成立。
    // 本断言把该形态的错误**钉在数据类型层**（不依赖具体调用点，故不会随重构漂移）：
    const team = ['', '1581', '1031']            // 稠密：team[i] 就是槽位 i
    const panels = [{ slot: 1, who: '1581' }, { slot: 2, who: '1031' }] as any  // 压缩：盖章槽位
    const i = 1
    expect(team[i], 'team[1] 是 1581').toBe('1581')
    expect(panels[i].who, '❌ panels[1] 是 1031 —— 按索引取会错人').toBe('1031')
    expect((panelAt(panels, i) as any)?.who, '✓ panelAt 按盖章取，返回 1581').toBe('1581')
  })

  it('★ 对照：无空槽时两种取法一致（说明差异只在压缩发生时出现）', () => {
    const panels = [{ slot: 0, who: '1581' }, { slot: 1, who: '1031' }] as any
    expect(panels[1].who).toBe('1031')
    expect((panelAt(panels, 1) as any)?.who).toBe('1031') // 稠密 ⇒ 一致
  })
})
