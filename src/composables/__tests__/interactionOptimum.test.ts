import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation, INTERACTION_OPTIMUM_STRATEGY_ID, TIME_WEIGHT_STRATEGIES } from '@/composables/timeWeightAllocation'
import { interactionFieldsAt } from '@/composables/interactionControls'
import { ACTION_COUNT_BOUNDS } from '@/stores/config'
import { capabilityGateMissesOf } from '@/composables/capabilityGateNotice'

describe('统一交互边际策略', () => {
 it('注册于既有策略表，真实队伍伤害不降且逐槽±1无可行正收益', async () => {
  const { config }=await setupHarness([{agentId:'1611'},{agentId:'1141'},{agentId:'1211'}],{recommendedBuild:true,productionBasicWeights:true})
  const calc=useResourceCalc()
  expect(TIME_WEIGHT_STRATEGIES.some(s=>s.id===INTERACTION_OPTIMUM_STRATEGY_ID)).toBe(true)
  const before=calc.teamTotalDamage.value
  const overflow=calc.resourceResult.value!.convergence.timeTruncatedSeconds ?? 0
  const r=applyTimeWeightAllocation({calc,configStore:config},INTERACTION_OPTIMUM_STRATEGY_ID)
  expect(r.damage).toBe(calc.teamTotalDamage.value)
  expect(r.damage).toBeGreaterThanOrEqual(before-1e-6)
  expect(r.overflowSeconds).toBeLessThanOrEqual(overflow+1e-6)
  expect(r.costDetail).toContain('×')
  expect(r.converged).toBe(true)
  console.log('OPTIMUM',JSON.stringify(r))
  for(let slot=0;slot<3;slot++)for(const field of interactionFieldsAt(config,slot)) {
   const value=Number(config.team[slot]?.[field] ?? 0)
   for(const next of [value-1,value+1]) {
    if(next<ACTION_COUNT_BOUNDS[field].min||next>ACTION_COUNT_BOUNDS[field].max)continue
    config.setActionCount(slot,field,next)
    const damage=calc.teamTotalDamage.value
    const trunc=calc.resourceResult.value!.convergence.timeTruncatedSeconds ?? 0
    if(trunc<=r.overflowSeconds!+1e-6)expect(damage,slot+':'+field+'='+next).toBeLessThanOrEqual(r.damage+1e-6)
   }
   config.setActionCount(slot,field,value)
  }
 },900000)
 it('两种手动锁均为零写入，保留可截断输入', async () => {
  const {config}=await setupHarness([{agentId:'1471',parryCount:40,dualCounterCount:40},{agentId:'1481'},{agentId:'1451'}])
  const calc=useResourceCalc()
  for(const lock of ['interaction','stun']) {
   config.interactionsLocked=lock==='interaction'
   config.setEnemy({stunCountLock:lock==='stun'?3:-1})
   const before=JSON.stringify(config.$state)
   const r=applyTimeWeightAllocation({calc,configStore:config},INTERACTION_OPTIMUM_STRATEGY_ID)
   expect(JSON.stringify(config.$state)).toBe(before)
   expect(r.applied).toBe(false)
   expect(r.note).toContain('锁定')
  }
 },900000)
})
/**
 * ★ 需求 2（用户 2026-11-04 逐字）：「**自动交互的情况下我希望这个能被检测出来**」。
 *
 * ## 实测背景（交接 §二 C/D）
 *
 * 夹具 `auto-1611-1141-1211` 全 0 交互起步（55.50M）→ 自动交互交付 **84.10M**，
 * 交付的交互是「槽0 弹刀1 + 闪反81，槽1（莱卡恩）弹刀 0，槽2 0」⇒ 围猎 0 次、冰舞 0 次，
 * 而旧实现的 note 里**一字未提**。
 *
 * ⇒ 本用例锁两件事：
 * 1. 交付的 note / `gateMisses` 里必须出现「围猎未启用」（报告）；
 * 2. 策略**不许**为了解门而改交互——交付点仍是「逐槽±1 无可行正收益」的驻点
 *    （实测该状态下给莱卡恩补弹刀是 **−8.1M**：84.05M → 75.93M）。
 */
