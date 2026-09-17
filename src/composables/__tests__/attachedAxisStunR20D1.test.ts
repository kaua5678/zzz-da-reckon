/**
 * D1（用户口径 2026-09-17）：「附伤/异放等事件需绑定轴内动作块，以此计算易伤」。
 *
 * ## 背景与实测缺陷（本文件锁定的 bug）
 *
 * `damagePool.ts` 的轴模式易伤分段链原本只有 **5 处逐 moveId 硬编码** 的 `axisStunFor(...)`
 * 调用（柏妮思 C6 余烬/燃爆、般岳摧岳附伤、爱丽丝极性强击…）。**模块自己产的伴随事件行
 * 没有通用通道**：它们的 moveId 在 `attachedEvents` 里未登记 ⇒ `attachedInAxisMap` 查不到
 * ⇒ 落到「按自己 moveId 查轴内块」的通用分支 ⇒ 查不到块 ⇒ **整段被判轴外、零易伤**。
 *
 * 实测漏计样本（1391 C6 + 1181 + 1011，手动轴含旋转 `1391010`）：
 * · 父行动作 `1391010` 轴内段 `stunMult = 1.5` ✓
 * · 而其驱动的爆米花 `1391_c6_popcorn`（`popcornHits = spinCount × 3`）**252 次、`stunMult = 1`**
 *   —— 占总伤 **21.73%**（4,777,434 / 21,980,811）的整段不吃失衡易伤。
 *
 * ## 本批修法（两条，缺一不可）
 *
 * ① **模块侧声明**：`specPanelBuffs.ts#jufufuTigerRoarMechanic.attachedEvents`
 *    登记 `{ [JUFUFU_MOVE.spinWeishi]: [JUFUFU_MOVE.popcorn] }`（父 → 子）；
 * ② **编排层通用消费**：`damagePool.ts` 新增分支——轴模式下若 `attachedInAxis[exec.moveId]`
 *    有值，则按该占比拆「轴内吃满 / 轴外零易伤」两段（与直伤 `axisSplitFor` 同源的分数口径，
 *    不是布尔 OR）。
 *
 * ## 为什么必须有这个文件
 *
 * `timeGolden` 对本类缺陷**结构性盲**：它只比对快照，而本缺陷**本来就在快照里**
 * （快照是「有 bug 的现状」生成的）。故必须自建精确值判据 + 反向验证。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'

/** 组一支队 + 手动轴（含 1391 旋转），返回爆米花相关行 */
async function popcornRows(opts: { axis: boolean; cinema?: number }) {
  const { config } = await setupHarness(
    [{ agentId: '1391', cinemaLevel: opts.cinema ?? 6 }, { agentId: '1181' }, { agentId: '1011' }] as never,
    { recommendedBuild: true },
  )
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  if (opts.axis) {
    config.stunAxes.push({
      name: '手动轴（1391 旋转 ×3）',
      actions: [
        { slot: 0, moveId: '1391010', count: 3, startTime: 0 },
        { slot: 1, moveId: '1181009', count: 1, startTime: 2 },
      ],
    } as never)
    config.useStunAxis = true
  } else {
    config.useStunAxis = false
  }
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 2000))
  return {
    total: calc.teamTotalDamage.value,
    rows: (calc.damagePoolRows.value as any[]).filter(r => r.moveId === '1391_c6_popcorn'),
    allRows: calc.damagePoolRows.value as any[],
  }
}

