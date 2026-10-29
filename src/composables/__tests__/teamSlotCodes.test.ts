/**
 * 每队配置码（用户 2026-10-26：「我从上面勾选的队伍也能写配置码」「填 00 或者其他不带专武的配置时，
 * 我在哪里勾选下位武器呢？」）。
 *
 * 判据重点：
 * ① 按 presetId 分开存 —— 同一张图上「诺姆30 队」与「诺姆11 队」各写各的（旧页面级三格做不到）；
 * ② 空 = 不覆盖（引擎侧逐位不变）；
 * ③ 右位 0（无专武）的槽被识别出来 ⇒ UI 才显示下位选择器；点了下位件它真的进 `SlotOverrides`；
 * ④ 右位 ≥1 时点过的下位件**不生效**（有专武就不可能同时穿下位，否则存档与结果不一致）；
 * ⑤ 存档坏条目整体丢弃、全空不留空壳。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  overridesOf, invalidCells, slotsNeedingDowngrade, parseTeamSlotCodes, useTeamSlotCodes,
  type TeamSlotCodeEntry,
} from '@/composables/teamSlotCodes'

const entry = (cells: [string, string, string], downs?: [string | null, string | null, string | null]): TeamSlotCodeEntry =>
  ({ cells, ...(downs ? { downgrades: downs } : {}) })

describe('每队配置码（teamSlotCodes）', () => {
  it('★ 空 ⇒ 三格全 null（= 不覆盖，引擎侧逐位不变）', () => {
    expect(overridesOf(undefined)).toEqual([null, null, null])
    expect(overridesOf(entry(['', '', '']))).toEqual([null, null, null])
    expect(slotsNeedingDowngrade(undefined)).toEqual([])
    expect(invalidCells(undefined)).toEqual([false, false, false])
  })

  it('★ 按队分开：两队同槽不同码，互不影响', () => {
    const a = overridesOf(entry(['30', '', '']))
    const b = overridesOf(entry(['11', '', '']))
    expect(a[0]).toEqual({ cinema: 3, wengine: 0 })
    expect(b[0]).toEqual({ cinema: 1, wengine: 1 })
  })

  it('★ 右位 0 ⇒ 该槽进「需要选下位」清单；点名的下位件进 overrides', () => {
    const e = entry(['00', '', '20'], ['13020', null, null])
    expect(slotsNeedingDowngrade(e)).toEqual([0, 2])
    expect(overridesOf(e)[0]).toEqual({ cinema: 0, wengine: 0, downgradeWEngineId: '13020' })
    expect(overridesOf(e)[2]).toEqual({ cinema: 2, wengine: 0 })
  })

  it('★ 右位 ≥1 时点过的下位件不生效（否则存档说有、实际穿专武 = 两处不一致）', () => {
    const e = entry(['11', '', ''], ['13020', null, null])
    expect(overridesOf(e)[0]).toEqual({ cinema: 1, wengine: 1 })
    expect(slotsNeedingDowngrade(e)).toEqual([]) // 有专武就不需要选下位
  })

  it('非法码 = 不覆盖 + 标红（不静默按 00 处理）', () => {
    const e = entry(['99', '1', ''])
    expect(invalidCells(e)).toEqual([true, true, false])
    expect(overridesOf(e)).toEqual([null, null, null])
    expect(slotsNeedingDowngrade(e)).toEqual([]) // 非法码不该冒出下位选择器
  })

  it('存档：坏条目整体丢弃，全空不留空壳，旧版（只有三格）也能读', () => {
    const parsed = parseTeamSlotCodes({
      'auto-1': { cells: ['30', '65', '61'] },
      'auto-2': { cells: ['', '', ''] }, // 全空 ⇒ 丢
      'auto-3': { cells: ['00', '', ''], downgrades: ['13020', null, null] },
      'auto-4': { cells: ['1'] }, // 不是三格 ⇒ 丢
      'auto-5': 'not an object',
      'auto-6': { cells: ['', '', ''], downgrades: [null, null, '13020'] }, // 只有下位件 ⇒ 保留
    })
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['auto-1', 'auto-3', 'auto-6'])
    expect(parsed?.['auto-3']?.downgrades?.[0]).toBe('13020')
  })

  it('存档整体损坏 ⇒ undefined（回落空表，不抛）', () => {
    for (const bad of [null, 42, 'x', []]) expect(parseTeamSlotCodes(bad)).toBeUndefined()
  })
})

/**
 * 批量写格（用户 2026-10-29：「配置码也支持批量修改，比如全填 01」）。
 *
 * 走真 store（`useTeamSlotCodes`）而不是纯函数：这条的语义全在「写盘形态」上——
 * 全填、逐槽清、全空 ⇒ 删键，以及**未命中的 id 不该让整批失败**。
 * vitest 跑 node 环境（无 localStorage）⇒ 自己装一个 fakeStorage（仓库惯例，见 customTeams.test.ts）。
 */
