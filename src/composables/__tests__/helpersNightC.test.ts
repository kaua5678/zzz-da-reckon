/**
 * R21 夜间批 C 判据（2026-09-17 round 21，棘轮 24 → **实测 10**）。
 *
 * 任务书：`/home/kaua/.dsh/session-manager/reports/R20-A-helpers-triage.md` §1/§4（分诊）
 * + 派活 brief（8 处逐处分类）。把 `helpers.ts` 的 8 处角色判定按「能不能迁」如实处理：
 *
 * | 站点 | 原文（重核后行号） | 处理 | 棘轮 |
 * |---|---|---|---|
 * | 组1-A `:621` | `configStore.team.findIndex(c => c.agentId === '1311')` | 改调 `findSlotByIdentity` | ±0（`c.agentId ===` 本就计数，**形状收敛**不是减量） |
 * | 组1-B `:942` | `team.find(m => m.agentId === '1211')?.slot ?? -1` | 改调 `findSlotByIdentity` | **−1** |
 * | 组2-C `:756` | `if (agent.id === '1581' \|\| agent.teammateBuffId === 'remielle') { …daze… }` | 迁进 `remielle.ts#applyPanel`（新增） | **−1** |
 * | 组2-D `:798` | 相变时流 `findIndex` + 给**当前**面板加 `dmgBonus` | 迁进 `remielle.ts#teamPanelEffects`（新增） | **−1** |
 * | 组2-E `:996` | `isRemielle: agent?.id === '1581' \|\| agent?.teammateBuffId === 'remielle'` | 改调 `remielle.ts#isRemielleAgent` | **−1** |
 * | 组2-F `:1661` | `const remielleEnabled = …`（panel + cfg **双出口**） | 迁进 `remielle.ts#buildCharConfig`（新增） | **−1** |
 * | 组2-G `:759` | 简 35 行面板块（`agent.id === '1261' \|\| …`） | ⚠ **没迁**（阻塞，见层⑦） | **−0** |
 * | 组3 `:974` | `findSlotByIdentity` **自身实现行** | **未动**（批 A/批 B 正在 import，禁改语义） | 不适用 |
 *
 * ⇒ 24 → **10**（−14）：组 1 的 **2** 处 + 组 2 的 **4** 处 + 同批顺带收敛的**蕾米/简辅助行**。
 *
 * ## 判据分层（照 `panelBlocksR20h1.test.ts` 的结构）
 *
 * ① **精确值**：全部 `toBe` / `toBeCloseTo` 到确定的位（**禁** `> 0` / `toBeGreaterThan`）；
 * ② **真派发器接线**：走 `computePanelPhases` / `buildCharConfig`（不是直调钩子）——证明钩子真的被派发到；
 * ③ **重复来源反锁**（★ 本批最有价值的一条，见下）；
 * ④ **跨槽语义**：加成随**目标槽**变化但**不含目标身份**信息（蕾米本人也吃）——原块**无自排除**，
 *    迁移时顺手加守卫 = 静默削蕾米面板且**无测试会红**（分诊 §3.3 的原话警告）；
 * ⑤ **等价性 oracle**：新实现 === 旧内联表达式（逐队形/逐角色对照）；
 * ⑥ **cfg 字段存在性**：迁移后字段由**角色模块**写（未命中时 `undefined` 而非 `false`），
 *    消费端 `if (cfg.remielleEnabled && …)` 下等价 ⇒ 用消费端可见性验；
 * ⑦ **未迁项的诚实反锁**：简块**必须仍在编排层**（迁了会丢滑块值）+ 钉住「`jane.passionCoverage`
 *    未注册」这一产品级口径缺口。
 *
 * ## ⚠ 层③ 为什么是「真回归」而不是假想（本批实测记录）
 *
 * 「相变时流」是**一个光环**，不是「每个蕾米各加一次」：原实现 `configStore.team.findIndex(…)`
 * 找**第一个**蕾米、读**她**的命座、给当前面板加**一次**。`teamPanelEffects` 按**来源槽**逐槽派发
 * ⇒ 不设守卫时**双蕾米队会加 N 次**。本批**逐位等价对拍实测抓到过**：
 * `[1581,1581,1581]` 队 `dmgBonus` 由 **33 → 69**（差值 36 = 2 × 18）。
 * 该守卫（「槽位最小的那个蕾米认领」）就是**为这条实测回归**加的，本层把它钉住。
 *
 * ⚠ 期望值全部取自**迁移前**在 HEAD 上抓的面板指纹（`/tmp/fp-r21c-before.txt`，**16596 行** =
 * 728 队 × 4 setting 态 × 3 槽 × in/out；迁移后 `diff` **0 行**）。**不是**事后从迁移后的实现
 * 倒推的（那会把错误一起固化成「期望」）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import {
  computePanelPhases,
  buildCharConfig,
  findSlotByIdentity,
  getTeamAnomalyDurationBonus,
  getWindInfectionTargetSlot,
  getWindInfectionElement,
} from '@/composables/resourceCalc/helpers'
import { emptyPanel } from '@/core/panel'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { getRegisteredMechanicSettings } from '@/mechanics'
import { remielleMechanic, isRemielleAgent } from '@/mechanics/agents/remielle'

type Slot = { agentId: string; cinemaLevel?: number } | ''

/** 组队输入：`''` = 空槽；harness 拒绝裸字符串（其 `setTeam` 守卫防「静默变空队伍」） */
function teamOf(ids: readonly string[]): Slot[] {
  return ids.map(id => (id ? { agentId: id } : ''))
}

