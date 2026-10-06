import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

describe('calculator default initialization', () => {
  it('requires all startup dependencies and initializes an untouched team only once', async () => {
    const catalog = useCatalogStore()
    const config = useConfigStore()
    const untouched = snapshot(config.team)
    expect(config.initDefaultTeam()).toBe(false)
    await catalog.load()
    await catalog.loadTeammateBuffs()
    expect(config.initDefaultTeam()).toBe(false)
    expect(config.team).toEqual(untouched)

    await catalog.loadBuildRecommendations()
    expect(config.initDefaultTeam()).toBe(true)
    expect(config.team.map(c => c.agentId)).toEqual(catalog.displayAgents.slice(0, 3).map(a => a.id))
    config.setWEngine(0, 'user-wengine-sentinel')
    const edited = snapshot(config.team)
    expect(config.initDefaultTeam()).toBe(false)
    expect(config.team).toEqual(edited)

    for (let slot = 0; slot < 3; slot++) config.setAgent(slot, '')
    const cleared = snapshot(config.team)
    expect(config.initDefaultTeam()).toBe(false)
    expect(config.team).toEqual(cleared)
  })

  it('remembers edits even if the user restores the empty startup team', async () => {
    const catalog = useCatalogStore()
    const config = useConfigStore()
    const untouched = snapshot(config.team)
    config.team[0]!.driveDisc.subStatAllocation = { critRate: 7 }
    config.team = snapshot(untouched)
    await catalog.load()
    await catalog.loadTeammateBuffs()
    await catalog.loadBuildRecommendations()

    expect(config.initDefaultTeam()).toBe(false)
    expect(config.team).toEqual(untouched)
  })

  it('retains the preset readiness guard without partially changing the team', async () => {
    const catalog = useCatalogStore()
    const config = useConfigStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const before = snapshot(config.team)
    const ids = catalog.displayAgents.slice(0, 3).map(a => a.id) as [string, string, string]
    expect(() => config.applyTeamPreset(ids)).toThrow(/配装推荐数据未加载/)
    expect(config.team).toEqual(before)
    await catalog.loadBuildRecommendations()
    expect(() => config.applyTeamPreset(ids)).not.toThrow()
    expect(config.team.map(c => c.agentId)).toEqual(ids)
  })

  it('preserves edits made while recommendations are pending', async () => {
    const catalog = useCatalogStore()
    const config = useConfigStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const fetchMock = vi.mocked(fetch)
    const staticFetch = fetchMock.getMockImplementation()!
    const response = deferred<Response>()
    fetchMock.mockImplementationOnce(() => response.promise)
    const loading = catalog.loadBuildRecommendations()

    config.setAgent(1, catalog.displayAgents.at(-1)!.id)
    config.setWEngine(1, 'user-wengine-sentinel')
    config.setCinemaLevel(1, 4)
    config.team[1]!.driveDisc.subStatAllocation = { critRate: 7 }
    const editedTeam = snapshot(config.team)
    expect(catalog.buildRecsLoaded).toBe(false)

    response.resolve(await staticFetch('/static/build-recommendations.json'))
    await loading
    config.initDefaultTeam()
    expect(config.team).toEqual(editedTeam)
  })
})

