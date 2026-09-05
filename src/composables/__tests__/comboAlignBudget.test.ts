/**
 * 合轴预算抵扣（2026-09-04 合轴口径落地）生效测试：
 * - 招式合轴率（comboAlignRatio）抵扣团队时间预算：Σnecessary 允许 > 战斗时间（Σ>180），
 *   合轴抵扣后净占用装得下 → 平A池扩大、overflowSeconds 按合轴后净额；
 * - GROSS/NET 约定：抵扣只计含在 necessaryTime 内的合轴（照/卢西娅 NET 已剔除 → credit=0
 *   不重复抵扣；11号 GROSS 含在 necessary 内 → credit=comboAlignTime 可抵扣）；
 * - 单角色前台硬顶：前台（必要+平A）≤ 战斗总时间，截断份额水填回流给还有余量的队友（2026-09-05 改）；
 * - 超时判定同口径：netFrontlineOccupation = Σ前台行 − 每槽 max(招式抵扣, 轴内节省)（不叠加）。
 *
 * 口径缺省安全：合轴率默认全 0（catalog 仅 1401012 平A段非零、不在 necessary 通道），
 * 本机制纯 opt-in——末条回归守卫钉住「不设合轴率时与旧口径逐位一致」。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { iterate, netFrontlineOccupation } from '@/core/resource/helpers'
import { calcTeamResources, clearWarmStartCache } from '@/core/resource'
import type { ResourceCalcConfig, IterationState, TeamResourceResult } from '@/types/resource'

beforeEach(() => {
  clearWarmStartCache()
})

function deepCopy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}

async function capturedConfig(team: string[]): Promise<ResourceCalcConfig> {
  // 交互归零（弹刀/闪反/快支的 base 必要时间会淹没受控变量）；合轴机制与交互无关
  await setupHarness(team.map(agentId => ({
    agentId, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0,
  })))
  const calc = useResourceCalc()
  const cfg = calc.resourceConfig.value!
  expect(cfg.characters.length).toBe(3)
  return deepCopy(cfg)
}

function zeroStates(cfg: ResourceCalcConfig): IterationState[] {
  return cfg.characters.map(() => ({
    basicAttackTime: 0,
    exSpecialCount: 0,
    ultimateCount: 0,
    chainCountTotal: 0,
    totalEnergy: 0,
    totalDecibel: 0,
    necessaryTime: 0,
    frontlineTime: 0,
    backstageTime: cfg.totalTime,
    comboAlignTime: 0,
  }))
}

const sumBasics = (states: IterationState[]) =>
  states.reduce((a, s) => a + s.basicAttackTime, 0)
const sumNecessary = (states: IterationState[]) =>
  states.reduce((a, s) => a + s.necessaryTime, 0)
/** 净占用（扣合轴抵扣）——可行性封顶约束的是这个量，毛值允许 >180 */
const sumNecessaryNet = (states: IterationState[]) =>
  states.reduce((a, s) => a + Math.max(0, s.necessaryTime - (s.comboAlignCredit ?? 0)), 0)

