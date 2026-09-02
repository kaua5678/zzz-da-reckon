/**
 * 从 nanoka 原文抽「倍率融合组」，供 src/data/moveFusions.ts 复用（只读诊断，不写 catalog）。
 *
 * 判据（用户 2026-09）：full/<id>.json 的 skill.<类>.description[].param[].desc 用
 * `{{Skill:A, Prop:1001} + {Skill:B, Prop:1001}*3}` 编码「哪些段属于同一次动作」。
 *   - 同一 param 内多个 {Skill} 相加 = 倍率融合（一次动作拆多段，求和）。
 *   - 同一招式名下多个 param（如星见雅飞雪「斩击」vs「追击」）= 多个独立动作，不能混加。
 *
 * 用法：node scripts/extract-move-fusions.mjs
 * 输出：控制台打印按 moveId 主段分组的融合组（damage/daze 同名组去重）。
 * 注意：需人工核对——本脚本不判「模块已显式建模」的双计风险；只收未由模块 emit 兄弟段的组。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../data/raw/nanoka_missing/full/', import.meta.url).pathname

/** 解析 `{Skill:1091009, Prop:1001}*3` 序列为 [{moveId, count}] */
function parseTerms(desc) {
  const re = /\{Skill:(\d+)[^}]*\}(?:\*(\d+))?/g
  const terms = []
  let m
  while ((m = re.exec(desc)) !== null) {
    terms.push({ moveId: m[1], count: m[2] ? parseInt(m[2], 10) : 1 })
  }
  return terms
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const groups = []
for (const f of files) {
  const agentId = f.replace('.json', '')
  const d = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  for (const cat of ['basic', 'dodge', 'special', 'chain', 'assist']) {
    const desc = d.skill?.[cat]?.description
    if (!Array.isArray(desc)) continue
    for (const it of desc) {
      if (!it || !Array.isArray(it.param)) continue
      for (const p of it.param) {
        if (!p || typeof p.desc !== 'string') continue
        const terms = parseTerms(p.desc)
        if (terms.length < 2) continue
        groups.push({ agentId, cat, skill: it.name, param: p.name, terms })
      }
    }
  }
}

// damage/daze 是同一 move 组（Prop:1001/1002），按 terms 签名去重
const seen = new Map()
for (const g of groups) {
  const key = g.terms.map((t) => `${t.moveId}:${t.count}`).join('+')
  if (!seen.has(key)) {
    seen.set(key, { ...g, params: [g.param] })
  } else if (!seen.get(key).params.includes(g.param)) {
    seen.get(key).params.push(g.param)
  }
}

console.log('// 融合组（主段 moveId → terms），需人工核对模块双计风险')
for (const [, g] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(
    `// ${g.agentId} ${g.cat} ${g.skill} (${g.params.join('/')})`,
  )
  console.log(
    `  moveId: '${g.terms[0].moveId}', terms: [${g.terms.map((t) => `{ moveId: '${t.moveId}', count: ${t.count} }`).join(', ')}],`,
  )
}
console.log(`// 共 ${seen.size} 组`)
