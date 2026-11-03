import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation, INTERACTION_OPTIMUM_STRATEGY_ID, TIME_WEIGHT_STRATEGIES } from '@/composables/timeWeightAllocation'
import { interactionFieldsAt } from '@/composables/interactionControls'
import { ACTION_COUNT_BOUNDS } from '@/stores/config'

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