async function ctx(
  ids: readonly string[],
  settings: Record<string, number> = {},
  cinema: Record<number, number> = {},
) {
  const { catalog, config } = await setupHarness(teamOf(ids) as never, { recommendedBuild: true })
  // 命座覆盖走「真实 UI 改命座」同一条路径（`teamOf` 只接受 id 列表）
  for (const [k, v] of Object.entries(cinema)) config.team[Number(k)].cinemaLevel = v
  for (const [k, v] of Object.entries(settings)) config.setMechanicSetting(k, v)
  return { catalog, config }
}

/** 走**真派发器**的局内面板 */
async function panelOf(
  ids: readonly string[],
  slot: number,
  opts: { cinema?: Array<number | undefined>; settings?: Record<string, number> } = {},
) {
  const cin: Record<number, number> = {}
  for (const [i, c] of (opts.cinema ?? []).entries()) if (c !== undefined) cin[i] = c
  const { catalog, config } = await ctx(ids, opts.settings ?? {}, cin)
  const p = computePanelPhases(slot, config, catalog)
  expect(p, `槽 ${slot} 面板为空`).not.toBeNull()
  return p!.inCombat as Record<string, number>
}

// ════════════════════════════════════════════════ 层②：真派发器接线

describe('R21-C 层②：迁走的钩子都经真派发器生效', () => {
  it('remielle 模块注册了本批新增的三个钩子（applyPanel / teamPanelEffects / buildCharConfig）', () => {
    // 原先三者**都不存在**（remielle.ts 只有 buildResourceResult / resourceSections）
    expect(remielleMechanic.applyPanel).toBeTypeOf('function')
    expect(remielleMechanic.teamPanelEffects).toBeTypeOf('function')
    expect(remielleMechanic.buildCharConfig).toBeTypeOf('function')
  })

  it('`isRemielleAgent` 是编排层与模块共用的**单一事实源**（导出即契约）', () => {
    expect(isRemielleAgent).toBeTypeOf('function')
  })
})

// ════════════════════════════════════════════════ 组2-C：蕾米额外能力三档（同槽自面板块）

