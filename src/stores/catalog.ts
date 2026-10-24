/**
 * Catalog 数据加载与 Pinia Store
 */
import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import type { Catalog, Agent, WEngine, DriveDiscSet, AgentSkills, StatRules, Boss, TeammateBuffGroup, BuildRecommendations, CharacterBuildRecommendation, BetaAgentsFile } from '@/types/catalog'
import type { BossPresetFile } from '@/types/bossPreset'
import type { ChangelogFile } from '@/types/changelog'
import type { RunArchiveFile } from '@/composables/runArchiveImport'
import { getAgentSpecsByAgentId } from '@/specs/registry'
import { specTeamBuffToTeammateBuff } from '@/specs/teamBuffConvert'

import { localized } from '@/utils/format'
import { withBase } from '@/utils/staticUrl'
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

  // spec teamBuffs → TeammateBuff 的转换在 `@/specs/teamBuffConvert`（CC-399：与 promia 展示值共用同一转换器）

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
      // beta 冻结 spec 的 teamBuffs 只在开关打开时并入——关闭时 getAgent 查不到 beta 角色，
      // 组名会退化成裸 id 泄进队友 Buff 列表。
      if (spec.beta && !betaEnabled.value) continue
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

  // Boss 预设（boss-presets.json：bosses + phaseViews）。arena-D 第 366 轮：原 9 处页面 / 组件各自 fetch 一份，
  // 切页面就重下 360 KB、各自写错误处理；收成唯一加载入口（同目录：浅层、整体赋值、并发去重、失败可重试）。
  // ⚠ 各页面拿到的是**同一份对象**：只读。要排序 / 改字段先拷贝（`[...boss.phases].sort(...)`），否则会串到别的页面。
  const bossPresetFile = shallowRef<BossPresetFile | null>(null)
  let bossPresetsPromise: Promise<BossPresetFile> | null = null
  // 实战归档（run-archive.json，3 MB）：同上约定（arena-D 第 367 轮；修前 3 处各自 fetch，兑现价值图另有模块级缓存）
  const runArchiveFile = shallowRef<RunArchiveFile | null>(null)
  let runArchivePromise: Promise<RunArchiveFile> | null = null

  // ============ beta 冻结角色（测试服旧版快照，2026-10-24） ============
  // beta-agents.json（scripts/snapshot-agent.mjs 生成）+ mechanics/agents/beta/*.ts（glob 注册，不受此开关
  // 控制——registry 里挂着不等于可见）。口径：默认关，整库不放出 beta id（选人列表/索引/技能表全看不见），
  // 已存队伍里的 beta id 因 catalog 无此角色而走空槽压缩；打开才 fetch 旁挂文件并合并进下列各索引。
  // 切换 = setBetaEnabled 落 localStorage 后刷新页面（SettingsDialog 提示），不做热切换——catalog/
  // teammateBuffs 的加载去重槽缓存了合并结果，热切换要动多处缓存，收益只有省一次刷新。
  const BETA_STORAGE_KEY = 'zzz-beta-agents'
  const betaAgentsFile = shallowRef<BetaAgentsFile | null>(null)
  const betaEnabled = ref((() => {
    try { return localStorage.getItem(BETA_STORAGE_KEY) === '1' } catch { return false }
  })())
  let betaAgentsPromise: Promise<BetaAgentsFile | null> | null = null

  function setBetaEnabled(on: boolean): void {
    betaEnabled.value = on
    try {
      if (on) localStorage.setItem(BETA_STORAGE_KEY, '1')
      else localStorage.removeItem(BETA_STORAGE_KEY)
    } catch { /* 写不进就只做会话内生效 */ }
  }

  /** 文件缺失（还没有任何 beta 快照）静默返回 null，不算错误态。 */
  // @fact engine:beta-agents/旁挂合并 口径: beta-agents.json 仅在 beta 开关打开时随 catalog 一并加载并合并进 agents/skills/wEngines 索引与 displayAgents；开关关闭 = 整库不放出 beta id，已存队伍按空槽压缩处理；切换 = 落 localStorage 后刷新页面（不热切换） | 据 用户裁决@2026-10-24（测试服旧版要可同屏对比） | 验 src/stores/__tests__/catalogBeta.test.ts | 锚 src/stores/catalog.ts#loadBetaAgents | 信 确认
  // ⟳复核: 首个真实 beta 快照（挽昼 v2 覆盖 1601 时）落地后复核合并面是否够用（如影画文本/配装推荐缺失的影响） | 到期 2027-01-24
  async function loadBetaAgents(): Promise<BetaAgentsFile | null> {
    if (betaAgentsFile.value) return betaAgentsFile.value
    if (betaAgentsPromise) return betaAgentsPromise
    betaAgentsPromise = Promise.resolve().then(async () => {
      try {
        const res = await fetch(withBase('/static/beta-agents.json'))
        if (!res.ok) return null
        const data = await res.json() as BetaAgentsFile
        betaAgentsFile.value = data
        return data
      } catch {
        return null
      } finally {
        betaAgentsPromise = null
      }
    })
    return betaAgentsPromise
  }

  // 合并视图：catalog + beta 旁挂（betaEnabled 且文件加载成功才有增量；beta 条目 id 形如 `1091v1`，
  // 由生成侧保证与真实四位数字 id 空间不交）。只读 concat，不改 catalog 本体（shallowRef 整体替换口径）。
  const mergedAgents = computed<Agent[]>(() =>
    [...(catalog.value?.agents ?? []), ...(betaAgentsFile.value?.agents ?? [])])
  const mergedAgentSkills = computed<AgentSkills[]>(() =>
    [...(catalog.value?.agentSkills ?? []), ...(betaAgentsFile.value?.agentSkills ?? [])])
  const mergedWEngines = computed<WEngine[]>(() =>
    [...(catalog.value?.wEngines ?? []), ...(betaAgentsFile.value?.wEngines ?? [])])

  // 索引 Map
  const agentsMap = computed(() => {
    const m = new Map<string, Agent>()
    mergedAgents.value.forEach(a => m.set(a.id, a))
    return m
  })

  const wEnginesMap = computed(() => {
    const m = new Map<string, WEngine>()
    mergedWEngines.value.forEach(w => m.set(w.id, w))
    // 旧 id 兼容：音擎 id 已统一为数字（legacyIds 保留旧格式，如 zzz_wiki_XXXX / nanoka_XXXX / 英文 slug），
    // 浏览器 localStorage 里的旧配置仍存旧 id，getWEngine 按 legacyIds 兜底。
    mergedWEngines.value.forEach(w => (w.legacyIds ?? []).forEach(old => m.set(old, w)))
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
    mergedAgentSkills.value.forEach(s => m.set(s.id, s))
    return m
  })

  const agentSkillsByAgentMap = computed(() => {
    const m = new Map<string, AgentSkills>()
    mergedAgentSkills.value.forEach(s => m.set(s.agentId, s))
    return m
  })

  // 显示列表（过滤 hidden）
  const displayAgents = computed(() =>
    mergedAgents.value.filter(a => !a.hidden)
  )
  const displayWEngines = computed(() =>
    mergedWEngines.value
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
        const res = await fetch(withBase('/static/catalog.json'))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as Catalog
        catalog.value = data
        // beta 旁挂在开关打开时随 catalog 一并就绪（blocking：文件极小；失败不算 catalog 错误态）
        if (betaEnabled.value) await loadBetaAgents()
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
        const res = await fetch(withBase('/static/teammate-buffs.json'))
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
        const res = await fetch(withBase('/static/build-recommendations.json'))
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

  /** 加载 Boss 预设；失败抛错（调用方沿用各自的 catch 口径），不缓存失败 ⇒ 下次调用重试。 */
  async function loadBossPresets(): Promise<BossPresetFile> {
    if (bossPresetFile.value) return bossPresetFile.value
    if (bossPresetsPromise) return bossPresetsPromise
    bossPresetsPromise = Promise.resolve().then(async () => {
      try {
        const res = await fetch(withBase('/static/boss-presets.json'))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as BossPresetFile
        bossPresetFile.value = data
        return data
      } finally {
        bossPresetsPromise = null
      }
    })
    return bossPresetsPromise
  }

  // 更新日志（changelog.json，由 scripts/gen-changelog.mjs 从 git 历史生成）：同 boss-presets 约定
  // （浅层、整体赋值、并发去重、失败可重试）。**按需加载**——它是 400 KB / 2460 条的历史数据，
  // 而用户打开计算器的目的不是读日志 ⇒ 不进启动门（启动只加载计算必需的依赖），
  // 由 ChangelogDialog 打开时才 fetch（失败也只影响弹层，不阻断计算）。
  const changelogFile = shallowRef<ChangelogFile | null>(null)
  let changelogPromise: Promise<ChangelogFile> | null = null

  /**
   * 加载更新日志；失败抛错、不缓存失败（同 loadBossPresets/loadRunArchive）。返回对象只读。
   *
   * @param force 用户点「刷新」= true：带 cache-buster 重取。
   *   **为什么必须带**：GitHub Pages 对静态资源回 `cache-control: max-age=600`（2026-10-22 实测
   *   线上响应头），裸重取在 10 分钟内拿到的还是浏览器/边缘缓存里的旧响应 ——
   *   「点了刷新没变化」的观感正是这个（产物本身没变时更明显）。
   * ⚠ 但刷新**取不到还没发布的内容**：changelog.json 由构建生成并随包发布
   *   （`.github/workflows/deploy-pages.yml` 的 push 触发），新提交要先 push + 部署完成。
   *
   * @fact ui:changelog/发布时机 口径: 更新日志只随部署更新——push 到 master 触发 deploy-pages（全历史 checkout 后重新生成 changelog.json）；弹层「刷新」只做缓存击穿（GitHub Pages 静态资源实测 cache-control max-age=600），拿不到未 push / 未部署的提交 | 据 用户实测@2026-10-22（线上停在 10-13 部署的版本） | 验 src/stores/__tests__/changelogLoad.test.ts | 锚 src/stores/catalog.ts#loadChangelog | 信 确认
   * ⟳复核: 若部署触发方式或静态资源缓存策略变化（改成秒级发布 / 客户端直读 CDN），复核刷新语义与页脚文案 | 到期 2027-04-22
   */
  async function loadChangelog(force = false): Promise<ChangelogFile> {
    if (changelogFile.value && !force) return changelogFile.value
    if (changelogPromise) return changelogPromise
    changelogPromise = Promise.resolve().then(async () => {
      try {
        // 查询串只做缓存击穿；路径字面量保持完整 —— JSON 入口扫描器（scripts/lib/json-contract.mjs）
        // 靠「fetch + 包装函数 + /static/<名>.json 字面量」这个形态认入口，别把参数拼进字面量里
        // （拼进去 = 扫描器看不见这个入口，契约检查静默失效）。
        const res = await fetch(withBase('/static/changelog.json') + (force ? `?t=${Date.now()}` : ''))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as ChangelogFile
        changelogFile.value = data
        return data
      } finally {
        changelogPromise = null
      }
    })
    return changelogPromise
  }

  /** 加载实战归档；失败抛错、不缓存失败（同 loadBossPresets）。返回对象各页共享，只读。 */
  async function loadRunArchive(): Promise<RunArchiveFile> {
    if (runArchiveFile.value) return runArchiveFile.value
    if (runArchivePromise) return runArchivePromise
    runArchivePromise = Promise.resolve().then(async () => {
      try {
        const res = await fetch(withBase('/static/run-archive.json'))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as RunArchiveFile
        runArchiveFile.value = data
        return data
      } finally {
        runArchivePromise = null
      }
    })
    return runArchivePromise
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

  /** 角色 id → 显示名的单一出口（CC-456）：`localized(name, fallback)`，缺角色 / 缺名时回退 `fallback`（默认 id）。页面 `nameOf` 直接传本函数。 */
  function agentName(id: string, fallback: string = id): string {
    return localized(getAgent(id)?.name, fallback)
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
    betaAgentsFile,
    betaEnabled,
    setBetaEnabled,
    loadBetaAgents,
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
    bossPresetFile,
    loadBossPresets,
    runArchiveFile,
    loadRunArchive,
    changelogFile,
    loadChangelog,
    getAgent,
    agentName,
    getWEngine,
    getDriveDiscSet,
    getAgentSkills,
    getTeammateBuffGroup,
    getBuildRecommendation,
  }
})
