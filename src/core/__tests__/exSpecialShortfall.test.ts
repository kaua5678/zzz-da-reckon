/**
 * 「差 1 点闪能就能多打一次强特」的门槛读数（`exSpecialShortfallOf`）判据。
 *
 * 背景（用户原话）：「预留 19 点闪能，平A回能到 20，额外释放一个强化特殊技，导致平A收益在这一点
 * 比交互高」——而 `resolveExSpecialCount` 是收敛后 `floor(总量/消耗)`，中间没有「差一点」的表达。
 *
 * 本文件的断言分两类（两类都必须绿，否则读数会骗人）：
 *  - **数值口径**：差 1 点 ⇒ 1、够 ⇒ 0、不适用 ⇒ 0、负/零 ⇒ 有限值不 NaN；
 *  - **与次数同源**：`n(E + shortfall) = n(E) + 1` 且 `n(E + shortfall − ε) = n(E)`
 *    （`n` = `resolveExSpecialCount`）——门槛可达、不虚高，杜绝两套账。
 */
import { describe, expect, it } from 'vitest'
import { resolveExSpecialCount, exSpecialShortfallOf } from '@/core/resource/helpers'
import { banyueMechanic } from '@/mechanics/agents/banyue'
import type { CharacterOperationConfig } from '@/types/resource'

/** 最小可用 cfg：只带 `resolveExSpecialCount` / `exSpecialShortfallOf` 会读的字段 */
function cfgOf(over: Partial<CharacterOperationConfig> = {}): CharacterOperationConfig {
  return {
    slot: 0,
    agentId: '1041',
    isFlashUser: true,
    exSpecialMoveId: '1041006',
    exSpecialCostType: 'energy',
    exSpecialEnergyConsume: 20,
    ...over,
  } as CharacterOperationConfig
}

const EPS = 1e-9

