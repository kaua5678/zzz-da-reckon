/**
 * 触发型音擎效果覆盖率折算（wEngineConditionCoverage）的判据。
 *
 * 每个断言对应一个真实失败模式：
 * ① 三选一被当成三条同时满覆盖（13128 实测虚高 7.8pp）；
 * ② 失衡清空型的层数按满层算（13008 实测虚高约 3pp）；
 * ③ 未登记的效果被瞎折算（应当返回 null 回退既有行为）。
 */
import { describe, expect, it } from 'vitest'
import {
  STUN_CLEARED_STACK_EFFECTS,
  ENEMY_ANOMALY_EFFECTS,
  TRIGGER_GATED_EFFECTS,
  conditionCoverageOf,
  stunClearedStackLayers,
  triggerGateCoverage,
} from '@/data/wEngineConditionCoverage'

describe('triggerGateCoverage（触发门控）', () => {
  it('★ 轰鸣座驾三选一：15 次强特 × 5s / 180s = 41.7%，每种效果再 ×1/3 = 13.9%', () => {
    const uptime = triggerGateCoverage(15, 5, 180, 1 / 3)!
    expect(uptime).toBeCloseTo((15 * 5 / 180) / 3, 6)
    expect(uptime * 100).toBeCloseTo(13.89, 1)
  })

  it('覆盖率夹在 [0,1]：命中数极多时封顶 1；未跑资源（battleSeconds=0）返回 null', () => {
    expect(triggerGateCoverage(1000, 5, 180, 1)).toBe(1)
    expect(triggerGateCoverage(0, 5, 180, 1)).toBe(0)
    expect(triggerGateCoverage(15, 5, 0, 1)).toBeNull()
  })
})

describe('stunClearedStackLayers（失衡清空型平均层数）', () => {
  it('★ 用户算法：失衡 3 次 × 18s，非失衡 126s 分 3.5 段（每段 36s）+ 末段 18s ⇒ 平均 ≈ 2.62 层', () => {
    const layers = stunClearedStackLayers({
      battleSeconds: 180,
      stunCount: 3,
      stunWindowSeconds: 18,
      anomalyApplications: 22,
      maxStacks: 4,
    })!
    // 22 次施加 / 180s ⇒ 每 8.18s 一层，32.7s 到满层
    expect(layers).toBeCloseTo(2.62, 2)
  })

  it('★ 本队实测：2 次失衡 × 12s ⇒ 2.5 段非失衡（每段 62.4s）⇒ 平均 ≈ 2.91 层', () => {
    const layers = stunClearedStackLayers({
      battleSeconds: 180,
      stunCount: 2,
      stunWindowSeconds: 12,
      anomalyApplications: 22,
      maxStacks: 4,
    })!
    expect(layers).toBeCloseTo(2.91, 2)
  })

  it('无失衡 ⇒ 全程线性涨到满层；施加次数极密 ⇒ 满层', () => {
    const noStun = stunClearedStackLayers({ battleSeconds: 180, stunCount: 0, stunWindowSeconds: 12, anomalyApplications: 22, maxStacks: 4 })!
    expect(noStun).toBeGreaterThan(2.6)
    expect(noStun).toBeLessThan(4)
    expect(stunClearedStackLayers({ battleSeconds: 180, stunCount: 0, stunWindowSeconds: 12, anomalyApplications: 1000, maxStacks: 4 })).toBeGreaterThan(3.99)
  })

  it('输入不足 ⇒ null（不折算）', () => {
    expect(stunClearedStackLayers({ battleSeconds: 0, stunCount: 2, stunWindowSeconds: 12, anomalyApplications: 22, maxStacks: 4 })).toBeNull()
    expect(stunClearedStackLayers({ battleSeconds: 180, stunCount: 2, stunWindowSeconds: 12, anomalyApplications: 0, maxStacks: 4 })).toBeNull()
  })
})

