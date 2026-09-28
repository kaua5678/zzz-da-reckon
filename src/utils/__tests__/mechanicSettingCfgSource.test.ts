/**
 * CC-235 源码锁：机制设置「引擎写 cfg、模块读」的键格式只在 `utils/mechanicSettingCfg.ts` 定义。
 *
 * 此前 `setting:${id}` 与读取 helper 在 30 多个角色模块各抄一份，语义有 4 种变体。
 * 新代码请用 `mechanicSettingCfgKey(id)`（写/取键）或 `cfgMechanicSetting(cfg, id, fallback)`（读值）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cfgMechanicSetting, mechanicSettingCfgKey } from '../mechanicSettingCfg'

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
  it('除 utils/mechanicSettingCfg.ts 外，非测试源码不出现 `setting:${` 模板字面量', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p).split('\\').join('/')
      if (rel === OWNER) continue
      readFileSync(p, 'utf-8').split('\n').forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        if (line.includes('`setting:${')) hits.push(`${rel}:${i + 1}`)
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
})
