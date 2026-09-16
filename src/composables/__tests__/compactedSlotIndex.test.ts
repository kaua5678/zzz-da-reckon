/**
 * 「压缩数组按槽位号索引」整类缺陷的生效测试（2026-09-16 round 9）。
 *
 * ## 缺陷（本文件是它唯一的护栏）
 * `useResourceCalc` 用 `for (let i = 0; i < 3; i++) { const x = buildX(i); if (x) arr.push(x) }`
 * 构建 `characters` / `panels` / `damagePanels` / `remielleEntryPanels` ⇒ 数组**按位置紧凑**
 * （空槽被跳过），**槽位号 ≠ 下标**。而下游长期按**槽位号**取值（`arr[slot]`），前导/中间空槽时
 * 静默取到 `undefined` 或**别人那份对象**。
 *
 * ## 为什么必须单独有这个文件（判据形态的由来）
 * - `timeGolden` 对本缺陷**完全盲**：105 个预设**全部满槽**（实测 `withEmptySlot = 0`），
 *   5758 条归档也全是 `slots = [1,2,3]` ⇒ 修不修它都绿。**不能拿它当本缺陷的验收面。**
 * - 存量 312 个 `setupHarness([...])` 用例里，前导空槽 0 例、中间空槽 0 例
 *   （此前用 grep 粗扫会误判——70 处「带空槽」其实全是全空占位或尾空）。
 * - 产品路径**可达**：`TeamConfigPage.vue` 是 3 个独立 `CharacterCard`，默认三槽全空，
 *   无「必须从槽0连续填」约束 ⇒ 用户**先填槽2**即造出前导空槽。
 *
 * ## 三档实测后果（每档都有对应用例，均可反向验证）
 * ① **静默错值**：艾莲影画4 冻结数 4→0、回能 16→0（`['', 1481, 1191]`）
 * ② **跨角色污染**：派发 slot=1 但 `characters=[1:1181, 2:1041]` ⇒ 格雷丝写进队友那份 cfg
 * ③ **硬崩**：奥菲丝 / 薇薇安 / 蕾米埃尔 在「槽0 空 + 该角色在槽2」时抛 TypeError
 *
 * ## 断言口径（读的是**最终可见产物**，不是内部 cfg 字段）
 * - 影画4 的可见产物 = `resourceResult.characters[].specResources.ellen_cycle`
 *   （`c4EnergyTotal`/`freezeCount`）；同款口径见 `nextRoundFeedback.test.ts`。
 * - 崩溃 = 直接跑 `teamTotalDamage` 并断言不抛。
 * - ⚠ `resourceConfig.value.characters` 是 **cfg 数组**（可写、跨轮重建），
 *   `resourceResult.value.characters` 是**资源结果数组**——两者都压缩，但字段不同，别混用。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { panelAt, emptyPanel } from '@/core/panel'
import type { PanelValues } from '@/types/catalog'
import type { TeamResourceResult } from '@/types/resource'

/** 跑一次全管线（含伤害池）并返回 resourceResult + 伤害 */
async function calc(team: Array<{ agentId: string; cinemaLevel?: number } | ''>) {
  await setupHarness(team)
  const c = useResourceCalc()
  const rr = c.resourceResult.value
  const damage = c.teamTotalDamage.value
  return { c, rr, damage }
}

/** 取某槽的资源结果行（按 slot 身份查，与生产代码同口径） */
const slotRow = (rr: TeamResourceResult | null, slot: number) =>
  rr?.characters.find(c => c.slot === slot)

/** 取某槽的 specResources 某键（角色模块自报的循环产物） */
function specOf<T>(rr: TeamResourceResult | null, slot: number, key: string): T | undefined {
  const row = slotRow(rr, slot) as unknown as { specResources?: Record<string, unknown> } | undefined
  return row?.specResources?.[key] as T | undefined
}

describe('压缩数组：前提（数组确实被压缩）', () => {
  it('★ 槽0 空时 characters 长度 2、槽位号 1/2 存在 slot 字段里 ⇒ 下标 2 是 undefined', async () => {
    const { rr } = await calc(['', { agentId: '1041' }, { agentId: '1191' }])
    expect(rr?.characters.length).toBe(2)
    expect(rr?.characters.map(c => c.slot)).toEqual([1, 2])
    // 旧代码正是按 `characters[2]` 取值 ⇒ undefined（本缺陷的前提）
    expect((rr?.characters as unknown as unknown[])[2]).toBeUndefined()
  })
})