describe('conditionCoverageOf（登记表派发）', () => {
  const base = {
    battleSeconds: 180,
    triggerCountValues: { exSpecial: 15, chain: 9, dodge: 10 },
    anomalyApplications: 22,
    stunCount: 2,
    stunWindowSeconds: 12,
    maxStacks: 4,
    defaultStacks: 4,
  }

  it('★ 13128 三条效果**同时在线**（0.3s ICD + 持续强特多次命中），不做 ÷3', () => {
    const ids = Object.keys(TRIGGER_GATED_EFFECTS).filter(id => id.startsWith('effect_wiki_494_'))
    expect(ids.length).toBe(3)
    for (const id of ids) {
      // 原文「多个效果可以同时存在」⇒ 三条各自独立，不瓜分同一份触发
      expect(TRIGGER_GATED_EFFECTS[id].sharePerTrigger, id).toBe(1)
      expect(TRIGGER_GATED_EFFECTS[id].sustainedSources, id).toEqual(['exSpecial'])
    }
  })

  it('★ 能量预算口径：每 20 能量 = 一次刷新 × **7 秒**（下砸 2s + 尾巴 5s）', () => {
    // 用户 2026-11-07：「实际上并不是 5 秒，而是 7 秒，他一个下砸耗时 2 秒，尾端还有 5s」
    //   「180/5×20 = 720 能量需求，他才 450」⇒ 满覆盖 720 能量、每次 7 秒
    const cov = conditionCoverageOf({ ...base, effectId: 'effect_wiki_494_self_atk', availableEnergy: 450 })!
    expect(cov).toBeCloseTo(450 / 20 * 7 / 180 * 100, 1) // 22.5 × 7 / 180 = 87.5%
    // 满覆盖能量 = 180 / 7 × 20 = 514.29 点（每次覆盖 7 秒，不是 5 秒）
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_494_self_atk', availableEnergy: 180 / 7 * 20 })).toBeCloseTo(100, 6)
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_494_self_atk', availableEnergy: 514 })).toBeCloseTo(99.94, 1)
    // 没给能量 ⇒ 退回占用秒数口径（不凭空断言满覆盖）
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_494_self_atk' })).not.toBe(100)
  })

  it('★ 占用秒数口径（无能量时的退路）：占用 + 每次施放的 5 秒尾巴', () => {
    const sustained = conditionCoverageOf({
      ...base,
      effectId: 'effect_wiki_494_self_atk',
      triggerCountValues: { exSpecial: 5.63 },
      triggerOccupiedSeconds: { exSpecial: 28.91 },
    })!
    // (28.91 占用 + 5s × 5.63 次尾巴) / 180s = 31.7%
    expect(sustained).toBeCloseTo(31.7, 1)
    // 反空：占用秒数也缺失 ⇒ 退化成「次数 × 5s」= 15.6%
    const neither = conditionCoverageOf({ ...base, effectId: 'effect_wiki_494_self_atk', triggerCountValues: { exSpecial: 5.63 } })!
    expect(neither).toBeCloseTo(15.6, 1)
    expect(sustained).toBeGreaterThan(neither)
  })

  it('★ 通用触发源分别取自己那类次数：连携终结读 chain、闪反读 dodge、多源取和', () => {
    // 13014 电波漫步（连携/终结，12s）：9 次 × 12s / 180s = 60%
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_1340_self_sheer_force' })!).toBeCloseTo(60, 1)
    // 13004 星徽引擎（闪避反击，12s）：10 次 × 12s / 180s = 66.7%
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_156_self_atk' })!).toBeCloseTo(66.67, 1)
    // 13111 旋钻机「强化特殊技**或**连携技」= 两源取和（15+9 = 24 次 × 10s / 180s = 100% 封顶）
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_265_self_basic_dash_electric_dmg' })!).toBe(100)
    // 13113 含羞恶面（强特，12s）：15 次 × 12s / 180s = 100%（封顶）
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_215_team_atk' })!).toBe(100)
  })

  it('★ 13106 家政员**不登记**：没有攻击段数数据 ⇒ 回退满覆盖（不硬算）', () => {
    // 用户 2026-11-07：「可琳自己带专武就给全 buff 就行，我们去计算 16% 其实不太准，
    //   目前还没有攻击段数的数据，没办法帮用户算。只能默认全 100% 了」
    // ⇒ 「15 层要几次命中才叠满」不可知时，登记任何数值都是假精度。
    expect(TRIGGER_GATED_EFFECTS.effect_wiki_264_self_physical_dmg).toBeUndefined()
    expect(STUN_CLEARED_STACK_EFFECTS.effect_wiki_264_self_physical_dmg).toBeUndefined()
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_264_self_physical_dmg' })).toBeNull()
  })

  it('★ 13008 双生泣星：2.91 层 / 满层 4 ⇒ 覆盖率 72.7%', () => {
    expect(Object.keys(STUN_CLEARED_STACK_EFFECTS)).toEqual(['effect_wiki_212_self_ap'])
    const cov = conditionCoverageOf({ ...base, effectId: 'effect_wiki_212_self_ap' })!
    expect(cov).toBeCloseTo(72.7, 1)
  })

  it('★ 反锁：**无条件**的效果绝不许登记（否则把白送的加成折掉）', () => {
    // 这三条原文都是「××提升 N%；（另一条）发动强特时…」——前半条不依赖触发，
    // catalog 的 condition 挂在整组上只为表达后半条。登记它们 = 主词条被白砍。
    const unconditional = [
      'effect_wiki_214_self_atk',   // 14118 嵌合编译器：攻击力+12% 无条件
      'effect_wiki_1721_self_crit_rate', // 14147 怒目金刚：暴击率+20% 无条件
      'effect_wiki_215_self_ice_dmg',    // 13113 含羞恶面：冰属性伤害+15% 无条件
    ]
    for (const id of unconditional) {
      expect(TRIGGER_GATED_EFFECTS[id], id).toBeUndefined()
      expect(STUN_CLEARED_STACK_EFFECTS[id], id).toBeUndefined()
      expect(conditionCoverageOf({ ...base, effectId: id }), id).toBeNull()
    }
  })

  it('★ 自身向效果的**分母是战场时间**，不是整场 180 秒', () => {
    // 用户 2026-11-07：「这种招式打了吃 buff 似乎不该用 180s 算，而是用自己战场时间算。
    //   角色通常会在有 buff 的时候多打，没 buff 的时候换别人打」
    // 派派：能量 477 / 20 = 23.85 次刷新 × 7s = 167s，战场 83.1s ⇒ 封顶 100%
    expect(conditionCoverageOf({
      ...base, effectId: 'effect_wiki_494_self_atk', availableEnergy: 477, frontlineSeconds: 83.1,
    })).toBe(100)
    // 同一份输入若按整场 180s 算只有 92.8%（可见分母口径的影响）
    expect(conditionCoverageOf({
      ...base, effectId: 'effect_wiki_494_self_atk', availableEnergy: 477,
    })!).toBeCloseTo(477 / 20 * 7 / 180 * 100, 1)
    // 队伍向效果（13113 全队攻击）仍用整场时长：9 次 × 12s / 180s = 60%
    expect(conditionCoverageOf({
      ...base, effectId: 'effect_wiki_215_team_atk', triggerCountValues: { exSpecial: 9 }, frontlineSeconds: 116,
    })!).toBeCloseTo(60, 1)
  })

  it('★ 触电唇彩「敌方是否处于异常」是二值判据，且与双生**共用同一个异常计数器**', () => {
    // 用户 2026-11-07：「触电的异常次数和双生重合了吧，这不是通用计数器吗」
    expect([...ENEMY_ANOMALY_EFFECTS].sort()).toEqual(['effect_wiki_210_self_atk', 'effect_wiki_210_self_dmg'])
    // 异常队（施加 > 0）⇒ 100%，与双生同一输入
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_210_self_atk' })).toBe(100)
    // 纯直伤队（没人挂异常）⇒ 0%，不再白送 +16% 攻击 +25% 增伤
    expect(conditionCoverageOf({ ...base, anomalyApplications: 0, effectId: 'effect_wiki_210_self_atk' })).toBe(0)
    // 双生在同一输入下仍然按层数折算（两者判据形态不同、源头同一个）
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_212_self_ap' })!).toBeGreaterThan(0)
  })

  it('未登记的效果返回 null（回退既有行为，不瞎折算）', () => {
    expect(conditionCoverageOf({ ...base, effectId: 'effect_wiki_208_self_dmg' })).toBeNull()
    expect(conditionCoverageOf({ ...base, effectId: '' })).toBeNull()
  })
})