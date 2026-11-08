/**
 * 知更鸟（1661）终结技「全队[锋御]固定回复 20 点[锐能]」——跨槽给养的判据（2026-11-08 批 2）。
 *
 * 原文（spec 1661 终结技 1661010）：「队伍中所有[锋御]角色固定回复 20 点[锐能]」。
 * 落点 = `robin.ts#applyRobinSharpnessGift`（**postRound** 相位）写每个锋御**队友**的
 * `cfg.sharpnessGiftFromTeam`，锋御模块再把它作为一条 `gifts` 喂 `sharpnessIncome`。
 *
 * 本文件锁三条**用户点名要的判据**：
 * ① 单锋御队：该锋御锐能池 **+20 × 知更鸟终结技次数**（不是 ×3、不是 ×她自己次数）；
 * ② 无锋御队：**零写**（连自己的槽都不写——缺省 = 本局该来源不发生）；
 * ③ 她自己的槽不写（原文限定 [锋御]；她是 [防护]）。
 *
 * ⚠ 还锁一条**空槽压缩**负控（判据 17 的经典缺陷）：前导空槽下 `ultimateCounts[slot]` ≠ 她的次数。
 */
import { describe, expect, it } from 'vitest'
import type { AgentTeamConfigInput } from '@/mechanics/types'
import { ROBIN_ULT_TEAM_SHARPNESS, robinMechanic } from '@/mechanics/agents/robin'
import { SHARPNESS_INITIAL, sharpnessIncome } from '@/mechanics/sharpnessIncome'

/** 手搭一槽 cfg（只填本判据用得到的字段） */
function cfgOf(slot: number, agentId: string) {
  return { slot, agentId } as any
}

/** 手搭 team 快照（只填 specialty 判据需要的两项） */
function memberOf(slot: number, agentId: string, specialty: string | null) {
  return { slot, agentId, agent: specialty ? ({ id: agentId, specialty } as any) : null, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 }
}

/** 跑一次 robin 的 applyTeamConfig（只有 postRound 会对给养动手） */
function runPostRound(opts: {
  slot: number
  characters: any[]
  team: any[]
  ultimateCounts: number[]
}): void {
  const hook = robinMechanic.applyTeamConfig!
  hook({
    slot: opts.slot,
    cfg: opts.characters.find(c => c.slot === opts.slot)!,
    characters: opts.characters,
    team: opts.team,
    phase: 'postRound',
    ultimateCounts: opts.ultimateCounts,
    combatTime: 180,
    cinemaLevel: 0,
    potentialLevel: 6,
    settings: {},
    agent: null,
    exCounts: [],
    stunCount: 0,
    teamEnergyConsumed: 0,
  } as unknown as AgentTeamConfigInput)
}

