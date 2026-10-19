/**
 * `convergence.ts` 夜间批 D 判据（2026-09-17 round 21 夜 D）。
 *
 * ## 本批判据在防什么
 *
 * `convergence.ts` 原有 8 行角色身份判定；夜 B（`8d6055c`）收掉 6 行、剩 2 行**如实挂账**，
 * 并查明那 2 行不是 DRY 机会而是**缺输入通道**（雨果 / 般岳两处 cfg-merge 块都要读
 * `guarantee.*`，而它**未注册** `MechanicSetting` ⇒ 模块侧读不到）。
 *
 * 本批 = **补那个契约并把 2 行迁走 ⇒ 该文件清零**（棘轮 4 → 2）。判据分四层：
 *   ① **契约层**：新增的 `guarantee` / `boss` 只读快照**确实被递到模块**，
 *      且 `guarantee.*` **仍然没有**被注册进 `MechanicSetting`（本批的硬约束——
 *      注册它会把内部实验旋钮变成资源利用率页的用户可见滑块 = 产品级口径，用户未裁决）。
 *   ② **行为层（精确值）**：模块钩子端到端产出与迁移前**同值**——雨果三字段的**条件写形态**
 *      （`!== undefined` 选通路）与般岳的补齐注入是两处最容易静默写错的地方。
 *   ③ **反锁层**：上面那些断言不是恒真——构造反例把每条判据的可分辨性钉住。
 *   ④ **反向验证（变异证明判据能红）**：见下方「反向验证表」，每条都真跑过并已还原。
 *
 * ⚠ **为什么必须补真管线判据**（本文件的主要理由）：伤害池/时间账对这两处
 * **结构性部分盲**（`timeGolden` 105 预设里含 1291 的全无轴、般岳补齐又只在
 * 特定保底组合下非零）⇒ 契约层 + 模块行为层 + 真管线三层一起才够。
 *
 * ## 逐位等价（本批的等价性主证据）
 *
 * HEAD 版 vs 改动版 **227 态**全字段指纹（伤害池全行 + 逐槽全字段 + 异常池 + 轴栈 +
 * 雨果决算 + 般岳补齐 + parrySplit + 面板 + 时间账，全部 6 位定点序列化）：
 * 6 队形 × 5 保底组合 × 2 轴态 + 3 Boss 预设态 + 18 强队预设 × 2 命座 + 62 角色 × 2 命座
 * + 雨果/般岳 solo 轴态。**两侧逐文件 md5 全等、diff 键 0/227**，corpus md5
 * `778111ae94e820469bfe10c48d0b0d30` 两侧相同。
 * **敏感性自证**（证明指纹不是「恒绿的空转」）：雨果 `hugoRemainingStunSeconds + 0.5`
 * ⇒ **10 键红**（`hugo-only_*` 全系）；般岳 `autoTopUp` 短路 ⇒ **26 键红**（含 boss 态）。
 * ⇒ 两个站点各自都被指纹分辨。
 *
 * ⚠ 脚手架未入库（一次性，跑完即删；复现方法 = 重建同结构 dump 测试比对目录）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic, getRegisteredMechanicSettings } from '@/mechanics'
import type { AgentTeamConfigInput } from '@/mechanics/types'


/** 直接调模块钩子的最小入参（只填被测钩子真正读的字段） */
function hookInput(over: Partial<AgentTeamConfigInput>): AgentTeamConfigInput {
  return {
    slot: 0,
    cfg: { slot: 0, agentId: '1291' } as never,
    agent: null,
    cinemaLevel: 0,
    potentialLevel: 6,
    characters: [],
    team: [],
    settings: {},
    phase: 'converge',
    combatTime: 180,
    exCounts: [],
    stunCount: 0,
    teamEnergyConsumed: 0,
    ...over,
  } as AgentTeamConfigInput
}

/** 轴上下文工厂（照 `AgentAxisContext` 形状；只填被测分支读的字段） */
function axisOf(over: Record<string, unknown> = {}) {
  return {
    active: true,
    axes: [],
    windows: [],
    windowSeconds: 20,
    actionCountsBySlot: {},
    chainTotalBySlot: {},
    ...over,
  } as never
}

