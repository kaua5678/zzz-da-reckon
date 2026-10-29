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
import { useCustomTeamsStore, resolveSelectedPresets, identityKey, CUSTOM_TEAM_PREFIX } from '@/composables/customTeams'
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

  it('★ 逐槽配置码：进 TeamPreset（散点/曲线同源）、换人自动清该槽的码、全清后字段消失', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const def = store.add()
    store.setSlot(def.id, 0, '1571')
    store.setSlot(def.id, 1, '1211')
    store.setSlot(def.id, 2, '1611')
    // 诺姆 30 / 丽娜 65 / 克拉蕾 61
    store.setSlotCode(def.id, 0, { cinema: 3, wengine: 1 })
    store.setSlotCode(def.id, 1, { cinema: 6, wengine: 5 })
    store.setSlotCode(def.id, 2, { cinema: 6, wengine: 1 })
    const preset = store.byId(def.id)!
    expect(preset.slotCodes).toEqual([{ cinema: 3, wengine: 1 }, { cinema: 6, wengine: 5 }, { cinema: 6, wengine: 1 }])
    // 物化进 TeamPreset：难度曲线/散点直接吃（不是页面级开关）
    expect(store.toCustomPreset(preset).slotCodes).toEqual(preset.slotCodes)
    // ★ 换人 ⇒ 该槽的码作废（码是「这个角色的 2 命 1 精」，换人还留着 = 给新角色套别人的档位）
    store.setSlot(def.id, 1, '1311')
    expect(store.byId(def.id)!.slotCodes?.[1]).toBeNull()
    expect(store.byId(def.id)!.slotCodes?.[0]).toEqual({ cinema: 3, wengine: 1 })
    // 全清 ⇒ 字段整体消失（不留一串 null）
    store.setSlotCode(def.id, 0, null)
    store.setSlotCode(def.id, 2, null)
    expect(store.byId(def.id)!.slotCodes).toBeUndefined()
    expect(store.toCustomPreset(store.byId(def.id)!).slotCodes).toBeUndefined()
  })

  it('自定义队声明了 @fact 锚点（锚符号存在）', () => {
    const s = readFileSync(join(process.cwd(), 'src/composables/customTeams.ts'), 'utf8')
    expect(s).toContain('@fact preset:自定义队伍')
    expect(s).toMatch(/export function toCustomPreset|function toCustomPreset/)
  })

  // ============ 创建组 + 批量配置码（用户 2026-10-29）============

  it('★ 创建组：固定两人 + 候选多选 ⇒ 每候选一支队，顺序 = 候选顺序，一次写盘', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const res = store.createGroup({
      varyingSlot: 2,
      fixed: [{ slot: 0, agentId: '1571' }, { slot: 1, agentId: '1211' }],
      candidates: ['1611', '1601', '1661'],
    })
    expect(res.created).toHaveLength(3)
    expect(res.skipped).toBe(0)
    expect(store.defs.map(d => d.id)).toEqual(res.created)
    expect(store.defs.map(d => d.team)).toEqual([
      ['1571', '1211', '1611'],
      ['1571', '1211', '1601'],
      ['1571', '1211', '1661'],
    ])
    // id 不重用、递增（已选清单不会指向新队伍）
    expect(res.created).toEqual(['custom-1', 'custom-2', 'custom-3'])
  })

  it('★ 创建组去重：同成员同码跳过，**同成员不同码照建**（那是两支要同时看的队）', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const group = {
      varyingSlot: 2 as const,
      fixed: [{ slot: 0 as const, agentId: '1571' }, { slot: 1 as const, agentId: '1211' }],
      candidates: ['1611'],
    }
    const one = store.createGroup({ ...group, code: { cinema: 3, wengine: 0 } })
    expect(one.created).toHaveLength(1)
    // 同成员 + 同码 ⇒ 跳过（不重复建）
    const again = store.createGroup({ ...group, code: { cinema: 3, wengine: 0 } })
    expect(again.created).toEqual([])
    expect(again.skipped).toBe(1)
    // 同成员 + 不同码 ⇒ **照建**（「诺姆30 队」与「诺姆11 队」必须并存，否则静默少一条曲线）
    const other = store.createGroup({ ...group, code: { cinema: 1, wengine: 1 } })
    expect(other.created).toHaveLength(1)
    expect(store.defs).toHaveLength(2)
    expect(store.defs[1]!.slotCodes).toEqual([
      { cinema: 1, wengine: 1 }, { cinema: 1, wengine: 1 }, { cinema: 1, wengine: 1 },
    ])
  })

  it('创建组：目录外的候选跳过；指向「变化槽」的固定项被忽略（不静默顶掉候选）', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const res = store.createGroup({
      varyingSlot: 1,
      // 第 2 条指向变化槽（1）⇒ 忽略它，而不是让「诺姆」把候选顶掉
      fixed: [{ slot: 0, agentId: '1571' }, { slot: 1, agentId: '1211' }],
      candidates: ['1611', 'not-a-real-agent', ''],
    })
    expect(res.created).toHaveLength(1)
    expect(res.skipped).toBe(2)
    expect(store.defs[0]!.team).toEqual(['1571', '1611', ''])
  })

  it('★ 批量配置码：多队 × 多槽一次写；null = 清那几个槽；未命中 id 跳过并如实回报改动数', async () => {
    await loadCatalog()
    const store = useCustomTeamsStore()
    const res = store.createGroup({
      varyingSlot: 2,
      fixed: [{ slot: 0, agentId: '1571' }, { slot: 1, agentId: '1211' }],
      candidates: ['1611', '1601'],
    })
    // 全填 01（用户原话的例子）
    expect(store.setCodesMany(res.created, [0, 1, 2], { cinema: 0, wengine: 1 })).toBe(2)
    for (const d of store.defs) {
      expect(d.slotCodes).toEqual([{ cinema: 0, wengine: 1 }, { cinema: 0, wengine: 1 }, { cinema: 0, wengine: 1 }])
    }
    // 只清第 0 槽：另两槽不受影响
    expect(store.setCodesMany(res.created, [0], null)).toBe(2)
    expect(store.defs[0]!.slotCodes).toEqual([null, { cinema: 0, wengine: 1 }, { cinema: 0, wengine: 1 }])
    // 全清 ⇒ 字段整体消失（不留一串 null）
    expect(store.setCodesMany(res.created, [1, 2], null)).toBe(2)
    expect(store.defs[0]!.slotCodes).toBeUndefined()
    // 未命中 / 空清单 ⇒ 0（调用方据此说「没有队被改」，而不是假装成功）
    expect(store.setCodesMany(['custom-999'], [0], { cinema: 0, wengine: 1 })).toBe(0)
    expect(store.setCodesMany([], [0], null)).toBe(0)
    expect(store.setCodesMany(res.created, [], null)).toBe(0)
  })

  it('identityKey：成员顺序无关 + 配置码进键（同一队换槽位仍是同一支队）', async () => {
    expect(identityKey({ team: ['a', 'b', 'c'] })).toBe(identityKey({ team: ['c', 'a', 'b'] }))
    expect(identityKey({ team: ['a', 'b', ''] })).not.toBe(identityKey({ team: ['a', 'b', 'c'] }))
    const withCode = identityKey({ team: ['a', 'b', 'c'], slotCodes: [{ cinema: 3, wengine: 0 }, null, null] })
    expect(withCode).not.toBe(identityKey({ team: ['a', 'b', 'c'] }))
  })

  it('源码锁：两处配置码编辑区都挂批量条（自定义队伍 / 每队配置码操作区）', () => {
    for (const f of ['CustomTeamsEditor.vue', 'TeamSlotCodeEditor.vue']) {
      const s = readFileSync(join(process.cwd(), 'src/components', f), 'utf8')
      expect(s, `${f} 应挂 SlotCodeBatchBar`).toContain('SlotCodeBatchBar')
    }
  })
})
