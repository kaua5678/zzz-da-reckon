/**
 * Catalog 数据加载与 Pinia Store
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Catalog, Agent, WEngine, DriveDiscSet, AgentSkills, StatRules, Boss, TeammateBuff, TeammateBuffGroup, BuildRecommendations, CharacterBuildRecommendation } from '@/types/catalog'
import { getAgentSpecsByAgentId } from '@/specs/registry'
import type { TeamBuffSpec } from '@/specs/types'

export const useCatalogStore = defineStore('catalog', () => {
  const catalog = ref<Catalog | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 队友 Buff 数据
  const teammateBuffGroups = ref<TeammateBuffGroup[]>([])
  const teammateBuffsLoading = ref(false)
  const teammateBuffsLoaded = ref(false)
  // in-flight 去重：useResourceCalc 每次实例化都会 fire 一次加载（不 await），
  // 并发 fetch 曾一次跑出 3 个请求；存 promise 让并发调用共享同一次加载
  let teammateBuffsPromise: Promise<TeammateBuffGroup[] | null> | null = null

  /**
   * spec teamBuffs（人工录入）→ 采集文件同构条目。
   * 教训修复：录入侧双轨（spec vs teammate-buffs.json），消费端只读采集文件 → spec 录的增益成了死数据。
   * 现在加载时合并：spec 条目按 id 去重并优先（人工确认覆盖原始采集），组不存在则新建。
   */
  function specTeamBuffToTeammateBuff(agentId: string, agent: Agent | null, tb: TeamBuffSpec): TeammateBuff {
    const nameZh = tb.name || `${agent?.name?.zhCN ?? agentId}｜${tb.source}`
    return {
      id: tb.id,
      source: { zhCN: tb.source },
      description: { zhCN: tb.description },
      scope: 'inCombat',
      effects: tb.effects.map((e, i) => ({
        id: e.id ?? `${tb.id}_effect_${i}`,
        type: e.type ?? 'fixed',
        target: { kind: 'default' as const },
        stat: e.stat as TeammateBuff['effects'][number]['stat'],
        mode: e.mode ?? 'flat',
        value: e.value ?? 0,
        coverage: { default: tb.coverage ?? 1, min: 0, max: 1, step: 0.1 },
        // 公式/转模字段：spec teamBuffs 人工录入时必须透传，否则加油/虎啸等公式增益变死数据
        ...(e.sourceStat ? { sourceStat: e.sourceStat as any } : {}),
        ...(e.sourcePanelPhase ? { sourcePanelPhase: e.sourcePanelPhase } : {}),
        ...(e.formula ? { formula: e.formula } : {}),
        ...(e.ratio != null ? { ratio: e.ratio } : {}),
        ...(e.cap != null ? { cap: e.cap } : {}),
        ...(e.targetSkillType ? { targetSkillType: e.targetSkillType as any } : {}),
      })) as TeammateBuff['effects'],
      buffModifiers: [],
      sourceType: 'teammate',
      sourceCategory: 'agent',
      sourceKind: 'teammate',
      sourceLabel: { zhCN: tb.source },
      ownerId: agentId,
      ownerName: { zhCN: agent?.name?.zhCN ?? agentId },
      teammateId: agentId,
      teammateName: { zhCN: agent?.name?.zhCN ?? agentId },
      conditionLabel: { zhCN: tb.description },
      name: { zhCN: nameZh },
      // SOP §6.4：hidden 条只作 UI 展示，collectInCombatTeamBuffs 按 buff.hidden 过滤
      ...(tb.hidden ? { hidden: true } : {}),
    }
  }

  function mergeSpecTeamBuffs(data: TeammateBuffGroup[]): TeammateBuffGroup[] {
    const out: TeammateBuffGroup[] = data.map(g => ({ ...g, buffs: [...g.buffs] }))
    const byId = new Map(out.map(g => [g.id, g]))
    for (const [agentId, spec] of getAgentSpecsByAgentId()) {
      const tbs = spec.teamBuffs ?? []
      if (tbs.length === 0) continue
      const agent = getAgent(agentId) ?? null
      let group = byId.get(agentId)
      if (!group) {
        group = {
          id: agentId,
          name: agent?.name ?? { zhCN: agentId },
          attribute: agent?.damageElement ?? '',
          specialty: agent?.specialty ?? 'attack',
          buffs: [],
        }
        byId.set(agentId, group)
        out.push(group)
      }
      for (const tb of tbs) {
        const converted = specTeamBuffToTeammateBuff(agentId, agent, tb)
        const idx = group.buffs.findIndex(b => b.id === tb.id)
        if (idx >= 0) group.buffs[idx] = converted // spec 优先（人工确认覆盖原始采集）
        else group.buffs.push(converted)
      }
    }
    return out
  }

  // 配装推荐数据（nanoka.cc 邦布精灵推荐）
  const buildRecommendations = ref<BuildRecommendations | null>(null)
  const buildRecsLoading = ref(false)
  const buildRecsLoaded = ref(false)

  // 索引 Map
  const agentsMap = computed(() => {
    const m = new Map<string, Agent>()
    catalog.value?.agents.forEach(a => m.set(a.id, a))
    return m
  })

  const wEnginesMap = computed(() => {
    const m = new Map<string, WEngine>()
    catalog.value?.wEngines.forEach(w => m.set(w.id, w))
    // 旧 id 兼容：音擎 id 已统一为数字（legacyIds 保留旧格式，如 zzz_wiki_XXXX / nanoka_XXXX / 英文 slug），
    // 浏览器 localStorage 里的旧配置仍存旧 id，getWEngine 按 legacyIds 兜底。
    catalog.value?.wEngines.forEach(w => (w.legacyIds ?? []).forEach(old => m.set(old, w)))
    return m
  })

  const driveDiscSetsMap = computed(() => {
    const m = new Map<string, DriveDiscSet>()
    catalog.value?.driveDiscSets.forEach(d => m.set(d.id, d))
    // 旧 id 兼容：驱动盘套装 id 已统一为数字（legacyIds 保留旧 zzz_wiki_XXXX），兼容旧 localStorage 配置
    catalog.value?.driveDiscSets.forEach(d => (d.legacyIds ?? []).forEach(old => m.set(old, d)))
    return m
  })

  const agentSkillsMap = computed(() => {
    const m = new Map<string, AgentSkills>()
    catalog.value?.agentSkills.forEach(s => m.set(s.id, s))
    return m
  })

  const agentSkillsByAgentMap = computed(() => {
    const m = new Map<string, AgentSkills>()
    catalog.value?.agentSkills.forEach(s => m.set(s.agentId, s))
    return m
  })

  // 显示列表（过滤 hidden）
  const displayAgents = computed(() =>
    catalog.value?.agents.filter(a => !a.hidden) ?? []
  )
  const displayWEngines = computed(() =>
    catalog.value?.wEngines ?? []
  )
  const displayDriveDiscSets = computed(() =>
    catalog.value?.driveDiscSets ?? []
  )

  const statRules = computed<StatRules | null>(() =>
    catalog.value?.statRules ?? null
  )

  const bosses = computed<Boss[]>(() =>
    catalog.value?.bosses ?? []
  )

  const ready = computed(() => catalog.value !== null)

  async function load() {
    if (catalog.value) return catalog.value
    loading.value = true
    error.value = null
    try {
      const res = await fetch('/static/catalog.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as Catalog
      catalog.value = data
      return data
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to load catalog'
      throw e
    } finally {
      loading.value = false
    }
  }

  /** 就绪门：teammate-buffs 已加载（失败也置位，见 loadTeammateBuffs 的 finally） */
  const teammateBuffsReady = computed(() => teammateBuffsLoaded.value)

  // 加载队友 Buff 数据
  async function loadTeammateBuffs() {
    if (teammateBuffsLoaded.value) return teammateBuffGroups.value
    if (teammateBuffsPromise) return teammateBuffsPromise
    teammateBuffsLoading.value = true
    teammateBuffsPromise = (async () => {
      try {
        const res = await fetch('/static/teammate-buffs.json', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as TeammateBuffGroup[]
        teammateBuffGroups.value = mergeSpecTeamBuffs(data) // 合并 spec 人工录入的 teamBuffs（去重，spec 优先）
        return teammateBuffGroups.value
      } catch (e: any) {
        console.warn('Failed to load teammate buffs:', e?.message)
        teammateBuffGroups.value = []
        return null
      } finally {
        // 无论成败都标记「已就绪」：就绪门（useResourceCalc 的 resourceConfig）依赖此标志，
        // 失败不置位会让整条计算管线在 fetch 失败时永久返回 null
        teammateBuffsLoaded.value = true
        teammateBuffsLoading.value = false
        teammateBuffsPromise = null
      }
    })()
    return teammateBuffsPromise
  }

  // 根据角色 ID 获取队友 Buff 组
  function getTeammateBuffGroup(agentId: string): TeammateBuffGroup | undefined {
    return teammateBuffGroups.value.find(g => g.id === agentId)
  }

  // 加载配装推荐数据
  async function loadBuildRecommendations() {
    if (buildRecsLoaded.value) return buildRecommendations.value
    buildRecsLoading.value = true
    try {
      const res = await fetch('/static/build-recommendations.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as BuildRecommendations
      buildRecommendations.value = data
      buildRecsLoaded.value = true
      return data
    } catch (e: any) {
      console.warn('Failed to load build recommendations:', e?.message)
      return null
    } finally {
      buildRecsLoading.value = false
    }
  }

  // 根据角色 ID 获取配装推荐
  function getBuildRecommendation(agentId: string): CharacterBuildRecommendation | undefined {
    return buildRecommendations.value?.characters[agentId]
  }

  function getAgent(id: string): Agent | undefined {
    return agentsMap.value.get(id)
  }

  function getWEngine(id: string): WEngine | undefined {
    return wEnginesMap.value.get(id)
  }

  function getDriveDiscSet(id: string): DriveDiscSet | undefined {
    return driveDiscSetsMap.value.get(id)
  }

  function getAgentSkills(agentId: string): AgentSkills | undefined {
    return agentSkillsByAgentMap.value.get(agentId)
  }

  return {
    catalog,
    loading,
    error,
    agentsMap,
    wEnginesMap,
    driveDiscSetsMap,
    agentSkillsMap,
    agentSkillsByAgentMap,
    displayAgents,
    displayWEngines,
    displayDriveDiscSets,
    statRules,
    bosses,
    ready,
    teammateBuffGroups,
    teammateBuffsLoading,
    teammateBuffsLoaded,
    /** 就绪门：数据已加载（含失败置空）——resourceConfig 等待此标志，杜绝半载状态下的静默错值 */
    teammateBuffsReady,
    buildRecommendations,
    buildRecsLoading,
    buildRecsLoaded,
    load,
    loadTeammateBuffs,
    loadBuildRecommendations,
    getAgent,
    getWEngine,
    getDriveDiscSet,
    getAgentSkills,
    getTeammateBuffGroup,
    getBuildRecommendation,
  }
})