describe('组2-C `:756` 蕾米 daze 面板块 → remielle.ts#applyRemiellePanel', () => {
  /**
   * 三档口径（原 `helpers.ts#resolveRemielleDazeBonus` 逐位搬入模块，**该导出已随迁删除**）：
   * `active = 队友里存在 [异常] 或同阵营者`；`tier = active ? clamp(异常角色数, 1, 3) : 0`；
   * `bonus = [0, 6, 12, 35][tier]`。
   *
   * 数据面事实（本批实测，`probe` 记录在报告）：`1581` 是**达识结社**唯一成员；`1011/1031/1311/1211`
   * 分别 stun/support/support/support ⇒ 与蕾米**不同阵营**且非异常 ⇒ 只有它们时 `active=false`。
   */
  const CASES: Array<{ ids: readonly string[]; want: number; why: string }> = [
    // tier 0：队友全是非异常且不同阵营 ⇒ 真 0（不是"小"）
    { ids: ['1581', '1011', '1031'], want: 0, why: 'stun+support，无异常/同阵营 ⇒ tier 0' },
    { ids: ['1581', '1311', '1031'], want: 0, why: '双 support ⇒ tier 0' },
    { ids: ['1581', '1551', '1031'], want: 0, why: 'attack+support ⇒ tier 0' },
    { ids: ['1581', '1611', '1031'], want: 0, why: 'sharpen+support ⇒ tier 0' },
    { ids: ['1581', '', ''], want: 0, why: '队友全空槽 ⇒ tier 0' },
    { ids: ['1581', '1211', '1031'], want: 0, why: '丽娜是 support（不是异常）⇒ tier 0' },
    // tier 1：只有蕾米自己一个异常 + active 由别的路径成立 ⇒ 6（用同阵营者触发 active）
    // ⚠ 达识结社仅蕾米一人 ⇒ 本档在**当前数据面**只能靠「异常队友」凑，故 tier1 无纯同阵营用例
    // tier 2：2 名异常（含蕾米）
    { ids: ['1581', '1181', '1031'], want: 12, why: '格莉丝[异常] ⇒ tier 2' },
    { ids: ['1581', '1261', '1031'], want: 12, why: '简[异常] ⇒ tier 2' },
    { ids: ['1581', '1331', '1031'], want: 12, why: '薇薇安[异常] ⇒ tier 2' },
    { ids: ['1581', '1221', '1031'], want: 12, why: '月城柳[异常] ⇒ tier 2' },
    { ids: ['1581', '1171', '1031'], want: 12, why: '柏妮思[异常] ⇒ tier 2' },
    { ids: ['1581', '1581', '1031'], want: 12, why: '**重复蕾米**：两个异常 + support ⇒ tier 2（不翻倍）' },
    // tier 3：3 名异常
    { ids: ['1581', '1261', '1331'], want: 35, why: '三异常 ⇒ tier 3' },
    { ids: ['1581', '1261', '1221'], want: 35, why: '三异常（简+柳）⇒ tier 3' },
  ]

  for (const c of CASES) {
    it(`精确值 ${c.want}：${c.why}`, async () => {
      const p = await panelOf(c.ids, c.ids.indexOf('1581'))
      expect(p.remielleRadiantTurnDazeBonusPct).toBe(c.want)
    })
  }

  it('★ 只写在蕾米自己那一槽（同槽自面板块）：队友槽读数为 0', async () => {
    expect((await panelOf(['1581', '1261', '1331'], 0)).remielleRadiantTurnDazeBonusPct).toBe(35)
    // 队友面板该字段缺席 ⇒ 读 0（`?? 0` 是**测试侧**读法，断言值仍是精确 0）
    expect((await panelOf(['1581', '1261', '1331'], 1)).remielleRadiantTurnDazeBonusPct ?? 0).toBe(0)
    expect((await panelOf(['1581', '1261', '1331'], 2)).remielleRadiantTurnDazeBonusPct ?? 0).toBe(0)
  })

  it('★ 前导空槽按**槽位号**定位（判据 17：槽位号 ≠ 下标）', async () => {
    // 蕾米在槽位 1（槽 0 空）⇒ 槽 1 拿档位、槽 2 拿不到
    expect((await panelOf(['', '1581', '1331'], 1)).remielleRadiantTurnDazeBonusPct).toBe(12)
    expect((await panelOf(['', '1581', '1331'], 2)).remielleRadiantTurnDazeBonusPct ?? 0).toBe(0)
  })

  it('★ 钩子契约：非蕾米 agent 直调 `applyPanel` 时**一个字节都不写**（防御性身份守卫）', () => {
    // ⚠ **诚实标注**：本层验的是**钩子契约**而非派发器可达面 —— 派发器是
    // `getAgentMechanic(agent.id)`（`mechanics/registry.ts` 按 **id** 查表），
    // 蕾米的 `applyPanel` 只会被派发给 `id === '1581'` 的槽 ⇒ 该守卫在**当前架构下不可达**。
    // 保留它的理由：① 契约面两臂（`id` / `teammateBuffId` 别名）在**模块自述**层要自洽；
    // ② 若哪天派发器改成按身份判定，缺守卫会让**所有**槽都被写上面板字段（静默跨槽泄漏）。
    // 本断言把守卫钉住 —— 删掉它（变异 6）本行立刻红。
    const fn = remielleMechanic.applyPanel!
    const team = [
      { slot: 0, agentId: '1181', agent: { id: '1181' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 1, agentId: '1201', agent: { id: '1201' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 2, agentId: '1031', agent: { id: '1031' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
    ] as never
    for (const [slot, agentId] of [[0, '1181'], [1, '1201']] as const) {
      const panel = emptyPanel() as unknown as Record<string, number>
      fn({
        slot,
        agent: { id: agentId } as never,
        cinemaLevel: 6,
        potentialLevel: 6,
        team,
        outOfCombatPanel: emptyPanel(),
        panel: panel as never,
        settings: {},
        enemyStunVuln: 1.5,
      })
      expect(panel.remielleRadiantTurnDazeBonusPct, `非蕾米 ${agentId} 不得写该字段`).toBeUndefined()
    }
  })

  it('★ 钩子契约：非蕾米 agent 直调 `buildCharConfig` 时不得写 cfg 字段（同一守卫的另一出口）', () => {
    const fn = remielleMechanic.buildCharConfig!
    const team = [
      { slot: 0, agentId: '1181', agent: { id: '1181' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 1, agentId: '1201', agent: { id: '1201' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 2, agentId: '1031', agent: { id: '1031' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
    ] as never
    const cfg = {} as unknown as Record<string, unknown>
    const panel = emptyPanel() as unknown as Record<string, number>
    fn({
      slot: 0,
      agent: { id: '1181' } as never,
      skills: {} as never,
      cinemaLevel: 0,
      potentialLevel: 6,
      wEngineId: '',
      wEngineModLevel: 1,
      team,
      panel: panel as never,
      cfg: cfg as never,
      getRowValue: () => 0,
    })
    expect(cfg.remielleEnabled).toBeUndefined()
    expect(cfg.remielleRadiantTurnDazeBonusPct).toBeUndefined()
    expect(panel.remielleRadiantTurnDazeBonusPct).toBeUndefined()
  })
})

// ════════════════════════════════════════════════ 组2-D：相变时流（跨槽队伍级）

describe('组2-D `:798` 相变时流 → remielle.ts#teamPanelEffects', () => {
    /**
   * 原式 `(12 + (C5?4 : C3?2 : 0)) × 1.5` ⇒ **18 / 21 / 24**（按蕾米技能等级 12/14/16）。
   *
   * ⚠ 端到端读数（`computePanelPhases`）在**蕾米在队**时还叠着她自己的 teammate-buff 拐力
   * （`[1581,1181,1031]` C0 = **78**，而 `[1011,1181,1031]` = **30**）⇒ 它**不是**本块的纯露出。
   * 故本层的**精确值**判据拆两条腿：
   *  §a **纯露出**（直调钩子，`emptyPanel` 起点）：`dmgBonus` 精确 **18 / 21 / 24**，各目标槽同值；
   *  §b **端到端逐档差分**（真派发器）：迁移前 HEAD 实测 `78 / 81 / 84`（C0 / C3 / C5）
   *      —— 端到端不动，就是「逐位等价」本身要证的东西。
   */
  const SELF_MATE_TEAM_IDS = ['1581', '1181', '1031'] as const

  /** 直调钩子的纯露出（`emptyPanel()` 起点，不掺 teammate-buff） */
  function hookDelta(
    cinemaLevel: number,
    targetSlot: number,
    opts: { sourceSlot?: number; sourceAgent?: { id: string }; targetAgentId?: string } = {},
  ): number {
    const fn = remielleMechanic.teamPanelEffects!
    const team = [
      { slot: 0, agentId: '1581', agent: { id: '1581' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 1, agentId: '1181', agent: { id: '1181' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 2, agentId: '1031', agent: { id: '1031' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
    ] as never
    const panel = emptyPanel() as unknown as Record<string, number>
    fn({
      slot: opts.sourceSlot ?? 0,
      agent: (opts.sourceAgent ?? { id: '1581' }) as never,
      cinemaLevel,
      team,
      targetSlot,
      // ⚠ targetAgent 必须按**真实目标槽**给（层④ 验「无自排除」，传错人会让该层变成空转）
      targetAgent: { id: opts.targetAgentId ?? (team as Array<{ agentId: string }>)[targetSlot].agentId } as never,
      panel: panel as never,
      settings: {},
    })
    return panel.dmgBonus
  }

  it('§a 纯露出精确值：C0/2 ⇒ 18、C3/4 ⇒ 21、C5/6 ⇒ 24（命座边界逐档）', async () => {
    expect(hookDelta(0, 1)).toBe(18)
    expect(hookDelta(1, 1)).toBe(18)
    expect(hookDelta(2, 1)).toBe(18)
    expect(hookDelta(3, 1)).toBe(21)
    expect(hookDelta(4, 1)).toBe(21)
    expect(hookDelta(5, 1)).toBe(24)
    expect(hookDelta(6, 1)).toBe(24)
    // 边界差分精确为 3
    expect(hookDelta(3, 1) - hookDelta(2, 1)).toBe(3)
    expect(hookDelta(5, 1) - hookDelta(4, 1)).toBe(3)
  })

  it('§b 端到端逐档差分（迁移前 HEAD 指纹基线，真派发器）', async () => {
    // 迁移前 HEAD 实测：C0=78 / C3=81 / C5=84（差分 3 / 3，与 §a 的 18/21/24 差 60：
    // 那 60 是蕾米 teammate-buff 给队友的固定拐力，与本块无关）
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [0] })).dmgBonus).toBe(78)
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [3] })).dmgBonus).toBe(81)
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [5] })).dmgBonus).toBe(84)
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [2] })).dmgBonus).toBe(78)
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [4] })).dmgBonus).toBe(81)
    expect((await panelOf(SELF_MATE_TEAM_IDS, 1, { cinema: [6] })).dmgBonus).toBe(84)
  })

  it('★★ 无自排除：加成对**每个**目标槽同值（含蕾米本人那槽）', async () => {
    // 原块无 `agent.id !== '1581'` 项 ⇒ 蕾米自己那格同样吃。
    // 直调钩子逐目标槽对照（纯露出，排除 teammate-buff 混淆）：
    // ⚠ targetAgent 传**真实**目标（槽 0 = 蕾米本人）——传成别人本层会变成空转（本批踩过，
    // 变异 3「顺手加自排除」当时只让另两层红、本层没红 ⇒ 已修正传参）。
    for (const target of [0, 1, 2]) expect(hookDelta(0, target), `target=${target}`).toBe(18)
    for (const target of [0, 1, 2]) expect(hookDelta(5, target), `target=${target}`).toBe(24)
    // ⚠ 迁移时「顺手加自排除」会让 target=0 变 0 ⇒ 本断言立刻红（这正是防它的靶子）
    expect(hookDelta(0, 0), '蕾米本人那格也必须吃（原块无自排除）').toBe(18)
  })

  it('★★ 重复蕾米：光环只加**一次**，且只由**槽位最小**的蕾米认领（本批实测真回归的靶子）', async () => {
    // ⚠ 实测回归：不设守卫时 `[1581,1581,1581]` 的 dmgBonus 会由 63 → 69（差值 6 = 3 份 18 变成更多）
    // 本批第一次对拍实测到的是 33 → 69（差值 36 = 2 × 18）——同一个缺陷的两个读数。
    // 直调钩子：**次位**蕾米不得认领（返回 0 = 一个字节都没写）
    const fn = remielleMechanic.teamPanelEffects!
    const team = [
      { slot: 0, agentId: '1581', agent: { id: '1581' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 1, agentId: '1581', agent: { id: '1581' }, cinemaLevel: 5, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
      { slot: 2, agentId: '1181', agent: { id: '1181' }, cinemaLevel: 0, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 },
    ] as never
    const second = emptyPanel() as unknown as Record<string, number>
    fn({
      slot: 1, agent: { id: '1581' } as never, cinemaLevel: 5, team,
      targetSlot: 2, targetAgent: { id: '1181' } as never, panel: second as never, settings: {},
    })
    expect(second.dmgBonus, '次位蕾米不得认领（否则双蕾米会加 N 次）').toBe(0)
    expect(hookDelta(5, 2), '首位蕾米（C5）⇒ 24').toBe(24)

    // 端到端：三蕾米全 C5 与单蕾米 C5 的**差分**必须一致（都只加一次 24）
    const single = await panelOf(['1581', '1181', '1031'], 1, { cinema: [5] })
    const triple = await panelOf(['1581', '1581', '1581'], 1, { cinema: [5, 5, 5] })
    expect(single.dmgBonus).toBe(84)
    expect(triple.dmgBonus).toBe(69)   // ⚠ 与单蕾米**不同队**（队友 buff 结构不同）；下面用成对对照
    // 成对对照：同队里把「第二个蕾米」从 C0 提到 C5 ⇒ 端到端**逐位不变**（档位只看首位）
    const dupeFirstC0 = await panelOf(['1581', '1581', '1181'], 2, { cinema: [0, 0] })
    const dupeSecondC5 = await panelOf(['1581', '1581', '1181'], 2, { cinema: [0, 5] })
    expect(dupeFirstC0.dmgBonus).toBe(93)
    expect(dupeSecondC5.dmgBonus, '次位命座不得影响档位（差值为 0）').toBe(93)
    // 反向：把**首位**从 C0 提到 C5 ⇒ 端到端 +3（18→21… 实为 18→24 ⇒ 差 6）
    const dupeFirstC5 = await panelOf(['1581', '1581', '1181'], 2, { cinema: [5, 0] })
    expect(dupeFirstC5.dmgBonus).toBe(99)
    expect(dupeFirstC5.dmgBonus - dupeFirstC0.dmgBonus).toBe(6)
  })

  it('★ 蕾米在任意槽都生效（跨槽光环；空槽/槽位号无关，端到端逐位等价）', async () => {
    // 迁移前 HEAD 指纹：三种排布 × 三档命座 端到端读数全等（78 / 81 / 84）
    for (const ids of [
      ['1581', '1181', '1031'], ['1181', '1581', '1031'], ['1181', '1031', '1581'],
    ] as const) {
      const at = async (cin: number) => {
        const slot = ids.indexOf('1581')
        return (await panelOf(ids, 2, { cinema: ids.map((_, i) => (i === slot ? cin : undefined)) })).dmgBonus
      }
      expect([await at(0), await at(3), await at(5)], JSON.stringify(ids)).toEqual([78, 81, 84])
    }
  })
})

