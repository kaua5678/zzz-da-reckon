import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mockStaticFetch, newPinia, setTeam } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'

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

describe('catalog loading readiness', () => {
  it.each([
    { name: 'catalog', action: 'load', status: 'catalogStatus', url: '/static/catalog.json' },
    { name: 'teammate buffs', action: 'loadTeammateBuffs', status: 'teammateBuffsStatus', url: '/static/teammate-buffs.json' },
    { name: 'recommendations', action: 'loadBuildRecommendations', status: 'buildRecsStatus', url: '/static/build-recommendations.json' },
  ] as const)('deduplicates concurrent $name loads and caches successful data', async ({ action, status, url }) => {
    const catalog = useCatalogStore()
    if (action !== 'load') await catalog.load()
    const fetchMock = vi.mocked(fetch)
    const staticFetch = fetchMock.getMockImplementation()!
    const request = deferred<Response>()
    const requested = deferred<void>()
    fetchMock.mockClear()
    fetchMock.mockImplementationOnce(() => {
      requested.resolve()
      return request.promise
    })

    const first = catalog[action]()
    const second = catalog[action]()
    await requested.promise
    const pendingRequests = fetchMock.mock.calls.length
    const pendingStatus = catalog[status]
    request.resolve(await staticFetch(url))
    const [a, b] = await Promise.all([first, second])

    expect(pendingRequests).toBe(1)
    expect(pendingStatus).toBe('loading')
    expect(a).toBe(b)
    expect(catalog[status]).toBe('ready')
    expect(await catalog[action]()).toBe(a)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'catalog', action: 'load', status: 'catalogStatus', error: 'error' },
    { name: 'teammate buffs', action: 'loadTeammateBuffs', status: 'teammateBuffsStatus', error: 'teammateBuffsError' },
    { name: 'recommendations', action: 'loadBuildRecommendations', status: 'buildRecsStatus', error: 'buildRecsError' },
  ] as const)('shares a synchronous $name fetch failure and releases it for retry', async ({ action, status, error }) => {
    const catalog = useCatalogStore()
    if (action !== 'load') await catalog.load()
    expect(catalog[status]).toBe('idle')
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockImplementationOnce(() => { throw new Error('offline') })

    const attempts = await Promise.allSettled([catalog[action](), catalog[action]()])
    for (const attempt of attempts) {
      if (action === 'load') expect(attempt.status).toBe('rejected')
      else expect(attempt).toEqual({ status: 'fulfilled', value: null })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(catalog[status]).toBe('error')
    expect(catalog[error]).toBe('offline')

    expect(await catalog[action]()).not.toBeNull()
    expect(catalog[status]).toBe('ready')
    expect(catalog[error]).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads catalog before merging spec buffs even when the calculation factory requests buffs first', async () => {
    const early = useCatalogStore()
    const earlyGroups = await early.loadTeammateBuffs()
    expect(early.ready).toBe(true)
    expect(early.teammateBuffsReady).toBe(true)

    newPinia()
    const ordered = useCatalogStore()
    await ordered.load()
    expect(earlyGroups).toEqual(await ordered.loadTeammateBuffs())
  })

  it('blocks complete calculation after failure until explicit retry, then equals a fresh successful load', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const agentId = catalog.displayAgents[0]!.id
    const config = useConfigStore()
    setTeam(config, [{ agentId }, '', ''])
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response)

    const calc = useResourceCalc()
    expect(calc.resourceConfig.value).toBeNull()
    expect(calc.resourceResult.value).toBeNull()
    expect(await catalog.loadTeammateBuffs()).toBeNull()
    expect(calc.resourceConfig.value).toBeNull()
    expect(calc.resourceResult.value).toBeNull()
    expect(calc.stunPoolResult.value).toBeNull()
    expect(calc.anomalyPoolResult.value).toBeNull()
    expect(calc.damagePoolRows.value).toEqual([])

    // A new reader must not hide the failure by silently starting another request.
    const secondReader = useResourceCalc()
    const statusAfterNewReader = catalog.teammateBuffsStatus
    expect(secondReader.resourceResult.value).toBeNull()
    await catalog.loadTeammateBuffs()
    await nextTick()
    expect(statusAfterNewReader).toBe('error')
    expect(calc.resourceResult.value).not.toBeNull()
    expect(calc.teamTotalDamage.value).toBeGreaterThan(0)
    const recovered = {
      groups: catalog.teammateBuffGroups,
      selections: JSON.parse(JSON.stringify(config.teammateBuffSelections)),
      result: calc.resourceResult.value,
      damage: calc.teamTotalDamage.value,
    }

    newPinia()
    const freshCatalog = useCatalogStore()
    await freshCatalog.load()
    await freshCatalog.loadTeammateBuffs()
    const freshConfig = useConfigStore()
    setTeam(freshConfig, [{ agentId }, '', ''])
    const freshCalc = useResourceCalc()
    await nextTick()
    expect(recovered).toEqual({
      groups: freshCatalog.teammateBuffGroups,
      selections: freshConfig.teammateBuffSelections,
      result: freshCalc.resourceResult.value,
      damage: freshCalc.teamTotalDamage.value,
    })
  })

  it('keeps failed teammate buffs not ready and retries the next request', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)

    expect(await catalog.loadTeammateBuffs()).toBeNull()
    expect(catalog.teammateBuffsReady).toBe(false)
    expect(catalog.teammateBuffsLoaded).toBe(false)
    expect(catalog.teammateBuffsStatus).toBe('error')
    expect(catalog.teammateBuffsError).toContain('503')
    expect(catalog.teammateBuffsLoading).toBe(false)

    const groups = await catalog.loadTeammateBuffs()
    expect(groups?.length).toBeGreaterThan(0)
    expect(catalog.teammateBuffsReady).toBe(true)
    expect(catalog.teammateBuffsLoaded).toBe(true)
    expect(catalog.teammateBuffsStatus).toBe('ready')
    expect(catalog.teammateBuffsError).toBeNull()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('teammate-buffs'))).toHaveLength(2)
  })
})