describe('exSpecialShortfallOf：门槛读数（距下一次强特还差多少点闪能）', () => {
  it('① 能量刚好差 1 点 ⇒ shortfall = 1（且补上这点正好多打一次）', () => {
    const cfg = cfgOf()
    expect(exSpecialShortfallOf(cfg, 19)).toBe(1)
    expect(resolveExSpecialCount(cfg, 19)).toBe(0)
    expect(resolveExSpecialCount(cfg, 19 + exSpecialShortfallOf(cfg, 19))).toBe(1)

    // 同一门槛序列的更高一档（已打了 5 发，差 1 点再打第 6 发）
    expect(exSpecialShortfallOf(cfg, 5 * 20 + 19)).toBe(1)
    expect(resolveExSpecialCount(cfg, 5 * 20 + 19)).toBe(5)
    expect(resolveExSpecialCount(cfg, 5 * 20 + 20)).toBe(6)
  })

  it('② 能量刚好够 ⇒ shortfall = 0，且次数比「差 1 点」多 1', () => {
    const cfg = cfgOf()
    const justEnough = 20
    expect(exSpecialShortfallOf(cfg, justEnough)).toBe(0)
    expect(resolveExSpecialCount(cfg, justEnough) - resolveExSpecialCount(cfg, justEnough - 1)).toBe(1)

    // 恰好整发（任何门槛点）必须读 0——读数不许把「刚好够」报成「差一点」
    for (const consume of [20, 60]) {
      const c = cfgOf({ exSpecialEnergyConsume: consume })
      for (const k of [1, 3, 7]) expect(exSpecialShortfallOf(c, k * consume)).toBe(0)
    }
expect(exSpecialShortfallOf(cfg, 1000)).toBe(0)
  })

  it('③ exSpecialCostType === "resource" ⇒ 0（次数由模块资源账本给，不扣闪能）；不耗闪能同理', () => {
    const asResource = cfgOf({ exSpecialCostType: 'resource', exSpecialResourcePaidCount: 3 })
    expect(exSpecialShortfallOf(asResource, 0)).toBe(0)
    expect(exSpecialShortfallOf(asResource, 19)).toBe(0)
    // 口径一致：resource 型次数完全不看能量
    expect(resolveExSpecialCount(asResource, 0)).toBe(3)
    expect(resolveExSpecialCount(asResource, 19)).toBe(3)

    // exSpecialEnergyConsume <= 0 = 强特不耗闪能，没有门槛可言
    expect(exSpecialShortfallOf(cfgOf({ exSpecialEnergyConsume: 0 }), 19)).toBe(0)
    expect(exSpecialShortfallOf(cfgOf({ exSpecialEnergyConsume: -5 }), 19)).toBe(0)
  })

  it('④ 负/零能量 ⇒ 有限值、不 NaN（读数 = 一发消耗，不报 0）', () => {
    const cfg = cfgOf()
    for (const energy of [0, -1, -19, -1e9]) {
      const s = exSpecialShortfallOf(cfg, energy)
      expect(Number.isFinite(s)).toBe(true)
      expect(Number.isNaN(s)).toBe(false)
      expect(s).toBe(20) // 负/零能量报 0 会被读成「已经够了」，所以报一发消耗
    }
    // 0 能量这一档：补上一发消耗恰好打得出第一次
    expect(resolveExSpecialCount(cfg, 0)).toBe(0)
    expect(resolveExSpecialCount(cfg, 0 + exSpecialShortfallOf(cfg, 0))).toBe(1)
    // 非有限输入也不传播 NaN（读数记一发消耗）
    for (const energy of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const s = exSpecialShortfallOf(cfg, energy)
      expect(Number.isNaN(s)).toBe(false)
      expect(s).toBe(20)
    }
  })

  it('门槛与次数同源（4 档 consume × 一串能量）：补上 shortfall 恰好多 1 次，少 ε 仍不多给', () => {
    for (const consume of [20, 40, 60, 50]) {
      const cfg = cfgOf({ exSpecialEnergyConsume: consume })
      for (const energy of [0.5, 1, 7, consume - 1, consume, consume + 0.25, 3 * consume - 0.5, 577.7]) {
        const shortfall = exSpecialShortfallOf(cfg, energy)
        const base = resolveExSpecialCount(cfg, energy)
        expect(Number.isFinite(shortfall)).toBe(true)
        expect(shortfall).toBeGreaterThanOrEqual(0)
        if (shortfall > 0) {
          // 门槛可达且不虚高：+shortfall 恰好跨一次，−ε 还差一点
          expect(resolveExSpecialCount(cfg, energy + shortfall)).toBeCloseTo(base + 1, 9)
          expect(resolveExSpecialCount(cfg, energy + shortfall - EPS)).toBeCloseTo(base, 9)
          expect(shortfall).toBeLessThanOrEqual(consume)
        } else {
          // 已够 ⇒ 再补一点点也不会白白多给一次（读数没有把「刚好够」误报成门槛）
          expect(resolveExSpecialCount(cfg, energy + 0.5 - EPS)).toBeCloseTo(base, 9)
        }
      }
    }
  })

  it('freeExSpecialCount 只加次数、不挪闪能门槛（免费次数不造出「假门槛」）', () => {
    const cfg = cfgOf({ freeExSpecialCount: 2 })
    // 免费 2 发：零闪能时就已兑现 2 次，但闪能门槛仍是「每 20 点一档」
    expect(resolveExSpecialCount(cfg, 0)).toBe(2)
    expect(resolveExSpecialCount(cfg, 19)).toBe(2)
    expect(resolveExSpecialCount(cfg, 20)).toBe(3)
    expect(exSpecialShortfallOf(cfg, 19)).toBe(1)
    // 门槛与次数同源：补上读数恰好多一次，少 ε 仍不多给
    for (const energy of [1, 19, 39.5, 50]) {
      const s = exSpecialShortfallOf(cfg, energy)
      const base = resolveExSpecialCount(cfg, energy)
      if (s > 0) {
        expect(resolveExSpecialCount(cfg, energy + s)).toBeCloseTo(base + 1, 9)
        expect(resolveExSpecialCount(cfg, energy + s - 1e-9)).toBeCloseTo(base, 9)
      }
    }
  })

  it('失衡内预留分支与 resolveExSpecialCount 同源（含成本为 0 的满额预留）', () => {
    // 预留 2 发、每发 20，成本 40：E=40 只够预留那 2 发 ⇒ 差一发（不是 0）
    const withCost = cfgOf({ exReservedCount: 2 })
    expect(resolveExSpecialCount(withCost, 40)).toBe(2)
    expect(exSpecialShortfallOf(withCost, 40)).toBe(20)
    expect(resolveExSpecialCount(withCost, 40 + exSpecialShortfallOf(withCost, 40))).toBe(3)
    expect(exSpecialShortfallOf(withCost, 60)).toBe(0)

    // 预留不花钱（exReservedEnergyCost = 0）⇒ 门槛序列 = k × consume，等价于无预留的成本面
    const freeReserve = cfgOf({ exReservedCount: 2, exReservedEnergyCost: 0 })
    for (const energy of [0, 0.5, 19, 20, 39.5, 40]) {
      const s = exSpecialShortfallOf(freeReserve, energy)
      const base = resolveExSpecialCount(freeReserve, energy)
      if (s > 0) expect(resolveExSpecialCount(freeReserve, energy + s)).toBeCloseTo(base + 1, 9)
    }

    // 预留本身也是付费的（缺省成本 = 预留量 × consume）⇒ 门槛序列 = 成本 + k × consume：
    // E=0 时先要把 3 发预留（60）攒出来、再攒第 4 发 ⇒ 读 80；E=60 恰在预留门槛上 ⇒ 读 20
    const paidReserve = cfgOf({ exReservedCount: 3 })
    expect(resolveExSpecialCount(paidReserve, 0)).toBe(3)
    expect(exSpecialShortfallOf(paidReserve, 0)).toBe(80)
    expect(exSpecialShortfallOf(paidReserve, 60)).toBe(20)
    expect(exSpecialShortfallOf(paidReserve, 61)).toBe(19)
    // 只有「预留不花钱」（exReservedEnergyCost = 0）时才退化为每 consume 一档
    const freeReserveAll = cfgOf({ exReservedCount: 3, exReservedEnergyCost: 0 })
    expect(exSpecialShortfallOf(freeReserveAll, 0)).toBe(20)
    expect(exSpecialShortfallOf(freeReserveAll, 60)).toBe(0)
  })

  it('★ 用户纠正（2026-10-19）：单价可调（持续释放滑块）的角色**没有**这个门槛', () => {
    // 洛克茜：consume = 10 + 30 × spinSeconds（滑块），玩家可以把这一发转短一点塞进剩余能量
    // ⇒ 不存在「差 X 点才能多打一发」的整数台阶。用户原话：
    // 「洛克茜的能量不是非得90才能整数释放，他有中间的持续释放滑块呀」
    const roxy = cfgOf({ agentId: '1621', skipGenericExSpecial: true, exSpecialEnergyConsume: 85 })
    expect(exSpecialShortfallOf(roxy, 765.3), '洛克茜报 84.67 = 假门槛').toBe(0)
    expect(exSpecialShortfallOf(roxy, 0)).toBe(0)

    // 同族的另外两条通路（持续型小数通道 / 实数通道）也必须恒 0
    const fractional = cfgOf({ exSpecialCountFractional: true, exSpecialEnergyConsume: 85 })
    expect(exSpecialShortfallOf(fractional, 765.3)).toBe(0)
    const continuous = cfgOf({ exContinuous: true, exRefundPerPaid: 15, exSpecialEnergyConsume: 85 })
    expect(exSpecialShortfallOf(continuous, 765.3)).toBe(0)

    // 反空洞：**同一份 consume、同一个能量**，把开关关掉就应报出真门槛（证明上面不是恒 0）
    const plain = cfgOf({ exSpecialEnergyConsume: 85 })
    expect(exSpecialShortfallOf(plain, 765.3)).toBeGreaterThan(0)
  })

  it('模块认领次数的角色（般岳嗔火循环）⇒ 0（免费强特与付费混编，闪能单价不成立）', () => {
    // 模块能力存在性先钉住（否则本用例会「因错误的原因通过」）
    expect(banyueMechanic.exSpecialCount).toBeTypeOf('function')
    const banyue = cfgOf({ agentId: '1471', isFlashUser: true, exSpecialEnergyConsume: 20 })
    expect(exSpecialShortfallOf(banyue, 19)).toBe(0)
    expect(exSpecialShortfallOf(banyue, 0)).toBe(0)
  })
})