describe('每队配置码 · 批量写格（2026-10-29）', () => {
  function fakeStorage() {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
    }
  }
  const savedStorage = (globalThis as { localStorage?: unknown }).localStorage
  beforeEach(() => { setActivePinia(createPinia()); (globalThis as { localStorage?: unknown }).localStorage = fakeStorage() })
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = savedStorage })

  it('★ 全填 01：多队 × 三槽一次写完（与逐格 setCell 同一条 commit 路径）', () => {
    const store = useTeamSlotCodes()
    expect(store.setCellsMany(['auto-1', 'auto-2'], [0, 1, 2], '01')).toBe(2)
    for (const id of ['auto-1', 'auto-2']) {
      expect(store.entryOf(id).cells).toEqual(['01', '01', '01'])
      expect(store.overridesFor(id)).toEqual([
        { cinema: 0, wengine: 1 }, { cinema: 0, wengine: 1 }, { cinema: 0, wengine: 1 },
      ])
    }
    // 值没变 ⇒ 改动数为 0（调用方据此说「无需改动」，而不是假装写了一次）
    expect(store.setCellsMany(['auto-1'], [0, 1, 2], '01')).toBe(0)
  })

  it('★ 只清指定槽：别的槽不受影响；全清 ⇒ 键整体消失（存档不留空壳）', () => {
    const store = useTeamSlotCodes()
    store.setCellsMany(['auto-1'], [0, 1, 2], '65')
    expect(store.setCellsMany(['auto-1'], [1], '')).toBe(1)
    expect(store.entryOf('auto-1').cells).toEqual(['65', '', '65'])
    expect(store.setCellsMany(['auto-1'], [0, 2], '')).toBe(1)
    expect('auto-1' in store.map.value).toBe(false)
    expect(store.activeIds.value).toEqual([])
  })

  it('批量不动该槽已选的下位件（清码 ≠ 清下位）；只写调用方给的 id，值没变的队不计入', () => {
    const store = useTeamSlotCodes()
    store.setCell('auto-1', 0, '00')
    store.setDowngrade('auto-1', 0, '13020')
    expect(store.overridesFor('auto-1')[0]).toEqual({ cinema: 0, wengine: 0, downgradeWEngineId: '13020' })
    // 覆盖成有专武的码 ⇒ 下位件仍在存档里（只是不生效，见 overridesOf 的口径）
    expect(store.setCellsMany(['auto-1'], [0], '21')).toBe(1)
    expect(store.entryOf('auto-1').downgrades?.[0]).toBe('13020')
    // id 清单归调用方（页面传解析后的勾选队伍）⇒ 这里只按清单写；空清单/空槽位 = 什么都不做
    expect(store.setCellsMany(['auto-2'], [2], '01')).toBe(1)
    expect(store.entryOf('auto-1').cells).toEqual(['21', '', ''])
    expect(store.setCellsMany([], [0], '01')).toBe(0)
    expect(store.setCellsMany(['auto-1'], [], '01')).toBe(0)
    expect(store.setCellsMany(['auto-1'], [7, -1], '01')).toBe(0) // 越界槽位不写（也不崩）
  })
})