describe('自动交互报告「机制入场券」未满足', () => {
  /**
   * ## ⚠ 2026-11-05 口径变化（本用例随 Boss 出手预算一起改）
   *
   * 旧断言是「交付态必须报出围猎未启用」——那是**修前**的事实：自动交互会搜到
   * 「槽0 闪反 81 + 莱卡恩弹刀 0」（81 次闪反 = 63.4s 动作塞进 84s 非失衡），
   * 而未受约束的搜索空间里给莱卡恩补弹刀是 −8.1M ⇒ 门自然解不开。
   *
   * 现在搜索空间被 `core/bossAttackBudget` 收窄到物理可能（闪反上限 = floor(非失衡/2s)），
   * 同一夹具的驻点**自然落在「莱卡恩弹刀 1」**上（`huntCount > 0` ⇒ 围猎真的产出冰舞行），
   * 总伤 84.10M → **86.89M**且门已满足。这不是「为解门改交互」——策略里没有任何门相关的分支，
   * 是搜索在合法空间里找到的更优点。
   *
   * ⇒ 本用例改锁**新不变量**：note 不许把「已满足的门」谎报成未满足。
   * 「门未满足时必须报出来」那条仍由 `lycaonGateAndMirrorBudget.test.ts` 的
   * 「弹刀 0 ⇒ 门未满足」与下面的反空洞用例锁住（构造态，可独立触发）。
   */
  it('★ 旗舰夹具：交付更高伤害，且 note 与 gateMisses 不谎报（已满足的门不报）', async () => {
    const { config } = await setupHarness([{ agentId: '1611' }, { agentId: '1141' }, { agentId: '1211' }],
      { recommendedBuild: true, productionBasicWeights: true })
    const calc = useResourceCalc()
    const before = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, INTERACTION_OPTIMUM_STRATEGY_ID)
    expect(r.applied).toBe(true)
    expect(r.damage).toBeGreaterThan(before)
    // ① 报告口径：**已满足的门一条都不许报**（谎报未启用同样是不透明，只是方向相反）
    const gateMisses = r.gateMisses ?? []
    const lycaonMiss = gateMisses.find(m => m.agentId === '1141')
    expect(lycaonMiss, '围猎已启用（弹刀 > 0 且产出了冰舞行）⇒ 不许报未启用').toBeUndefined()
    // 与结果行同源：门满足 ⇔ 冰舞行存在（capabilityGates.activeOf 的判据）
    const ly = calc.resourceResult.value!.characters.find(c => c.agentId === '1141')!
    const gateSatisfied = ly.executions.some(e => e.moveId === '1141027')
    expect(gateSatisfied, '前置：交付态真的产出了围猎行').toBe(true)
    expect(gateMisses).toHaveLength(0)
    expect(r.note).not.toContain('围猎未启用')
    // ② 只报告、不改交互：策略里没有任何「为解门而动交互」的分支 ⇒ 交付的仍是伤害驻点
    //    （莱卡恩弹刀 = 1 是搜索在合法空间里自己选的，不是被门驱动的）
    expect(Number(config.team[1]!.parryCount)).toBe(1)
    // ③ 既有判据（伤害不降 / 截断不增）逐位保留
    expect(r.damage).toBe(calc.teamTotalDamage.value)
    expect(r.overflowSeconds).toBeLessThanOrEqual(1e-6)
    console.log('GATE', JSON.stringify({ damage: +(r.damage / 1e6).toFixed(3), note: r.note, misses: gateMisses }))
  }, 900000)

  it('反空洞：围猎已经产出冰舞行的队不报（判据是结果行，不是字段值）', async () => {
    // 直接看引擎结果：给莱卡恩弹刀 3 ⇒ `huntCount = min(失衡, 弹刀) > 0` ⇒ `patchExecutions` 真的产冰舞行
    // ⇒ 同一个纯函数必须**不**报。⚠ 不跑整轮 allocate（那是 60s 级搜索，本判据只需要一次求值）。
    const { config } = await setupHarness([
      { agentId: '1611', parryCount: 1, dodgeCounterCount: 20 },
      { agentId: '1141', parryCount: 3, dodgeCounterCount: 0 },
      { agentId: '1211', parryCount: 0, dodgeCounterCount: 0 },
    ], { recommendedBuild: true, productionBasicWeights: true })
    const calc = useResourceCalc()
    const rr = calc.resourceResult.value!
    const ly = rr.characters.find(c => c.agentId === '1141')!
    expect(ly.executions.some(e => e.moveId === '1141027'), '前置：弹刀 3 ⇒ 围猎应产出冰舞行').toBe(true)
    const misses = capabilityGateMissesOf(rr, (slot, field) => Number(config.team[slot]?.[field] ?? 0))
    expect(misses.some(m => m.agentId === '1141'), '围猎已产出冰舞 ⇒ 不该报未启用').toBe(false)
  }, 900000)
})