// ════════════════════════════════════════════════ 组1-A：耀嘉音源面板槽位（findSlotByIdentity）

describe('组1-A `:621` 耀嘉音源面板槽位 → findSlotByIdentity', () => {
  /**
   * 本处是**形状收敛**而非减量（`c.agentId === '1311'` 本就计入棘轮）：
   * 原 `configStore.team.findIndex(c => c.agentId === '1311')` → `findSlotByIdentity(…, ['1311'])`。
   *
   * ⚠ 该块写的是 `sourcePanelsByOwner['1311']`（**源面板**，与当前槽无关）⇒ 是**跨槽**块，不是
   * 同槽面板块。本批**只换查找形状、不迁落点**（迁它需「源面板写入口」契约，属分诊批次 2 的判死项）。
   */
  it('精确值：耀嘉音 C0/3/5 的技能等级加成经源面板进队友面板（94 / 96 / 98）', async () => {
    // 迁移前 HEAD 实测；`[1011,1031,'']` 对照 = 30
    for (const slot of [0, 1, 2]) {
      expect((await panelOf(['1311', '1011', '1031'], slot, { cinema: [0] })).dmgBonus, `c0/slot${slot}`).toBe(94)
      expect((await panelOf(['1311', '1011', '1031'], slot, { cinema: [3] })).dmgBonus, `c3/slot${slot}`).toBe(96)
      expect((await panelOf(['1311', '1011', '1031'], slot, { cinema: [5] })).dmgBonus, `c5/slot${slot}`).toBe(98)
    }
    // 端点差分精确 2 / 2（C3=+2、C5=+4 技能等级 → 咏叹华彩公式各跳一档）
    expect((await panelOf(['1311', '1011', '1031'], 1, { cinema: [3] })).dmgBonus
      - (await panelOf(['1311', '1011', '1031'], 1, { cinema: [0] })).dmgBonus).toBe(2)
    expect((await panelOf(['1311', '1011', '1031'], 1, { cinema: [5] })).dmgBonus
      - (await panelOf(['1311', '1011', '1031'], 1, { cinema: [3] })).dmgBonus).toBe(2)
  })

  it('★ 源面板块与耀嘉音所在**槽位**无关（跨槽：她在槽 0/1/2 读数全同）', async () => {
    for (const slot of [0, 1, 2]) {
      expect((await panelOf(['1011', '1311', '1031'], slot, { cinema: [undefined, 5, undefined] })).dmgBonus,
        `yj@1/slot${slot}`).toBe(98)
    }
  })

  it('★ 数据面事实（诚实记录）：`skillLevelBonus` 的源面板写入**当前无消费者** ⇒ 反向验证打不到它', async () => {
    // ⚠ **本层是本批唯一「反向验证失败」的一处，如实记录**：
    // 本块把 `skillLevelBonus` 写进 `sourcePanelsByOwner['1311']`，而该字段**唯一**的消费路径是
    // `core/buff.ts#cloneEffectWithSourceValue` 的 `dynamicSkillLevel = 12 + panel.skillLevelBonus`，
    // 前提是队友 buff 的 effect **同时**声明 `sourceStat` + `sourcePanelPhase`。
    //
    // **实测（本批两次独立证据）**：
    // ① 1311 名下那两条带 `sourceStat` 的 effect（`yaojiayin.core_andante_atk` /
    //    `yaojiayin.cinema_2.core_andante_atk_bonus`，均在 C5 时启用）用的都是 **`atk`**，
    //    且 formula 只含 `x`（第二条 = `clamp(x*0.54,0,1600) - clamp(x*0.35,0,1200)`），**无 `s`**
    //    ⇒ 没有任何 effect 读 `dynamicSkillLevel`。
    // ② 把本块的 `'1311'` 故意改成 `'1211'`（变异 11）后，本批 **16596 行**逐位指纹 diff **仍为 0**
    //    （`/tmp/fp-mut11.txt`，`diff | wc -l` = 0）。
    // ⇒ 本块是**当前数据面下的死写**（与分诊 §3.1 对 A1「耀嘉音源面板」的判死假设**独立吻合**：
    //   它穷举 `sourceStat` 直方图得「提 skillLevel 的 0 条」，本批是从**消费端公式**这一侧验的）。
    // ⚠ **本批未删**（删 = 判死动作，需引擎实测背书 + 独立批次授权；brief 明确不许）。
    // 本断言把该事实钉住：若哪天有 effect 开始读 `skillLevelBonus`（或 formula 用 `s`），这里立刻红
    // ⇒ 届时应把本块纳入反向验证面，并复核它的 id 是否仍指向耀嘉音。
    const { catalog, config } = await ctx(['1311', '1011', '1031'], {}, /* cinema */ { 0: 5 })
    const srcCtx = buildTeammateBuffSourceContext(config.team, {
      teammateBuffGroups: catalog.teammateBuffGroups,
      driveDiscSetsMap: catalog.driveDiscSetsMap,
      statRules: catalog.statRules,
      getAgent: id => catalog.getAgent(id),
      getWEngine: id => catalog.getWEngine(id),
      isTeammateBuffEnabled: id => config.isTeammateBuffEnabled(id),
    })
    // ① 别名齐备：1311 的源面板确实挂在 owner key 下（本块能写到它）
    expect(srcCtx.sourcePanelsByOwner['1311']).toBeTruthy()
    // ② 事实：1311 名下带 sourceStat 的 effect（C5 两条全启用）用的都不是 skillLevelBonus、formula 不含 s
    const statUsing = srcCtx.enabledTeammateBuffs
      .filter(b => ['1311', 'yaojiayin'].includes(String(b.ownerId ?? '')))
      .flatMap(b => (b.effects ?? []).map(e => ({ id: b.id, effectId: String((e as { id?: string }).id ?? ''), ...(e as unknown as { sourceStat?: string; formula?: unknown }) })))
      .filter(e => !!e.sourceStat)
    expect(statUsing.map(e => e.effectId).sort(), '1311 名下带 sourceStat 的 effect 清单（数据面变化 ⇒ 复核本层）')
      .toEqual(['yaojiayin_cinema_2_core_atk_delta', 'yaojiayin_core_andante_atk_flat'])
    for (const e of statUsing) {
      expect(e.sourceStat, `${e.effectId} 若改用 skillLevelBonus ⇒ 本块复活，需纳入反向验证`).toBe('atk')
      const formula = typeof e.formula === 'object' && e.formula !== null
        ? String((e.formula as { expression?: string }).expression ?? '')
        : String(e.formula ?? '')
      expect(formula.includes('s'), `${e.effectId} 的 formula 若开始用 s ⇒ 本块复活，需纳入反向验证`).toBe(false)
    }
  })

  it('★ 等价性 oracle：helper 结果 === 旧 team.findIndex 表达式', async () => {
    for (const ids of [
      ['1311', '1011', '1031'], ['1011', '1311', '1031'], ['', '1311', '1011'],
      ['1011', '1031', '1181'], ['1311', '1311', '1011'],
    ] as const) {
      const { catalog, config } = await ctx(ids)
      const legacy = config.team.findIndex(c => c.agentId === '1311')
      expect(findSlotByIdentity(config as never, catalog as never, ['1311']), JSON.stringify(ids)).toBe(legacy)
    }
  })
})

