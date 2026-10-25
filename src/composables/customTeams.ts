/**
 * 自定义队伍（用户 2026-10-11：「点了职业和属性后就不能加其他队伍了…这不够自由」→ 除预设库外
 * 还要能**自己填 3 个槽位**丢进对比）。
 *
 * 为什么是「物化成 TeamPreset」而不是给引擎加一路自定义输入：两个对比页的入参本来就是
 * `TeamPreset[]`（`selectedPresets` → `computeTeamCompare` / `computePositionCompare` /
 * `computeDifficultyCurves` / `computeSlotSweepPoints`），自定义队只要**渲染成同一种形状**
 * 就自动获得全部下游能力（金数、难度曲线、切轴、逐槽配装），零引擎改动、零新分支。
 * 这也是规则 12 的阶梯①：不新建并行数据通道。
 *
 * 与预设库的边界：
 * · 预设库 = 文件（`src/data/teamPresets/*.json`），只读、带策划好的 goldSteps / 轴 / 交互；
 * · 自定义队 = 本 store，用户自填**槽位成员**，配装走角色默认推荐（`wEngines` 留空 = 自动推荐，
 *   与 `_template.json` 的缺省语义一致），`goldSteps: []` = 01 基线、`interactions: []` = 走角色
 *   职业基准（与 auto- 预设同口径，见 `data/teamPresets.ts` 头注释）。
 * 分类：不落 `group`/`subgroup` —— 那两级是**预设库的**检索口径（`scripts/lib/presetCategories.mjs`
 * 按「输出核心职业 + 属性」算），自定义队不进预设库就不该伪造分类（会被 `validate:data` 的分类
 * 护栏与 `teamPresets.test.ts` 的成员集合去重误伤）。UI 侧单独列在「自定义」区。
 *
 * @fact preset:自定义队伍 口径: 自定义队伍 = 用户自填槽位成员（可少于 3 人，空槽走引擎既有的按位压缩路径），物化成 TeamPreset 后与预设队同路进对比；配装/交互/金数一律取缺省（wEngines 空=自动推荐、goldSteps:[]=01 基线、interactions:[]=角色职业基准）；id 前缀固定 `custom-`，不进预设库、不落 group/subgroup | 据 用户 2026-10-11「两个都要」（跨筛选自由勾选 + 手动组队） | 验 src/composables/__tests__/customTeams.test.ts | 锚 src/composables/customTeams.ts#toCustomPreset | 信 确认
 * ⟳复核: 若自定义队开始需要自带配装/交互/金数（不再一律取缺省），或预设库改为可写（自定义队能落盘成预设文件），复核「物化成 TeamPreset 且不进预设库」这条归属 | 到期 2027-01-31
 */
import { computed } from 'vue'
import { defineStore } from 'pinia'
import { persistedRef } from '@/composables/persistedRef'
import { teamPresets } from '@/data/teamPresets'
import { useCatalogStore } from '@/stores/catalog'
import type { TeamPreset } from '@/types/teamPreset'

/** localStorage 键（改键名 = 用户已存的自定义队丢失，故带版本后缀，与 stores/ui.ts 同惯例） */
export const CUSTOM_TEAMS_KEY = 'zzz-custom-teams:v1'

/** 自定义队 id 前缀：与预设库（`auto-*` / 手编）在同一个 `selectedPresetIds` 命名空间里共存 */
export const CUSTOM_TEAM_PREFIX = 'custom-'

/** 一个槽位的固定配置码（`null` = 不固定）；形状与 `TeamPreset.slotCodes` 一致 */
export interface SlotCode {
  cinema: number
  wengine: number
}

/** 自定义队定义：只有成员是用户输入的，其余全是派生 */
export interface CustomTeamDef {
  /** id（`custom-` + 稳定序号；重命名不改 id，避免已选清单失配） */
  id: string
  /** 展示名（用户可改名；缺省按当前成员自动生成） */
  name: string
  /** 槽位成员（长度 3，空串 = 空槽）；引擎按位压缩，故允许少于 3 人 */
  team: [string, string, string]
  /**
   * 逐槽固定配置码（2026-10-25，用户：「队友是固定65丽娜61克拉蕾」「比较同样克拉蕾和丽娜配置的
   * 不同配置诺姆的难度曲线」）。
   *
   * 为什么在**队伍**上而不是在页面上：一支队 = 3 人 + 3 套配置。「诺姆30 队」与「诺姆11 队」
   * 是两支队（队友相同、诺姆不同），要各出一条曲线 ⇒ 配置必须跟着队伍走，才能同时进
   * 散点 / 难度曲线 / 归档对拍。页面级全局开关只能给当次运行套同一个覆盖。
   *
   * 长度 3，`null` = 该槽不固定（走 01 基线/加金）。
   */
  slotCodes?: Array<SlotCode | null>
}

