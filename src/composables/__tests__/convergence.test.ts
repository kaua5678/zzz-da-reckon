/**
 * convergence.ts 租户的定向单测（#10 落点的行为契约）。
 *
 * computePromiaNextRoundFeedback：普罗米娅·霜刑下一轮反馈。这些口径散在注释里
 * （「队友异放排除自身」「自身只认两条 eventId ×100」「首轮才写回 characters」），
 * 搬出成纯函数后逐条钉死——角色特判迁进落点时，**测试与分支一起搬**才算真清偿的样板。
 */
import { describe, expect, it } from 'vitest'
import {
  computeAnbyNextRoundFeedback,
  computeEllenNextRoundFeedback,
  computeLucyNextRoundFeedback,
  computePromiaNextRoundFeedback,
  computeVivianNextRoundFeedback,
} from '@/composables/resourceCalc/convergence'
import type { AnomalyPoolResult, TeamResourceResult } from '@/types/resource'

const ev = (o: Partial<{ eventType: string; eventId: string; count: number }> = {}) => ({
  eventType: 'release', eventId: 'promia_execution_release', count: 1, ...o,
})
const ch = (agentId: string, events: unknown[] = []) => ({ agentId, anomalyEventExecutions: events })
const castCh = (arr: Array<ReturnType<typeof ch>>) => arr as never
const team = (chars: Array<ReturnType<typeof ch>>) => ({ characters: chars } as unknown as TeamResourceResult)

const run = (o: Partial<Parameters<typeof computePromiaNextRoundFeedback>[0]> = {}) =>
  computePromiaNextRoundFeedback({
    characters: [], ap1: null, rrShown: null, rr: team([]),
    prevPromiaTriggerHits: 0, prevPromiaTeammateReleases: 0, ...o,
  })

describe('computePromiaNextRoundFeedback', () => {
  it('队内无 1541 → 三值全 0 且不写回任何角色', () => {
    const chars = castCh([ch('1471'), ch('1481')]) as unknown as Array<{ agentId: string } & Record<string, unknown>>
    const r = run({ characters: chars as never, ap1: { totalTriggerCount: 7 } as unknown as AnomalyPoolResult })
    expect(r).toEqual({ promiaTriggerHitsNext: 0, promiaTeammateReleasesNext: 0, promiaReleaseDecibelNext: 0 })
    expect(chars.every(c => !('promiaTriggerHitCount' in c))).toBe(true)
  })

  it('触发命中数读上一轮异常池；ap1 为 null → 0', () => {
    const r = run({
      characters: castCh([ch('1541')]),
      ap1: { totalTriggerCount: 9 } as unknown as AnomalyPoolResult,
    })
    expect(r.promiaTriggerHitsNext).toBe(9)
    expect(run({ characters: castCh([ch('1541')]) }).promiaTriggerHitsNext).toBe(0)
  })

  it('队友异放：排除普罗米娅自身、只数 release 且 count>0、逐事件 floor 求和', () => {
    const r = run({
      characters: castCh([ch('1541')]),
      rr: team([
        ch('1471', [ev({ count: 2.7 }), ev({ eventType: 'disorder', count: 5 }), ev({ count: 0 })]),
        ch('1481', [ev({ count: 1 })]),
        ch('1541', [ev({ count: 9 })]),   // 自身不计队友异放
      ]),
    })
    expect(r.promiaTeammateReleasesNext).toBe(Math.floor(2.7) + Math.floor(1))  // 2 + 1
  })

  it('自身异放回喧响：只认绝裁/影画6两条 eventId，各 ×100', () => {
    const r = run({
      characters: castCh([ch('1541')]),
      rr: team([
        ch('1541', [
          ev({ eventId: 'promia_execution_release', count: 2 }),
          ev({ eventId: 'promia_c6_special_release', count: 1 }),
          ev({ eventId: 'other_release', count: 8 }),
        ]),
      ]),
    })
    expect(r.promiaReleaseDecibelNext).toBe(300)
  })

  it('★ 写回只在首轮（上轮两线程皆 ≤0）；二轮起 characters 不再被触碰', () => {
    const first = castCh([ch('1541')])
    run({ characters: first, rr: team([ch('1471', [ev({ count: 2 })])]), ap1: { totalTriggerCount: 5 } as unknown as AnomalyPoolResult })
    expect((first[0] as Record<string, unknown>).promiaTriggerHitCount).toBe(5)
    expect((first[0] as Record<string, unknown>).promiaTeammateReleaseCount).toBe(2)

    const second = castCh([ch('1541')])
    run({
      characters: second,
      rr: team([ch('1471', [ev({ count: 2 })])]),
      prevPromiaTriggerHits: 5, prevPromiaTeammateReleases: 2,
    })
    expect('promiaTriggerHitCount' in (second[0] as object)).toBe(false)
  })

  it('rrShown 优先于 rr（展示口径行集与装配同源），缺失回退 rr', () => {
    const o = {
      characters: castCh([ch('1541')]),
      rr: team([ch('1471', [ev({ count: 4 })])]),
    }
    const withShown = run({ ...o, rrShown: team([ch('1471', [ev({ count: 1 })])]) })
    expect(withShown.promiaTeammateReleasesNext).toBe(1)
    expect(run(o).promiaTeammateReleasesNext).toBe(4)
  })
})

