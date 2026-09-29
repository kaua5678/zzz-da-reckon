/**
 * CC-53：impactVariables 三个函数与原 ImpactChart（789a27e :161–236）内联算法逐值一致。
 * CC-55：柏妮思判断改为模块声明（teamReleaseShares）；下面的 inline* 仍保留原写死 '1171' 的写法当对照基准。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { IMPACT_VARIABLES, readImpactVar, writeImpactVar } from '@/core/impactVars'
import { teamMechanicSettings, teamReleaseShares } from '@/composables/agentMechanicView'
import type { MechanicSetting } from '@/types/resource'
import { buildImpactVariables, readImpactVariable, writeImpactVariable } from '@/composables/impactVariables'

type H = Awaited<ReturnType<typeof setupHarness>>

// ── 照抄原组件（只把闭包变量换成参数）──
function inlineAllVars(h: H, settingMap: Map<string, MechanicSetting>, coverage: Record<string, number> | undefined) {
  const { config: configStore, catalog: catalogStore } = h
  const vars: typeof IMPACT_VARIABLES = []
  for (const [id, setting] of settingMap) {
    const range = setting.suffix === '%'
      ? [(setting.min ?? 0) * 100, (setting.max ?? 100) * 100]
      : [setting.min ?? 0, setting.max ?? 100]
    vars.push({ id: `setting.${id}`, label: setting.label, defaultRange: range as [number, number], suffix: setting.suffix })
  }
  const burniceSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.id === '1171'
  })
  if (burniceSlot >= 0) {
    const elementLabels: Record<string, string> = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风', lumiflux: '辉光' }
    for (const [element, rate] of Object.entries(coverage ?? {})) {
      if (rate <= 0) continue
      vars.push({ id: `setting.burnice.releaseShare:${element}`, label: `柏妮思异放·${elementLabels[element] ?? element}占比`, defaultRange: [0, 100], suffix: '%' })
    }
  }
  return [...IMPACT_VARIABLES, ...vars]
}
function parseDynamicVar(id: string) {
  const m = id.match(/^setting\.(.+)$/)
  return m ? { kind: 'setting' as const, settingId: m[1] } : null
}
function inlineRead(h: H, settingMap: Map<string, MechanicSetting>, coverage: Record<string, number> | undefined, id: string): number {
  const configStore = h.config
  const dyn = parseDynamicVar(id)
  if (dyn?.kind === 'setting' && dyn.settingId) {
    if (dyn.settingId.startsWith('burnice.releaseShare:')) {
      const element = dyn.settingId.slice('burnice.releaseShare:'.length)
      const stored = configStore.mechanicSettings[dyn.settingId]
      const auto = (coverage?.[element] ?? 0) * 100
      return stored !== undefined ? stored * 100 : auto
    }
    const meta = settingMap.get(dyn.settingId)
    const raw = configStore.getMechanicSetting(dyn.settingId, meta?.default ?? 1)
    return meta?.suffix === '%' ? raw * 100 : raw
  }
  return readImpactVar(configStore, id)
}
function inlineWrite(h: H, settingMap: Map<string, MechanicSetting>, id: string, value: number): void {
  const configStore = h.config
  const dyn = parseDynamicVar(id)
  if (dyn?.kind === 'setting' && dyn.settingId) {
    if (dyn.settingId.startsWith('burnice.releaseShare:')) { configStore.setMechanicSetting(dyn.settingId, value / 100); return }
    const meta = settingMap.get(dyn.settingId)
    configStore.setMechanicSetting(dyn.settingId, meta?.suffix === '%' ? value / 100 : value)
    return
  }
  writeImpactVar(configStore, id, value)
}

const mapOf = (h: H) => {
  const m = new Map<string, MechanicSetting>()
  for (const s of teamMechanicSettings(h.config.team)) m.set(s.id, s)
  return m
}
const snap = (h: H) => JSON.parse(JSON.stringify({ ms: h.config.mechanicSettings, enemy: h.config.enemy, tw: h.config.team.map(c => c.basicAttackTimeWeight) }))

describe('impactVariables（CC-53）', () => {
  it('变量表 / 读 / 写 与原组件逐值一致（含柏妮思占比、% 机制设置）', async () => {
    const h = await setupHarness([{ agentId: '1171' }, { agentId: '1311' }, { agentId: '1211' }], { recommendedBuild: true })
    const settingMap = mapOf(h)
    const coverage = { fire: 0.6, ice: 0, electric: 0.4 }
    const shares = teamReleaseShares(h.config.team, id => h.catalog.getAgent(id))
    expect(shares).toEqual([{ namespace: 'burnice', label: '柏妮思异放' }])  // CC-55：模块声明替代写死 1171

    const vars = buildImpactVariables(settingMap, shares, coverage)
    expect(vars).toEqual(inlineAllVars(h, settingMap, coverage))
    const ids = vars.map(v => v.id)
    expect(ids).toContain('setting.burnice.releaseShare:fire')
    expect(ids).toContain('setting.burnice.releaseShare:electric')
    expect(ids).not.toContain('setting.burnice.releaseShare:ice')
    const pctSetting = vars.find(v => v.id.startsWith('setting.') && !v.id.includes('releaseShare') && v.suffix === '%')
    expect(pctSetting, '至少一个 % 机制设置变量').toBeTruthy()

    h.config.setMechanicSetting('burnice.releaseShare:electric', 0.3) // 一个已存、一个走自动值
    for (const id of ids) expect(readImpactVariable(id, h.config, settingMap, coverage), id).toBe(inlineRead(h, settingMap, coverage, id))
    expect(readImpactVariable('setting.burnice.releaseShare:electric', h.config, settingMap, coverage)).toBeCloseTo(30)
    expect(readImpactVariable('setting.burnice.releaseShare:fire', h.config, settingMap, coverage)).toBeCloseTo(60)

    for (const v of vars) {
      const target = v.defaultRange[0] + (v.defaultRange[1] - v.defaultRange[0]) * 0.37
      inlineWrite(h, settingMap, v.id, target)
      const a = snap(h)
      writeImpactVariable(v.id, v.defaultRange[0] + (v.defaultRange[1] - v.defaultRange[0]) * 0.11, h.config, settingMap)
      writeImpactVariable(v.id, target, h.config, settingMap)
      expect(snap(h), v.id).toEqual(a)
    }
    writeImpactVariable(pctSetting!.id, 50, h.config, settingMap)
    expect(h.config.getMechanicSetting(pctSetting!.id.slice('setting.'.length), -1)).toBeCloseTo(0.5)
  }, 60000)

  it('队伍无柏妮思 ⇒ 不出占比变量；覆盖率缺省也不崩', async () => {
    const h = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }])
    const settingMap = mapOf(h)
    const shares = teamReleaseShares(h.config.team, id => h.catalog.getAgent(id))
    expect(shares).toEqual([])
    const vars = buildImpactVariables(settingMap, shares, { fire: 1 })
    expect(vars.some(v => v.id.includes('releaseShare'))).toBe(false)
    expect(vars).toEqual(inlineAllVars(h, settingMap, { fire: 1 }))
    expect(readImpactVariable('setting.burnice.releaseShare:fire', h.config, settingMap, undefined)).toBe(0)
  }, 60000)
})
