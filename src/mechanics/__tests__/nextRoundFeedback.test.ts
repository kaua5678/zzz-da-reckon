/**
 * `nextRoundFeedback` 钩子的行为契约（2026-09-16 arch 棘轮第 6 批迁移的落点测试）。
 *
 * 为什么必须单独有这个文件（同 `teamHook.test.ts` 头注的理由）：这 5 条反馈原本是
 * `convergence.ts` 里 5 个导出纯函数，由同名文件 `composables/__tests__/convergence.test.ts`
 * 直接单测。迁进各角色模块后，**「钩子到底有没有被派发」在原有测试网里完全不可见**——
 * 模块写错字段名 / 派发器漏调 / 忘挂 `nextRoundFeedback`，全管线测试照样全绿
 * （实测：`timeGolden` 对这 4 处 cfg 写回**完全不敏感**，见下）。
 *
 * ## 实测背景（迁移时亲测，决定了本文件的断言形态）
 * 把这 4 处带守卫的 cfg 写回全部短路（`if (false && …)`；露西那处本就无条件、短路的是外层 `if (lucyCh)`）后：
 * - `npx vitest run timeGolden` → **3 passed，0 delta**（它只看伤害/时间账，不看这些 cfg 字段）；
 * - `npm run check` → 只有 `convergence.test.ts` 的 5 条单测变红（迁移后即本文件）。
 * ⇒ 这些写回**唯一的护栏就是本文件**（交接文档纪律 4 的实证：`timeGolden` 覆盖不到非轴路径）。
 * ⚠ 注意区分：**写回 cfg** 与**返回值 → threads 跨轮生效** 是两条不同的路（见下方「写回的真实作用域」）；
 * 上表测的是前者。后者 `timeGolden` 是**部分**看得见的（5 站点里 4 个红、露西盲），见管线级用例段。
 *
 * ## 首轮守卫语义**各不相同**，逐位钉死（迁移时最容易"顺手统一"的地方）
 * - 普罗米娅 1541 / 薇薇安 1331 / 艾莲 1191 = `prev* <= 0`（首轮）**才**写回 cfg；
 * - 露西 1151 = **每轮无条件写**（消费端 `crossAgentSupply.perTargetAmounts` 读的就是本轮估计值）。
 *
 * ## ⚠ 写回的真实作用域（迁移时探明，别被字段名骗）
 * `runCalcRound` 每轮从 `base.characters` **重新 spread** 出 cfg 数组 ⇒ 写回**不跨轮留存**。
 * 跨轮真正生效的通道 = 钩子**返回值** → `threadsNext` → 下一轮 `applyTeamConfig(converge)`
 * 读 `threads` 写 cfg。所以本文件两条腿都要测：① 返回值（生效路径）；② cfg 写回（展示口径 +
 * 守卫语义，迁移前就在写，逐位保留）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'
import { initialCalcRoundThreads } from '@/composables/resourceCalc/roundThreads'
import type { AgentNextRoundFeedbackInput } from '@/mechanics/types'

// ── 构造器：只填钩子真正读到的字段，其余用最小代价补齐（真实对象形状见 types/resource） ──

/** 一个「本轮结果」行：只有 5 条反馈读到的字段有意义 */
const row = (o: Record<string, unknown> = {}) => ({ agentId: 'x', ...o })
const teamResult = (chars: unknown[]) => ({ characters: chars }) as never
const anomalyPool = (o: Record<string, unknown> = {}) => ({ perElement: [], ...o }) as never
const skillsOf = (cats: unknown[] = []) => ({ categories: cats }) as never

/** 直接调某个角色的 `nextRoundFeedback`（派发器的等价最小复现：给 cfg + 全队 + 本轮结果） */
function run(agentId: string, o: { cfg?: Record<string, unknown> } & Partial<AgentNextRoundFeedbackInput> = {}) {
  // `cfg` 单列（不靠展开覆盖），避免同一 key 出现两次
  const { cfg: cfgIn, ...rest } = o
  const cfg = (cfgIn ?? { agentId, slot: 0 }) as never
  const input = {
    slot: 0,
    characters: [cfg],
    teamResult: teamResult([]),
    displayResult: undefined,
    adjustedResult: null,
    anomalyPool: null,
    prevThreads: initialCalcRoundThreads(),
    combatTime: 180,
    getAgentSkills: () => undefined,
    ...rest,
    cfg,
  } as AgentNextRoundFeedbackInput
  const hook = getAgentMechanic(agentId)?.nextRoundFeedback
  expect(typeof hook, `${agentId} 未声明 nextRoundFeedback —— 反馈会静默归零`).toBe('function')
  const cfgRec = cfg as unknown as Record<string, unknown>
  return { ret: hook!(input) ?? {}, cfg: cfgRec }
}

