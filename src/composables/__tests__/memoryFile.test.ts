/**
 * 用户记忆文件 · 格式判据（`composables/memoryFile.ts`）。
 *
 * 覆盖用户点名要的四件事：
 *  ① **往返幂等**：导出 → 导入 → 逐字节相同（含 `undefined`/`Infinity`/`NaN` 边界——
 *     JSON 表达不了它们，`JSON.stringify` 会写成 `null` 或直接丢键 ⇒ 净化必须显式剔除，
 *     否则同一份记忆两次导入结果不同。同族坑见 `analysisScenario#cloneConfigState` 头注释）。
 *  ② **损坏/缺版本号可见报错**（不是静默回落——静默回落会让用户以为记忆丢了）。
 *  ③ **迁移**：旧版本文件必须能读回；高版本必须明确拒绝而不是猜。
 *  ④ **队伍身份 = 成员 id 集合、顺序无关**（用户裁决；与 `teamPresets.test.ts` 既有口径一致）。
 */
import { describe, expect, it } from 'vitest'
import {
  MEMORY_SCHEMA_VERSION,
  canonicalMemory,
  createEmptyMemory,
  memorySummary,
  parseMemory,
  serializeMemory,
  teamKeyOf,
  teamLabelOf,
  type MemoryFile,
} from '@/composables/memoryFile'

const sample = (): MemoryFile => ({
  schemaVersion: MEMORY_SCHEMA_VERSION,
  savedAt: '2026-10-09T12:00:00.000Z',
  global: { teammateBuffs: { 'rina.core_pen_ratio': { coverage: 30 } } },
  teams: {
    '1081+1211': {
      label: '雅 / 丽娜',
      teammateBuffs: { 'rina.core_pen_ratio': { enabled: false }, 'rina.cinema_6.electric_damage_bonus': { enabled: true, coverage: 50 } },
    },
  },
})

describe('memoryFile · 往返幂等', () => {
  it('导出 → 导入 → 再导出：逐字节相同', () => {
    const first = serializeMemory(sample())
    const parsed = parseMemory(first)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(serializeMemory(parsed.file)).toBe(first)
    // 第三轮：再导入再导出仍相同（幂等，不是「第一次碰巧」）
    const again = parseMemory(serializeMemory(parsed.file))
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(serializeMemory(again.file)).toBe(first)
  })

  it('JSON 表达不了的边界值被显式剔除，不留 null 让两次导入分叉', () => {
    const dirty = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      savedAt: 'x',
      global: { teammateBuffs: { a: { coverage: Number.NaN }, b: { coverage: Number.POSITIVE_INFINITY }, c: { enabled: undefined } } },
      teams: {},
    }
    const parsed = parseMemory(dirty)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // NaN / Infinity 的覆盖率被丢弃；enabled: undefined 让该条整条消失（无有效字段）
    expect(parsed.file.global.teammateBuffs).toEqual({})
    // 幂等：再走一轮导出→导入，字节不变（NaN/Infinity 没有被「洗」成 null 或 0）
    const second = parseMemory(serializeMemory(parsed.file))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(serializeMemory(second.file)).toBe(serializeMemory(parsed.file))
  })

  it('覆盖率钳到 0..100（与 store 的钳位口径同源）', () => {
    const parsed = parseMemory({ ...sample(), global: { teammateBuffs: { a: { coverage: 999 }, b: { coverage: -5 } } } })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.global.teammateBuffs.a.coverage).toBe(100)
    expect(parsed.file.global.teammateBuffs.b.coverage).toBe(0)
  })

  it('空队伍记忆（无信息量）不落盘：文件里不留空壳', () => {
    const file = canonicalMemory({
      ...sample(),
      teams: { '1081': { label: '雅', teammateBuffs: {} }, '1081+1211': sample().teams['1081+1211'] },
    })
    expect(Object.keys(file.teams)).toEqual(['1081+1211'])
  })
})

describe('memoryFile · 损坏与版本（可见报错）', () => {
  it('非 JSON / 非对象 / 缺 schemaVersion / 高版本 ⇒ 全部 ok:false 且带人话原因', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['{not json', /不是合法 JSON/],
      ['[1,2,3]', /顶层不是对象/],
      ['"字符串"', /顶层不是对象/],
      [JSON.stringify({ savedAt: 'x', global: {}, teams: {} }), /schemaVersion/],
      [JSON.stringify({ schemaVersion: 0 }), /schemaVersion/],
      [JSON.stringify({ schemaVersion: 1.5 }), /schemaVersion/],
      [JSON.stringify({ schemaVersion: MEMORY_SCHEMA_VERSION + 1 }), /高于本程序支持/],
    ]
    for (const [input, re] of cases) {
      const r = parseMemory(input)
      expect(r.ok, String(input)).toBe(false)
      if (!r.ok) expect(r.error, String(input)).toMatch(re)
    }
  })

  it('旧版本文件能读回（迁移链；当前 v1 为首版 ⇒ 同版直读且 migratedFrom=null）', () => {
    const r = parseMemory(serializeMemory(sample()))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.migratedFrom).toBeNull()
  })

  it('出厂记忆 = 全为「不修改」：两层都空', () => {
    const empty = createEmptyMemory('2026-10-09T00:00:00.000Z')
    expect(memorySummary(empty)).toEqual({ globalEntries: 0, teams: 0, teamEntries: 0 })
    expect(parseMemory(serializeMemory(empty)).ok).toBe(true)
  })
})

describe('memoryFile · 队伍身份', () => {
  it('成员 id 集合，顺序无关（换位仍是同一支队伍）', () => {
    const a = teamKeyOf([{ agentId: '1081' }, { agentId: '1211' }, { agentId: '1041' }])
    const b = teamKeyOf([{ agentId: '1041' }, { agentId: '1081' }, { agentId: '1211' }])
    expect(a).toBe(b)
    expect(a).toBe('1041+1081+1211')
  })

  it('空槽被忽略；空队伍 = 空串', () => {
    expect(teamKeyOf([{ agentId: '' }, { agentId: '1081' }, {}])).toBe('1081')
    expect(teamKeyOf([{ agentId: '' }, {}, {}])).toBe('')
  })

  it('重复成员只算一次（同一角色不该出现两次，但数据脏了也不该造出两个身份）', () => {
    expect(teamKeyOf([{ agentId: '1081' }, { agentId: '1081' }])).toBe('1081')
  })

  it('展示名按身份键顺序拼成员名', () => {
    const name = (id: string) => ({ '1081': '雅', '1211': '丽娜' })[id] ?? id
    expect(teamLabelOf([{ agentId: '1211' }, { agentId: '1081' }], name)).toBe('雅 / 丽娜')
  })
})