describe('computeLucyNextRoundFeedback（露西 C6，第 3 批）', () => {
  const rr = (chars: unknown[]) => ({ characters: chars }) as never
  it('队友强特合计排除自身', () => {
    expect(computeLucyNextRoundFeedback({
      characters: [{ agentId: '1151' }],
      rr: rr([{ agentId: '1151', exSpecialCount: 2 }, { agentId: 'a', exSpecialCount: 3 }]),
    }).lucyTeammateExNext).toBe(3)
  })
  it('★ 写回无首轮守卫（每轮都做）：C6 spins = 自身强特 + C2(连携+终结) + C6(队友合计)', () => {
    const chars: Array<{ agentId: string } & Record<string, unknown>> = [{ agentId: '1151', lucyCinemaLevel: 6 }]
    computeLucyNextRoundFeedback({
      characters: chars,
      rr: rr([{ agentId: '1151', exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1 }, { agentId: 'a', exSpecialCount: 3 }]),
    })
    expect(chars[0].lucyCheerSpinsEstimate).toBe(2 + 2 + 3)
    expect(chars[0].lucyTeammateExTotal).toBe(3)
    // 再来一轮（非首轮）仍写回——与 promia/vivian 的守卫不同，此差异是口径
    computeLucyNextRoundFeedback({ characters: chars, rr: rr([{ agentId: '1151', exSpecialCount: 5 }]) })
    expect(chars[0].lucyCheerSpinsEstimate).toBe(5)
  })
  it('C0 无连携/终结附加项', () => {
    const chars: Array<{ agentId: string } & Record<string, unknown>> = [{ agentId: '1151' }]
    computeLucyNextRoundFeedback({ characters: chars, rr: rr([{ agentId: '1151', exSpecialCount: 4, chainCountTotal: 9, ultimateCount: 9 }]) })
    expect(chars[0].lucyCheerSpinsEstimate).toBe(4)
  })
})

describe('computeAnbyNextRoundFeedback（安比白雷，第 3 批）', () => {
  const catalog = { getAgentSkills: () => undefined } as never
  const rr = (chars: unknown[]) => ({ characters: chars }) as never
  it('无 1381 不产层数；有则 hits 折层 floor(t×0.5×0.75)... 常数 16.667/33.333=0.5', () => {
    expect(computeAnbyNextRoundFeedback({
      az: rr([{ agentId: 'a', executions: [{ skillDamageTarget: 'additionalAttack', count: 10 }] }]),
      catalogStore: catalog, battleTime: 180,
    }).anbyZeroTeammateWlNext).toBe(0)
    expect(computeAnbyNextRoundFeedback({
      az: rr([{ agentId: '1381' }, { agentId: 'a', executions: [{ skillDamageTarget: 'additionalAttack', count: 10 }] }]),
      catalogStore: catalog, battleTime: 180,
    }).anbyZeroTeammateWlNext).toBe(Math.floor(10 * (16.667 / 33.333) * 0.75))
  })
  it('ICD 上限 = floor(战斗/5)：命中数封顶；battleTime 缺省 180', () => {
    const r = computeAnbyNextRoundFeedback({
      az: rr([{ agentId: '1381' }, { agentId: 'a', executions: [{ skillDamageTarget: 'additionalAttack', count: 99 }] }]),
      catalogStore: catalog, battleTime: 20,
    })
    expect(r.anbyZeroTeammateWlNext).toBe(Math.floor(4 * 0.5 * 0.75))  // icdCap=4
  })
})

describe('computeVivian / computeEllen（第 3 批，同款首轮守卫）', () => {
  const rr = (chars: unknown[]) => ({ characters: chars }) as never
  const ap = (els: unknown[]) => ({ perElement: els }) as never
  it('薇薇安：无 1331 全 0；有则源1 含自身强特、源2 求和 perElement 触发数', () => {
    const chars: Array<{ agentId: string } & Record<string, unknown>> = [{ agentId: '1331' }]
    const r = computeVivianNextRoundFeedback({
      characters: chars, rr: rr([{ agentId: '1331', exSpecialCount: 2 }, { agentId: 'a', exSpecialCount: 3 }]),
      ap1: ap([{ triggerCount: 4 }, { triggerCount: 1 }]), prevVivianTeamEx: 0,
    })
    expect(r).toEqual({ vivianTeamExNext: 5, vivianAnomalyTriggersNext: 5 })
    expect(chars[0].vivianTeamExTotal).toBe(5)
    const second: Array<{ agentId: string } & Record<string, unknown>> = [{ agentId: '1331' }]
    computeVivianNextRoundFeedback({ characters: second, rr: rr([]), ap1: ap([]), prevVivianTeamEx: 5 })
    expect('vivianTeamExTotal' in second[0]).toBe(false)  // 非首轮不写回
  })
  it('艾莲：只数 ice 元素触发；首轮写回守卫', () => {
    const chars: Array<{ agentId: string } & Record<string, unknown>> = [{ agentId: '1191' }]
    const r = computeEllenNextRoundFeedback({
      characters: chars,
      ap1: ap([{ element: 'ice', triggerCount: 6 }, { element: 'fire', triggerCount: 9 }]),
      prevEllenFreezeCount: 0,
    })
    expect(r.ellenFreezeCountNext).toBe(6)
    expect(chars[0].ellenFreezeCount).toBe(6)
  })
})