// ── 图：钩子必须挂上（防「迁完忘了挂」= 5 条反馈静默归零） ─────────────────────────
describe('nextRoundFeedback 接線', () => {
  it('★ 5 个已迁移角色都声明了 nextRoundFeedback（防迁移后忘挂钩子 → 反馈静默归零）', () => {
    for (const [agentId, name] of [
      ['1541', '普罗米娅'], ['1381', '零号·安比'], ['1151', '露西'], ['1331', '薇薇安'], ['1191', '艾莲'],
    ] as const) {
      expect(
        typeof getAgentMechanic(agentId)?.nextRoundFeedback,
        `${name}(${agentId}) 未声明 nextRoundFeedback`,
      ).toBe('function')
    }
  })
})

// ── 普罗米娅 1541 ───────────────────────────────────────────────────────────────
describe('普罗米娅 1541：触发命中 / 队友异放 / 自身异放回喧响', () => {
  const ev = (o: Partial<{ eventType: string; eventId: string; count: number }> = {}) => ({
    eventType: 'release', eventId: 'promia_execution_release', count: 1, ...o,
  })

  it('队内无 1541 → 三值全 0 且不写回任何角色', () => {
    // 用 1471 的 cfg 调 1541 的钩子（等价「队里没有普罗米娅」：派发器不会派到她）
    const chars = [row({ agentId: '1471' }), row({ agentId: '1481' })]
    const { ret } = run('1541', {
      cfg: { agentId: '1471', slot: 0 } as never,
      characters: chars as never,
      anomalyPool: { totalTriggerCount: 7 } as never,
    })
    expect(ret).toEqual({ promiaTriggerHits: 0, promiaTeammateReleases: 0, promiaReleaseDecibel: 0 })
    expect(chars.every(c => !('promiaTriggerHitCount' in c))).toBe(true)
  })

  it('触发命中数读异常池 totalTriggerCount；池为 null → 0', () => {
    expect(run('1541', { anomalyPool: { totalTriggerCount: 9 } as never }).ret.promiaTriggerHits).toBe(9)
    expect(run('1541', { anomalyPool: null }).ret.promiaTriggerHits).toBe(0)
  })

  it('队友异放：排除普罗米娅自身、只数 release 且 count>0、逐事件 floor 求和', () => {
    const { ret } = run('1541', {
      teamResult: teamResult([
        row({ agentId: '1471', anomalyEventExecutions: [ev({ count: 2.7 }), ev({ eventType: 'disorder', count: 5 }), ev({ count: 0 })] }),
        row({ agentId: '1481', anomalyEventExecutions: [ev({ count: 1 })] }),
        row({ agentId: '1541', anomalyEventExecutions: [ev({ count: 9 })] }), // 自身不计队友异放
      ]),
    })
    expect(ret.promiaTeammateReleases).toBe(Math.floor(2.7) + Math.floor(1)) // 2 + 1
  })

  it('自身异放回喧响：只认绝裁/影画6两条 eventId，各 ×100', () => {
    const { ret } = run('1541', {
      teamResult: teamResult([
        row({
          agentId: '1541',
          anomalyEventExecutions: [
            ev({ eventId: 'promia_execution_release', count: 2 }),
            ev({ eventId: 'promia_c6_special_release', count: 1 }),
            ev({ eventId: 'other_release', count: 8 }),
          ],
        }),
      ]),
    })
    expect(ret.promiaReleaseDecibel).toBe(300)
  })

  it('★ 写回只在首轮（上轮两线程皆 ≤0）；二轮起 characters 不再被触碰', () => {
    const first = run('1541', {
      teamResult: teamResult([row({ agentId: '1471', anomalyEventExecutions: [ev({ count: 2 })] })]),
      anomalyPool: { totalTriggerCount: 5 } as never,
    })
    expect(first.cfg.promiaTriggerHitCount).toBe(5)
    expect(first.cfg.promiaTeammateReleaseCount).toBe(2)

    // 二轮：prevThreads 带上轮值 ⇒ 守卫不成立 ⇒ 不写
    const second = run('1541', {
      teamResult: teamResult([row({ agentId: '1471', anomalyEventExecutions: [ev({ count: 2 })] })]),
      prevThreads: { ...initialCalcRoundThreads(), promiaTriggerHits: 5, promiaTeammateReleases: 2 },
    })
    expect('promiaTriggerHitCount' in second.cfg).toBe(false)
  })

  it('displayResult 优先于 teamResult（展示口径行集与装配同源），缺失回退 teamResult', () => {
    const o = {
      teamResult: teamResult([row({ agentId: '1471', anomalyEventExecutions: [ev({ count: 4 })] })]),
    }
    expect(run('1541', { ...o, displayResult: teamResult([row({ agentId: '1471', anomalyEventExecutions: [ev({ count: 1 })] })]) }).ret.promiaTeammateReleases).toBe(1)
    expect(run('1541', o).ret.promiaTeammateReleases).toBe(4)
  })
})