// ════════════════════════════════════════════════ 组1-B：里奈槽位（findSlotByIdentity）

describe('组1-B `:942` 里奈槽位 → findSlotByIdentity', () => {
  it('精确值：门控通过 ⇒ 电属性 +3；不通过 / 不在队 ⇒ 真 0', async () => {
    const on = await ctx(['1211', '1011', '1031'])
    expect(getTeamAnomalyDurationBonus(on.config, on.catalog, 'electric')).toBe(3)
    // 门控 = `evalAdditionalAbility`（队友条件），不是「在队即 +3」：
    const solo = await ctx(['1211', '', ''])
    expect(getTeamAnomalyDurationBonus(solo.config, solo.catalog, 'electric')).toBe(0)
    const off = await ctx(['1011', '1031', '1181'])
    expect(getTeamAnomalyDurationBonus(off.config, off.catalog, 'electric')).toBe(0)
  })

  it('★ 前导空槽：槽位号按**真实槽位**给（helper 返回下标即槽位号）', async () => {
    // 里奈在槽位 1 ⇒ 门控仍能拿到正确的槽位（若返回压缩下标会指向空槽 ⇒ 门控失败 ⇒ 0）
    const lead = await ctx(['', '1211', '1011'])
    expect(getTeamAnomalyDurationBonus(lead.config, lead.catalog, 'electric')).toBe(3)
  })

  it('★ 等价性 oracle：helper 结果 === 旧 `team.find(m => m.agentId === id)?.slot ?? -1`', async () => {
    const legacy = (config: unknown, catalog: unknown) => {
      const c = config as { team: Array<{ agentId: string }> }
      const cat = catalog as { getAgent: (id: string) => unknown }
      const members = c.team.map((ch, slot) => ({ slot, agentId: ch.agentId, agent: ch.agentId ? cat.getAgent(ch.agentId) : null }))
      // 旧式只用 `agentId`，**不查** teammateBuffId —— 等价性只在 `agentId` 命中面成立
      return members.find(m => m.agentId === '1211')?.slot ?? -1
    }
    for (const ids of [
      ['1211', '1011', '1031'], ['1011', '1211', '1031'], ['', '1211', '1011'],
      ['1011', '1031', '1181'], ['1211', '1211', '1011'], ['1011', '', '1211'],
    ] as const) {
      const { catalog, config } = await ctx(ids)
      // ⚠ 里奈 1211 的 teammateBuffId 是 `undefined`（实测）⇒ 两实现必然同值；
      // 若哪天数据面给它一个别名，本断言会红 ⇒ 提醒复核那一行迁移
      expect(findSlotByIdentity(config as never, catalog as never, ['1211']), JSON.stringify(ids))
        .toBe(legacy(config, catalog))
    }
  })
})