describe('calculator startup flow', () => {
  it('建立启动入口即激活行融合规则——不依赖用户打开过逻辑编辑器页（r697）', async () => {
    const { activeRowFusionRulesSnapshot, setActiveRowFusionRules } = await import('@/logicEditor/fusion')
    const { createDefaultLogicEditorState } = await import('@/logicEditor/defaults')
    const { useCalculatorStartup } = await import('@/composables/calculatorStartup')
    const enabled = createDefaultLogicEditorState().rowFusions.filter(r => r.enabled).map(r => `${r.moveId}/${r.rowId}×${r.multiplier}`)
    expect(enabled.length).toBeGreaterThan(0)
    setActiveRowFusionRules([])
    useCalculatorStartup()
    expect(activeRowFusionRulesSnapshot().map(r => `${r.moveId}/${r.rowId}×${r.multiplier}`)).toEqual(enabled)
  })

  it('deduplicates simultaneous starts and preserves edits and empty teams across remounts', async () => {
    const { useCalculatorStartup } = await import('@/composables/calculatorStartup')
    const config = useConfigStore()
    const firstMount = useCalculatorStartup()
    const overlappingMount = useCalculatorStartup()
    expect(await Promise.all([firstMount.start(), firstMount.start(), overlappingMount.start()])).toEqual([true, true, true])
    expect(firstMount.status.value).toBe('ready')
    expect(overlappingMount.status.value).toBe('ready')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)

    config.setWEngine(0, 'user-wengine-sentinel')
    config.team[0]!.driveDisc.subStatAllocation = { critRate: 7 }
    const editedTeam = snapshot(config.team)
    expect(await firstMount.start()).toBe(true)
    expect(await useCalculatorStartup().start()).toBe(true)
    expect(config.team).toEqual(editedTeam)

    for (let slot = 0; slot < 3; slot++) config.setAgent(slot, '')
    const clearedTeam = snapshot(config.team)
    expect(await useCalculatorStartup().start()).toBe(true)
    expect(config.team).toEqual(clearedTeam)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3)
  })

  it.each([
    { url: '/static/teammate-buffs.json', label: '队友 Buff' },
    { url: '/static/build-recommendations.json', label: '配装推荐' },
  ])('exposes $label failure, retries, and never reapplies defaults over intervening edits', async ({ url, label }) => {
    const { useCalculatorStartup } = await import('@/composables/calculatorStartup')
    const catalog = useCatalogStore()
    const config = useConfigStore()
    const fetchMock = vi.mocked(fetch)
    const staticFetch = fetchMock.getMockImplementation()!
    let failNext = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === url && failNext) {
        failNext = false
        return Promise.resolve({ ok: false, status: 503 } as Response)
      }
      return staticFetch(input, init)
    })

    const startup = useCalculatorStartup()
    expect(await startup.start()).toBe(false)
    expect(startup.status.value).toBe('error')
    expect(startup.error.value).toContain(label)
    expect(startup.error.value).toContain('503')
    expect(config.team.every(c => !c.agentId)).toBe(true)
    config.setAgent(1, catalog.displayAgents.at(-1)!.id)
    config.setWEngine(1, 'user-wengine-sentinel')
    config.team[1]!.driveDisc.subStatAllocation = { critRate: 7 }
    const editedTeam = snapshot(config.team)

    expect(await startup.start()).toBe(true)
    expect(startup.status.value).toBe('ready')
    expect(startup.error.value).toBeNull()
    expect(config.team).toEqual(editedTeam)
    expect(await useCalculatorStartup().start()).toBe(true)
    expect(config.team).toEqual(editedTeam)
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === url)).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('retries a catalog failure and initializes a still untouched team after success', async () => {
    const { useCalculatorStartup } = await import('@/composables/calculatorStartup')
    const config = useConfigStore()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    const startup = useCalculatorStartup()
    expect(await startup.start()).toBe(false)
    expect(startup.error.value).toContain('目录')
    expect(startup.status.value).toBe('error')
    expect(config.team.every(c => !c.agentId)).toBe(true)

    expect(await startup.start()).toBe(true)
    expect(startup.error.value).toBeNull()
    expect(startup.status.value).toBe('ready')
    expect(config.team.every(c => !!c.agentId)).toBe(true)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4)
  })

  it('keeps startup locked while recommendations are deferred and preserves an edited team on completion', async () => {
    const { useCalculatorStartup } = await import('@/composables/calculatorStartup')
    const catalog = useCatalogStore()
    const config = useConfigStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const fetchMock = vi.mocked(fetch)
    const staticFetch = fetchMock.getMockImplementation()!
    const requested = deferred<void>()
    const response = deferred<Response>()
    fetchMock.mockImplementationOnce(() => {
      requested.resolve()
      return response.promise
    })

    const startup = useCalculatorStartup()
    expect(startup.status.value).toBe('idle')
    const pending = startup.start()
    await requested.promise
    expect(startup.status.value).toBe('loading')
    expect(config.team.every(c => !c.agentId)).toBe(true)
    config.setAgent(0, catalog.displayAgents.at(-1)!.id)
    config.setWEngine(0, 'user-wengine-sentinel')
    config.team[0]!.driveDisc.subStatAllocation = { critRate: 7 }
    const editedTeam = snapshot(config.team)

    response.resolve(await staticFetch('/static/build-recommendations.json'))
    expect(await pending).toBe(true)
    expect(startup.status.value).toBe('ready')
    expect(startup.error.value).toBeNull()
    expect(config.team).toEqual(editedTeam)
  })
})
