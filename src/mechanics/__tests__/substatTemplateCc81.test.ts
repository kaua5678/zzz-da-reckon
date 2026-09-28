/**
 * CC-81：core/substatOptimizer.ts AGENT_TEMPLATES 角色特例 → 模块声明 substatTemplate。
 * CC-186（第 209 轮）：模板只剩 stats / critRateCap；原 8 个声明者里 6 个异常角色的 stats 与职业兜底
 * （anomaly → 精通+攻击）完全相同，声明已删，改由兜底给出——本文件钉「真实职业下结果不变」。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTemplate, type SubstatTemplate } from '@/core/substatOptimizer'
import { getRegisteredAgentMechanics } from '@/mechanics'
import type { Agent } from '@/types/catalog'

const DECLARED: Record<string, SubstatTemplate> = {
  '1451': { stats: ['hpPct', 'atkPct', 'defPct'] }, // 卢西娅：生命→全队攻击（局外）→ hpPct 优先
  '1621': { stats: ['defPct', 'atkPct', 'critRate'] }, // 洛克茜：防御→攻击/冲击力（局内）→ defPct 优先
}
/** CC-186 删掉声明的 6 个异常角色：真实职业 anomaly 下必须仍得到原声明的 stats */
const FORMER_ANOMALY_IDS = ['1261', '1581', '1171', '1561', '1401', '1221']
const SPECS = ['attack', 'anomaly', 'support', 'stun', 'defense', 'rupture', 'sharpen', undefined]
const mock = (id: string, specialty?: string) => ({ id, specialty }) as unknown as Agent

describe('CC-81 副词条模板 → 模块 substatTemplate', () => {
  it('声明者 = 卢西娅 / 洛克茜（与职业兜底不同的两个）', () => {
    const ids = getRegisteredAgentMechanics().filter(m => !!m.substatTemplate).flatMap(m => m.agentIds).sort()
    expect(ids).toEqual(Object.keys(DECLARED).sort())
  })

  it('全注册角色 × 各职业：声明者 == 声明，其余 == 职业兜底', () => {
    const ids = [...new Set(getRegisteredAgentMechanics().flatMap(m => m.agentIds)), '9999', '']
    let n = 0
    for (const id of ids) {
      for (const spec of SPECS) {
        const want = DECLARED[id] ?? getTemplate(mock('9999', spec))
        expect(getTemplate(mock(id, spec)), `${id}/${spec}`).toEqual(want)
        n++
      }
    }
    expect(n).toBeGreaterThan(300)
  })

  it('CC-186 删声明的 6 个异常角色：anomaly 职业下 stats 与原声明相同', () => {
    for (const id of FORMER_ANOMALY_IDS) {
      expect(getTemplate(mock(id, 'anomaly')).stats, id).toEqual(['anomalyProficiency', 'atkPct'])
    }
  })

  it('源码锁：substatOptimizer.ts 不再有按角色 id 为键的模板', () => {
    const src = readFileSync(resolve(__dirname, '../../core/substatOptimizer.ts'), 'utf-8')
    expect(src).not.toMatch(/'\d{4}':/)
    expect(src).toContain('?.substatTemplate')
  })
})