// ════════════════════════════════════════════════ 组2-E：isRemielle 谓词

describe('组2-E `:996` isRemielle → remielle.ts#isRemielleAgent', () => {
  it('★ 等价性 oracle：谓词结果 === 旧内联两臂表达式（逐角色 + 空值安全）', async () => {
    const legacy = (a: { id?: string; teammateBuffId?: string } | null | undefined) =>
      a?.id === '1581' || a?.teammateBuffId === 'remielle'
    const { catalog } = await ctx(['1581', '1261', '1011'])
    for (const id of ['1581', '1261', '1011', '1031', '1311', '1211', '1181', '1331', '1221', '1171']) {
      const a = catalog.getAgent(id)
      expect(isRemielleAgent(a), id).toBe(legacy(a))
    }
    expect(isRemielleAgent(null)).toBe(false)
    expect(isRemielleAgent(undefined)).toBe(false)
    expect(isRemielleAgent({})).toBe(false)
  })

  it('★ 数据面事实：`remielle` **不是**任何角色的 teammateBuffId（该臂当前恒 false，但契约面要留）', async () => {
    const { catalog } = await ctx(['1581', '1261', '1011'])
    // 蕾米真实的 teammateBuffId 就是自身 id ⇒ 别名臂在当前数据面永不命中
    expect(catalog.getAgent('1581')!.teammateBuffId).toBe('1581')
    expect(isRemielleAgent({ id: '1581' })).toBe(true)
    // 别名臂单独可命中（构造对象，证明分支活着）
    expect(isRemielleAgent({ teammateBuffId: 'remielle' })).toBe(true)
    expect(isRemielleAgent({ id: '9999', teammateBuffId: 'remielle' })).toBe(true)
  })

  it('★ 风染挑槽：蕾米被**排除**（跳到队里第 3 位）；非蕾米异常角色**会被**挑中（成对对照）', async () => {
    // 维琳娜 1561 = 风（风染源）；蕾米 1581 = 异常但非风 ⇒ 若不排除会被挑中
    const skip = await ctx(['1561', '1581', '1011'])
    expect(getWindInfectionTargetSlot(skip.config, skip.catalog)).toBe(2)
    expect(getWindInfectionElement(skip.config, skip.catalog)).toBe('electric')
    // 反锁：把蕾米换成另一个异常（简 1261）⇒ 该槽**会被**挑中
    const useJane = await ctx(['1561', '1261', '1011'])
    expect(getWindInfectionTargetSlot(useJane.config, useJane.catalog)).toBe(1)
    expect(getWindInfectionElement(useJane.config, useJane.catalog)).toBe('physical')
  })

  it('★ 风染挑槽：无风角色 ⇒ -1（真值，不是 0）', async () => {
    const dry = await ctx(['1011', '1181', '1031'])
    expect(getWindInfectionTargetSlot(dry.config, dry.catalog)).toBe(-1)
  })
})

