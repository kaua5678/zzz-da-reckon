/**
 * CC-285：角色模块不得往 cfg 写「无人读」的键。
 *
 * 为什么：模块在物化钩子里写 cfg（`record.X = …` / `(cfg as any).X = …`）若没有任何读者，就是死写——
 * 它不改结果，却让 `materializeRows` 的快照/恢复每次都走「新增键」慢分支（rowBuild.ts 注释：13 个模块
 * 每轮新增键占 materializeRows 自耗时 ~1/3），还让读代码的人误以为有下游消费者。
 * CC-285 前有 9 个这样的键（lucyCheer / lucyBoarCount / lighterMorale / lighterFlameShockCount / rinaBangboo /
 * yaojiayinTremolo / anbyBasicChargedHits / anbyBasicHitTotal / nangongBeatTotal）——结果对象里另有同名字段，
 * 真正的读者读的是 `result.X`。
 *
 * 读的判定（宽口径，宁放过不误报）：src 下任一 ts / vue / json（不含测试）出现 `.X`（其后不是赋值）
 * 或字符串 `'X'` / `"X"`（spec json 的 countField、方括号访问）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..')
const AGENTS = join(SRC, 'mechanics', 'agents')
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p, out) }
    else if (/\.(ts|vue|json)$/.test(n) && !/\.(test|d)\.ts$/.test(n)) out.push(p)
  }
  return out
}
const WRITE = /(?:\(cfg as any\)|\(cfg as unknown as Record<string, unknown>\)|\brecord|\bcfg)\.(\w+)\s*(?:=(?!=)|\+=)/g

describe('cfg write-only keys in agent modules (CC-285)', () => {
  it('每个写入 cfg 的键都有读者', () => {
    const files = walk(SRC)
    const texts = files.map(f => readFileSync(f, 'utf8'))
    const writes = new Map<string, string>()
    for (const n of readdirSync(AGENTS)) {
      if (!n.endsWith('.ts')) continue
      const lines = readFileSync(join(AGENTS, n), 'utf8').split('\n')
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*)/.test(l)) return
        for (const m of l.matchAll(WRITE)) if (!writes.has(m[1]!)) writes.set(m[1]!, `mechanics/agents/${n}:${i + 1}`)
      })
    }
    expect(writes.size).toBeGreaterThan(50)
    const orphans: string[] = []
    for (const [k, at] of writes) {
      const read = new RegExp(`\\.${k}\\b(?!\\s*(?:=(?!=)|\\+=))|['"]${k}['"]`)
      if (!texts.some(t => read.test(t))) orphans.push(`${k} @ ${at}`)
    }
    expect(orphans, `只写不读的 cfg 键（删掉写入；若确有读者，检查读法是否被本扫描识别）：\n${orphans.join('\n')}`).toEqual([])
  })
})
