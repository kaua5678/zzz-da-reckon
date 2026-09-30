/**
 * Catalog 数据加载与 Pinia Store
 */
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import type { Catalog, Agent, WEngine, DriveDiscSet, AgentSkills, StatRules, Boss, TeammateBuff, TeammateBuffGroup, BuildRecommendations, CharacterBuildRecommendation } from '@/types/catalog'
import { getAgentSpecsByAgentId } from '@/specs/registry'
import type { TeamBuffSpec } from '@/specs/types'

export type CatalogLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export const useCatalogStore = defineStore('catalog', () => {
  /**
   * 目录数据用 **shallowRef**（2026-09-23 mcp-engine，用户批准高风险引擎优化）：目录是加载后只读的静态数据
   * （1.48MB JSON），只会**整体替换**（load / 测试 harness），全库无原地改写（已 grep 核：生产代码与 .vue 均无）。
   * 深响应式 `ref` 让引擎每次读倍率表/技能行都走 Proxy get + 依赖追踪——实测难度爬梯里 Vue `get/track/find`
   * 自耗时 >10s/40s。浅层后读取是裸对象，整体替换照常触发下游重算。
   * ⚠ 若将来需要原地改目录（热更新单个角色等），必须整体替换 `catalog.value = { ...catalog.value, ... }`，
   * 或调用 `triggerRef(catalog)`；原地改不会触发任何重算。
   */
  const catalog = shallowRef<Catalog | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const catalogStatus = computed<CatalogLoadStatus>(() =>
    loading.value ? 'loading' : error.value ? 'error' : catalog.value ? 'ready' : 'idle',
  )
  let catalogPromise: Promise<Catalog> | null = null

  // 队友 Buff 数据
  /** 浅层（同 catalog）：只在加载时整体赋值 */
  const teammateBuffGroups = shallowRef<TeammateBuffGroup[]>([])
  const teammateBuffsStatus = ref<CatalogLoadStatus>('idle')
  const teammateBuffsError = ref<string | null>(null)
  const teammateBuffsLoading = computed(() => teammateBuffsStatus.value === 'loading')
  const teammateBuffsLoaded = computed(() => teammateBuffsStatus.value === 'ready')
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
      // SOP §6.4：`singleSourced`（原 `hidden`，R65 改名）条不进 collectInCombatTeamBuffs
      // —— 数值由模块/helpers 单通道接入，防双计（**不是** UI 隐藏，见 src/utils/teammateBuffRows.ts）
      ...(tb.singleSourced ? { singleSourced: true } : {}),
    }
  }

  function mergeSpecTeamBuffs(data: TeammateBuffGroup[]): TeammateBuffGroup[] {
    // CC-275：拥有者身份归一到组 id（= 拥有者 agentId，CC-199 口径）。采集数据里 1171/1261/1411/1511/1581 的
    // ownerId / teammateId 是拼音 slug（burnice_white / jane_doe / youye / nangongyu / remielle），而来源面板
    // （teammateBuffSource.addSourcePanelAliases）只按 agent.id / teammateBuffId（均为数字）登记 ⇒ core/buff 的
    // cloneEffectWithSourceValue 按 ownerId 查不到来源面板，这些 derived / formula 效果（柚叶 攻击力 40% 转模、
    // 额外能力 异常掌控公式；简 核心被动 精通公式；蕾米埃尔 攻击力转模）拿不到 x：derived 回落 defaultSourceValue
    // （柚叶 3000 ⇒ 恒顶 1200），formula 回落接收者自己的面板。在加载处归一，所有按 ownerId
    // 查拥有者的消费者（来源面板、CC-130 接收槽过滤、HP 来源标签）一次修好。
    const out: TeammateBuffGroup[] = data.map(g => ({
      ...g,
      buffs: g.buffs.map(b => (b.ownerId === g.id && b.teammateId === g.id ? b : { ...b, ownerId: g.id, teammateId: g.id })),
    }))
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
  /** 浅层（同 catalog）：只在加载时整体赋值 */
  const buildRecommendations = shallowRef<BuildRecommendations | null>(null)
  const buildRecsStatus = ref<CatalogLoadStatus>('idle')
  const buildRecsError = ref<string | null>(null)
  const buildRecsLoading = computed(() => buildRecsStatus.value === 'loading')
  const buildRecsLoaded = computed(() => buildRecsStatus.value === 'ready')
  let buildRecsPromise: Promise<BuildRecommendations | null> | null = null

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
    if (catalogPromise) return catalogPromise
    loading.value = true
    error.value = null
    catalogPromise = Promise.resolve().then(async () => {
      try {
        // 默认缓存：服务端（vite preview 发 no-cache + ETag）走 304 重验证，避免每次整包重下 1.48MB。
        // 改动后 ETag/mtime 变化自然失效，无需 no-store 强刷。
        const res = await fetch('/static/catalog.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as Catalog
        catalog.value = data
        return data
      } catch (e: unknown) {
        error.value = e instanceof Error ? e.message : 'Failed to load catalog'
        throw e
      } finally {
        loading.value = false
        catalogPromise = null
      }
    })
    return catalogPromise
  }

  /** 就绪门只认完整数据成功；失败保持未就绪，显式重试成功后再放行计算。 */
  const teammateBuffsReady = computed(() => teammateBuffsLoaded.value)

  // @fact ui:loading/队友Buff完整数据 口径: 队友Buff仅在采集数据加载且spec合并成功后ready；失败阻断完整计算并允许重试，不以空数据降级 | 据 用户任务@2026-09-28·复核@2026-09-30 | 验 src/stores/__tests__/catalogReadiness.test.ts | 锚 src/stores/catalog.ts#loadTeammateBuffs | 信 确认
  // ⟳复核: 加载依赖或降级策略变化时复核错误门与重试回归 | 到期 2026-12-31
  async function loadTeammateBuffs() {
    if (teammateBuffsLoaded.value) return teammateBuffGroups.value
    if (teammateBuffsPromise) return teammateBuffsPromise
    teammateBuffsStatus.value = 'loading'
    teammateBuffsError.value = null
    // 下一微任务才开始请求，确保同步抛错也不会把已失败的 promise 永久留在去重槽里。
    teammateBuffsPromise = Promise.resolve().then(async () => {
      try {
        // useResourceCalc 可能先于页面 onMounted 请求 Buff；spec 合并需要目录里的角色元信息。
        await load()
        const res = await fetch('/static/teammate-buffs.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as TeammateBuffGroup[]
        teammateBuffGroups.value = mergeSpecTeamBuffs(data) // 合并 spec 人工录入的 teamBuffs（去重，spec 优先）
        teammateBuffsStatus.value = 'ready'
        return teammateBuffGroups.value
      } catch (e: unknown) {
        teammateBuffsError.value = e instanceof Error ? e.message : 'Failed to load teammate buffs'
        teammateBuffsStatus.value = 'error'
        console.warn('Failed to load teammate buffs:', teammateBuffsError.value)
        return null
      } finally {
        teammateBuffsPromise = null
      }
    })
    return teammateBuffsPromise
  }

  // 根据角色 ID 获取队友 Buff 组
  function getTeammateBuffGroup(agentId: string): TeammateBuffGroup | undefined {
    return teammateBuffGroups.value.find(g => g.id === agentId)
  }

  // 推荐加载原本即允许失败重试；这里补齐显式错误态与并发去重，不改变失败返回 null 的契约。
  async function loadBuildRecommendations() {
    if (buildRecsLoaded.value) return buildRecommendations.value
    if (buildRecsPromise) return buildRecsPromise
    buildRecsStatus.value = 'loading'
    buildRecsError.value = null
    buildRecsPromise = Promise.resolve().then(async () => {
      try {
        const res = await fetch('/static/build-recommendations.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as BuildRecommendations
        buildRecommendations.value = data
        buildRecsStatus.value = 'ready'
        return data
      } catch (e: unknown) {
        buildRecsError.value = e instanceof Error ? e.message : 'Failed to load build recommendations'
        buildRecsStatus.value = 'error'
        console.warn('Failed to load build recommendations:', buildRecsError.value)
        return null
      } finally {
        buildRecsPromise = null
      }
    })
    return buildRecsPromise
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
    catalogStatus,
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
    teammateBuffsStatus,
    teammateBuffsError,
    teammateBuffsLoading,
    teammateBuffsLoaded,
    /** 完整数据成功门：失败不放行 resourceConfig。 */
    teammateBuffsReady,
    buildRecommendations,
    buildRecsStatus,
    buildRecsError,
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
