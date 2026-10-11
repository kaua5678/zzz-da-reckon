/**
 * 自定义队伍（用户 2026-10-11：「点了职业和属性后就不能加其他队伍了…这不够自由」→ 两个都要：
 * 跨筛选自由勾选 + 手动组队）。
 *
 * 本文件锁三件事：
 * 1) 物化口径：自定义队 → TeamPreset（缺省配装/零金/无交互），且 id 前缀不与预设库撞车；
 * 2) 合并解析：`resolveSelectedPresets` 同时认预设 id 与自定义 id —— 只查预设库会让自定义队
 *    **静默消失**（选中了却算不出来），这是本功能最危险的回归，必须钉住；
 * 3) 存档健壮性：损坏/幽灵成员不炸、不整批抹掉（目录未就绪时也不许误删）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useCustomTeamsStore, resolveSelectedPresets, CUSTOM_TEAM_PREFIX } from '@/composables/customTeams'
import { teamPresets } from '@/data/teamPresets'
import { useCatalogStore } from '@/stores/catalog'
import { mockStaticFetch } from '@/test/harness'

/** 目录里的前两个角色（用真实 catalog，避免手写 id 与目录脱节） */
function firstTwoAgentIds(): [string, string] {
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'public/static/catalog.json'), 'utf8')) as {
    agents: { id: string; hidden?: boolean }[]
  }
  const visible = cat.agents.filter(a => !a.hidden).map(a => a.id)
  return [visible[0]!, visible[1]!]
}

