/**
 * CC-349：自动轴命中 → 保底目标预填是 **UI store 会话效果**，不依赖任何页面挂载；独立场景模型不挂。
 * 预设数据用注入（presetGuaranteeWrites / autoStunAxisPresetOf 的纯函数口径）+ store 级端到端两层判据。
 */
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  autoStunAxisPresetOf,
  presetGuaranteeWrites,
  NO_AUTO_AXIS_PRESET_HINTS,
  type StunAxisPreset,
} from '@/data/stunAxisPresets'

const G_PRESET: StunAxisPreset = {
  id: 'p-g', name: 'G', team: ['A', 'B', '*'], note: '',
  guarantee: { stun: 4, fury: 0 },
  axes: [{ name: 'x', actions: [] }],
} as unknown as StunAxisPreset

describe('presetGuaranteeWrites', () => {
  it('只列声明的键：N>0 → 1、0 → 0，未声明不出现', () => {
    expect(presetGuaranteeWrites(G_PRESET)).toEqual([['guarantee.stun', 1], ['guarantee.fury', 0]])
    expect(presetGuaranteeWrites(null)).toEqual([])
    expect(presetGuaranteeWrites({ guarantee: undefined })).toEqual([])
  })
})

describe('autoStunAxisPresetOf', () => {
  it('开关关 → null；开 → 按槽位命中', () => {
    const team = [{ agentId: 'A', cinemaLevel: 0 }, { agentId: 'B' }, { agentId: 'C' }]
    expect(autoStunAxisPresetOf({ autoYidhariAxis: false, team }, NO_AUTO_AXIS_PRESET_HINTS, [G_PRESET])).toBeNull()
    expect(autoStunAxisPresetOf({ autoYidhariAxis: true, team }, NO_AUTO_AXIS_PRESET_HINTS, [G_PRESET])?.id).toBe('p-g')
    expect(autoStunAxisPresetOf({ autoYidhariAxis: true, team: team.slice(0, 2) }, NO_AUTO_AXIS_PRESET_HINTS, [G_PRESET])).toBeNull()
  })
})

describe('UI store 会话效果（不挂页面）', () => {
  async function setup() {
    vi.resetModules()
    vi.doMock('@/data/stunAxisPresets', async (orig) => {
      const real = await orig<typeof import('@/data/stunAxisPresets')>()
      const presets = [G_PRESET]
      return {
        ...real,
        stunAxisPresets: presets,
        autoStunAxisPresetOf: (c: Parameters<typeof real.autoStunAxisPresetOf>[0], h: Parameters<typeof real.autoStunAxisPresetOf>[1]) =>
          real.autoStunAxisPresetOf(c, h, presets),
      }
    })
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const cfg = await import('@/stores/config')
    const { useCatalogStore } = await import('@/stores/catalog')
    return { cfg, catalog: useCatalogStore() }
  }

  it('换成命中队伍 → 预填声明键；未声明键与用户手勾保留', async () => {
    const { cfg } = await setup()
    const store = cfg.useConfigStore()
    store.setMechanicSetting('guarantee.ultimate', 1) // 用户手勾（预设未声明 ultimate）
    store.setMechanicSetting('guarantee.fury', 1)
    store.team[0]!.agentId = 'A'
    store.team[1]!.agentId = 'B'
    store.team[2]!.agentId = 'C'
    await nextTick()
    expect(store.getMechanicSetting('guarantee.stun', 0)).toBe(1)
    expect(store.getMechanicSetting('guarantee.fury', 0)).toBe(0)
    expect(store.getMechanicSetting('guarantee.ultimate', 0)).toBe(1)
    vi.doUnmock('@/data/stunAxisPresets')
  })

  it('独立场景模型（createConfigModel）不挂该效果', async () => {
    const { cfg, catalog } = await setup()
    const model = cfg.createConfigModel(catalog)
    model.team.value[0]!.agentId = 'A'
    model.team.value[1]!.agentId = 'B'
    model.team.value[2]!.agentId = 'C'
    await nextTick()
    expect(model.getMechanicSetting('guarantee.stun', 0)).toBe(0)
    vi.doUnmock('@/data/stunAxisPresets')
  })
})