// ════════════════════════════════════════════════ 组2-F：cfg 双出口

describe('组2-F `:1661` cfg 双出口 → remielle.ts#buildRemielleCharConfig', () => {
  it('精确值：命中槽 `remielleEnabled === true`，档位写进 cfg **与** panel（双出口都通）', async () => {
    const { catalog, config } = await ctx(['1581', '1261', '1331'])
    const cfg = buildCharConfig(0, config, catalog)!
    expect(cfg.remielleEnabled).toBe(true)
    expect(cfg.remielleRadiantTurnDazeBonusPct).toBe(35)
    expect(cfg.panel.remielleRadiantTurnDazeBonusPct).toBe(35)
  })

  it('★ 未命中槽：cfg 两字段 `undefined`（消费端 `if (cfg.remielleEnabled && …)` 下等价于 false）', async () => {
    const { catalog, config } = await ctx(['1581', '1261', '1331'])
    for (const slot of [1, 2]) {
      const cfg = buildCharConfig(slot, config, catalog)!
      expect(cfg.remielleEnabled, `槽${slot}`).toBeUndefined()
      expect(cfg.remielleRadiantTurnDazeBonusPct, `槽${slot}`).toBeUndefined()
    }
  })

  it('★ 槽位号 ≠ 下标：蕾米在槽 1 时只有槽 1 的 cfg 带字段', async () => {
    const { catalog, config } = await ctx(['1261', '1581', '1031'])
    expect(buildCharConfig(1, config, catalog)!.remielleEnabled).toBe(true)
    expect(buildCharConfig(0, config, catalog)!.remielleEnabled).toBeUndefined()
    expect(buildCharConfig(2, config, catalog)!.remielleEnabled).toBeUndefined()
  })

  it('★ 面板阶段与 cfg 阶段读**同一个数**（原先双写者同值 ⇒ 本批收敛为唯一写者）', async () => {
    for (const ids of [['1581', '1261', '1331'], ['1581', '1181', '1031'], ['1581', '', '']] as const) {
      const { catalog, config } = await ctx(ids)
      const cfg = buildCharConfig(0, config, catalog)!
      const p = computePanelPhases(0, config, catalog)!.inCombat
      expect(cfg.remielleRadiantTurnDazeBonusPct, JSON.stringify(ids))
        .toBe(p.remielleRadiantTurnDazeBonusPct ?? 0)
    }
  })
})

