/**
 * CC-53：impactVariables 三个函数与原 ImpactChart（789a27e :161–236）内联算法逐值一致。
 * CC-55：柏妮思判断改为模块声明（teamReleaseShares）；下面的 inline* 仍保留原写死 '1171' 的写法当对照基准。
 * CC-537：读写改收变量对象（动态变量自带声明 / 异放键与元素）；对照基准仍按 id 走原内联写法，变量表只比对展示字段（toMatchObject）。
 * CC-538：读写随变量对象（v.read / v.write）。对照基准里静态变量照原组件交给 core——现在就是表项自带的读写，等于自比；静态读写由 core 测试覆盖。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { IMPACT_VARIABLES, type ImpactVariable } from '@/core/impactVars'
import { teamMechanicSettings, teamReleaseShares } from '@/composables/agentMechanicView'
import type { MechanicSetting } from '@/types/resource'
import { buildImpactVariables } from '@/composables/impactVariables'

type H = Awaited<ReturnType<typeof setupHarness>>

// ── 照抄原组件（只把闭包变量换成参数）──
function inlineAllVars(h: H, settingMap: Map<string, MechanicSetting>, coverage: Record<string, number> | undefined) {
  const { config: configStore, catalog: catalogStore } = h
  const vars: Omit<ImpactVariable, 'read' | 'write'>[] = []
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
  return IMPACT_VARIABLES.find(v => v.id === id)!.read(configStore)
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
  IMPACT_VARIABLES.find(v => v.id === id)!.write(configStore, value)
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
    expect(vars).toMatchObject(inlineAllVars(h, settingMap, coverage))
    const ids = vars.map(v => v.id)
    expect(ids).toContain('setting.burnice.releaseShare:fire')
    expect(ids).toContain('setting.burnice.releaseShare:electric')
    expect(ids).not.toContain('setting.burnice.releaseShare:ice')
    const pctSetting = vars.find(v => v.id.startsWith('setting.') && !v.id.includes('releaseShare') && v.suffix === '%')
    expect(pctSetting, '至少一个 % 机制设置变量').toBeTruthy()

    h.config.setMechanicSetting('burnice.releaseShare:electric', 0.3) // 一个已存、一个走自动值
    for (const v of vars) expect(v.read(h.config), v.id).toBe(inlineRead(h, settingMap, coverage, v.id))
    const byId = (id: string) => vars.find(v => v.id === id)!
    expect(byId('setting.burnice.releaseShare:electric').read(h.config)).toBeCloseTo(30)
    expect(byId('setting.burnice.releaseShare:fire').read(h.config)).toBeCloseTo(60)

    for (const v of vars) {
      const target = v.defaultRange[0] + (v.defaultRange[1] - v.defaultRange[0]) * 0.37
      inlineWrite(h, settingMap, v.id, target)
      const a = snap(h)
      v.write(h.config, v.defaultRange[0] + (v.defaultRange[1] - v.defaultRange[0]) * 0.11)
      v.write(h.config, target)
      expect(snap(h), v.id).toEqual(a)
    }
    pctSetting!.write(h.config, 50)
    expect(h.config.getMechanicSetting(pctSetting!.id.slice('setting.'.length), -1)).toBeCloseTo(0.5)
  }, 60000)

  it('队伍无柏妮思 ⇒ 不出占比变量', async () => {
    const h = await setupHarness([{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }])
    const settingMap = mapOf(h)
    const shares = teamReleaseShares(h.config.team, id => h.catalog.getAgent(id))
    expect(shares).toEqual([])
    const vars = buildImpactVariables(settingMap, shares, { fire: 1 })
    expect(vars.some(v => v.id.includes('releaseShare'))).toBe(false)
    expect(vars).toMatchObject(inlineAllVars(h, settingMap, { fire: 1 }))
  }, 60000)
})
