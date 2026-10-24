/**
 * beta 快照纯函数判据（scripts/lib/beta-snapshot.mjs；CLI 见 scripts/snapshot-agent.mjs）。
 *
 * 核心断言面：id/名字/ownerAgentId 改写逐位正确、legacyIds 必删（wEnginesMap legacy 兜底会被
 * beta 副本劫持）、agentId 字面量整串替换不误伤更长数字（moveId 空间）、spec 加 beta 标记与
 * 出处 note、betaFile 合并幂等（同 betaId 重跑 = 整组替换）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BETA_TAG_RE,
  findModuleFile,
  mergeBetaFile,
  rewriteAgentSlice,
  rewriteModuleSource,
  rewriteSpec,
  sliceCatalogFor,
} from '../../../scripts/lib/beta-snapshot.mjs'

const catalogData = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))

describe('sliceCatalogFor', () => {
  it('切出 agent + skills + 专武（ownerAgentId 命中）；未知角色返回 null', () => {
    const slice = sliceCatalogFor(catalogData, '1091')!
    expect(slice.agent.id).toBe('1091')
    expect(slice.skills?.agentId).toBe('1091')
    expect(slice.engines.length).toBeGreaterThanOrEqual(1) // 霰落星殿 14109
    expect(sliceCatalogFor(catalogData, '9999')).toBeNull()
  })
})

describe('rewriteAgentSlice', () => {
  const slice = sliceCatalogFor(catalogData, '1091')
  const meta = { agentId: '1091', betaId: '1091v1', tag: 'v1', sourceVersion: 't', gitTag: 'g', createdAt: '2026-10-24T00:00:00Z' }
  const entries = rewriteAgentSlice(slice, '1091', 'v1', meta)

  it('id/agentId/ownerAgentId 全改写，名字带版本后缀，hidden 清除', () => {
    expect(entries.agent.id).toBe('1091v1')
    expect(entries.agent.name.zhCN).toContain('v1')
    expect(entries.agent.hidden).toBeUndefined()
    expect(entries.skills!.id).toBe('1091v1')
    expect(entries.skills!.agentId).toBe('1091v1')
    for (const w of entries.engines) {
      expect(w.id).toMatch(/^14109v1$/)
      expect(w.ownerAgentId).toBe('1091v1')
    }
  })

  it('专武副本删 legacyIds（防 wEnginesMap legacy 兜底被劫持），深拷贝不动正主', () => {
    for (const w of entries.engines) expect(w.legacyIds).toBeUndefined()
    expect(slice!.agent.id).toBe('1091') // 入参未被改写
    expect(slice!.engines[0].id).toBe('14109')
  })
})

describe('rewriteModuleSource', () => {
  it("整串引号替换，不误伤更长数字（moveId 空间），三种引号形态都吃", () => {
    const src = [
      "const agentIds = ['1091']",
      "if (cfg.agentId === \"1091\") x()",
      'const ref = `1091`',
      "const moveId = '1091507'", // 含 1091 子串但不是整串 —— 必须原样保留
      "const other = '1092'",
    ].join('\n')
    const out = rewriteModuleSource(src, '1091', '1091v1')
    expect(out.replacements).toBe(3)
    expect(out.source).toContain("['1091v1']")
    expect(out.source).toContain(`"1091v1"`)
    expect(out.source).toContain('`1091v1`')
    expect(out.source).toContain("'1091507'")
    expect(out.source).not.toContain("'1092v1'")
  })

  it('零替换计数可作「找错文件」判据', () => {
    expect(rewriteModuleSource('const x = 1', '1091', '1091v1').replacements).toBe(0)
  })
})

describe('findModuleFile / rewriteSpec / mergeBetaFile', () => {
  it('按整串字面量定位模块；spec 加 beta 标记 + 出处；合并幂等', () => {
    const files = [
      { path: 'miyabi.ts', content: "export const m = { agentIds: ['1091'] }" },
      { path: 'other.ts', content: "export const o = { agentIds: ['1011'] }" },
    ]
    expect(findModuleFile(files, '1091')).toEqual(['miyabi.ts'])

    const spec = { schemaVersion: 1, id: 'agent:1091', name: '雅', agentIds: ['1091'], status: 'implemented_approximation', notes: ['旧 note'] }
    const out = rewriteSpec(spec, '1091', 'v1', 'beta 冻结：源 xxx')
    expect(out.id).toBe('agent:1091v1')
    expect(out.agentIds).toEqual(['1091v1'])
    expect(out.beta).toBe(true)
    expect(out.notes.at(-1)).toBe('beta 冻结：源 xxx')
    expect(spec.agentIds).toEqual(['1091']) // 入参不动
    expect(BETA_TAG_RE.test('v1')).toBe(true)
    expect(BETA_TAG_RE.test('x1')).toBe(false)

    const slice = sliceCatalogFor(catalogData, '1091')
    const meta = { agentId: '1091', betaId: '1091v1', tag: 'v1', sourceVersion: 't', gitTag: 'g', createdAt: 'c' }
    const entries = rewriteAgentSlice(slice, '1091', 'v1', meta)
    const file1 = mergeBetaFile(null, entries, meta)
    expect(file1.agents).toHaveLength(1)
    expect(file1.snapshots).toHaveLength(1)
    const file2 = mergeBetaFile(file1, entries, meta) // 同 betaId 重跑
    expect(file2.agents).toHaveLength(1) // 整组替换，不重复堆叠
    expect(file2.snapshots).toHaveLength(1)
  })
})