describe('自定义队伍（2026-10-11）', () => {
  /*
   * vitest 跑 `environment: 'node'`（vite.config.ts）⇒ **没有 localStorage**，`persistedRef` 的
   * `try/catch` 会静默走 fallback。要测存档解析就得自己装一个（仓库惯例见 `persistedRef.test.ts`
   * 的 fakeStorage；这里直接挂 globalThis）。
   */
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
    }
  }
  const savedStorage = (globalThis as { localStorage?: unknown }).localStorage

  beforeEach(() => {
    setActivePinia(createPinia())
    mockStaticFetch()
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage()
  })
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = savedStorage })

  /** 载入目录（本文件只测模型/解析，不需要队伍夹具，故不走 setupHarness 的重路径） */
  async function loadCatalog() {
    const catalog = useCatalogStore()
    await catalog.load()
    return catalog
  }

  it('物化成 TeamPreset：缺省配装 / 零金 / 无交互，id 带 custom- 前缀', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const [a, b] = firstTwoAgentIds()
    const def = store.add()
    store.setSlot(def.id, 0, a)
    store.setSlot(def.id, 1, b)

    const p = store.toCustomPreset(store.byId(def.id)!)
    expect(p.id.startsWith(CUSTOM_TEAM_PREFIX)).toBe(true)
    expect(p.team).toEqual([a, b, ''])
    // 缺省语义与 auto- 预设一致：wEngines 缺省 = 自动推荐，goldSteps 空 = 01 基线，interactions 空 = 角色职业基准
    expect(p.wEngines).toBeUndefined()
    expect(p.goldSteps).toEqual([])
    expect(p.interactions).toEqual([])
    // 不进预设库的分类口径（group/subgroup 是预设库的检索维度）
    expect(p.group).toBeUndefined()
    expect(p.subgroup).toBeUndefined()
  })

  it('id 不与预设库撞车（同名空间共存的前提）', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    store.add()
    store.add()
    const presetIds = new Set(teamPresets.map(t => t.id))
    for (const d of store.defs) expect(presetIds.has(d.id)).toBe(false)
    // 删掉再建不重用旧 id（已选清单不会指向新队伍）
    const first = store.defs[0]!.id
    store.remove(first)
    const next = store.add()
    expect(next.id).not.toBe(first)
  })

  it('展示名：用户填过用用户的，否则按成员自动生成', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const [a, b] = firstTwoAgentIds()
    const def = store.add()
    store.setSlot(def.id, 0, a)
    store.setSlot(def.id, 1, b)
    const auto = store.displayName(store.byId(def.id)!)
    // 自动名 = 两个成员名用 + 连起来（成员名来自目录，不写死具体角色名）
    expect(auto.split('+')).toHaveLength(2)
    expect(auto).not.toBe('空队伍')
    store.setName(def.id, '我的队')
    expect(store.displayName(store.byId(def.id)!)).toBe('我的队')
  })

  it('合并解析：预设 id 与自定义 id 都认；未命中丢弃（不抛错）', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const [a] = firstTwoAgentIds()
    const def = store.add()
    store.setSlot(def.id, 0, a)

    const presetId = teamPresets[0]!.id
    const out = resolveSelectedPresets([presetId, def.id, 'does-not-exist'], store.defs, store.toCustomPreset)
    expect(out.map(p => p.id)).toEqual([presetId, def.id])
    // 只查预设库的实现会让自定义队静默消失 —— 钉住这一条
    expect(out.some(p => p.id === def.id)).toBe(true)
  })

  it('setSlot：不在目录里的成员当清空（不写幽灵 id）；空槽允许（引擎按位压缩）', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const def = store.add()
    store.setSlot(def.id, 0, 'not-a-real-agent')
    expect(store.byId(def.id)!.team[0]).toBe('')
    store.setSlot(def.id, 2, null)
    expect(store.byId(def.id)!.team[2]).toBe('')
  })

  it('存档解析：损坏条目/全空队/错前缀一律丢弃，好条目保留；目录未就绪时不整批抹掉', () => {
    const [a] = firstTwoAgentIds()
    const raw = [
      { id: 'custom-1', name: '', team: [a, '', ''] },      // 好
      { id: 'custom-2', name: '', team: ['', '', ''] },      // 全空 → 丢
      { id: 'auto-9', name: '', team: [a, '', ''] },         // 错前缀 → 丢
      { id: 'custom-3', name: '', team: [a, ''] },           // 不是三元组 → 丢
      null,                                                   // 非对象 → 丢
    ]
    // 存档必须在 store 创建前写进 storage（persistedRef 在 setup 时同步读）
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'zzz-custom-teams:v1': JSON.stringify(raw) })
    const store = useCustomTeamsStore()
    // 目录尚未 load ⇒ 成员不被当成幽灵删掉（parseCustomTeams 刻意不查目录）
    expect(store.defs.map(d => d.id)).toEqual(['custom-1'])
    expect(store.defs[0]!.team[0]).toBe(a)
  })

  it('存档整体损坏 ⇒ 回落空数组（不抛）', () => {
    for (const bad of ['{not json', '"a string"', '{"not":"array"}']) {
      setActivePinia(createPinia())
      ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage({ 'zzz-custom-teams:v1': bad })
      expect(useCustomTeamsStore().defs, bad).toEqual([])
    }
  })

  it('源码锁：两个对比页都走合并解析（不许各自 filter 预设库）', () => {
    const viewsDir = join(process.cwd(), 'src/views')
    for (const f of ['PositionComparePage.vue', 'TeamComparePage.vue']) {
      const s = readFileSync(join(viewsDir, f), 'utf8')
      expect(s, `${f} 应走 resolveSelectedPresets`).toContain('resolveSelectedPresets(')
      expect(s, `${f} 应挂 CustomTeamsEditor`).toContain('CustomTeamsEditor')
      // 旧的「只 filter 预设库」写法会让自定义队静默消失
      expect(s).not.toMatch(/teamPresets\.filter\(\w+ => selectedPresetIds\.value\.includes/)
    }
  })

  it('自定义队声明了 @fact 锚点（锚符号存在）', () => {
    const s = readFileSync(join(process.cwd(), 'src/composables/customTeams.ts'), 'utf8')
    expect(s).toContain('@fact preset:自定义队伍')
    expect(s).toMatch(/export function toCustomPreset|function toCustomPreset/)
  })
})
