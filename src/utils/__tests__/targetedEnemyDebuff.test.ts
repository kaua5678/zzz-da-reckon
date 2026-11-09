/**
 * 招式限定的**敌方减益**必须显示（2026-10-18 审计的第 4 类定向字段缺口）。
 *
 * 引擎侧一直是对的——带 `target` 的减防/减抗写进 `<stat>__<招式族>`，`core/damage.ts` 按当前招式读回：
 *   · 14146 机巧心种（席德专武）：普攻/终结「无视目标防御 20%」→ `enemyDefReduction__basic/__ultimate`
 *   · 14132 心弦夜响（伊芙琳专武）：连携/终结「无视 12.5% 火抗」→ `enemyFireResReduction__chain/__ultimate`
 * 修前**页面上一条都看不到**（StatPanel 敌方减益节与 FinalPanel 减益行都只列基础字段）。
 *
 * 本测试钉：① 这两把音擎确实产出定向键且只对对应招式生效；② 两处展示点都渲染定向减益行。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { computePanel } from '@/composables/resourceCalc/panelPhases'
import { getTargetedElementStat, getTargetedStatExtra } from '@/core/buff'
import { targetedPanelRows } from '@/utils/targetedPanelRows'

const statPanel = readFileSync(new URL('../../components/StatPanel.vue', import.meta.url), 'utf8')
const finalPanel = readFileSync(new URL('../../components/FinalPanel.vue', import.meta.url), 'utf8')

describe('招式限定的敌方减益', () => {
  it('14132 心弦夜响：连携/终结无视火抗 25，其余招式 0', async () => {
    const { catalog } = await setupHarness([{ agentId: '1321' }, '', ''])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    cfg.team[0]!.wEngineId = '14132'
    cfg.team[0]!.wEngineModLevel = 1
    const p = computePanel(0, cfg, catalog) as unknown as Record<string, number>
    expect(p.enemyFireResReduction__chain, '连携限定火抗无视').toBe(25)
    expect(p.enemyFireResReduction__ultimate, '终结限定火抗无视').toBe(25)
    expect(getTargetedElementStat(p as never, 'enemyRes', 'fire', 'chain'), '按连携读得到').toBe(25)
    expect(getTargetedElementStat(p as never, 'enemyRes', 'fire', 'basic'), '普攻不应吃到').toBe(0)
    // 展示层能枚举到
    const rows = targetedPanelRows(p as never, ['enemyFireResReduction'])
    expect(rows.map(r => r.key).sort()).toEqual(['enemyFireResReduction__chain', 'enemyFireResReduction__ultimate'])
    expect(rows[0]!.label).toContain('连携技限定')
  }, 120000)

  it('14146 机巧心种：普攻/终结无视防御 20，强特 0', async () => {
    const { catalog } = await setupHarness([{ agentId: '1461' }, '', ''])
    const cfg = useConfigStore()
    await catalog.loadBuildRecommendations()
    cfg.team[0]!.wEngineId = '14146'
    cfg.team[0]!.wEngineModLevel = 1
    const p = computePanel(0, cfg, catalog) as unknown as Record<string, number>
    // 防御三通道（2026-11-09）：14146「普攻/终结无视防御」= 自身**直伤**无视防御（定向键随之改名）
    expect(p.enemyDefIgnoreDirect__basic).toBe(20)
    expect(p.enemyDefIgnoreDirect__ultimate).toBe(20)
    expect(getTargetedStatExtra(p as never, 'enemyDefIgnoreDirect', 'basic'), '按普攻读得到').toBe(20)
    expect(getTargetedStatExtra(p as never, 'enemyDefIgnoreDirect', 'exSpecial'), '强特不应吃到').toBe(0)
    const rows = targetedPanelRows(p as never, ['enemyDefIgnoreDirect'])
    expect(rows.map(r => r.key).sort()).toEqual(['enemyDefIgnoreDirect__basic', 'enemyDefIgnoreDirect__ultimate'])
  }, 120000)

  it('源码锁：两处展示点都渲染了定向敌方减益行', () => {
    expect(statPanel, 'StatPanel 缺定向减益行').toContain('targetedEnemyDebuffRows')
    expect(finalPanel, 'FinalPanel 缺定向减益行').toContain('targetedDebuffRows')
  })
})