// ── 露西 1151 ──────────────────────────────────────────────────────────────────
describe('露西 1151（C6 回旋预估）', () => {
  it('队友强特合计排除自身', () => {
    const { ret } = run('1151', {
      teamResult: teamResult([row({ agentId: '1151', exSpecialCount: 2 }), row({ agentId: 'a', exSpecialCount: 3 })]),
    })
    expect(ret.lucyTeammateEx).toBe(3)
  })

  it('★ 写回无首轮守卫（每轮都做）：C6 spins = 自身强特 + C2(连携+终结) + C6(队友合计)', () => {
    const cfg: Record<string, unknown> = { agentId: '1151', slot: 0, lucyCinemaLevel: 6 }
    const rr = teamResult([
      row({ agentId: '1151', exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1 }),
      row({ agentId: 'a', exSpecialCount: 3 }),
    ])
    const r1 = run('1151', { cfg: cfg as never, characters: [cfg] as never, teamResult: rr })
    expect(r1.cfg.lucyCheerSpinsEstimate).toBe(2 + 2 + 3)
    expect(r1.cfg.lucyTeammateExTotal).toBe(3)
    // 再来一轮（非首轮）仍写回——与 promia/vivian/ellen 的守卫不同，此差异是口径
    const r2 = run('1151', {
      cfg: cfg as never, characters: [cfg] as never,
      teamResult: teamResult([row({ agentId: '1151', exSpecialCount: 5 })]),
      prevThreads: { ...initialCalcRoundThreads(), lucyTeammateEx: 99 },
    })
    expect(r2.cfg.lucyCheerSpinsEstimate).toBe(5)
  })

  it('C0 无连携/终结附加项', () => {
    const cfg: Record<string, unknown> = { agentId: '1151', slot: 0 }
    const { cfg: out } = run('1151', {
      cfg: cfg as never, characters: [cfg] as never,
      teamResult: teamResult([row({ agentId: '1151', exSpecialCount: 4, chainCountTotal: 9, ultimateCount: 9 })]),
    })
    expect(out.lucyCheerSpinsEstimate).toBe(4)
  })

  it('★ 写回目标是**全队每一份 cfg**（crossAgentSupply 会读落点那份）', () => {
    const lucy: Record<string, unknown> = { agentId: '1151', slot: 0, lucyCinemaLevel: 6 }
    const mate: Record<string, unknown> = { agentId: 'a', slot: 1 }
    run('1151', {
      cfg: lucy as never, characters: [lucy, mate] as never,
      teamResult: teamResult([row({ agentId: '1151', exSpecialCount: 2 }), row({ agentId: 'a', exSpecialCount: 3 })]),
    })
    expect(mate.lucyCheerSpinsEstimate, '队友那份 cfg 也要写（落点读取）').toBe(2 + 0 + 3)
    expect(mate.lucyTeammateExTotal).toBe(3)
  })
})