// ════════════════════════════════════════════════ 层⑦：未迁项的诚实反锁

describe('层⑦：本批**刻意没做**的事（做了会静默改数值）', () => {
  it('★ 简面板块仍在编排层：`jane.passionCoverage` 滑块必须**真的生效**（迁进模块会丢值）', async () => {
    // 若简块被迁进 `jane.ts#applyPanel`，模块只能读 `settings['jane.passionCoverage']`，
    // 而它**未注册** ⇒ 该键在 `AgentPanelInput.settings` 里缺席 ⇒ 读数恒为 `?? 0.9` 的回落值
    // ⇒ 滑块静默失效。本批逐位对拍**实测过**这个失败形态（迁移版把 47.5 读成 0）。
    const at = async (cov: number) =>
      (await panelOf(['1261', '1011', '1031'], 0, { settings: { 'jane.passionCoverage': cov } }))
        .physicalAnomalyBuildUpEfficiency
    // 精确值（迁移前 HEAD 实测）：1011(stun)/1031(support) 都不满足痛点门控
    // ⇒ 只有「狂热 25 × 覆盖率」这一项（C0 无影画1 项）
    expect(await at(0)).toBe(0)
    expect(await at(0.5)).toBe(12.5)
    expect(await at(1)).toBe(25)
    expect((await at(1)) - (await at(0))).toBe(25)
    expect((await at(0.5)) - (await at(0))).toBe(12.5)
  })

  it('★ 简块的身份守卫按**两臂**匹配（`teammateBuffId` 别名臂也要留）', async () => {
    const { catalog } = await ctx(['1261', '1011', '1031'])
    const jane = catalog.getAgent('1261')!
    expect(jane.id).toBe('1261')
    // 数据面：恰等于自身 ⇒ 两臂同值（契约面两臂都要留，见 jane.ts 注释）
    expect(jane.teammateBuffId).toBe('1261')
  })

  it('★ `jane.passionCoverage` **仍未注册**（本批不许为迁移方便而注册 = 产品级口径待裁决）', async () => {
    // ⚠ 这是**缺口登记**，不是「应该如此」的背书：注册它会让它进
    // `ResourceUtilizationPage.vue` 的 `mechanicSettings` v-for ⇒ 与手写卡片（`janePassionSlot`）并存
    // = 双滑块。用户未裁决该产品口径 ⇒ 本批**不注册**。
    // 若哪天裁决「注册 + 删手写卡片」，本行会红 ⇒ 届时请同步复核上一条端点判据
    // （注册后 `settings['jane.passionCoverage']` 就有值，简块即可迁进模块）。
    const registered = getRegisteredMechanicSettings()
    expect(registered.some(s => s.id === 'jane.passionCoverage')).toBe(false)
  })

  it('★ 组3 未动：`findSlotByIdentity` 语义保持不变（批 A/批 B 正在 import 它）', async () => {
    // 只验**行为契约**（不验实现行号）：未命中 ⇒ -1；前导空槽 ⇒ 真实槽位；两字段都查。
    const { catalog, config } = await ctx(['', '1581', '1011'])
    expect(findSlotByIdentity(config as never, catalog as never, ['1581'])).toBe(1)
    expect(findSlotByIdentity(config as never, catalog as never, ['1011'])).toBe(2)
    expect(findSlotByIdentity(config as never, catalog as never, ['9999'])).toBe(-1)
    expect(findSlotByIdentity(config as never, catalog as never, ['remielle'])).toBe(-1)
  })
})