/**
 * 解析存档：**只校验形状**（id 前缀 / team 三元组 / 成员是字符串），**不查目录**。
 *
 * 刻意不在这里过滤目录里不存在的成员：`persistedRef` 的 `load()` 是**同步**执行的，而目录
 * （`catalogStore.displayAgents`）要等 `catalog.load()` 完成才非空——在这里查目录会在
 * 「store 先于目录就绪被创建」时把所有成员判成幽灵、把用户存的自定义队整批抹掉。
 * 目录侧的存在性校验改在下游 `defs` 计算里做（响应式，目录就绪后自动收敛）。
 */
function parseCustomTeams(stored: unknown): CustomTeamDef[] | undefined {
  if (!Array.isArray(stored)) return undefined
  const out: CustomTeamDef[] = []
  const seen = new Set<string>()
  for (const raw of stored) {
    if (!raw || typeof raw !== 'object') continue
    const { id, name, team } = raw as Partial<CustomTeamDef>
    if (typeof id !== 'string' || !id.startsWith(CUSTOM_TEAM_PREFIX) || seen.has(id)) continue
    if (!Array.isArray(team) || team.length !== 3) continue
    const slots = team.map(v => (typeof v === 'string' ? v : '')) as [string, string, string]
    if (!slots.some(Boolean)) continue // 全空的条目没有意义，静默丢弃
    seen.add(id)
    // slotCodes：只收形状合法的（三位、每位 null 或 {cinema 0-6, wengine 1-5}）；坏条目整体丢弃
    // 而不是部分保留——半份配置比没有更危险（用户会以为锁上了）
    const rawCodes: unknown = 'slotCodes' in raw ? (raw as Record<string, unknown>).slotCodes : undefined
    let slotCodes: CustomTeamDef['slotCodes']
    if (Array.isArray(rawCodes) && rawCodes.length === 3) {
      const ok = rawCodes.every(code => {
        if (code === null) return true
        if (!code || typeof code !== 'object') return false
        const cinema: unknown = 'cinema' in code ? (code as Record<string, unknown>).cinema : undefined
        const wengine: unknown = 'wengine' in code ? (code as Record<string, unknown>).wengine : undefined
        return typeof cinema === 'number' && Number.isFinite(cinema) && cinema >= 0 && cinema <= 6
          && typeof wengine === 'number' && Number.isFinite(wengine) && wengine >= 1 && wengine <= 5
      })
      if (ok) slotCodes = rawCodes as CustomTeamDef['slotCodes']
    }
    out.push({ id, name: typeof name === 'string' ? name : '', team: slots, ...(slotCodes ? { slotCodes } : {}) })
  }
  return out.length > 0 ? out : undefined
}

/** 自动队名：按槽位成员名拼（与预设命名的「A+B+C」观感一致；无名可拼时退回占位） */
function autoName(team: readonly string[], nameOf: (id: string) => string): string {
  const names = team.filter(Boolean).map(nameOf)
  return names.length > 0 ? names.join('+') : '空队伍'
}