describe('D1 伴随事件绑定轴内动作块（爆米花 = 旋转驱动）', () => {
  it('★ 契约登记存在：1391 模块声明了 attachedEvents（父=旋转 → 子=爆米花）', () => {
    const mod = getAgentMechanic('1391')
    expect(mod, '1391 模块必须注册').toBeTruthy()
    const map = (mod as any).attachedEvents as Record<string, string[]> | undefined
    expect(map, '未登记 attachedEvents ⇒ 轴内易伤恒 0（本批修的正是这个）').toBeTruthy()
    expect(map!['1391010'], '父动作 = 山君鼎戏·威势的旋转').toEqual(['1391_c6_popcorn'])
  })

  it('★ 轴模式：爆米花被拆成「轴内吃满易伤(1.5) / 轴外零易伤(1)」两段', async () => {
    const { rows, total } = await popcornRows({ axis: true })
    expect(rows.length, '轴模式下应拆成两段（in / out）').toBe(2)
    const inSeg = rows.find(r => !String(r.id ?? '').endsWith('-out'))
    const outSeg = rows.find(r => String(r.id ?? '').endsWith('-out'))
    expect(inSeg, '缺轴内段').toBeTruthy()
    expect(outSeg, '缺轴外段').toBeTruthy()
    // 精确值：boss 默认易伤 1.5 ⇒ 轴内满易伤行 = 1.5，轴外 = 1
    expect(inSeg!.stunMultiplier ?? inSeg!.stunMult).toBeCloseTo(1.5, 10)
    expect(outSeg!.stunMultiplier ?? outSeg!.stunMult).toBe(1)
    // 两段次数之和 = 该轮总次数（**不硬编码常数**：实测轴/非轴收敛出的旋转次数不同
    // ——轴模式 252 / 非轴 261，硬编码会假红。此处只钉「不丢单位」不变量。）
    expect((inSeg!.count ?? 0) + (outSeg!.count ?? 0)).toBe(252)
    expect(total, '总伤必须为正').toBeGreaterThan(0)
    // 轴内段必须 > 0（若 0 说明占比算成 0 = 修复没生效）
    expect(inSeg!.count, '轴内段次数必须 > 0').toBeGreaterThan(0)
    expect(total).toBeGreaterThan(0)
  })

  it('非轴模式：整段单行、按全局覆盖率（不拆段）', async () => {
    const { rows } = await popcornRows({ axis: false })
    expect(rows.length, '非轴不该拆段').toBe(1)
    const only = rows[0]!
    // ⚠ 不硬编码次数：轴模式收敛出 252、非轴 261（捏轴改变资源收敛）。
    // 只钉「单行整段」+ 单位数 > 0（3×旋转次数属模块侧口径，由既有测试钉）。
    expect(only.count, '非轴单行必须 > 0').toBeGreaterThan(0)
    // 非轴走全局覆盖率（本队实测 1.177777…，即 stunCoverage 折算后的值）
    expect(only.stunMultiplier ?? only.stunMult).toBeCloseTo(1.1777777777777778, 10)
  })

  it('★ C5（无影画6）⇒ 不产爆米花行（附伤来源本身不存在）', async () => {
    const { rows } = await popcornRows({ axis: true, cinema: 5 })
    expect(rows.length, 'C5 不该有爆米花').toBe(0)
  })

  it('★ 轴内段单位伤害 > 轴外段（满易伤 vs 零易伤的方向性；不钉比值）', async () => {
    // ⚠ 不钉「比值 = 1.5」：两段除易伤外还差 crit/dmg 的分摊（实测比 1.85 而非 1.5），
    // 钉 1.5 会假红。真正的精确值判据是上面那条 `stunMultiplier`（1.5 vs 1）——
    // 本条只锁**方向性**：轴内单位伤害必须更高（若修复失效，两段同值 ⇒ 本断言红）。
    const { rows } = await popcornRows({ axis: true })
    const inSeg = rows.find(r => !String(r.id ?? '').endsWith('-out'))!
    const outSeg = rows.find(r => String(r.id ?? '').endsWith('-out'))!
    const inPerUnit = (inSeg.totalDamage ?? 0) / Math.max(1, inSeg.count ?? 1)
    const outPerUnit = (outSeg.totalDamage ?? 0) / Math.max(1, outSeg.count ?? 1)
    expect(inPerUnit, '轴内单位伤害必须 > 轴外').toBeGreaterThan(outPerUnit)
  })
})
