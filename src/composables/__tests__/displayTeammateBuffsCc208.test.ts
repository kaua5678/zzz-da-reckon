/**
 * CC-208：展示层（FinalPanel 生命构成 / DebugPage 队友 Buff 行）列「本槽生效的队友 buff」取引擎同一份输入
 * `resolveSlotPanelBuffInputs`，不再按勾选状态自己重筛。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'

describe('CC-208 展示层队友 buff 列表与引擎同源', () => {
  it('勾选 ≠ 生效：被钩子否决的条目 store 显示已勾，引擎输入里没有（旧展示口径会误列）', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1351', cinemaLevel: 6 }, { agentId: '1191' }, ''])
    config.toggleTeammateBuff('pulchra_extra_trap_followup', true)
    expect(config.isTeammateBuffEnabled('pulchra_extra_trap_followup')).toBe(true)
    const ids = resolveSlotPanelBuffInputs(1, config, catalog).teammateBuffs.map(b => b.id)
    expect(ids).not.toContain('pulchra_extra_trap_followup')
    expect(ids).toContain('pulchra_cinema_6_trap_all')
  })

  it('源码锁：两个展示点经 resolveSlotPanelBuffInputs 取列表，不再遍历 teammateBuffGroups 按勾选重筛', () => {
    // CC-209：FinalPanel 生命构成拆解迁至 composables/hpSourceBreakdown.ts，锁随迁；FinalPanel 本体也不得回到自筛
    for (const rel of ['composables/hpSourceBreakdown.ts', 'views/DebugPage.vue']) {
      const src = readFileSync(new URL('../../' + rel, import.meta.url), 'utf8')
      expect({ rel, usesEngine: /resolveSlotPanelBuffInputs\(/.test(src) }).toEqual({ rel, usesEngine: true })
      expect({ rel, reFilters: /teammateBuffGroups[\s\S]{0,200}isTeammateBuffEnabled\(/.test(src) }).toEqual({ rel, reFilters: false })
    }
  })

  it('源码锁：FinalPanel 本体不再遍历 teammateBuffGroups 自筛（CC-209 后经 hpSourceBreakdown 取）', () => {
    const src = readFileSync(new URL('../../components/FinalPanel.vue', import.meta.url), 'utf8')
    expect(/teammateBuffGroups/.test(src)).toBe(false)
    expect(/collectHpSources\(slot, configStore, catalogStore, props\.effectCoverages\)/.test(src)).toBe(true)
  })
})
