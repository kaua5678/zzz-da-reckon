/**
 * CC-235 源码锁：机制设置「引擎写 cfg、模块读」的键格式只在 `utils/mechanicSettingCfg.ts` 定义。
 *
 * 此前 `setting:${id}` 与读取 helper 在 30 多个角色模块各抄一份，语义有 4 种变体。
 * 新代码请用 `mechanicSettingCfgKey(id)`（写/取键）或 `cfgMechanicSetting(cfg, id, fallback)`（读值）。
 *
 * CC-363（r393）：原锁只认模板字面量 `` `setting:${` ``，带引号的硬编码键 `'setting:<id>'` 漏网——
 * 11 个模块 24 处绕过 helper 直接 `(cfg as any)['setting:…']` / `record['setting:…']`。已全部改走
 * `cfgMechanicSettingRaw(cfg, id)`（原始值，外层 `Number(… ?? d)` 原样保留 ⇒ 零差），并把引号字面量也锁上。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cfgMechanicSetting, cfgMechanicSettingRaw, mechanicSettingCfgKey, mechanicSettingPanelReader, mechanicSettingReader } from '../mechanicSettingCfg'

const SRC = resolve(__dirname, '../..')
const OWNER = 'utils/mechanicSettingCfg.ts'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') walk(p, out)
    } else if (/\.(ts|vue)$/.test(name) && !/\.(test|d)\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('CC-235 机制设置 cfg 键单一来源', () => {
  it('除 utils/mechanicSettingCfg.ts 外，非测试源码不出现 `setting:${` 模板字面量或 \'setting:…\' 引号字面量', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).split('\\').join('/')
      if (rel === OWNER) continue
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        if (line.includes('`setting:${') || /['"]setting:/.test(line)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('读值语义：数字直用；null/undefined 取 fallback；可转数字的按 Number；非有限取 fallback', () => {
    const key = mechanicSettingCfgKey('x.y')
    expect(key).toBe('setting:x.y')
    expect(cfgMechanicSetting({ [key]: 0 }, 'x.y', 5)).toBe(0)
    expect(cfgMechanicSetting({ [key]: 0.3 }, 'x.y', 5)).toBe(0.3)
    expect(cfgMechanicSetting({}, 'x.y', 5)).toBe(5)
    expect(cfgMechanicSetting({ [key]: null }, 'x.y', 5)).toBe(5)
    expect(cfgMechanicSetting({ [key]: '2' }, 'x.y', 5)).toBe(2)
    expect(cfgMechanicSetting({ [key]: NaN }, 'x.y', 5)).toBe(5)
    expect(cfgMechanicSetting({ [key]: 'abc' }, 'x.y', 5)).toBe(5)
    expect(cfgMechanicSetting(undefined, 'x.y', 5)).toBe(5)
  })

  it('cfgMechanicSettingRaw 返回原始值、不转换（字符串轴值兼容）', () => {
    const key = mechanicSettingCfgKey('x.y')
    expect(cfgMechanicSettingRaw({ [key]: 0.3 }, 'x.y')).toBe(0.3)
    expect(cfgMechanicSettingRaw({ [key]: 'full' }, 'x.y')).toBe('full')
    expect(cfgMechanicSettingRaw({}, 'x.y')).toBeUndefined()
    expect(cfgMechanicSettingRaw(undefined, 'x.y')).toBeUndefined()
  })

  it('CC-508 reader：未给 fallback 时取模块 settings 声明的 default；显式 fallback 覆盖；未声明且无 fallback 抛错', () => {
    const key = mechanicSettingCfgKey('x.y')
    const read = mechanicSettingReader(() => [{ id: 'x.y', default: 7 }])
    expect(read({}, 'x.y')).toBe(7)
    expect(read({ [key]: 0 }, 'x.y')).toBe(0)
    expect(read({ [key]: null }, 'x.y')).toBe(7)
    expect(read({}, 'x.y', 3)).toBe(3)
    expect(read({}, 'x.z', 3)).toBe(3)
    expect(() => read({}, 'x.z')).toThrow(/x\.z/)
    // 惰性：声明在 reader 构造之后才可用也行（模块常量在文件底部）
    let late: Array<{ id: string; default: number }> | undefined
    const lazy = mechanicSettingReader(() => late)
    late = [{ id: 'a.b', default: 2 }]
    expect(lazy({}, 'a.b')).toBe(2)
  })

  it('CC-508b panel reader：记录读口同样以声明 default 为准；显式 fallback 覆盖；未声明抛错', () => {
    const read = mechanicSettingPanelReader(() => [{ id: 'x.y', default: 0.5 }])
    expect(read({}, 'x.y')).toBe(0.5)
    expect(read({ 'x.y': 0 }, 'x.y')).toBe(0)
    expect(read({ 'x.y': NaN }, 'x.y')).toBe(0.5)
    expect(read(undefined, 'x.y', 2)).toBe(2)
    expect(() => read({}, 'x.z')).toThrow(/x\.z/)
  })

  it('CC-508/510 源码锁：mechanics/agents 内不再手抄「带点 id + 字面量/常量 fallback」的机制设置读法（调用形与裸索引形；默认值只在 settings 声明）', () => {
    const AGENTS = resolve(SRC, 'mechanics/agents')
    // 调用形（CC-508/508b）：reader(x, 'a.b', <数字>)；裸索引形（CC-510）：settings['a.b'] ?? <数字|常量>
    const re = /\b(?:setting|cfgNum|cfgSetting|readSetting|cfgMechanicSetting|settingOf|mechanicSettingOf)\(\s*\w+,\s*'\w+\.\w+',\s*-?[0-9.]+\s*\)|\b(?:settings|settingsMap|values)\??\.?\['\w+\.\w+'\]\s*\?\?\s*(?:-?[0-9.]+|[A-Z_][A-Z0-9_]*)\b/
    const hits: string[] = []
    for (const p of walk(AGENTS)) {
      if (!p.endsWith('.ts') || p.includes('__tests__')) continue
      const rel = relative(SRC, p).split('\\').join('/')
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
        if (/^\s*(\*|\/\*)/.test(code)) return
        if (re.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})
