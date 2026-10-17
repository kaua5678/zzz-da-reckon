/**
 * 分析工作台 · 预设模型/存储测试
 *
 * localStorage 的内容是外部输入（旧 schema / 手改 / 损坏）⇒ 读取必须**静默丢弃坏条目**，
 * 但保存失败必须让页面知道（返回 null），不能假装存进去了。
 */
import { describe, expect, it } from 'vitest'
import {
  deleteUserPreset,
  isUserPreset,
  loadUserPresets,
  newUserPresetId,
  sanitizePreset,
  saveUserPreset,
  type PresetStorage,
  type WorkbenchPreset,
} from '@/composables/freeCompare/presets'

function memStorage(): PresetStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v) },
  }
}

const valid = (): WorkbenchPreset => ({
  id: 'user:seed',
  name: '测试预设',
  series: [{ agentId: '1171', code: '21' }],
  axisId: 'cinema',
  sliceKey: '',
  metricId: 'teamTotalDamage',
  cinemaMax: 6,
  setupCodesText: '01,11,21,20',
  bossId: '',
  buffChoice: 'none',
  mateA: '1561',
  mateB: '',
  autoBuild: false,
  conditions: [],
})

describe('预设净化（外部输入不炸页面）', () => {
  it('合法预设原样返回（含 note/view）', () => {
    const raw = { ...valid(), note: '看命座', view: 'grid' }
    expect(sanitizePreset(raw)).toEqual({ ...valid(), note: '看命座', view: 'grid' })
  })

  it('★ 缺 id/name/系列、非法轴/指标/切片编码 ⇒ null（不把半条预设塞进下拉）', () => {
    expect(sanitizePreset({ ...valid(), id: '' })).toBeNull()
    expect(sanitizePreset({ ...valid(), name: '  ' })).toBeNull()
    expect(sanitizePreset({ ...valid(), series: [] })).toBeNull()
    expect(sanitizePreset({ ...valid(), series: [{ agentId: '1171', code: '2' }] })).toBeNull()
    expect(sanitizePreset({ ...valid(), axisId: 'nope' })).toBeNull()
    expect(sanitizePreset({ ...valid(), metricId: 'nope' })).toBeNull()
    expect(sanitizePreset({ ...valid(), sliceKey: 'axis:nope' })).toBeNull()
  })

  it('★ 越界值夹紧、坏条目过滤；未知视角丢弃（不让旧预设带崩视图切换）', () => {
    const raw = {
      ...valid(),
      cinemaMax: 99,
      conditions: [{ agentId: '1561', cinema: 99 }, { cinema: 1 }, { agentId: '' }],
      view: 'nope',
    }
    const clean = sanitizePreset(raw)!
    expect(clean.cinemaMax).toBe(6)
    expect(clean.conditions).toEqual([{ agentId: '1561', cinema: 6 }])
    expect(clean.view).toBeUndefined()
    expect(sanitizePreset({ ...valid(), view: 'delta' })?.view).toBe('delta')
  })
})

describe('用户预设存储', () => {
  it('保存 → 读取 → 覆盖（同 id 不重复） → 删除', () => {
    const s = memStorage()
    expect(saveUserPreset(valid(), s)?.length).toBe(1)
    const loaded = loadUserPresets(s)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].name).toBe('测试预设')

    const renamed = { ...valid(), name: '改名了' }
    expect(saveUserPreset(renamed, s)?.length).toBe(1)
    expect(loadUserPresets(s)[0].name).toBe('改名了')

    expect(deleteUserPreset(valid().id, s)).toEqual([])
    expect(loadUserPresets(s)).toEqual([])
  })

  it('★ 损坏 JSON / 旧 schema / 非法条目：读取回落空/跳过，不抛', () => {
    const broken = memStorage()
    broken.setItem('zzz-analysis-presets-v1', '{')
    expect(loadUserPresets(broken)).toEqual([])

    const old = memStorage()
    old.setItem('zzz-analysis-presets-v1', JSON.stringify({ version: 2, presets: [valid()] }))
    expect(loadUserPresets(old)).toEqual([])

    const mixed = memStorage()
    mixed.setItem('zzz-analysis-presets-v1', JSON.stringify({
      version: 1,
      presets: [valid(), { id: 'user:bad', name: 'bad', series: [] }, valid()],
    }))
    expect(loadUserPresets(mixed).map(p => p.id)).toEqual(['user:seed'])
  })

  it('上限 50：继续保存丢最早的一条', () => {
    const s = memStorage()
    for (let i = 0; i < 52; i++) {
      saveUserPreset({ ...valid(), id: 'user:p' + i, name: 'p' + i }, s)
    }
    const loaded = loadUserPresets(s)
    expect(loaded).toHaveLength(50)
    expect(loaded[0].id).toBe('user:p2')
    expect(loaded[49].id).toBe('user:p51')
  })

  it('★ 写失败（quota/隐私模式）返回 null，不谎报保存成功', () => {
    const s: PresetStorage = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(saveUserPreset(valid(), s)).toBeNull()
  })

  it('id 生成/识别：用户预设 user: 前缀，内置 builtin: 不误删', () => {
    expect(isUserPreset('user:abc')).toBe(true)
    expect(isUserPreset('builtin:character')).toBe(false)
    const id = newUserPresetId(123)
    expect(id.startsWith('user:')).toBe(true)
  })
})
