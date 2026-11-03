/** 全库验收探针：INTERACTION_LIBRARY=1 INTERACTION_SHARD=0..3 显式分片；无基线改写。 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { teamPresets } from '@/data/teamPresets'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { clearInteractions, interactionFieldsAt, tauntLeverSlots } from '@/composables/interactionControls'
import { applyTimeWeightAllocation, INTERACTION_OPTIMUM_STRATEGY_ID } from '@/composables/timeWeightAllocation'
import { ACTION_COUNT_BOUNDS } from '@/stores/config'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import type { BossPresetFile } from '@/types/bossPreset'
const enabled=process.env.INTERACTION_LIBRARY==='1'
const shard=Number(process.env.INTERACTION_SHARD ?? 0)
const shards=Number(process.env.INTERACTION_SHARDS ?? 4)
const bossFile=JSON.parse(readFileSync('public/static/boss-presets.json','utf8')) as BossPresetFile
const boss=bossFile.bosses.find(b=>b.name.includes('叶释渊'))!
describe.skipIf(!enabled)('统一交互最优全库单调性与边际见证',()=>{
 it('逐队伤害不降、截断不增、可行±1和净收益退格均无正收益',async()=>{
  const rows: unknown[]=[]; const errors: string[]=[]
  for(const [i,p] of teamPresets.entries()) {
   if(i%shards!==shard)continue
   const {catalog,config}=await setupHarness(['','',''],{productionBasicWeights:true})
   await catalog.loadBuildRecommendations(); const calc=useResourceCalc()
   applyTeamToStore(config,p); applyBossRoom(config,boss,boss.phases[0]!)
   config.setTimeWeightStrategy('static')
   const read=()=>({damage:calc.teamTotalDamage.value,stun:calc.stunPoolResult.value?.stunCount ?? 0,overflow:calc.resourceResult.value?.convergence.timeTruncatedSeconds ?? 0})
   const closed=read()
   const r=applyTimeWeightAllocation({calc,configStore:config},INTERACTION_OPTIMUM_STRATEGY_ID)
   const best=read();const bad:string[]=[]
   if(best.damage<closed.damage-1e-6)bad.push('damage decreased')
   if(best.overflow>closed.overflow+1e-6)bad.push('overflow increased')
   for(let slot=0;slot<3;slot++)for(const field of interactionFieldsAt(config,slot)) {
    const value=Number(config.team[slot]?.[field] ?? 0)
    for(const next of [value-1,value+1]) {
     if(next<ACTION_COUNT_BOUNDS[field].min||next>ACTION_COUNT_BOUNDS[field].max)continue
     config.setActionCount(slot,field,next);const trial=read()
     if(trial.overflow<=best.overflow+1e-6&&trial.damage>best.damage+1e-6)bad.push(slot+':'+field+'='+next+' gain '+(trial.damage-best.damage))
    }
    config.setActionCount(slot,field,value)
   }
   const cap=config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING,0.4)
   config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING,Math.max(0,cap-0.05))
   const low=read(); if(low.overflow<=best.overflow+1e-6&&low.damage>best.damage+1e-6)bad.push('absorb rollback improves '+(low.damage-best.damage))
   config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING,cap)
   for(const slot of tauntLeverSlots(config)) {
    const v=config.team[slot]!.tauntCancelCount ?? 0
    const actual=calc.resourceResult.value?.characters.find(c=>c.slot===slot)?.banyueRageCycle?.tauntCancelCount ?? v
    config.setActionCount(slot,'tauntCancelCount',Math.max(0,actual-1));const trial=read()
    if(trial.overflow<=best.overflow+1e-6&&trial.damage>best.damage+1e-6)bad.push('taunt rollback improves '+(trial.damage-best.damage))
    config.setActionCount(slot,'tauntCancelCount',v)
   }
   rows.push({id:p.id,closed,best,deltaPct:(best.damage/closed.damage-1)*100,counts:r.counts,elapsedMs:r.elapsedMs,evaluations:r.evaluations,bad})
   errors.push(...bad.map(b=>p.id+': '+b))
   console.log('LIBRARY',p.id,JSON.stringify(rows.at(-1)))
  }
  writeFileSync('.zc/perf/interaction-library-'+shard+'.json',JSON.stringify(rows,null,2))
  expect(rows.length).toBeGreaterThan(0)
  expect(errors).toEqual([])
 },3600000)
 it('原全零旋钮仍清零全部既有输入',async()=>{
  const {config}=await setupHarness([{agentId:'1471'},{agentId:'1481'},{agentId:'1451'}])
  const calc=useResourceCalc();clearDifficultyLevers({config,calc});clearInteractions({config,calc})
  // 契约 = 只清「字段存在」的项（未初始化字段保持 undefined，见 clearInteractions 头注释）
  const keys = ['parryCount','dodgeCounterCount','blockCount','dualCounterCount'] as const
  expect(config.team.every(c => keys.every(f => c[f] === undefined || c[f] === 0))).toBe(true)
 })
})
