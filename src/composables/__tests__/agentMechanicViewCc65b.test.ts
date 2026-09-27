/**
 * CC-65b：交互次数默认值 / 通用基准排除 / 交互栏格挡·双反输入框 / 保底4嗔火开关 → 模块声明。
 * 对照 = 原 stores/config.ts 写死表（1531、1471）与名单（1051）、原 TeamConfigPage 写死 1471/1531。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentInteractionInputs, teamHasGuaranteeFuryOwner } from '@/composables/agentMechanicView'
import { getInteractionDefaults, interactionBaselineFor, roleInteractionBaseline } from '@/stores/config'

const ZERO = { parry: 0, dodge: 0, block: 0, dual: 0 }
const LEGACY_DEFAULTS: Record<string, typeof ZERO> = {
  '1531': { parry: 4, dodge: 0, block: 5, dual: 0 },
  '1471': { parry: 6, dodge: 10, block: 20, dual: 5 },
}
const LEGACY_NO_GENERIC = new Set(['1051'])
function legacyBaseline(id: string, spec?: string) {
  if (LEGACY_NO_GENERIC.has(id)) return ZERO
  const d = LEGACY_DEFAULTS[id] ?? ZERO
  return d.parry > 0 || d.dodge > 0 || d.block > 0 || d.dual > 0 ? d : roleInteractionBaseline(spec)
}
function legacyInputs(id: string) {
  const out: { block?: { label: string }; dualCounter?: { label: string } } = {}
  if (['1471', '1531'].includes(id)) out.block = { label: id === '1531' ? '格挡（动力压制）' : '金身格挡' }
  if (id === '1471') out.dualCounter = { label: '双反' }
  return out
}

describe('CC-65b 交互默认值与交互栏特殊输入 → 模块声明', () => {
  it('全 catalog 角色：getInteractionDefaults / interactionBaselineFor / 输入框 / 嗔火开关 == 原写死', async () => {
    const { catalog } = await setupHarness([{ agentId: '1471' }, '', ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    expect(ids.length).toBeGreaterThan(30)
    const specs = [undefined, 'attack', 'stun', 'anomaly', 'support', 'defense', 'rupture']
    let hitDef = 0, hitInp = 0, hitFury = 0
    for (const id of ids) {
      const d = getInteractionDefaults(id)
      expect(d, id).toEqual(LEGACY_DEFAULTS[id] ?? ZERO)
      if (LEGACY_DEFAULTS[id]) hitDef++
      for (const sp of [...specs, catalog.getAgent(id)?.specialty]) {
        expect(interactionBaselineFor(id, sp), `${id}/${sp}`).toEqual(legacyBaseline(id, sp))
      }
      const inp = JSON.parse(JSON.stringify(agentInteractionInputs(id)))
      expect(inp, id).toEqual(legacyInputs(id))
      hitInp += Object.keys(inp).length
      for (const pos of [0, 2]) {
        const team = [{ agentId: '' }, { agentId: '' }, { agentId: '' }]
        team[pos] = { agentId: id }
        const got = teamHasGuaranteeFuryOwner(team)
        expect(got, `${id}@${pos}`).toBe(team.some(c => c?.agentId === '1471'))
        if (got) hitFury++
      }
    }
    expect([hitDef, hitInp, hitFury]).toEqual([2, 3, 2])
    expect(agentInteractionInputs(null)).toEqual({})
    expect(teamHasGuaranteeFuryOwner([null, undefined, { agentId: null }])).toBe(false)
  }, 60000)

  it('getInteractionDefaults 返回副本（改返回值不污染模块声明）', () => {
    const a = getInteractionDefaults('1471')
    a.parry = 999
    expect(getInteractionDefaults('1471').parry).toBe(6)
  })

  it('源码锁：TeamConfigPage.vue 与 stores/config.ts 不再写死角色 id', () => {
    const page = readFileSync(resolve(__dirname, '../../views/TeamConfigPage.vue'), 'utf-8')
    expect(page.match(/'1\d\d1'/g)).toBeNull()
    expect(page).not.toContain('teamHasBanyue')
    const cfg = readFileSync(resolve(__dirname, '../../stores/config.ts'), 'utf-8')
    for (const id of ['1531', '1471', '1051']) expect(cfg).not.toContain(`'${id}'`)
  })
})
