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
    ultimateTotalBySlot: {},
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
      // 精确值：只有 fury 被打开
      expect(g).toEqual({ stun: false, fury: true, ultimate: false })
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
    expect(cfg.hugoRemainingStunSeconds).toBe(15)
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
    expect(cfg.hugoRemainingStunSeconds).toBeUndefined()
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
    expect(cfg.hugoRemainingStunSeconds).toBeUndefined()
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
    expect(cfg.hugoRemainingStunSeconds).toBe(15)
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
    expect(cfg.hugoRemainingStunSeconds).toBeCloseTo(0.195, 10)
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
    expect(cfg.hugoRemainingStunSeconds).toBe(15)
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
      threads: { banyueTopUp: { parry: 3, dual: 5 } } as never,
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
      threads: { banyueTopUp: { parry: 3, dual: 5 } } as never,
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
      threads: { banyueTopUp: { parry: 3, dual: 5 } } as never,
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
      threads: { banyueTopUp: { parry: 0, dual: 4 } } as never,
      settings: { 'banyue.autoTopUpInteractions': 1 },
    }))
    expect(cfg.banyueInteractionTopUp).toEqual({ parry: 0, dual: 4 })
    expect(cfg.dualCounterCount).toBe(4)   // 只写有值那侧
    expect(cfg.parryCount).toBe(0)         // topUp.parry=0 ⇒ 该字段走 `?? 0` 分支（同值）
  })

  it('★ 契约缺 `guarantee` ⇒ 整块不写（不静默按「保底全关」算）', () => {
    const hook = getAgentMechanic('1471')!.applyTeamConfig!
    const cfg = { slot: 0, agentId: '1471' } as never as Record<string, unknown>
    hook(hookInput({ cfg: cfg as never, axis: axisOf({}), threads: { banyueTopUp: { parry: 3, dual: 5 } } as never }))
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
        threads: { banyueTopUp: { parry: 3, dual: 5 } } as never,
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
  const readBanyueCfg = async (guaranteeUltimate: number, guaranteeFury = 0) => {
    const { config } = await setupHarness(
      [{ agentId: '1471' }, { agentId: '1481' }, { agentId: '1451' }] as never, { recommendedBuild: true })
    config.setMechanicSetting('guarantee.ultimate', guaranteeUltimate)
    config.setMechanicSetting('guarantee.fury', guaranteeFury)
    const calc = useResourceCalc()
    const res = calc.resourceResult.value as unknown as {
      characters: Array<{ slot: number; banyueInteractionTopUp?: { parry: number; dual: number } }>
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
    expect(await readBanyueCfg(1)).toEqual({ parry: 4, dual: 0, requiredSeconds: 9.332, illegal: false })
  })

  it('★ 保底全关 ⇒ 同结构但全 0（反向锁：上面那个 6 不是恒写）', async () => {
    expect(await readBanyueCfg(0)).toEqual({ parry: 0, dual: 0 })
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
      specResources?: { hugo_abyss_echo?: { remainingStunSeconds: number; exVerdictCount: number } }
    }
    const cycle = ch?.specResources?.hugo_abyss_echo
    expect(cycle, '雨果资源卡必须存在').toBeTruthy()
    // 精确值 = 轴内反推（窗口 18 − maxEnd），与滑块 5 可分辨
    expect(cycle!.remainingStunSeconds).toBeCloseTo(11.429, 3)
    expect(cycle!.remainingStunSeconds, '轴臂必须真的覆盖了滑块（否则本判据退化成空转）').not.toBe(5)
    expect(cycle!.exVerdictCount).toBe(5)
  })
})