describe('知更鸟终结技 · 全队锋御锐能给养（3.4.3）', () => {
  it('常量口径 = 20 点/次（原文「固定回复 20 点[锐能]」）', () => {
    expect(ROBIN_ULT_TEAM_SHARPNESS).toBe(20)
  })

  it('① 单锋御队：知更鸟 3 次终结技 ⇒ 挽昼 +60（= 20 × 3），池子随之 +60', () => {
    const robin = cfgOf(0, '1661')
    const sun = cfgOf(1, '1601')
    const pad = cfgOf(2, '1011')
    const team = [
      memberOf(0, '1661', 'defense'),
      memberOf(1, '1601', 'sharpen'),
      memberOf(2, '1011', 'stun'),
    ]
    runPostRound({ slot: 0, characters: [robin, sun, pad], team, ultimateCounts: [3, 1, 1] })
    expect(sun.sharpnessGiftFromTeam).toBe(60)
    // 非锋御队友不受影响
    expect(pad.sharpnessGiftFromTeam).toBeUndefined()
    // 池子口径：同一套收支式 + 这条 gift ⇒ 正好 +60
    const without = sharpnessIncome({ initial: SHARPNESS_INITIAL, regenPerSec: 1.5, seconds: 180 })
    const withGift = sharpnessIncome({
      initial: SHARPNESS_INITIAL, regenPerSec: 1.5, seconds: 180, gifts: [sun.sharpnessGiftFromTeam],
    })
    expect(withGift.total - without.total).toBe(60)
  })

  it('① 双锋御队：两个都以同一个 20×n 给养（不是把总池按槽拆分）', () => {
    const robin = cfgOf(0, '1661')
    const claret = cfgOf(1, '1611')
    const sun = cfgOf(2, '1601')
    const team = [
      memberOf(0, '1661', 'defense'),
      memberOf(1, '1611', 'sharpen'),
      memberOf(2, '1601', 'sharpen'),
    ]
    runPostRound({ slot: 0, characters: [robin, claret, sun], team, ultimateCounts: [2, 9, 9] })
    // 「全队每个锋御固定 20」⇒ 各自 +40，与她/他们自己打了几次终结算无关
    expect(claret.sharpnessGiftFromTeam).toBe(40)
    expect(sun.sharpnessGiftFromTeam).toBe(40)
  })

  it('② 无锋御队：零写（不写自己、不写队友、不留 0 残留）', () => {
    const robin = cfgOf(0, '1661')
    const stun = cfgOf(1, '1011')
    const sup = cfgOf(2, '1411')
    const team = [
      memberOf(0, '1661', 'defense'),
      memberOf(1, '1011', 'stun'),
      memberOf(2, '1411', 'support'),
    ]
    runPostRound({ slot: 0, characters: [robin, stun, sup], team, ultimateCounts: [5, 2, 2] })
    expect(robin.sharpnessGiftFromTeam).toBeUndefined()
    expect(stun.sharpnessGiftFromTeam).toBeUndefined()
    expect(sup.sharpnessGiftFromTeam).toBeUndefined()
  })

  it('③ 她自己的槽不写：哪怕她把 specialty 当成 sharpen 也一样（判据是「队友」+ specialty）', () => {
    const robin = cfgOf(0, '1661')
    const sun = cfgOf(1, '1601')
    const team = [
      memberOf(0, '1661', 'sharpen'), // 假设将来她改成锐能职业
      memberOf(1, '1601', 'sharpen'),
    ]
    runPostRound({ slot: 0, characters: [robin, sun], team, ultimateCounts: [4, 1] })
    expect(robin.sharpnessGiftFromTeam, '她自己的槽恒不写').toBeUndefined()
    expect(sun.sharpnessGiftFromTeam).toBe(80)
  })

  it('0 次终结技 ⇒ 写 0 而不是留上一轮残值（幂等：绝对写不是 += )', () => {
    const robin = cfgOf(0, '1661')
    const sun = cfgOf(1, '1601')
    const team = [memberOf(0, '1661', 'defense'), memberOf(1, '1601', 'sharpen')]
    // 先写一轮 3 次 ⇒ 60
    runPostRound({ slot: 0, characters: [robin, sun], team, ultimateCounts: [3, 1] })
    expect(sun.sharpnessGiftFromTeam).toBe(60)
    // 再跑一轮 0 次 ⇒ 必须清成 0（不然上一轮的 60 会一直留在池里）
    runPostRound({ slot: 0, characters: [robin, sun], team, ultimateCounts: [0, 1] })
    expect(sun.sharpnessGiftFromTeam).toBe(0)
    // 幂等：同样输入跑两遍结果相同（不是 60 → 120）
    runPostRound({ slot: 0, characters: [robin, sun], team, ultimateCounts: [2, 1] })
    runPostRound({ slot: 0, characters: [robin, sun], team, ultimateCounts: [2, 1] })
    expect(sun.sharpnessGiftFromTeam).toBe(40)
  })

  it('★ 空槽压缩负控（判据 17）：知更鸟在槽2 ⇒ 取她的次数不能用 ultimateCounts[slot]', () => {
    // 队 = 槽2 知更鸟 + 槽0 挽昼；characters 按位置压缩后 = [挽昼(槽0), 知更鸟(槽2)]
    // ⇒ characters[0].slot = 0（不是知更鸟），ultimateCounts 同序，她的次数在下标 1。
    const sun = cfgOf(0, '1601')
    const robin = cfgOf(2, '1661')
    const team = [memberOf(0, '1601', 'sharpen'), memberOf(2, '1661', 'defense')]
    // 下标序 = [挽昼, 知更鸟] ⇒ 知更鸟 3 次终结技（下标 1），挽昼 1 次（下标 0）
    runPostRound({ slot: 2, characters: [sun, robin], team, ultimateCounts: [1, 3] })
    expect(sun.sharpnessGiftFromTeam, '必须按她的下标(1)取 3 次 ⇒ 60，不是 ultimateCounts[2] 的 undefined').toBe(60)
  })
})