export const useCustomTeamsStore = defineStore('customTeams', () => {
  const catalogStore = useCatalogStore()
  /** 目录里真实存在的角色 id（存档校验 + 下拉选项共用同一判据） */
  const knownAgentIds = computed(() => new Set(catalogStore.displayAgents.map(a => a.id)))

  const defs = persistedRef<CustomTeamDef[]>(
    CUSTOM_TEAMS_KEY,
    parseCustomTeams,
    () => [],
  )

  /** 下一个可用的 id：取现存最大序号 +1（不重用已删 id，避免已选清单指向新队伍） */
  function nextId(): string {
    const used = defs.value.map(d => Number(d.id.slice(CUSTOM_TEAM_PREFIX.length))).filter(Number.isFinite)
    const max = used.length > 0 ? Math.max(...used) : 0
    return `${CUSTOM_TEAM_PREFIX}${max + 1}`
  }

  /** 新建一支（默认空队，由调用方随即引导用户填槽） */
  function add(): CustomTeamDef {
    const def: CustomTeamDef = { id: nextId(), name: '', team: ['', '', ''] }
    defs.value = [...defs.value, def]
    return def
  }

  function remove(id: string) {
    defs.value = defs.value.filter(d => d.id !== id)
  }

  function setName(id: string, name: string) {
    defs.value = defs.value.map(d => (d.id === id ? { ...d, name } : d))
  }

  /** 设槽位成员（成员不在目录里一律当清空，避免写出幽灵 id） */
  function setSlot(id: string, slot: 0 | 1 | 2, agentId: string | null) {
    const next = agentId && knownAgentIds.value.has(agentId) ? agentId : ''
    defs.value = defs.value.map(d => {
      if (d.id !== id) return d
      const team = [...d.team] as [string, string, string]
      if (team[slot] === next) return d
      team[slot] = next
      // 换人 ⇒ 该槽的固定码作废（见 setSlotCode 注释）
      const codes: Array<SlotCode | null> | null = d.slotCodes ? [...d.slotCodes] : null
      if (codes) codes[slot] = null
      return { ...d, team, ...(codes && codes.some(c => c !== null) ? { slotCodes: codes } : { slotCodes: undefined }) }
    })
  }

  /**
   * 设某槽的固定配置码（`null` = 不固定）。成员换人时**自动清掉该槽的码**——
   * 配置码是「这个角色的 2 命 1 精」，换了角色还留着就是给新角色套别人的档位（静默错数）。
   */
  function setSlotCode(id: string, slot: 0 | 1 | 2, code: SlotCode | null) {
    defs.value = defs.value.map(d => {
      if (d.id !== id) return d
      const next: Array<SlotCode | null> = d.slotCodes ? [...d.slotCodes] : [null, null, null]
      next[slot] = code
      return { ...d, slotCodes: next.every(c => c === null) ? undefined : next }
    })
  }

  /** 展示名：用户填过就用用户的，否则按成员自动生成（改名不改 id） */
  function displayName(def: CustomTeamDef): string {
    const custom = def.name.trim()
    return custom || autoName(def.team, id => catalogStore.agentName(id))
  }

  /** 物化成 TeamPreset —— 与预设库同一种形状，故下游（对比/曲线/切轴）零改动直接吃 */
  function toCustomPreset(def: CustomTeamDef): TeamPreset {
    return {
      id: def.id,
      name: displayName(def),
      team: def.team,
      goldSteps: [],
      interactions: [],
      // 逐槽固定配置（2026-10-25）：有码 ⇒ 这支队带固定配装，散点/曲线/对拍全走同一条路
      ...(def.slotCodes && def.slotCodes.some(c => c !== null) ? { slotCodes: def.slotCodes } : {}),
    }
  }

  /**
   * 供对比页消费：已选清单里属于自定义队的部分（顺序 = 用户建队顺序）。
   *
   * 目录就绪后**收敛幽灵成员**：`parseCustomTeams` 刻意不查目录（见其注释），所以这里在目录
   * 非空时把已不存在的角色剔成空槽再交给引擎（`knownAgentIds` 响应式，目录一变本计算自动重跑）。
   * 目录为空（尚未加载）时不剔——不把「还没加载」当成「角色已删除」。
   */
  const presets = computed<TeamPreset[]>(() => defs.value.map(d => toCustomPreset(resolveGhosts(d))))

  /** 幽灵成员剔成空槽（目录未加载时原样返回） */
  function resolveGhosts(def: CustomTeamDef): CustomTeamDef {
    const known = knownAgentIds.value
    if (known.size === 0) return def
    if (!def.team.some(id => !!id && !known.has(id))) return def
    return { ...def, team: def.team.map(id => (known.has(id) ? id : '')) as [string, string, string] }
  }

  /**
   * 目录角色 → 是否有幽灵成员（UI 提示用；不动存档，避免「目录还没加载完」时误删用户数据）。
   * 目录为空（未加载）时恒 false —— 不把「还没加载」报成「角色不存在」。
   */
  function hasUnknownMembers(def: CustomTeamDef): boolean {
    const known = knownAgentIds.value
    if (known.size === 0) return false
    return def.team.some(id => !!id && !known.has(id))
  }

  function byId(id: string): CustomTeamDef | undefined {
    return defs.value.find(d => d.id === id)
  }

  return { defs, presets, knownAgentIds, add, remove, setName, setSlot, setSlotCode, displayName, toCustomPreset, byId, hasUnknownMembers }
})

/**
 * 已选项 id → TeamPreset（预设库 + 自定义队合并解析）。**两个对比页共用的唯一解析口**。
 *
 * 为什么要合并解析而不是两处各自 `teamPresets.filter`：自定义队 id 与预设 id 同在
 * `selectedPresetIds` 里，只查预设库会让自定义队**静默消失**（选中了但算不出来，
 * 比报错更难查）。未命中一律丢弃（删除队伍 / 存档残留）。
 */
export function resolveSelectedPresets(
  ids: readonly string[],
  customDefs: readonly CustomTeamDef[],
  toCustomPreset: (def: CustomTeamDef) => TeamPreset,
): TeamPreset[] {
  const customMap = new Map(customDefs.map(d => [d.id, d]))
  const presetMap = new Map(teamPresets.map(t => [t.id, t]))
  const out: TeamPreset[] = []
  for (const id of ids) {
    const preset = presetMap.get(id)
    if (preset) { out.push(preset); continue }
    const def = customMap.get(id)
    if (def) out.push(toCustomPreset(def))
  }
  return out
}