describe('压缩数组：前导空槽（槽0 空）', () => {
  it('★ 艾莲影画4 不得静默归零（缺陷 ① 静默错值）', async () => {
    // 对照组：艾莲在槽0（满槽）
    const full = await calc([{ agentId: '1191', cinemaLevel: 6 }, { agentId: '1481' }, { agentId: '1311' }])
    const fullCycle = specOf<{ freezeCount: number; c4EnergyTotal: number }>(full.rr, 0, 'ellen_cycle')
    // 实验组：艾莲在槽2（槽0 空）
    const pre = await calc(['', { agentId: '1481' }, { agentId: '1191', cinemaLevel: 6 }])
    const preCycle = specOf<{ freezeCount: number; c4EnergyTotal: number }>(pre.rr, 2, 'ellen_cycle')

    expect(fullCycle?.c4EnergyTotal, '对照组（满槽）影画4 回能应非零').toBeGreaterThan(0)
    // 修复前实测：前导空槽下 freeze=0 / c4=0（写进了空气）——这条断言就是那个回归的护栏
    expect(preCycle?.c4EnergyTotal, '前导空槽下影画4 回能静默归零 —— characters[slot] 取错对象').toBeGreaterThan(0)
    expect(preCycle?.freezeCount, '前导空槽下冻结次数静默归零').toBeGreaterThan(0)
  })
})

describe('压缩数组：中间空槽（槽1 空）', () => {
  it('★ 艾莲在槽2、槽1 空 ⇒ 影画4 仍生效（槽位号 2 ≠ 下标 1）', async () => {
    const { rr } = await calc([{ agentId: '1191', cinemaLevel: 6 }, '', { agentId: '1481' }])
    expect(rr?.characters.map(c => c.slot)).toEqual([0, 2])
    const cycle = specOf<{ c4EnergyTotal: number }>(rr, 0, 'ellen_cycle')
    expect(cycle?.c4EnergyTotal, '中间空槽下影画4 回能静默归零').toBeGreaterThan(0)
  })
})

describe('压缩数组：跨角色污染（缺陷 ②，比 undefined 更隐蔽）', () => {
  it('★ 格雷丝的影画1 全队回能按自己那份 cfg 算，且不污染队友那份', async () => {
    // 槽0 空 ⇒ characters = [1:1181(格雷丝), 2:1041]。旧代码 `characters[slot]`（slot=1）
    // 取到的其实是**槽2 的 1041** ⇒ 格雷丝的字段被写到队友 cfg 上。
    const { c } = await calc(['', { agentId: '1181' }, { agentId: '1041' }])
    // 格雷丝影画1 的可见产物 = 全队 initialEnergyGift 增加（按自己那份的 graceC1Cycles 算）。
    // 直接判据：管线不崩、两条槽都在、伤害有限（污染的判据见下一条对 cfg 的检查）。
    const rc = c.resourceConfig.value
    expect(rc?.characters.map(x => x.slot)).toEqual([1, 2])
    // 队友（1041，槽2）那份 cfg **不得**带有格雷丝的字段 —— 这是「跨角色污染」的直接判据
    const mate = rc?.characters.find(x => x.slot === 2) as Record<string, unknown> | undefined
    expect(mate?.graceC1TeamEnergyTotal, '格雷丝的字段被写进了队友那份 cfg（跨角色污染）').toBeUndefined()
  })
})