// ── 零号·安比 1381 ─────────────────────────────────────────────────────────────
describe('零号·安比 1381（白雷层数）', () => {
  const additional = (count: number) => row({ agentId: 'a', executions: [{ skillDamageTarget: 'additionalAttack', count }] })

  it('结果行集无 1381 不产层数；有则 hits 折层 floor(t×0.5×0.75)（16.667/33.333=0.5）', () => {
    expect(run('1381', { teamResult: teamResult([additional(10)]) }).ret.anbyZeroTeammateWl).toBe(0)
    expect(run('1381', { teamResult: teamResult([row({ agentId: '1381' }), additional(10)]) }).ret.anbyZeroTeammateWl)
      .toBe(Math.floor(10 * (16.667 / 33.333) * 0.75))
  })

  it('ICD 上限 = floor(战斗/5)：命中数封顶', () => {
    expect(run('1381', {
      teamResult: teamResult([row({ agentId: '1381' }), additional(99)]),
      combatTime: 20,
    }).ret.anbyZeroTeammateWl).toBe(Math.floor(4 * 0.5 * 0.75)) // icdCap=4
  })

  it('行上没有 skillDamageTarget 时按 catalog moveId 现场推断 additionalAttack', () => {
    const cats = [{ id: 'special', moves: [{ id: 'm1', skillTags: ['additionalAttack'] }] }]
    const { ret } = run('1381', {
      teamResult: teamResult([row({ agentId: '1381' }), row({ agentId: 'a', executions: [{ moveId: 'm1', count: 8 }] })]),
      getAgentSkills: () => skillsOf(cats),
    })
    expect(ret.anbyZeroTeammateWl).toBe(Math.floor(8 * 0.5 * 0.75))
  })

  it('adjustedResult 优先于 teamResult（诺姆赠链/琉音转大落地后口径）', () => {
    const { ret } = run('1381', {
      teamResult: teamResult([row({ agentId: '1381' }), additional(99)]),
      adjustedResult: teamResult([row({ agentId: '1381' }), additional(10)]),
    })
    expect(ret.anbyZeroTeammateWl).toBe(Math.floor(10 * 0.5 * 0.75))
  })
})

// ── 薇薇安 1331 / 艾莲 1191（同款首轮守卫） ──────────────────────────────────────
describe('薇薇安 1331 / 艾莲 1191（同款首轮守卫）', () => {
  it('薇薇安：结果行集无 1331 全 0；有则源1 含自身强特、源2 求和 perElement 触发数', () => {
    const cfg: Record<string, unknown> = { agentId: '1331', slot: 0 }
    const r = run('1331', {
      cfg: cfg as never, characters: [cfg] as never,
      teamResult: teamResult([row({ agentId: '1331', exSpecialCount: 2 }), row({ agentId: 'a', exSpecialCount: 3 })]),
      anomalyPool: anomalyPool({ perElement: [{ triggerCount: 4 }, { triggerCount: 1 }] }),
    })
    expect(r.ret).toEqual({ vivianTeamEx: 5, vivianAnomalyTriggers: 5 })
    expect(r.cfg.vivianTeamExTotal).toBe(5)

    const cfg2: Record<string, unknown> = { agentId: '1331', slot: 0 }
    run('1331', {
      cfg: cfg2 as never, characters: [cfg2] as never,
      teamResult: teamResult([]), anomalyPool: anomalyPool(),
      prevThreads: { ...initialCalcRoundThreads(), vivianTeamEx: 5 },
    })
    expect('vivianTeamExTotal' in cfg2).toBe(false) // 非首轮不写回

    const { ret } = run('1331', {
      cfg: { agentId: 'a', slot: 0 } as never,
      characters: [row({ agentId: 'a' }) as never],
      teamResult: teamResult([row({ agentId: 'a', exSpecialCount: 9 })]),
    })
    expect(ret).toEqual({ vivianTeamEx: 0, vivianAnomalyTriggers: 0 })
  })

  it('艾莲：只数 ice 元素触发；首轮写回守卫', () => {
    const cfg: Record<string, unknown> = { agentId: '1191', slot: 0 }
    const r = run('1191', {
      cfg: cfg as never, characters: [cfg] as never,
      anomalyPool: anomalyPool({ perElement: [{ element: 'ice', triggerCount: 6 }, { element: 'fire', triggerCount: 9 }] }),
    })
    expect(r.ret.ellenFreezeCount).toBe(6)
    expect(r.cfg.ellenFreezeCount).toBe(6)

    const cfg2: Record<string, unknown> = { agentId: '1191', slot: 0 }
    run('1191', {
      cfg: cfg2 as never, characters: [cfg2] as never,
      anomalyPool: anomalyPool({ perElement: [{ element: 'ice', triggerCount: 6 }] }),
      prevThreads: { ...initialCalcRoundThreads(), ellenFreezeCount: 3 },
    })
    expect('ellenFreezeCount' in cfg2).toBe(false) // 非首轮不写回
  })
})

