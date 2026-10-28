/**
 * CC-458 锁：结果卡「失衡池」本角色总失衡值直接读引擎 `StunPoolResult.perSlotStun[slot]`，不在页面侧重算。
 * 此前 ResourceResultCard 用 Σ `contrib.totalStun`（毛值，含失衡窗口内的无效部分）当分子、
 * `totalStunBuildUp`（有效值）当分母算占比：轴模式下口径不一致，全队占比可超 100%；
 * 而 positionCompare / freeCompare metrics 读的都是 `perSlotStun`（有效）。
 * 两层锁：① 引擎契约——perSlotStun 逐槽 = Σ effectiveStun，Σ perSlotStun = totalStunBuildUp（卡片依赖的恒等式）；
 * ② 源码——卡片读 perSlotStun、明细行显示 effectiveStun、不再 reduce totalStun。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const TEAMS = [['1051', '1311', '1221'], ['1471', '1481', '1451']]

describe('CC-458 失衡池 perSlotStun 契约', () => {
  for (const team of TEAMS) it(team.join('-'), async () => {
    await setupHarness(team.map(agentId => ({ agentId })), { recommendedBuild: true })
    const pool = useResourceCalc().stunPoolResult.value
    expect(pool).toBeTruthy()
    expect(pool!.contributions.length).toBeGreaterThan(0)
    expect(pool!.totalStunBuildUp).toBeGreaterThan(0)
    const perSlot = [0, 0, 0]
    for (const c of pool!.contributions) perSlot[c.slot] += c.effectiveStun
    for (let s = 0; s < 3; s++) expect(pool!.perSlotStun[s] ?? 0, `slot ${s}`).toBeCloseTo(perSlot[s], 6)
    /**
     * ⚠ 2026-10-28 恒等式收窄为 ≥：CC-150 规范化（cycle 队把池钳到最大自洽整数）下
     * `totalStunBuildUp` 按计数律重建（= 兑现账，K 窗吃掉的量），而 `perSlotStun` 保留
     * 产出账（含「攒出来但没能开启下一窗」的残量）⇒ `Σ perSlot ≥ total`，等号仅在
     * 未重建的池上成立（withStunCountRebuilt 头注释：产出账不伪造）。
     * 本队 1471-1481-1451 恰是重建案例：产出 82235 / 兑现 46458（3 窗 × ~15486）。
     */
    const sumPerSlot = pool!.perSlotStun.reduce((a, b) => a + b, 0)
    expect(sumPerSlot, 'Σ perSlot ≥ totalStunBuildUp（产出账 ≥ 兑现账；重建池时严格大于）')
      .toBeGreaterThanOrEqual(pool!.totalStunBuildUp - 1e-6)
  })
})

describe('CC-458 源码锁：ResourceResultCard 失衡池读引擎字段', () => {
  const src = readFileSync(resolve(__dirname, '../../components/ResourceResultCard.vue'), 'utf-8')
  const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')
  it('本角色总失衡值 = perSlotStun[props.result.slot]，不再 Σ totalStun', () => {
    expect(code).toMatch(/perSlotStun\[props\.result\.slot\]/)
    expect(code).not.toMatch(/sum \+ c\.totalStun/)
  })
  it('明细行显示 effectiveStun（与标题同口径），轴内无效部分单独标注', () => {
    const tpl = src.slice(0, src.indexOf('<script'))
    expect(tpl).toMatch(/fmt\(contrib\.effectiveStun, 1\)/)
    expect(tpl).not.toMatch(/fmt\(contrib\.totalStun/)
    expect(tpl).toMatch(/contrib\.inAxisStun > 0/)
  })
})
