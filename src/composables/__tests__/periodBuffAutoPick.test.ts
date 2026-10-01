/**
 * CC-352：实战部署页「当期牌自动选择」在独立场景上试牌，UI store 只写最终结果。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { applyPeriodBuff, pickBestPeriodBuff } from '@/composables/runArchiveDeploy'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import type { BossPresetFile, PhaseBuffCard, PhaseView } from '@/types/bossPreset'

const bp = JSON.parse(readFileSync(new URL('../../../public/static/boss-presets.json', import.meta.url), 'utf8')) as BossPresetFile
const views = (bp.phaseViews ?? []) as PhaseView[]
const usable = (b: PhaseBuffCard) => !b.testOnly && (b.effects ?? []).some(e => e.stat)

describe('CC-352 pickBestPeriodBuff', () => {
  it('结果 = 「不用」+ 各可用牌里伤害最高者；UI 现场一行不动', async () => {
    const view = views.find(v => (v.buffs ?? []).filter(usable).length >= 2)
    expect(view, '数据里应有 ≥2 张可用当期牌的期').toBeTruthy()
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }], { recommendedBuild: true })
    config.globalBuffs.push({ id: 'user:x', name: '用户手填', stat: 'atkPct', value: 5, enabled: true } as never)
    const before = JSON.stringify(config.globalBuffs)
    const best = await withAnalysisScenario(s => pickBestPeriodBuff(s, view!.phaseId, view!.buffs ?? []))
    expect(JSON.stringify(config.globalBuffs)).toBe(before)
    // 逐张独立求值作对照（各开一个场景，互不影响）
    const damageOf = (card: PhaseBuffCard | null) => withAnalysisScenario(s => {
      applyPeriodBuff(s.config, view!.phaseId, card)
      return s.calc.teamTotalDamage.value ?? 0
    })
    const all = [null, ...(view!.buffs ?? []).filter(usable)]
    const dmgs = await Promise.all(all.map(damageOf))
    expect(new Set(dmgs).size, '各牌伤害应有差异（否则本例空过）').toBeGreaterThan(1)
    const max = Math.max(...dmgs)
    expect(await damageOf(best)).toBe(max)
  }, 120000)

  it('没有可用牌 → null（不试）', async () => {
    const { config } = await setupHarness([{ agentId: '1091' }, { agentId: '1511' }, { agentId: '1411' }])
    const r = await withAnalysisScenario(s => pickBestPeriodBuff(s, 'p', [{ title: 't', testOnly: true, effects: [{ stat: 'atkPct', value: 1 }], unparsed: [] } as PhaseBuffCard]), config)
    expect(r).toBeNull()
  }, 60000)

  it('源码锁：RunArchivePage 不再在 UI store 上逐张试牌', () => {
    const page = readFileSync(new URL('../../views/RunArchivePage.vue', import.meta.url), 'utf8')
    expect(page).toMatch(/withAnalysisScenario\(s => pickBestPeriodBuff\(/)
    expect(page).not.toMatch(/setTimeout\(r, 40\)/)
    expect((page.match(/applyPeriodBuff\(/g) ?? []).length).toBe(1) // 只剩 pickPeriodBuff 里写最终结果那一处
  })
})