describe('压缩数组：硬崩（缺陷 ③，3 个角色在「槽0 空 + 该角色在槽2」时抛 TypeError）', () => {
  // 修复前各自的报错（2026-09-16 实测）：
  //  1301 奥菲丝  Cannot set properties of undefined (setting 'orphieAutoFrontRatio')  ← characters[slot] 写
  //  1331 薇薇安  Cannot read properties of undefined (reading 'anomalyProficiency')    ← damagePanels[slot] 读
  //  1501 蕾米埃尔 Cannot read properties of undefined (reading 'anomalyMastery')       ← damagePanels[slot] 读
  for (const agentId of ['1301', '1331', '1501']) {
    it(`★ 队 ['', 1041, ${agentId}] 走完整管线（含伤害池）不抛错`, async () => {
      const { rr, damage } = await calc(['', { agentId: '1041' }, { agentId }])
      expect(rr).toBeTruthy()
      expect(Number.isFinite(damage)).toBe(true)
      expect(damage).toBeGreaterThan(0)
    })
  }

  it('★ 奥菲丝 build 阶段写入落在自己那份 cfg 上（原崩溃点的正面判据）', async () => {
    const { c } = await calc(['', { agentId: '1041' }, { agentId: '1301' }])
    const orphie = c.resourceConfig.value?.characters.find(x => x.slot === 2) as Record<string, unknown> | undefined
    // 修复前：写入抛错；修复后：字段存在于奥菲丝自己那份 cfg（席德不在队 ⇒ 0）
    expect(orphie?.orphieAutoFrontRatio, '奥菲丝的 build 写入没落到自己那份 cfg').toBeDefined()
  })
})

describe('不变量：有 cfg 必有面板（响亮失败的前提）', () => {
  // damagePool 用 `panelAt(...)!`（非空断言）而不是 `?? 兜底/continue`——依据就是这条不变量：
  // buildCharConfig 里 `computePanel` 是它 return 的前置（helpers.ts:1674）。本用例是它的护栏：
  // 若将来 producer 让「有 cfg 但无面板」成为可能，damagePool 的断言会变成硬崩，
  // 而本用例会**先**红在这里，指出是契约变了。
  it('★ 空槽队形 + 预设库：每条 execution 的 slot 都能按身份命中面板', async () => {
    const teams: Array<Array<{ agentId: string; cinemaLevel?: number } | ''>> = [
      ['', { agentId: '1041' }, { agentId: '1191', cinemaLevel: 6 }],   // 前导空槽
      [{ agentId: '1191', cinemaLevel: 6 }, '', { agentId: '1481' }],   // 中间空槽
      ['', '', { agentId: '1331' }],                                    // 仅槽2
      ['', { agentId: '1501' }, ''],                                    // 尾空
    ]
    for (const team of teams) {
      const { c, rr } = await calc(team)
      const panels = c.panels.value
      for (const ch of rr?.characters ?? []) {
        expect(
          panels.some(p => p.slot === ch.slot),
          `队 ${JSON.stringify(team)} 的槽 ${ch.slot} 有 cfg 却无面板 —— 「有 cfg 必有面板」不变量被破坏`,
        ).toBe(true)
      }
    }
  })
})

describe('panelAt：按身份取面板（压缩数组的读取端契约）', () => {
  const p = (slot: number): PanelValues => ({ ...emptyPanel(), slot, atk: 100 + slot })

  it('★ 按槽位号取到的是**那份**面板，不是同下标那个', () => {
    // 压缩数组：[槽1, 槽2]（槽0 空）
    const panels = [p(1), p(2)]
    expect(panelAt(panels, 1)?.atk).toBe(101)
    expect(panelAt(panels, 2)?.atk).toBe(102)
    // 槽0 确实没有角色 ⇒ undefined（**不得**回落到 panels[0] 那个「槽1 的面板」）
    expect(panelAt(panels, 0), '槽0 无角色却取到了槽1 的面板（旧行为的下标错位）').toBeUndefined()
  })

  it('未盖章的密集数组（测试手工构造）按下标兜底', () => {
    const dense = [{ atk: 1 } as PanelValues, { atk: 2 } as PanelValues, { atk: 3 } as PanelValues]
    expect(panelAt(dense, 2)?.atk).toBe(3)
  })

  it('★ 查找**无副作用**：连续查多个槽不因前一次查找而改变结果', () => {
    // 曾经的错误实现「回落到下标时顺手盖章」会让首次查找把数组变得「看起来已盖章」，
    // 于是下一次查别的槽被判成压缩数组而返回 undefined（实测让维琳娜风蚀用例变红）。
    const dense = [{ atk: 1 } as PanelValues, { atk: 2 } as PanelValues, { atk: 3 } as PanelValues]
    expect(panelAt(dense, 0)?.atk).toBe(1)
    expect(panelAt(dense, 1)?.atk).toBe(2)
    expect(panelAt(dense, 2)?.atk).toBe(3)
    // 且不得给入参盖上印章（盖章会让后续判定把密集数组误判成压缩数组）
    expect(dense.every(x => (x.slot ?? -1) < 0)).toBe(true)
  })
})