describe('合轴率抵扣团队时间预算', () => {
  it('Σnecessary>180 可行：合轴抵扣后净占用装得下 → 平A池扩大、overflow 归零', async () => {
    const cfg = await capturedConfig(['1061', '1011', '1151'])
    // 连携次数直写 override（iterate 输入项，不依赖失衡收敛）：把必要时间推过 180
    for (const c of cfg.characters) {
      c.chainCountTotalOverride = 40
      c.timeWeight = 1
    }

    const cold = deepCopy(cfg)
    const s0 = iterate(cold.characters, zeroStates(cold), cold)
    // 无合轴抵扣：想打的必做动作超预算 ⇒ **账本被可行性封顶到预算**（2026-09-05 新口径，
    // 不再虚高到 180 以上），池被挤光，压力记在 overflowSeconds（= 想打却装不下的量）。
    // 封顶的是**净占用**（合轴抵扣不占预算，原样保留），所以毛值可以 >180
    expect(sumNecessaryNet(s0)).toBeLessThanOrEqual(cold.totalTime + 1e-6)
    expect(sumNecessaryNet(s0)).toBeGreaterThan(cold.totalTime - 1)
    expect(sumBasics(s0)).toBeCloseTo(0, 6)
    expect(cold.overflowSeconds).toBeGreaterThan(0)

    const warm = deepCopy(cfg)
    for (const c of warm.characters) c.chainComboAlignRatio = 1
    const s1 = iterate(warm.characters, zeroStates(warm), warm)
    // 全额合轴抵扣：合轴段不占预算 ⇒ 封顶后 Σnecessary 仍 >180（净占用压到预算 + 抵扣保留），
    // 池因此打开、overflow 归零——这正是合轴放宽的意义，封顶不吞它
    expect(sumNecessary(s1)).toBeGreaterThan(warm.totalTime)
    expect(sumBasics(s1)).toBeGreaterThan(sumBasics(s0) + 10)
    expect(warm.overflowSeconds).toBe(0)
    // overflow 净额口径 = Σnecessary − 抵扣 − 预算
    const relief = s1.reduce((a, s) => a + (s.comboAlignCredit ?? 0), 0)
    expect(relief).toBeGreaterThan(0)
  })

  it('单角色前台硬顶：平A份额超「总时间−必要」时截断到 180；无队友可接时留在池里', async () => {
    const cfg = await capturedConfig(['1061', '1011', '1151'])
    cfg.characters[0].chainCountTotalOverride = 20
    cfg.characters[1].chainCountTotalOverride = 40
    cfg.characters[2].chainCountTotalOverride = 40
    for (const c of cfg.characters) c.chainComboAlignRatio = 1
    cfg.characters[0].timeWeight = 1
    cfg.characters[1].timeWeight = 0
    cfg.characters[2].timeWeight = 0

    const s = iterate(cfg.characters, zeroStates(cfg), cfg)
    // 池（合轴抵扣后 ≈ 180−Σbase）> 槽0 剩余时间（180−槽0必要）→ cap 生效，前台贴 180 硬顶
    expect(s[0].necessaryTime).toBeLessThan(cfg.totalTime)
    expect(s[0].frontlineTime).toBeLessThanOrEqual(cfg.totalTime + 1e-6)
    expect(s[0].frontlineTime).toBeGreaterThanOrEqual(cfg.totalTime - 1e-6)
    expect(s[0].basicAttackTime).toBeCloseTo(cfg.totalTime - s[0].necessaryTime, 6)
    // 权重 0 的角色不接池（没有有余量的队友 → 截断的份额留在池里）
    expect(s[1].basicAttackTime).toBe(0)
    expect(s[2].basicAttackTime).toBe(0)
  })

  it('截断份额回流（2026-09-05 改口径）：贴顶槽吃不下的秒数按剩余权重水填给有余量的队友', async () => {
    const cfg = await capturedConfig(['1061', '1011', '1151'])
    cfg.characters[0].chainCountTotalOverride = 20
    cfg.characters[1].chainCountTotalOverride = 40
    cfg.characters[2].chainCountTotalOverride = 40
    for (const c of cfg.characters) c.chainComboAlignRatio = 1
    // 槽0 权重压倒性（9/1/0）：它的 naive 份额远超「180 − 必要时间」→ 必然贴顶被截断
    cfg.characters[0].timeWeight = 9
    cfg.characters[1].timeWeight = 1
    cfg.characters[2].timeWeight = 0

    const s = iterate(cfg.characters, zeroStates(cfg), cfg)
    const pool = Math.max(0, cfg.totalTime - (cfg.invincibleTime ?? 0)
      - s.reduce((a, st) => a + Math.max(0, st.necessaryTime - (st.comboAlignCredit ?? 0)), 0))
    // ① 单人硬顶不破：任何槽前台 ≤ 战斗总时间
    for (const st of s) expect(st.frontlineTime).toBeLessThanOrEqual(cfg.totalTime + 1e-6)
    // ② 槽0 确实被截断（贴 180 硬顶），且它吃不下的份额没有蒸发
    expect(s[0].frontlineTime).toBeGreaterThanOrEqual(cfg.totalTime - 1e-6)
    expect(s[1].basicAttackTime).toBeGreaterThan(0)
    // ③ 池被分完：Σ平A ≈ pool（旧口径下这里会少一截——截断量直接留在池里消失）
    expect(s.reduce((a, st) => a + st.basicAttackTime, 0)).toBeCloseTo(pool, 6)
    // ④ 不凭空造时间：任何槽都不会拿到超过自身物理余量的平A
    for (const st of s) {
      expect(st.basicAttackTime).toBeLessThanOrEqual(Math.max(0, cfg.totalTime - st.necessaryTime) + 1e-6)
    }
  })
})

