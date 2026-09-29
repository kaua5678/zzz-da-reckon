/**
 * CC-242：角色模块 buildCharConfig 预存的倍率表行值吃逻辑编辑器行规则（作用面裁决 §24.85 ④）。
 *
 * 修前 norma / phoenix / severian / sigrid / xide 各自内联 `rows.find(...).values[0]` 取原始值：
 * 用户在编辑器里对这些行开规则，模块自有执行（弹幕影画6缩放、余火、凭风载体、钢能…）完全不响应
 * （第 264 轮探针：席德 attack_data_0 ×2 修前 0% / 修后 +9.07%）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { getAgentMechanic } from '@/mechanics'
import type { AgentSkills } from '@/types/catalog'

afterEach(() => setActiveRowFusionRules([]))

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf-8'))
const skillsOf = (agentId: string) => (catalog.agentSkills as AgentSkills[]).find(s => s.agentId === agentId)

function cfgOf(agentId: string): Record<string, any> {
  const cfg: Record<string, any> = { panel: {} }
  getAgentMechanic(agentId)!.buildCharConfig!({ skills: skillsOf(agentId), cinemaLevel: 0, cfg, panel: {}, team: [], slot: 0 } as never)
  return cfg
}
function rule(agentId: string, moveId: string, rowId: string) {
  return { id: `t_${moveId}_${rowId}`, name: 't', agentId, moveId, rowId, multiplier: 2, enabled: true, note: '' }
}

const CASES: Array<[string, string, string, string, (cfg: Record<string, any>) => number]> = [
  ['赛维里安 苍风影猎 damage', '1631', '1631006', 'damage', c => c.severianShadowMeta.damage],
  ['菲欧妮 余火 attack_data_0', '1641', '1641003', 'attack_data_0', c => c.phoenixCombustionMeta['1641003']],
  ['希格莉德 敛枪 decibel_recovery', '1591', '1591007', 'decibel_recovery', c => c.sigridLanceSegments[0].decibelRecovery],
  ['席德 钢能 attack_data_0', '1461', '1461001', 'attack_data_0', c => c.xideAttackDataMap['1461001']],
]

describe('CC-242 角色模块预存行值吃行规则', () => {
  for (const [name, agentId, moveId, rowId, pick] of CASES) {
    it(`${name}：规则 ×2 ⇒ 预存值 ×2`, () => {
      const base = pick(cfgOf(agentId))
      expect(base).toBeGreaterThan(0)
      setActiveRowFusionRules([rule(agentId, moveId, rowId)])
      expect(pick(cfgOf(agentId))).toBeCloseTo(base * 2, 9)
    })
  }

  it('诺姆 弹幕行值表：damage 规则 ×2 ⇒ normaBarrageRowValues.damage 逐段 ×2', () => {
    const base: number[] = cfgOf('1571').normaBarrageRowValues.damage
    expect(base.some(v => v > 0)).toBe(true)
    setActiveRowFusionRules(Array.from({ length: 40 }, (_, i) => rule('1571', '1571' + String(i + 1).padStart(3, '0'), 'damage')))
    const now: number[] = cfgOf('1571').normaBarrageRowValues.damage
    now.forEach((v, i) => expect(v).toBeCloseTo(base[i] * 2, 9))
  })

  /**
   * 登记表：mechanics/agents 允许的原始行读取。remielle 按技能等级选列（非首列），已裁决不做（§24.85）。
   * 第 323 轮（§24.147）：键由「文件:行号」改为「文件: 去首尾空白的代码行」——约束力不变（新增 / 改写读点照样红），
   * 但与读点无关的增删行不再逼着同步行号。
   */
  const RAW_ROW_READ_ALLOW = [
    'remielle.ts: if (idx >= 0) return values[idx] ?? values[0] ?? 0',
    'remielle.ts: return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0',
    'remielle.ts: return values[0] ?? 0',
  ]
  it('源码：mechanics/agents 非注释行的 values[0] 仅限登记表', () => {
    const dir = resolve(__dirname, '../agents')
    const hits: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      for (const l of readFileSync(join(dir, name), 'utf-8').split('\n')) {
        if (!/^\s*(\/\/|\*|\/\*)/.test(l) && /values\??\.?\[0\]/.test(l)) hits.push(`${name}: ${l.trim()}`)
      }
    }
    expect(hits).toEqual(RAW_ROW_READ_ALLOW)
  })
})
