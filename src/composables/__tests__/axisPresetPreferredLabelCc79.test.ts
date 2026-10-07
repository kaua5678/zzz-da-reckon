/**
 * CC-79：StunAxisPage 横幅「有琉/无琉」→ agentMechanicView#axisPresetPreferredLabel（声明者简称拼出）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import { axisPresetPreferredLabel } from '@/composables/agentMechanicView'
import { useCatalogStore } from '@/stores/catalog'
import { setupHarness } from '@/test/harness'

let restore: (() => void) | undefined
afterEach(() => { restore?.(); restore = undefined })

describe('CC-79 横幅有X/无X 文案', () => {
  it('现唯一声明者琉音 1481：catalog 全角色单人队 + 空队 == 原写死文案', async () => {
    await setupHarness(['', '', ''])
    const ids = [...new Set([...useCatalogStore().agentsMap.keys()])]
    expect(getRegisteredAgentMechanics().filter(m => m.axisPresetPreferred).flatMap(m => m.agentIds)).toEqual(['1481'])
    for (const id of ids) {
      const team = [{ agentId: id }, { agentId: '' }, null]
      expect(axisPresetPreferredLabel(team), id).toBe(id === '1481' ? '有琉' : '无琉')
    }
    expect(axisPresetPreferredLabel([])).toBe('无琉')
    expect(axisPresetPreferredLabel([{ agentId: '1481' }, { agentId: '1481' }])).toBe('有琉')
  })

  it('多声明者：在队的都列出（槽位序），都不在时列全部已注册声明者', () => {
    const m = getAgentMechanic('1141')! as AgentMechanicModule
    const o = { p: m.axisPresetPreferred, s: m.axisPresetPreferredShort }
    restore = () => { m.axisPresetPreferred = o.p; m.axisPresetPreferredShort = o.s }
    m.axisPresetPreferred = true
    m.axisPresetPreferredShort = '狼'
    expect(axisPresetPreferredLabel([{ agentId: '1141' }, { agentId: '1481' }])).toBe('有狼/琉')
    expect(axisPresetPreferredLabel([{ agentId: '1481' }])).toBe('有琉')
    expect(axisPresetPreferredLabel([{ agentId: '1211' }]).startsWith('无')).toBe(true)
    expect(axisPresetPreferredLabel([{ agentId: '1211' }]).split('/').length).toBe(2)
    m.axisPresetPreferredShort = undefined
    expect(axisPresetPreferredLabel([{ agentId: "1141" }])).toBe(`有${m.name ?? m.agentIds[0]}`)
  })

  it('源码锁：StunAxisPage 不再写死「有琉」「无琉」', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf-8')
    expect(src).not.toContain("'有琉'")
    expect(src).not.toContain("'无琉'")
    expect(src).toContain('axisPresetPreferredLabel(configStore.team)')
  })
})