describe('GROSS/NET 约定（防双重抵扣）', () => {
  it('NET 模块（照）：合轴时间>0 但预算抵扣=0（E 已从 necessary 剔除）', async () => {
    const cfg = await capturedConfig(['1341', '1011', '1151'])
    cfg.characters[0].freeExSpecialCount = 5
    const s = iterate(cfg.characters, zeroStates(cfg), cfg)
    expect(s[0].comboAlignTime).toBeGreaterThan(0)
    expect(s[0].comboAlignCredit ?? 0).toBe(0)
  })

  it('GROSS 模块（11号）：合轴含在 necessary 内 → 抵扣=comboAlignTime', async () => {
    const cfg = await capturedConfig(['1041', '1011', '1151'])
    cfg.characters[0].freeExSpecialCount = 5
    cfg.characters[0].exSpecialComboAlignRatio = 0.5
    const s = iterate(cfg.characters, zeroStates(cfg), cfg)
    expect(s[0].comboAlignTime).toBeGreaterThan(0)
    expect(s[0].comboAlignCredit ?? 0).toBeCloseTo(s[0].comboAlignTime, 6)
    // 抵扣确实含在必要时间内（GROSS 语义自洽）
    expect(s[0].comboAlignCredit ?? 0).toBeLessThanOrEqual(s[0].necessaryTime)
  })
})

describe('netFrontlineOccupation（超时判定单一事实源）', () => {
  function fakeRR(
    rows: Array<{ slot: number; moveId: string; totalTime: number; backstage?: boolean }>,
    opts: {
      creditBySlot?: Record<number, number>
      overlapByAction?: Record<string, number>
      overlapSeconds?: number
    } = {},
  ): TeamResourceResult {
    const slots = [...new Set(rows.map(r => r.slot))]
    return {
      axisOverlapByAction: opts.overlapByAction,
      axisOverlapSeconds: opts.overlapSeconds,
      characters: slots.map(slot => ({
        slot,
        executions: rows.filter(r => r.slot === slot).map(r => ({
          moveId: r.moveId,
          totalTime: r.totalTime,
          timeBucket: r.backstage ? 'backstage' : 'necessary',
        })),
        timeAllocation: { comboAlignCredit: opts.creditBySlot?.[slot] ?? 0 },
      })),
    } as unknown as TeamResourceResult
  }

  it('轴模式：招式抵扣与轴内节省按槽取 max 不叠加', () => {
    // 行全额 50，轴内节省 10，招式抵扣 6 → 净 = 50 − max(6,10) = 40（叠加口径会错扣成 34）
    const rr = fakeRR(
      [{ slot: 0, moveId: 'm1', totalTime: 50 }],
      { creditBySlot: { 0: 6 }, overlapByAction: { '0:m1': 10 } },
    )
    expect(netFrontlineOccupation(rr)).toBeCloseTo(40, 6)
    // 抵扣 20 > 节省 10 → 只再扣增量 10：净 = 50 − 10 − 10 = 30
    const rr2 = fakeRR(
      [{ slot: 0, moveId: 'm1', totalTime: 50 }],
      { creditBySlot: { 0: 20 }, overlapByAction: { '0:m1': 10 } },
    )
    expect(netFrontlineOccupation(rr2)).toBeCloseTo(30, 6)
  })

  it('非轴模式：只扣招式抵扣；后台行不计；无分摊时团队级 max 兜底', () => {
    const rr = fakeRR(
      [
        { slot: 0, moveId: 'm1', totalTime: 50 },
        { slot: 0, moveId: 'bg', totalTime: 99, backstage: true },
      ],
      { creditBySlot: { 0: 6 } },
    )
    expect(netFrontlineOccupation(rr)).toBeCloseTo(44, 6)
    // 只有 axisOverlapSeconds（老注入路径/测试）：抵扣与节省取 max，不叠加
    const scalar = fakeRR(
      [{ slot: 0, moveId: 'm1', totalTime: 50 }],
      { creditBySlot: { 0: 6 }, overlapSeconds: 10 },
    )
    expect(netFrontlineOccupation(scalar)).toBeCloseTo(40, 6)
  })
})

