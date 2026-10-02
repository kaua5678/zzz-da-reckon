import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * r409（CC-383）：模块钩子里**不自找、不自证在队**。
 *
 * 派发器（`panelPhases.ts` 的 applyTeamConfig / collectNextRoundFeedback、异常池 teamMechanics 等）只对**在队**模块、
 * 按 `getAgentMechanic(cfg.agentId)` 取模块调用，并把**本人那份 `cfg` / `slot`** 递进去（CC-373 同一契约）。
 * 所以模块里 `characters.find(c => c.agentId === 本人ID)` 拿到的就是入参 `cfg`（同一对象），
 * `characters.some(c => c.agentId === 本人ID)` 恒为真——前者是冗余的第二条定位通道，后者是死判据。
 *
 * 锁：`mechanics/agents/*.ts` 中，对**裸变量 `characters`**（cfg 数组）按本文件 `agentIds: [...]` 声明的本人 ID
 * （常量名或字面量）做 find / findIndex / some / filter 的写法一律禁止。
 * r410 补：接收者含裸变量 `team`（ReadonlyTeam / 压缩 Agent 列表；teammateBuffGate 自 CC-384 起由派发器给 `self`），比较字段含 `.id` / `.agent?.id`；
 * `for (const c of characters) { if (c.agentId !== 本人ID) continue …` 循环跳过别人的变体（alice 漏网）同样禁止。
 * 不锁：`teamResult.characters` / `rr.characters` 等**结果行**集合（判「结果里有没有本人那行」是另一回事，
 * 见 lighter / anbyZero 的 nextRoundFeedback）；对**队友** ID 的查询。
 */
const AGENTS_DIR = join(__dirname, '..', 'agents')
const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function selfIds(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/agentIds:\s*\[([^\]]*)\]/g)) {
    for (const tok of m[1].split(',').map(t => t.trim()).filter(Boolean)) {
      out.push(tok)
      const lit = /^['"](\d+)['"]$/.exec(tok)
      if (!lit) {
        const decl = new RegExp(`const\\s+${tok}\\s*=\\s*['"](\\d+)['"]`).exec(src)
        if (decl) out.push(`'${decl[1]}'`, `"${decl[1]}"`)
      }
    }
  }
  return out
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('r409 CC-383：模块钩子不在 characters 里自找 / 自证在队', () => {
  const scanned = files.map(f => {
    const raw = readFileSync(join(AGENTS_DIR, f), 'utf-8')
    return { f, src: stripComments(raw), ids: selfIds(raw) }
  }).filter(x => x.ids.length > 0)

  it('扫描面非空（防目录改名 / agentIds 写法变化后全绿）', () => {
    expect(scanned.length).toBeGreaterThanOrEqual(40)
  })

  it('零命中（违规列出 文件 + 片段；本人 = 派发器给的 cfg）', () => {
    const hits: string[] = []
    for (const { f, src, ids } of scanned) {
      const alt = ids.map(esc).join('|')
      const rx = new RegExp(
        `(?<![.\\w])(?:characters|team)\\.(?:find|findIndex|some|filter)\\(\\s*\\(?\\s*\\w+\\s*\\)?\\s*=>\\s*\\w+(?:\\??\\.agent)?\\??\\.(?:agentId|id)\\s*===\\s*(?:${alt})(?![\\w'"])`,
        'g',
      )
      for (const m of src.matchAll(rx)) hits.push(`${f}: ${m[0]}`)
      const loop = new RegExp(
        `for\\s*\\(\\s*const\\s+(\\w+)\\s+of\\s+characters\\s*\\)\\s*\\{\\s*if\\s*\\(\\s*\\1\\.agentId\\s*!==\\s*(?:${alt})(?![\\w'"])`,
        'g',
      )
      for (const m of src.matchAll(loop)) hits.push(`${f}: ${m[0]}`)
    }
    expect(hits).toEqual([])
  })
})
