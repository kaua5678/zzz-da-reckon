/**
 * 音擎下拉的「职业优先」排序（用户 2026-10-26：「这下拉菜单点进去太多了，能不能把同职业的放在前面，
 * 因为同职业才能触发武器效果」）。
 *
 * 判据重点（都是会**静默给出错数**的形状）：
 * ① 同职业判定以 `effect.requirement.specialty` 为准（引擎就是这么卡的），无 requirement 才回落 `w.specialty`；
 * ② 跨职业件必须排到第二组，并且**不能消失**（用户可能就想比较"少一条被动差多少"）；
 * ③ 角色专属表里的件排在同职业最前（那是实战真穿过的），但**不重排**组内其余件的相对顺序；
 * ④ 顺序是纯显示层——同一批 id 排完，集合不变（不增不删）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WEngine, Specialty } from '@/types/catalog'
import { engineTierOf, groupEnginesForAgent, partitionEngineIds, type EngineOption } from '@/composables/enginePicker'

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf8')) as {
  wEngines: WEngine[]
}
const ALL = catalog.wEngines
const byId = (id: string) => ALL.find(w => w.id === id)

/** 分组结果的扁平 id 列表（排掉「自动」这种空 value 项） */
function idsOf(opts: EngineOption[]): string[] {
  const out: string[] = []
  for (const o of opts) {
    if ('type' in o && o.type === 'group') {
      const kids: unknown = o.children
      if (!Array.isArray(kids)) continue
      for (const c of kids) {
        if (c && typeof c === 'object' && 'value' in c && String(c.value) !== '') out.push(String(c.value))
      }
    } else if ('value' in o && String(o.value) !== '') {
      out.push(String(o.value))
    }
  }
  return out
}

describe('enginePicker（音擎下拉职业优先）', () => {
  it('★ 同职业判定以 effect.requirement.specialty 为准，不是音擎自身的 specialty', () => {
    // 14161「猩红渴望」是克拉蕾专武：requirement 写 attack？还是自身 specialty？逐件核对
    const w = byId('13020')! // 炎炙沸釜：A 级击破，无 requirement
    expect(w.effect?.requirement).toBeUndefined()
    // 无 requirement ⇒ 回落自身 specialty（数据契约：通用件两者一致）
    expect(engineTierOf(w, 'stun' as Specialty, undefined).matches).toBe(true)
    expect(engineTierOf(w, 'attack' as Specialty, undefined).matches).toBe(false)
    // 有 requirement 的件：以 requirement 为准
    const sig = ALL.find(x => x.effect?.requirement?.specialty)!
    const req = sig.effect!.requirement!.specialty
    expect(engineTierOf(sig, req, undefined).matches).toBe(true)
  })

  it('★ 分组：同职业在前、跨职业在后，且**一件都不丢**', () => {
    const opts = groupEnginesForAgent(ALL, 'stun' as Specialty, '1481')
    const ids = idsOf(opts)
    expect(ids.length, '排序是纯显示层，不许增删').toBe(ALL.length)
    expect(new Set(ids).size).toBe(ALL.length)
    const firstGroup = opts[0] as { type: 'group'; label: string; children: Array<{ value: string }> }
    expect(firstGroup.type).toBe('group')
    expect(firstGroup.label).toContain('同职业')
    // 第一组全部同职业，第二组全部跨职业
    for (const id of firstGroup.children.map(c => c.value)) {
      expect(engineTierOf(byId(id)!, 'stun' as Specialty, '1481').matches, id).toBe(true)
    }
    const second = opts[1] as { type: 'group'; children: Array<{ value: string }> }
    for (const id of second.children.map(c => c.value)) {
      expect(engineTierOf(byId(id)!, 'stun' as Specialty, '1481').matches, id).toBe(false)
    }
  })

  it('★ 角色专属表里的件排在同职业最前（实战真穿过的），组内其余保持原顺序', () => {
    // 琉音 1481 的角色表 = ['13005', '14110']（人为刀俎×10 / 燃狱齿轮×2）
    const opts = groupEnginesForAgent(ALL, 'stun' as Specialty, '1481')
    const ownGroup = (opts[0] as { children: Array<{ value: string }> }).children.map(c => c.value)
    expect(ownGroup.slice(0, 2)).toEqual(['13005', '14110'])
    // 其余同职业件：相对顺序 = catalog 顺序（不重排）
    const rest = ownGroup.slice(2)
    const catalogOrder = ALL.filter(w => rest.includes(w.id)).map(w => w.id)
    expect(rest).toEqual(catalogOrder)
  })

  it('没有职业信息时不瞎分组：全部落进「跨职业」组（仍可选中，不静默空表）', () => {
    const opts = groupEnginesForAgent(ALL, undefined, undefined)
    expect(idsOf(opts).length).toBe(ALL.length)
    const groups = opts.filter(o => 'type' in o && o.type === 'group') as Array<{ label: string }>
    expect(groups).toHaveLength(1)
    expect(groups[0]!.label).toContain('其它职业')
  })

  it('partitionEngineIds：保持表的原顺序（频次/白值排序），只把跨职业挑到后面', () => {
    // 职业表里混进一把跨职业件时，它必须去 other，且 own 内相对顺序不变
    const ids = ['13005', '14110', '13004', '14118']
    const { own, other } = partitionEngineIds(ids, byId, 'stun' as Specialty, '1481')
    expect(own.map(w => w.id)).toEqual(['13005', '14110'])
    expect(other.map(w => w.id)).toEqual(['13004', '14118'])
  })
})