describe('端到端（折叠循环 + 超时判定同口径）', () => {
  it('合轴抵扣队：物化行净占用 ≤ 预算（不误报超时），对照无抵扣队账本超预算且池=0', async () => {
    const cfg = await capturedConfig(['1061', '1011', '1151'])
    for (const c of cfg.characters) {
      c.chainCountTotalOverride = 30
      c.timeWeight = 1
    }

    const base = deepCopy(cfg)
    const rr0 = calcTeamResources(base)
    // 无合轴抵扣：账本被可行性封顶到预算（不再虚高），平A池被挤光 ⇒ 压力体现在 overflowSeconds
    // （= 想打却装不下、被截断的秒数），而不是"账本 > 180"这种虚高可观测。
    const necNet0 = rr0.characters.reduce(
      (a, c) => a + Math.max(0, c.timeAllocation.necessaryTime - (c.timeAllocation.comboAlignCredit ?? 0)), 0)
    expect(necNet0).toBeLessThanOrEqual(rr0.totalTime + 1e-6)
    expect(rr0.overflowSeconds ?? 0).toBeGreaterThan(0)
    expect(rr0.characters.reduce((a, c) => a + c.timeAllocation.basicAttackTime, 0))
      .toBeLessThan(1e-6)

    const aligned = deepCopy(cfg)
    for (const c of aligned.characters) c.chainComboAlignRatio = 1
    const rr1 = calcTeamResources(aligned)
    // 合轴抵扣把池打开（这才是抵扣的真实效果）；截断量口径下两队都不需要砍行 ⇒ 不再断言
    // 「overflow 大降」（旧口径是账本超预算量，2026-09-05 改为被截断的秒数）。
    expect(rr1.characters.reduce((a, c) => a + c.timeAllocation.basicAttackTime, 0))
      .toBeGreaterThan(rr0.characters.reduce((a, c) => a + c.timeAllocation.basicAttackTime, 0))
    // 净占用（超时判定口径）不超预算+容差：合轴放宽不会被误报超时
    expect(netFrontlineOccupation(rr1)).toBeLessThanOrEqual(aligned.totalTime + 2)
    const basics1 = rr1.characters.reduce((a, c) => a + c.timeAllocation.basicAttackTime, 0)
    expect(basics1).toBeGreaterThan(10)
    // 账本全额不缩（合轴只改重叠记账）：Σnecessary 仍 > 战斗时间
    expect(rr1.characters.reduce((a, c) => a + c.timeAllocation.necessaryTime, 0))
      .toBeGreaterThan(aligned.totalTime)
  })

  it('回归守卫：不设合轴率（缺省全 0）时与旧口径逐位一致', async () => {
    const cfg = await capturedConfig(['1061', '1011', '1151'])
    const s = iterate(cfg.characters, zeroStates(cfg), cfg)
    for (const st of s) expect(st.comboAlignCredit ?? 0).toBe(0)
    // 旧口径公式：池 = max(0, 180 − Σ必要)，按权重分配
    const budget = cfg.totalTime - (cfg.invincibleTime ?? 0)
    const pool = Math.max(0, budget - sumNecessary(s))
    const totalWeight = cfg.characters.reduce((a, c) => a + c.timeWeight, 0)
    for (let i = 0; i < s.length; i++) {
      expect(s[i].basicAttackTime)
        .toBeCloseTo(Math.min(pool * (cfg.characters[i].timeWeight / totalWeight),
          Math.max(0, cfg.totalTime - s[i].necessaryTime)), 6)
    }
  })
})
