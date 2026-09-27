/**
 * CC-75：giftedPolarAssaultCount 多提供方口径 = 求和（census §5.82）；派发收进 resourceCalc/giftedPolarAssault.ts。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import type { CharacterResourceResult } from '@/types/resource'
import { giftedPolarAssaultOf, sumGiftedPolarAssault } from '@/composables/resourceCalc/giftedPolarAssault'

const ch = (agentId: string, extra: Record<string, unknown> = {}) => ({ agentId, ...extra }) as unknown as CharacterResourceResult
type Hook = AgentMechanicModule['giftedPolarAssaultCount']
let patched: { m: AgentMechanicModule; orig: Hook } | undefined
afterEach(() => { if (patched) patched.m.giftedPolarAssaultCount = patched.orig; patched = undefined })

describe('CC-75 giftedPolarAssaultCount 求和口径', () => {
  it('现唯一声明者 = 爱丽丝 1401（CC-78 起不再要求同时声明 anomalyPoolSetup）', () => {
    const owners = getRegisteredAgentMechanics().filter(m => !!m.giftedPolarAssaultCount)
    expect(owners.flatMap(m => m.agentIds)).toEqual(['1401'])
  })

  it('单角色 == 原表达式；空槽 / 无能力 ⇒ 0', () => {
    const alice = ch('1401', { aliceSwordWillSource: { sparkCount: 3 } })
    expect(giftedPolarAssaultOf(alice)).toBe(getAgentMechanic('1401')!.giftedPolarAssaultCount!(alice))
    expect(giftedPolarAssaultOf(alice)).toBe(3)
    expect(giftedPolarAssaultOf(ch('1401'))).toBe(0)
    expect(giftedPolarAssaultOf(ch('1141'))).toBe(0)
    expect(giftedPolarAssaultOf(ch(''))).toBe(0)
  })

  it('多提供方求和：给第二个模块临时挂能力，结果 = 两者相加（不是取首个）', () => {
    const m = getAgentMechanic('1141')!
    patched = { m, orig: m.giftedPolarAssaultCount }
    m.giftedPolarAssaultCount = () => 2
    const team = [ch('1401', { aliceSwordWillSource: { sparkCount: 3 } }), ch('1141'), ch('')]
    expect(sumGiftedPolarAssault(team)).toBe(5)
    expect(sumGiftedPolarAssault([])).toBe(0)
  })

  it('源码锁：convergence / outerCycle 只经本 helper 派发', () => {
    for (const f of ['convergence.ts', 'outerCycle.ts']) {
      const src = readFileSync(resolve(__dirname, '../resourceCalc', f), 'utf-8')
      expect(src).not.toContain('?.giftedPolarAssaultCount?.(')
      expect(src).toMatch(/giftedPolarAssaultOf|sumGiftedPolarAssault/)
    }
  })
})