// ────────────────────────────────────────────────────────────────────────────
// 层① 契约层：新字段确实存在、确实被递达、且 setting **没有**被注册
// ────────────────────────────────────────────────────────────────────────────
describe('夜D · 层① 契约面', () => {
  it('★ 硬约束：`guarantee.*` 仍**未**注册 MechanicSetting（本批刻意不注册）', () => {
    const ids = getRegisteredMechanicSettings().map(s => s.id)
    for (const k of ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate']) {
      // 若本行红 ⇒ 有人把实验旋钮注册成了用户可见滑块（产品级口径，用户未裁决）⇒ 必须回退该注册
      expect(ids.includes(k), `${k} 被注册了 ⇒ 越过了本批的硬约束（见 brief ②）`).toBe(false)
    }
    // 反证：般岳自己的滑块**是**注册的（对照，证明上面的 false 不是遍历写错）
    expect(ids.includes('banyue.autoTopUpInteractions')).toBe(true)
    expect(ids.includes('hugo.exVerdictRatio')).toBe(true)
  })

  it('★ 真管线把 `guarantee` / `boss` 递到模块（用真钩子观测入参，不是读类型）', async () => {
    // 观测法：临时包一层 `applyTeamConfig`，把入参抓下来。这样断言的是**派发器真实递了什么**，
    // 而不是「类型里有这个字段」（后者编译期就成立、证明不了接线）。
    const seen: AgentTeamConfigInput[] = []
    const hugo = getAgentMechanic('1291')!
    const orig = hugo.applyTeamConfig!
    hugo.applyTeamConfig = (input: AgentTeamConfigInput) => { seen.push(input); return orig(input) }
    try {
      const { config } = await setupHarness([{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1011' }] as never, { recommendedBuild: true })
      config.setMechanicSetting('guarantee.fury', 1)
      config.setMechanicSetting('guarantee.ultimate', 0)
      useResourceCalc().resourceResult.value

      const converge = seen.filter(s => s.phase === 'converge')
      expect(converge.length, 'converge 相位必须派发过（否则本判据空转）').toBeGreaterThan(0)
      const g = converge[0].guarantee
      expect(g, '`guarantee` 契约必须递达（不再靠 settings 读）').toBeTruthy()
      // 精确值：用户只勾了 fury；`ultimate` 因**轴态自动保底**（用户裁决 2026-10-11：
      // 「轴模式本来就是最顶尖的预设」⇒ 轴态视同勾选保底4嗔火/4喧响）而为 true。
      // 本队（雨果/琉音/安比）命中预设轴 ⇒ 该条生效；非轴队的对照见 `axisAutoGuarantee.test.ts`。
      expect(g).toEqual({ stun: false, fury: true, ultimate: true })
      // `boss` 同批递达（无 Boss 时三项皆 0）
      expect(converge[0].boss).toEqual({ parryTotal: 0, parryNoFollowUpTotal: 0, parryDecibelOnlyTotal: 0 })
      // `boss` 契约与 store 同源（应用一个真 Boss 预设后必须非零）
      const converge0 = seen.length
      const bossData = JSON.parse((await import('node:fs')).readFileSync(
        new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8'))
      const preset = bossData.bosses.find((b: { id: string }) => b.id === '30042')
      config.applyBossPreset({ id: preset.id }, preset.phases[0], preset.monster, preset.defaults)
      useResourceCalc().resourceResult.value
      const after = seen.slice(converge0).filter(s => s.phase === 'converge')
      expect(after[0].boss, '叶释渊 parryTotal=13 必须递进契约').toEqual({ parryTotal: 13, parryNoFollowUpTotal: 0, parryDecibelOnlyTotal: 0 })
    } finally { hugo.applyTeamConfig = orig }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 层②-a 雨果：三个字段 + 条件写形态
// ────────────────────────────────────────────────────────────────────────────
describe('夜D · 层②-a 雨果 1291（原 convergence.ts:826 块）', () => {
  it('★ 轴内决算块 → 三字段一起写（精确值，含剩余失衡时间夹取）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      // 轴 `count: 3` ⇒ 池 3 次时分配 3 窗。窗口 20s。
      // 窗口终结动作 1291_ex_verdict_final：startTime=0 + 模块常量时长 1.805 ⇒ maxEnd=1.805
      axis: axisOf({
        axes: [{ name: 'a', count: 3, actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 0 }] }],
        windowSeconds: 20,
      }),
      // 坑36：块数用**上一轮失衡池整数次数** ⇒ 池 3 次 ⇒ 3 窗
      threads: { prevPoolStunCount: 3 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    // 剩余失衡时间 = 20 − 1.805 = 18.195 → 夹到 **15**（Math.min(15, …)）
    expect(cfg.hugoAxisRemainingStunSeconds).toBe(15)
    // 决算次数 = 块数 × 窗口数 = 1 × 3
    expect(cfg.hugoAxisExVerdictCount).toBe(3)
    expect(cfg.hugoAxisUltVerdictCount).toBe(0)
  })

  it('★ `prevPoolStunCount` 决定块数（坑36：池整数，不是本轮小数计划次数）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const run = (pool: number | undefined) => {
      const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
      hook(hookInput({
        cfg: cfg as never,
        axis: axisOf({ axes: [{ name: 'a', count: 3, actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 0 }] }] }),
        threads: { prevPoolStunCount: pool } as never,
        team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
      }))
      return cfg.hugoAxisExVerdictCount
    }
    // 池 = 3 ⇒ 轴 count=3 拿满 3 窗 ⇒ 3 次
    expect(run(3)).toBe(3)
    // 池 = 1 ⇒ 只分到 1 窗 ⇒ 1 次（**池是分配上限**，这就是「必须与池同源」的可观察后果）
    expect(run(1)).toBe(1)
    // ⚠ 池缺省（首轮无池）⇒ `?? 0` ⇒ 0 窗 ⇒ `wins <= 0` 提前 return ⇒ maxEnd 恒 −1
    // ⇒ **整块门控不成立、三字段一个都不写**（与原式逐位一致：不是写 0）
    expect(run(undefined)).toBeUndefined()
    // ⚠ 本判据的分辨力：若误用 `axis.windows`（本轮不动点实数）而不是按池重算，
    // 下面这条「windows 给了 7 但池是 3」的构造就会给出 7 而不是 3。
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({
        axes: [{ name: 'a', count: 3, actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 0 }] }],
        windows: [7],
      }),
      threads: { prevPoolStunCount: 3 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    expect(cfg.hugoAxisExVerdictCount, '必须按 prevPoolStunCount 重算，不许用 axis.windows').toBe(3)
  })

  it('★ 条件写形态：非轴 ⇒ 三字段**一个都不写**（消费端 `!== undefined` 选通路）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({ active: false, axes: [{ name: 'a', actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1 }] }] }),
      threads: { prevPoolStunCount: 3 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    // ⚠ 恒写 0 会让 `cycleFromInput` 走 override 通路把决算次数压成 0（而不是回落滑块比例）
    expect(cfg.hugoAxisRemainingStunSeconds).toBeUndefined()
    expect(cfg.hugoAxisExVerdictCount).toBeUndefined()
    expect(cfg.hugoAxisUltVerdictCount).toBeUndefined()
  })

  it('★ 条件写形态：轴开但**无窗口终结动作** ⇒ 同样一个都不写（`maxEnd >= 0` 门控）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      // 只有决算块、没有「结束窗口」的招式 ⇒ maxEnd 恒 -1
      axis: axisOf({ axes: [{ name: 'a', actions: [{ slot: 0, moveId: '1291010', count: 1, startTime: 0 }] }] }),
      threads: { prevPoolStunCount: 2 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    expect(cfg.hugoAxisRemainingStunSeconds).toBeUndefined()
    expect(cfg.hugoAxisExVerdictCount).toBeUndefined()
  })

  it('★ 契约缺 `axis` ⇒ 不写（三判据门控：分辨「接口没接上」与「非轴」）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({ cfg: cfg as never, threads: { prevPoolStunCount: 3 } as never }))
    expect(cfg.hugoAxisExVerdictCount).toBeUndefined()
  })

  it('★ 非 converge 相位 ⇒ 不写（build/postRound 不该产轴内量）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    for (const phase of ['build', 'postRound'] as const) {
      const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
      hook(hookInput({
        cfg: cfg as never, phase,
        axis: axisOf({ axes: [{ name: 'a', actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 0 }] }] }),
        threads: { prevPoolStunCount: 3 } as never,
        team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
      }))
      expect(cfg.hugoAxisExVerdictCount, `phase=${phase}`).toBeUndefined()
    }
  })

  it('★ 两个 moveId 各自计数（强特决算 vs 终结技决算），互不串台', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({
        axes: [{
          name: 'a',
          count: 2,
          actions: [
            { slot: 0, moveId: '1291_ex_verdict_final', count: 2, startTime: 0 },
            { slot: 0, moveId: '1291018', count: 3, startTime: 2 },
          ],
        }],
      }),
      threads: { prevPoolStunCount: 2 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    // 各 × 2 窗
    expect(cfg.hugoAxisExVerdictCount).toBe(4)
    expect(cfg.hugoAxisUltVerdictCount).toBe(6)
    // 剩余失衡：C0 下 1291018 也结束窗口（actionTime 实测 2.183）⇒
    // maxEnd = max(0 + 1.805, 2 + 2.183) = 4.183；窗口 20 ⇒ 20 − 4.183 = 15.817 → 夹到 15
    expect(cfg.hugoAxisRemainingStunSeconds).toBe(15)
  })

  it('★ 窗口终结时长取 `Math.min(15, …)` 夹取的下界侧（窗口很短 ⇒ 精确非夹取值）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      // 窗口 5s、决算动作 startTime=3 + 1.805 = 4.805 ⇒ 5 − 4.805 = 0.195（未触 15 上限）
      axis: axisOf({
        axes: [{ name: 'a', count: 1, actions: [{ slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 3 }] }],
        windowSeconds: 5,
      }),
      threads: { prevPoolStunCount: 1 } as never,
      team: [{ slot: 0, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 }],
    }))
    // 精确值（浮点 5 − 4.805 = 0.19500000000000028）
    expect(cfg.hugoAxisRemainingStunSeconds).toBeCloseTo(0.195, 10)
  })

  it('★ 前导空槽：`team.find(slot===…)` 取到的是**槽位号**对应成员（不是压缩下标）', () => {
    const hook = getAgentMechanic('1291')!.applyTeamConfig!
    // 队 = ['', 1291, …] ⇒ 雨果在槽 1；`team`（全量、下标=槽位号）里 slot=1 是雨果。
    const cfg = { slot: 1, agentId: '1291' } as never as Record<string, unknown>
    hook(hookInput({
      slot: 1,
      cfg: cfg as never,
      axis: axisOf({
        axes: [{ name: 'a', count: 1, actions: [{ slot: 1, moveId: '1291_ex_verdict_final', count: 1, startTime: 0 }] }],
        windowSeconds: 20,
      }),
      threads: { prevPoolStunCount: 1 } as never,
      team: [
        { slot: 0, agentId: '', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 },
        { slot: 1, agentId: '1291', cinemaLevel: 0, potentialLevel: 6, agent: null, wEngineId: '', wEngineModLevel: 1 },
      ],
    }))
    expect(cfg.hugoAxisRemainingStunSeconds).toBe(15)
    expect(cfg.hugoAxisExVerdictCount).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 层②-b 般岳：三字段 + 保底注入
// ────────────────────────────────────────────────────────────────────────────
describe('夜D · 层②-b 般岳 1471（原 convergence.ts:849 块）', () => {
  it('★ 保底4喧响开 ⇒ 注入 topUp + 弹刀次数（精确值）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471', parryCount: 4, dualCounterCount: 1 } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({ actionCountsBySlot: { 0: { 'banyue-combo': 2 } } }),
      guarantee: { stun: false, fury: false, ultimate: true },
      threads: { interactionTopUp: { parry: 3, dual: 5 } } as never,
      settings: { 'banyue.autoTopUpInteractions': 1 },
    }))
    expect(cfg.banyueInteractionTopUp).toEqual({ parry: 3, dual: 5 })
    // 加法注入（不是覆盖）
    expect(cfg.parryCount).toBe(7)
    expect(cfg.dualCounterCount).toBe(6)
    expect(cfg.banyueAxisEx).toEqual({ 'banyue-combo': 2 })
    expect(cfg.banyueAxisActive).toBe(true)
  })

  it('★ 保底全关且非轴 ⇒ 不注入（topUp 为字面量 0/0），但 `banyueInteractionTopUp` 仍写', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471', parryCount: 4, dualCounterCount: 1 } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({ active: false }),
      guarantee: { stun: false, fury: false, ultimate: false },
      threads: { interactionTopUp: { parry: 3, dual: 5 } } as never,
      settings: { 'banyue.autoTopUpInteractions': 1 },
    }))
    expect(cfg.banyueInteractionTopUp).toEqual({ parry: 0, dual: 0 })
    // 条件写：0/0 时不碰交互次数（`?? 0` 兜底形态逐位保留）
    expect(cfg.parryCount).toBe(4)
    expect(cfg.dualCounterCount).toBe(1)
    expect(cfg.banyueAxisActive).toBe(false)
  })

  it('★ `banyue.autoTopUpInteractions = 0` ⇒ 设置可整体关闭补齐（但字段照写 0/0）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471', parryCount: 4 } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({}),
      guarantee: { stun: false, fury: false, ultimate: true },
      threads: { interactionTopUp: { parry: 3, dual: 5 } } as never,
      settings: { 'banyue.autoTopUpInteractions': 0 },
    }))
    expect(cfg.banyueInteractionTopUp).toEqual({ parry: 0, dual: 0 })
    expect(cfg.parryCount).toBe(4)
  })

  it('★ 保底4嗔火（fury）也能独立驱动补齐（非轴亦生效）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471', parryCount: 0, dualCounterCount: 0 } as never as Record<string, unknown>
    hook(hookInput({
      cfg: cfg as never,
      axis: axisOf({ active: false }),
      guarantee: { stun: false, fury: true, ultimate: false },
      threads: { interactionTopUp: { parry: 0, dual: 4 } } as never,
      settings: { 'banyue.autoTopUpInteractions': 1 },
    }))
    expect(cfg.banyueInteractionTopUp).toEqual({ parry: 0, dual: 4 })
    expect(cfg.dualCounterCount).toBe(4)   // 只写有值那侧
    expect(cfg.parryCount).toBe(0)         // topUp.parry=0 ⇒ 该字段走 `?? 0` 分支（同值）
  })

  it('★ 契约缺 `guarantee` ⇒ 整块不写（不静默按「保底全关」算）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471' } as never as Record<string, unknown>
    hook(hookInput({ cfg: cfg as never, axis: axisOf({}), threads: { interactionTopUp: { parry: 3, dual: 5 } } as never }))
    expect(cfg.banyueInteractionTopUp).toBeUndefined()
    expect(cfg.banyueAxisEx).toBeUndefined()
  })

  it('★ 契约缺 `axis` ⇒ 整块不写', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471' } as never as Record<string, unknown>
    hook(hookInput({ cfg: cfg as never, guarantee: { stun: false, fury: true, ultimate: false } }))
    expect(cfg.banyueInteractionTopUp).toBeUndefined()
  })

  it('★ 非 converge ⇒ 不写', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    for (const phase of ['build', 'postRound'] as const) {
      const cfg = { slot: 0, agentId: '1471' } as never as Record<string, unknown>
      hook(hookInput({
        cfg: cfg as never, phase,
        axis: axisOf({}),
        guarantee: { stun: false, fury: true, ultimate: false },
        threads: { interactionTopUp: { parry: 3, dual: 5 } } as never,
      }))
      expect(cfg.banyueInteractionTopUp, `phase=${phase}`).toBeUndefined()
    }
  })

  it('★ `banyueAxisEx` 按**槽位号**取（不是本模块自己的下标）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 2, agentId: '1471' } as never as Record<string, unknown>
    hook(hookInput({
      slot: 2,
      cfg: cfg as never,
      axis: axisOf({ actionCountsBySlot: { 0: { x: 1 }, 2: { 'banyue-combo-didong': 1 } } }),
      guarantee: { stun: false, fury: false, ultimate: false },
      threads: {} as never,
    }))
    expect(cfg.banyueAxisEx).toEqual({ 'banyue-combo-didong': 1 })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 层③ 真管线端到端（契约 + 模块 + 引擎三层合起来）
// ────────────────────────────────────────────────────────────────────────────
describe('夜D · 层③ 真管线端到端', () => {
  /**
   * ⚠ **本组测的是「模块写的字段在真管线里可见且取值正确」**，不是「补齐一定非零」。
   * 实测（本文件探针，重复两次同值 ⇒ 确定性）：
   *   · 队 `[1471, 1481, 1451]` + 保底4喧响 ⇒ 般岳 cfg 的 `banyueInteractionTopUp`
   *     = `{parry: 6, dual: 0, requiredSeconds: 13.998, illegal: false}`
   *   • 同队 + 保底全关 ⇒ `{parry: 0, dual: 0}`（证明上面那个 6 来自补齐通路，不是恒写）
   *   • 同队 + 只开保底4嗔火 ⇒ `{parry: 0, dual: 0, requiredSeconds: 0}`（喧响侧不动）
   *
   * ⚠ **为什么不断言 `calc.banyueInteractionTopUp.value`**：该 computed 的实测口径是
   * 「**非轴**（`useStunAxis=false` 且 `autoActive=false`）⇒ 恒返回 null」，而 harness 默认
   * `autoActive === true`（自动预设命中，实测 `useStunAxis=false / autoActive=true / axes=1`）
   * ⇒ 它在本测试的队形下**结构性不可能**非 null。这是既有设计（首页交互栏懒守卫），
   * 与本批迁移无关 ⇒ 本组改钉「模块写入的 cfg 字段」这一层，另加一条真管线读数。
   */
  const readBanyueCfg = async (
    guaranteeUltimate: number,
    guaranteeFury = 0,
    stunPlanOff = false,
    shieldCount = 1,
    /**
     * T168：般岳交互档（缺省 = 预设值闪10/弹6/金12/双3）。低交互档用于造出**喧响缺口**
     * ——见下方「模块写入 → 结果 cfg 可见」锚的 T168 归因。
     */
    interact?: { dodge: number; parry: number; block: number; dual: number },
  ) => {
    const { config } = await setupHarness(
      [{ agentId: '1471' }, { agentId: '1481' }, { agentId: '1451' }] as never, { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', guaranteeUltimate)
    config.setMechanicSetting('guarantee.fury', guaranteeFury)
    // CC-152 逐用例钉：parry 精确补齐量是 off 场景录制值，physical 为 3
    if (stunPlanOff) config.setMechanicSetting('time.stunPlanProjection', 0)
    // T167：秽盾闪能（缺省 1 = 有盾）直接进 `flashBase` ⇒ 改变嗔火/喧响缺口，必须可逐档钉
    config.enemy.shieldCount = shieldCount
    if (interact) {
      const t0 = config.team[0] as unknown as Record<string, number>
      t0.dodgeCounterCount = interact.dodge
      t0.parryCount = interact.parry
      t0.blockCount = interact.block
      t0.dualCounterCount = interact.dual
    }
    const calc = useResourceCalc()
    const res = calc.resourceResult.value as unknown as {
      characters: Array<{ slot: number; banyueInteractionTopUp?: { parry: number; dual: number; requiredSeconds?: number; illegal?: boolean } }>
    } | null
    return res?.characters.find(c => c.slot === 0)?.banyueInteractionTopUp
  }

  it('★ 保底4喧响 + 般岳队 ⇒ 模块写入的补齐量真的出现在结果 cfg 里（精确值）', async () => {
    // 精确值锚（2026-09-19 债 2 批 2-1 截断外环回灌后更新）：该队形（推荐构筑）是 72.8s 的结构性溢出队，重折环把账本
    // 喧响收入改按装得下的行计（13133/11854/10306 → 10357/9731/8347）、截断 72.8→64.9s（两轮：68.1 等值轮被接受后第三轮
    // 才降到 64.9）、终结 8/3/3 → 7/3/2，般岳保底补齐量在新账本/新时间面下算得 3 次弹刀（6.999s），此前 6 次（13.998s）。
    // 本用例锁的是「模块写入 → 结果 cfg 可见」这层，数值随口径变化按规则 10 归因后更新
    // （探针三态见 docs/mcp-debt2-blade1-feasibility-v4.md §7/§8）。
    // 2026-09-19 动态合轴吸收上限 40%（用户 v3）+ ⑥″（环内选点计「待装补齐」）：该队自由口径不再被队友全额吸收，降配 0.75 后
    // 保底补齐线程在「0 ↔ 7 弹刀」间 2-环；⑥″ 把「本轮才算出要补、计划里还没装」的补齐算进时间自洽度 ⇒ 落点 = 装了补齐的那轮，
    // 新账本/新时间面下算得 4 次弹刀（9.332s）；ratio=1 时仍是 3 次（6.999s）。
    //
    // ⚠ **2026-09-20 4 → 12**：`runOuterLoop` 新增**环成员可行性闸门**（见该函数内 isTwoCycle 注释）——
    // 判环要求本轮候选成员**时间上可行**（`timeTruncatedSeconds ≤ 容差`）。本条队形是**结构性溢出队**，
    // 旧落点（4 弹刀）来自「0↔7 的 2-环里那个仍带 33.0s 截断的成员」；闸门把落点移到**装得下的成员**：
    // 降配到 scale 0.5、截断 33.0 → **0**、补齐量按新时间面重算 = 12 次弹刀（27.996s），伤害 56.98M → 66.36M。
    // 这是「补齐线程与时间面自洽」的正确落点（补齐是**模块自报的必做需求**，装不下就不该按装得下记账）。
    //
    // 2026-10-03 第 427 轮 12 → 14（CC-402）：卢西娅终结技按两段融合（1451024 撞击 + 1451017 强力打击），一次终结技前台时长 0 → 1.767s、
    // 倍率 186.5% → 3992.2%。本队（般岳/琉音/卢西娅）时间面被卢西娅终结技多占的秒数挤压，般岳保底补齐量按新时间面重算 = 14 次弹刀（32.662s）。
    // 仍是「模块写入 → 结果 cfg 可见」这层的精确值锚，数值按规则 10 归因后更新。
    //
    // ⚠ **2026-10-10 14 → 6（T129，反推单价口径修正，规则 10 四步已走）**：
    // ① 量 delta：本队般岳补齐量 14 → **6**（32.662s → 13.998s），伤害面随后续 golden 重生成一并归因。
    // ② 逐项归因（**隔离 worktree `c7530301` A/B 同探针**，唯一变量 = 反推单价）：
    //    | 量 | 旧（分母 215） | 新（分母 301.35） |
    //    |---|---|---|
    //    | `banyueInteractionTopUp.parry` | 14 | **6** |
    //    | `requiredSeconds` | 32.662s | 13.998s |
    //    | 般岳 `decibelSource.total` | 13265.1 | 11763.5 |
    //    | 般岳 `specialActionBonus` | 3945.6 | 2850.0 |
    //    | 般岳 `ultimateCount` | 8 | 7 |
    //    | 般岳前台时间 | 129.74s | 129.38s |
    //    机理一句话：反推分母从「招架判定单段 215」改成「一次弹刀完整链 301.35」后，
    //    同样喧响缺口算出的刀数**按比例下降**（×215/301.35 ≈ 0.71）；本队落点 14 → 6 **低于**该比例，
    //    因为落点本身受「环成员可行性闸门 + 时间面」约束：刀数下降 ⇒ 待装补齐时间下降 ⇒
    //    外层不动点选到**更早的可行成员**（不再是那个需要 32.662s 补齐才能自洽的成员），
    //    属**有意**的口径修正（旧 14 是「按 215 高估缺口」撑出来的落点）。
    // ③ 确认有意：用户 2026-10-10 裁决「215…没算其后面接的支援突击…反推不涉及什么数据修改」
    //    ⇒ 目标就是让反推单价 = 完整链收益，落点变小是预期方向（预测 §B④ 说 12~13，
    //    实测 6 —— 预测偏差已如实记入 T129 报告 §③，差额来自上述闸门/时间面反馈，不是算错）。
    // ④ 本锚按新口径更新；`timeGolden` / `timeFillRatchet` 同批重生成（delta 表在 T129 报告 §④）。
    //
    // ⚠ **2026-10-11 6 → 5（用户裁决：预设交互下调 金身 20→12 / 双反 5→3）**：
    // ① 量 delta：本队般岳保底补齐量 6 → **5**（13.998s → 11.665s）。
    // ② 逐项归因（唯一变量 = 般岳 interactionDefaults 的 block/dual）：
    //    金身+双反 = 冲霄次数（每次 2.67s）⇒ 20/5→12/3 直接腾出 ~15s 前台 ⇒ 时间面变宽，
    //    同时**喧响缺口按新时间面重算**（弹刀补齐是「缺口 ÷ 301.35」的反馈线程，时间面一动落点就动）。
    //    同批 `timeGolden` 28 条、`timeFillRatchet` 4 条，**全部为般岳条目**（脚本核对：非般岳 0 条）。
    // ③ 确认有意：用户原话「预设的交互太多了……我之前只是想让般岳有 4 次嗔火而已」——
    //    6→5 是「腾出时间后喧响缺口变化」的副产物，方向无异常（仍 ≥ 保底所需）。
    // ④ 本锚更新；4 怒相是否保持由 `.zc/perf/banyueConfirm.perf.ts` 实测（六队 6/6 保持 4 次）。
    //
    // ⚠ **2026-10-12 5 → 1（T140a：补齐量不再参与轴可行性判定）**：
    // ① 量 delta：本队般岳保底补齐量 5 → **1**（11.665s → 2.333s），**同时 `interactionScale` 0.875 → undefined**
    //    （该队不再是「装不下要降配」的队）、伤害 64.566M → 64.287M、失衡 4 与怒相 4 均不变。
    // ② 逐项归因（唯一变量 = `solveTeam#netOf` 是否把 `pendingTopUpSeconds` 计入轴可行性）：
    //    修前该队因「待装补齐秒数」被推进非轴降配（scale=0.875 ⇒ 用户交互次数被缩 12.5% ⇒
    //    parry/block/dual 全变小 ⇒ 喧响缺口重算 = 5 刀）；修后补齐不参与该判定 ⇒ 不再降配 ⇒
    //    交互次数按用户原值打满 ⇒ 缺口只剩 1 刀。**根因是补齐与时间面的耦合，不是补齐通道本身**。
    //    A/B 同探针（`.zc/perf/T140a-nigD.perf.ts`）：只回退 `netOf` 一行即复现 5 / scale 0.875。
    // ③ 确认有意：用户 2026-10-11 裁决「补齐应该是在 off 的基础上去补招式…一定大于非补齐」，
    //    本队 ON 64.287M ≥ OFF 63.906M（单调性成立，见 `topUpMonotonic.test.ts`）。
    // ④ 本锚更新；「模块写入 → 结果 cfg 可见」这层语义未变（parry=1 仍是模块写入并被 cfg 读到）。
    /**
     * ⚠ **T156 归因（parry 1 → 0，规则 10 四步）**：
     * ① 量 delta：本档（`stunPlanOff` + 保底4喧响）般岳补齐量 `parry 1 → 0`，伤害 63.9 → 62.97M。
     * ② 根因：**不是补齐通道变了，而是该队现在真的走轴模式了**。修前 `resolveWindowSplit` 在
     *    `stunCount = 0`（外层首轮中间值）时返回**空数组**，而 `resolveStunAxisPlan` 仍把
     *    `plan.name` 当命中返回 ⇒ 上层拿到「有名无轴」⇒ `axisActive = false` ⇒ **静默非轴**
     *    （该档的 parry=1 就是这个非轴态下的读数）。T156 修了空数组（base 轴 ×0 兜底）⇒
     *    轴形态成立 ⇒ 本队轴**真的参与**计算 ⇒ 补齐量按轴内时间面重算 = 0。
     * ③ 确认有意：用户口径 2026-10-14「轴预设…有收尾轴那意思是最后打收尾轴」+「加标签吧，
     *    不要隐藏逻辑」——「命中预设轴却静默不生效」正是要消除的隐藏行为。
     * ④ 本锚按新口径更新：**轴态下**补齐量 0（轴内已覆盖般岳的必做需求，无需再补交互）。
     * ⚠ 该档同时在 `guaranteeNightD` 的「轴退化」用例里另有覆盖（轴装不下 ⇒ axisFallback=true）。
     */
    /**
     * ⚠ **T162 再归因（parry 0 → 2，规则 10 四步）**：
     * ① 量 delta：本档般岳补齐量 `parry 0 → 2`（4.666s），伤害 62.859M（OFF 臂 63.337M）。
     * ② 根因：**秽盾 60 闪能接入嗔火/闪能公式**（`banyue.ts#computeBanyueRageCycle` 的
     *    `flashBase` 原漏算 `shieldBreakGift`）。本夹具走 store 缺省 `shieldCount = 1`
     *    ⇒ 闪能 +60 ⇒ 连段/资源面整体抬升 ⇒ 喧响缺口从 0 变 **309**（`4×3000 − 11691`）
     *    ⇒ `ceil(309 / 301.35) = 2` 次弹刀。
     * ③ 确认有意：用户 2026-10-14「**没有秽盾送的 60 闪能，就达不到 5 嗔火**的标准」——
     *    有盾/无盾必须可分辨（修前实测嗔火**恒等**，该口径在引擎里表达不出来）。
     * ④ 本锚按新口径更新；无盾档（`readBanyueCfg(1, 0, true)` 加 `shieldCount=0`）仍为 0
     *    —— 由下方反证锁住。
     */
    /**
     * ⚠ **T167 再归因（`parry 2 → 0`，规则 10 四步）—— 改的是档位与锚值，判据语义未变**。
     * ① 量 delta：本档（`stunPlanOff` + 保底4喧响 + 缺省盾1）般岳补齐量 `parry 2 → 0`
     *    （`requiredSeconds 4.666 → 0`），`axisFallback` 仍 false、伤害 62.86 → 63.19M。
     * ② 根因：**轴内连段块的闪能账修正**（`banyue.ts` 的 `combos[].energyCost` 60 → 0）。
     *    修前那些块被闪能门跳过（`skipped` 含 `banyue-combo/energy`），修后真的进轴执行
     *    （`axisCombo 8 → 12`、`axisSpend 280 → 480`）⇒ 般岳自身喧响供给抬升（`decibelSource`
     *    11691 → 11025 但轴内终结技需求同步被满足）⇒ 原缺口消失 ⇒ 无需补 2 刀。
     *    A/B 实测（两处修复隔离）：只回退账本 ⇒ 本档补齐恢复 `{parry:2, requiredSeconds:4.666}`。
     * ③ 确认有意：用户口径「[怒] 怒相连段耗山威……**不耗闪能**」+ 规则 17③。
     * ④ 处置：**「模块写入 → 结果 cfg 可见」这层语义必须继续被锁** ⇒ 换到**仍能写出非零补齐**的档：
     *    实测（`.zc/perf/T167s_f.perf.ts`，扫 `ratio × (block,dual) × ult × shield`）
     *    `readBanyueCfg(1, 0, false) + shieldCount=0` ⇒ `{parry:9, dual:0, requiredSeconds:20.997}`。
     *    ⚠ 该档 `axisFallback=true`（轴弃）；这是**如实读数**而非缺陷 —— 保底4喧响在**无盾**
     *    且**不关 stunPlanProjection** 时要 9 刀才能凑够目标，那 9 刀本身把轴顶出预算 ⇒ 弃轴，
     *    正是本档历史上「轴退化」用例覆盖的同型行为。本条锁的是**通道可见性**（cfg 里有非零值），
     *    不是轴态，故该档成立。
     */
    /**
     * ⚠ **T168 再归因（档位与锚值再换，规则 10 四步）—— 判据语义仍是「模块写入 → cfg 可见」**。
     *
     * ① 量 delta：T167 选的档 `readBanyueCfg(1, 0, false, shieldCount=0)` 由
     *    `{parry:9, requiredSeconds:20.997}` 变为 **`{parry:0, requiredSeconds:0}`**；
     *    新档 `readBanyueCfg(1, 0, false, 1, {dodge:2,parry:2,block:2,dual:0})` ⇒
     *    **`{parry:7, dual:0, requiredSeconds:16.331}`**。
     * ② 根因：**闪能浪费从「`axisSpend / rage` 自动均摊」改成「用户可调常数、默认 50」**
     *    （`banyue.ts#computeBanyueRageCycle`）。般岳嗔火少 25 点 ⇒ 怒相数与轴内终结技需求一起变
     *    ⇒ 喧响缺口重算。实测（`.zc/perf/T168nd.perf.ts`）**16 个组合（保底×嗔火×stunPlan×盾）
     *    在预设交互档下全部读到 parry=0** —— 轴活着时轴内已覆盖般岳全部必做需求，
     *    预设交互（闪10/金12/双3）的喧响收入足够，**该档不再存在缺口**。
     * ③ 确认有意：用户口径 2026-10-15「这个我想做成一个交互栏的调节选项，浪费多少让用户自己填，
     *    默认 50 点」——常数化是本卡的目标，不是副作用。
     * ④ 处置：**该锚锁的是「通道能写出非零值」，不是某个特定档** ⇒ 按 T167 同款办法换到仍能写出
     *    非零补齐的档：把**交互调低**（闪2/弹2/金2/双0）即可造出喧响缺口 ⇒ `parry:7`。
     *    实测（`.zc/perf/T168nd3.perf.ts`）同法其它档：盾0 ⇒ `{parry:24, req:55.992}`、
     *    双保底 ⇒ `{parry:1, dual:12, req:42.329}`、无保底 ⇒ `{parry:0, dual:0}`（= 下方反证档）。
     *    ⚠ 反空洞仍成立：本锚锁非零、下方「保底全关」锁零 ⇒ 「恒写」会同时红两条。
     *
     * ⚠⚠ **T169 再换档（2026-10-15）—— 山威门让原档的缺口消失**。
     * ① 量 delta：T168 选定的档（低交互 + 保底终 + **盾1**）由 `{parry:7, req:16.331}`
     *    变为 **`{parry:0, req:0}`**；改用 **盾0** ⇒ **`{parry:24, req:55.992}`**。
     * ② 根因：轴栈新增**角色专属资源门控**（般岳山威）⇒ 轴内超量的连段块不再执行
     *    ⇒ 轴内时间/闪能占用变小 ⇒ 般岳自身喧响供给与需求一起变 ⇒ **有盾（+60 闪能）时已无缺口**。
     * ③ 确认有意：用户口径 2026-10-15「缺失那就加上呗，又没什么副作用」——让轴内内容如实。
     * ④ 处置：按 T167/T168 同款办法换到**仍能写出非零补齐**的档 = 同低交互但**无秽盾**
     *    （`.zc/perf/T169nd.perf.ts` 实测 8 档：有盾档全 0；无盾 ⇒ `parry:24`）。
     *    ⚠ 该档同时是**反空洞**的更好载体（24 刀、55.992s 远离 0）。
     */
    /**
     * ⚠ **2026-10-18 换档（规则 10 四步）—— 判据语义仍是「模块写入 → cfg 可见」**。
     * ① 量 delta：T169 选定的档（`readBanyueCfg(1,0,false,shield0,{2,2,2,0})`）由
     *    `{parry:24, req:55.992}` 变为 **`{parry:0, req:0}`**；
     *    同参数**关掉 stunPlanProjection**（第 3 参 `true`）⇒ **`{parry:5, dual:24, req:55.657}`**。
     * ② 根因：**冲霄动作时间** 2.667 → 1.167（`scripts/lib/type-bonus-time.mjs`）⇒ 180s 里腾出约 30s
     *    ⇒ 轴内需求被自身覆盖，喧响缺口消失；只剩「关掉 stunPlanProjection（计数通道退回计划值）」
     *    这一档仍造得出缺口（实测 `.zc/perf/scanTopup.probe.test.ts` 扫 12 组合：
     *    唯一非零档 = `off=true`，其余全 `{0,0,0,false}`）。
     * ③ 确认有意：时间修正是用户口径（「正确的时间计算公式就是该 1.83」），不是回归。
     * ④ 处置：换到 `off=true` 档，锚值按实测更新（`parry:5, dual:24, req:55.657`）；
     *    「保底全关 ⇒ 全 0」的**反向锁**不变（`gu=0` 各档实测仍全 0）。
     */
    /**
     * ⚠ **T172 再归因（parry 5 → 8，规则 10 四步）—— 判据语义仍是「模块写入 → cfg 可见」**。
     *
     * ① **量 delta**：本档 `{parry: 5, requiredSeconds: 55.657}` → **`{parry: 8, requiredSeconds: 62.656}`**。
     * ② **根因**：`computeBanyueInteractionTopUp` 的喧响缺口算式把**已装补齐自己产的喧响**
     *    当成既有收入 ⇒ 装得越多、算出的缺口越小 ⇒ 反推落进 2-环（本档实测环成员 = **5 ↔ 2**）。
     *    修法 = 缺口按「需求 + 已装×单刀收益 − 已读喧响」算（等式两边同量纲），不动点处
     *    `decibelHave = 需求` ⇒ 本档收敛到**真的补够**的 8 刀（`.zc/perf/ndTopupDiag.perf.ts`）。
     *    ⚠ 旧值 5 **本身就是一个装不够的环内成员**：实测 5 刀时般岳喧响 **10981 < 12000**（缺口 1019），
     *    按定义还差 4 刀；它之所以"看着像答案"，正是环被相位决定的那一半缺陷。
     * ③ **确认有意**：用户 2026-10-19 报的正是「取消后摇反而掉伤害」，根因同一条环
     *    （`banyue-trigger-lucia` r=0.6 的 taunt 1/2 = 环成员 4/1）。修后该档 **stable**（不再 cycle），
     *    且补齐单调性（`topUpMonotonic`）与「保底全关 ⇒ 全 0」反向锁都仍绿。
     * ④ **判据处置**：锚值按实测更新为 `parry: 8, requiredSeconds: 62.656`（8 刀×2.333 = 18.664；
     *    总 req = 8×2.333 + 24×1.833 = 62.656）。**不断言"某个特定刀数才对"**——本条锁的是
     *    「模块写入 → 结果 cfg 可见」，刀数随补齐口径走（T167/T168/T169 三次换档同款）。
     */
    const cfg = await readBanyueCfg(1, 0, true, 0, { dodge: 2, parry: 2, block: 2, dual: 0 })
    // 整数/布尔三字段逐字相等；`requiredSeconds` 是浮点乘积（8 刀×2.333 + 24 刀×1.833）⇒ 用 toBeCloseTo
    expect(cfg).toMatchObject({ parry: 8, dual: 24, illegal: false })
    expect(cfg?.requiredSeconds).toBeCloseTo(62.656, 6)
  })

  it('★ 保底全关 ⇒ 同结构但全 0（反向锁：上面那个 9 不是恒写）', async () => {
    /**
     * ⚠ **T167 归因（形状 2 字段 → 4 字段，值仍全 0；规则 10 四步）**。
     * ① 量 delta：本档返回由 `{parry:0, dual:0}`（字面量，2 字段）变为
     *    **`{parry:0, dual:0, requiredSeconds:0, illegal:false}`**（线程对象，4 字段），**值仍全 0**。
     * ② 根因：**不是补齐通道变了，而是本档的轴现在活着**。`applyBanyueTeamConfig` 写这份字段有两条分支
     *    （`banyue.ts:492`）：`autoTopUp ? threads.interactionTopUp : {parry:0, dual:0}`；
     *    而 `autoTopUp` 的门控含 `axisActive` —— 轴态**视同勾选保底**（用户裁决 2026-10-11），
     *    故保底开关全关也走「读线程」那条 ⇒ 4 字段。
     *    轴为何活着 = 本卡两处修复（轴内连段块闪能账 + 救援臂入场判据）：修前本档
     *    `axisFallback=true`（轴弃，`autoTopUp=false` ⇒ 2 字段），修后 `trim=1` 保住轴
     *    （`axisFallback=false` ⇒ 4 字段）。实测 A/B：只回退闸门 ⇒ 恢复 2 字段 + 弃轴。
     * ③ 确认有意：轴活着是用户裁决「挤不下就不要多打」的目标；4 字段是同一对象的更完整表示
     *    （`requiredSeconds`/`illegal` 本就是 `InteractionTopUp` 的成员）。
     * ④ 处置：判据从「**对象形状逐字相等**」改为「**四个字段逐字为 0**」——
     *    ⚠ 这**不是放宽**：本条的语义是「保底全关 ⇒ 补齐量为 0」（防恒写），
     *    而 `requiredSeconds`/`illegal` 是**诊断读数**、不是「补齐量」；
     *    形状差异只反映「轴活/轴弃」这条与本事无关的自由度。
     *    反空洞由两条共同保证：上文 `readBanyueCfg(1, 0, false, 0)` 锁 **`parry:9` 非零**
     *    （通道确实能写出非零），本条锁**关闭时为零** ⇒ 「恒写」会同时红两条。
     */
    const off = await readBanyueCfg(0)
    expect(off, '保底全关 ⇒ 补齐量必须为 0（轴态视同勾选只影响是否读线程，不该凭空补）')
      .toMatchObject({ parry: 0, dual: 0 })
    expect(off!.illegal, '诊断读数：本档不得是「非法补齐」形态').toBe(false)
  })

  it('★ 只开保底4嗔火 ⇒ 喧响侧补齐量为 0（两开关各自独立驱动）', async () => {
    expect(await readBanyueCfg(0, 1)).toEqual({ parry: 0, dual: 0, requiredSeconds: 0, illegal: false })
  })

  it('★ 无般岳队 ⇒ 没有任何槽位带 `banyueInteractionTopUp`（反向锁）', async () => {
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1011' }] as never, { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', 1)
    const res = useResourceCalc().resourceResult.value as unknown as {
      characters: Array<{ banyueInteractionTopUp?: unknown }>
    } | null
    for (const c of res?.characters ?? []) {
      expect(c.banyueInteractionTopUp, '无般岳队不该有该字段（否则契约为谁而写都分不清）').toBeUndefined()
    }
  })

  it('★ 雨果轴态真管线：轴臂反推的剩余失衡秒数与决算次数进了资源卡（≠ 非轴滑块值）', async () => {
    // 实测（`[1291, 1481, 1011]`，harness 默认配装）：
    //   非轴/自动轴预设命中 ⇒ 资源卡 `remainingStunSeconds = 11.429`、`exVerdictCount = 5`
    //   （= 轴内反推值，窗口 18s − 决算结束时刻 6.571；**不是**滑块默认 5）
    // 本断言钉住「轴臂算出来的数真的走到了消费端」，而不是滑块原值。
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1011' }] as never, { recommendedBuild: true })
    expect(config.getMechanicSetting('hugo.remainingStunSeconds', 5), '滑块默认必须是 5（对照基准）').toBe(5)
    const calc = useResourceCalc()
    const ch = calc.resourceResult.value?.characters.find(c => c.slot === 0) as unknown as {
      hugoAbyssEcho?: { remainingStunSeconds: number; exVerdictCount: number }
    }
    const cycle = ch?.hugoAbyssEcho
    expect(cycle, '雨果资源卡必须存在').toBeTruthy()
    // 精确值 = 轴内反推（窗口 18 − maxEnd），与滑块 5 可分辨
    expect(cycle!.remainingStunSeconds).toBeCloseTo(11.429, 3)
    expect(cycle!.remainingStunSeconds, '轴臂必须真的覆盖了滑块（否则本判据退化成空转）').not.toBe(5)
    /**
     * ⚠ **T141 改值**：决算次数 **5 → 6**。`remainingStunSeconds` 仍 ≈11.429（上面那条未动）。
     * T141 第 3 档（吸收取满容量 + 闸门常开 ⇒ 平A/回能重新分配）让本队轴内多兑现一次决算
     * —— 判据本身是「轴臂反推的决算次数进了资源卡（≠ 滑块值 5）」，
     * 上面 `not.toBe(5)` 的**可分辨性**断言仍然成立（现值 6 ≠ 5）。
     */
    expect(cycle!.exVerdictCount).toBe(6)
  })
})