// ── ★ 前导空槽：cfg 必须按「派发器给的那份」取，不能按 characters[slot] ─────────────
// characters 是**按位置压缩**的数组（buildCharConfig 跳过空槽），槽位号 ≠ 下标。
// 2026-09-16 实测：`['', 1041, 1191]` 时槽 2 的 `characters[2]` 是 undefined。
// ⚠ 这是本批**新引入的**契约要求（`AgentNextRoundFeedbackInput.cfg`）；既有 19 处
// `characters[slot]`（applyTeamConfig 等）仍有同一缺陷，属既存问题、本批不动。
describe('★ 前导空槽：写回落到正确的 cfg 对象', () => {
  it('槽位号 ≠ 数组下标时，写回仍落在本模块自己那份 cfg 上', () => {
    const mate = { agentId: '1041', slot: 1 } as Record<string, unknown>
    const ellenCfg = { agentId: '1191', slot: 2 } as Record<string, unknown>
    // 派发器遍历压缩数组：给 ellen 的 cfg = ellenCfg，slot = 2（但数组下标是 1）
    const hook = getAgentMechanic('1191')!.nextRoundFeedback!
    const ret = hook({
      slot: 2,
      cfg: ellenCfg as never,
      characters: [mate, ellenCfg] as never,
      teamResult: teamResult([]),
      anomalyPool: anomalyPool({ perElement: [{ element: 'ice', triggerCount: 6 }] }),
      prevThreads: initialCalcRoundThreads(),
      combatTime: 180,
      getAgentSkills: () => undefined,
    } as AgentNextRoundFeedbackInput)
    expect(ret?.ellenFreezeCount).toBe(6)
    expect(ellenCfg.ellenFreezeCount, '写回必须落在艾莲自己那份 cfg').toBe(6)
    expect('ellenFreezeCount' in mate, '不能污染队友那份 cfg').toBe(false)
  })
})

// ── ★ 管线级：`timeGolden` 覆盖不到的路径（迁移时必须自己补的那一半） ────────────────
// 实测（2026-09-16）：把这 5 个钩子逐个从模块注册表摘掉后跑 `timeGolden`，
//   普罗米娅 red（preset:auto-1541-* 伤害 −7.4%…−13.4%）
//   零号·安比 red（preset:auto-1381-1361-1301 逐槽时间账变化）
//   薇薇安 red（−25.8%…−42.3%）
//   艾莲 red（agent:1191:c6）
//   **露西绿** —— 它唯一的预设 `auto-1041-1571-1151` 是 0 命，而露西反馈只在 C1/C6 生效
// ⇒ 露西那一条**没有**端到端护栏，本节的 C6 用例就是补这个缺口（同交接文档纪律 4）。
describe('★ 管线级：timeGolden 盲区（露西 C6 / 艾莲影画4 冻结通道）', () => {
  it('露西 C6：反馈真的驱动影画1 回旋回能（crossAgent.lucyEnergy 随之上台阶）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1041' }, { agentId: '1571' }, { agentId: '1151', cinemaLevel: 6 },
    ])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const lucy = rr.characters.find(c => c.agentId === '1151')!
    // 实测锚点（2026-09-16）：**有**钩子 58 / **摘掉**钩子 30（同队同配装）。
    // ⚠ 这条队是 0 命预设唯一覆盖，C6 只在手动队出现 ⇒ `timeGolden` 对本条**完全盲**，
    // 本断言是它唯一的端到端护栏（反向验证：摘 `nextRoundFeedback: lucyNextRoundFeedback` ⇒ 本行红）。
    expect(
      lucy.energySource.crossAgent.lucyEnergy,
      '露西 C6 回旋全队回能没生效 —— nextRoundFeedback 未派发（timeGolden 对这条队是盲的）',
    ).toBe(58)
  })

  it('艾莲影画4：冻结次数反馈真的驱动影画4 回能（ellen_cycle.c4EnergyTotal）', async () => {
    // 槽位 0（紧凑队伍）：冻结次数唯一来源 = `nextRoundFeedback` 读异常池 ice 触发数。
    const { catalog, config } = await setupHarness([
      { agentId: '1191', cinemaLevel: 6 }, { agentId: '1481' }, { agentId: '1311' },
    ])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.applyBuildRecommendationForSlot(i)
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const cycle = (rr.characters.find(c => c.agentId === '1191') as unknown as {
      specResources?: { ellen_cycle?: { freezeCount: number; c4EnergyTotal: number } }
    }).specResources?.ellen_cycle
    // 实测锚点（2026-09-16）：**有**钩子 freeze=4 / c4=16；**摘掉**钩子 freeze=0 / c4=0。
    expect(cycle?.freezeCount, '艾莲冻结次数没注入 —— nextRoundFeedback 未把 ice 触发数反馈回来').toBe(4)
    expect(cycle?.c4EnergyTotal, '影画4 回能没随冻结次数上台阶').toBe(16)
  })
})
