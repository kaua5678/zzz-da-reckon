/**
 * CC-274：源码里的招式 / 音擎 / 角色 id 字面量必须存在于 catalog（数据侧兜住改号 / 笔误）。
 * 背景：`findMoveById(skills, '<字面量>')` / `exec.moveId === '<字面量>'` 查不到时静默返回 null / false，
 * 模块就不产行、不加成，也不报错（CC-269 / CC-273 同类「静默回落」）。第 289 轮全量扫描：招式 869 处、音擎 27 处、角色 365 处字面量全部存在（驱动盘套装 id 字面量为 0，不设例）。
 * 扫描范围：mechanics / specs / data / composables / core / logicEditor / views / components / stores / utils 下的 .ts/.json/.vue（跳过 __tests__、teamPresets、
 * golden baseline、注释行）。只认 7 位 1 开头的带引号字面量（= catalog moveId 形态）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const catalog = JSON.parse(readFileSync(join(ROOT, 'public/static/catalog.json'), 'utf8'))
const MOVE_IDS = new Set<string>()
for (const s of catalog.agentSkills ?? []) for (const c of s.categories ?? []) for (const m of c.moves ?? []) MOVE_IDS.add(String(m.id))
const WENGINE_IDS = new Set<string>()
for (const w of catalog.wEngines ?? []) for (const id of [w.id, ...(w.legacyIds ?? [])]) WENGINE_IDS.add(String(id))
const AGENT_IDS = new Set<string>((catalog.agents ?? []).map((a: { id: string }) => String(a.id)))

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === '__tests__' || f === 'teamPresets') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|json|vue)$/.test(f) && !f.includes('.baseline.')) out.push(p)
  }
  return out
}

const DIRS = ['mechanics', 'specs', 'data', 'composables', 'core', 'logicEditor', 'views', 'components', 'stores', 'utils']
const FILES = DIRS.map(d => join(ROOT, 'src', d)).flatMap(d => { try { return walk(d) } catch { return [] } })

/** 扫描带引号字面量；返回 [字面量总数, 悬空清单] */
function scan(pattern: RegExp, known: Set<string>): [number, string[]] {
  const missing: string[] = []
  let total = 0
  for (const file of FILES) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      for (const m of line.matchAll(pattern)) {
        total++
        if (!known.has(m[1])) missing.push(`${relative(ROOT, file)}:${i + 1} ${m[1]}`)
      }
    })
  }
  return [total, missing]
}

describe('CC-274 源码 id 字面量全部存在于 catalog', () => {
  it('招式 moveId（7 位）', () => {
    const [total, missing] = scan(/['"](1\d{6})['"]/g, MOVE_IDS)
    expect(MOVE_IDS.size).toBeGreaterThan(1000)
    expect(total, '扫描器失效（字面量数骤降）').toBeGreaterThan(500)
    expect(missing).toEqual([])
  })

  it('音擎 id（13xxx / 14xxx，含 legacyIds）', () => {
    const [total, missing] = scan(/['"](1[34]\d{3})['"]/g, WENGINE_IDS)
    expect(total).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })

  it('角色 id（1xx1）', () => {
    const [total, missing] = scan(/['"](1[0-6]\d1)['"]/g, AGENT_IDS)
    expect(total).toBeGreaterThan(100)
    expect(missing).toEqual([])
  })
})
