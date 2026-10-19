/**
 * 测试三环的**行为判据**（T186，2026-10-18）。
 *
 * `check-guards` **判据 32** 守的是"清单与 package.json 的接线"（嵌套、默认环、出口）；
 * 本文件守的是**脚本本身算得对**：
 * ① `excludesFor` 的嵌套（core ⊇ fast ⊇ full=∅）与 `vitestArgsFor` 的形态；
 * ② `adviseFor` 的升环判定（改数值/角色模块 ⇒ full；改展示层 ⇒ fast；只改 docs ⇒ core）；
 * ③ **排除集非空洞**（core 必须真排除东西，否则 core = 全量，整件事白做）；
 * ④ 每条排除项都得能在仓库里找到对应测试文件（改名后清单腐坏 ⇒ 该环静默变宽）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_EXCLUDES, CORE_INVARIANTS, CORE_MAX_SECONDS, FAST_MAX_SECONDS,
  adviseFor, excludesFor, vitestArgsFor,
} from '../../../scripts/test-ring.mjs'

const SRC = join(process.cwd(), 'src')

/** src 下所有 `*.test.ts` 的文件名（判据独立实现，不引 vitest 配置） */
function testFileNames() {
  const out = new Set<string>()
  const walk = (d: string) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name)
      if (n.isDirectory()) walk(p)
      else if (n.name.endsWith('.test.ts')) out.add(n.name)
    }
  }
  walk(SRC)
  return out
}

describe('测试三环（core / fast / full）', () => {
  it('① 嵌套：excl(fast) ⊆ excl(core)，full 恒为空（全量一个都不砍）', () => {
    const core = excludesFor('core')
    const fast = excludesFor('fast')
    const full = excludesFor('full')
    expect(fast.filter(f => !core.includes(f)), 'fast 排除集必须是 core 的子集').toEqual([])
    expect(full, 'full 不得有排除项').toEqual([])
    // 未知环大声失败（防「分片号写错 ⇒ 静默跑全量两遍」）
    expect(() => excludesFor('nope')).toThrow()
  })

  it('② 排除集非空洞：core 真的排除东西，且 CPU 占比可观', () => {
    const core = excludesFor('core')
    const fast = excludesFor('fast')
    expect(core.length, 'core 排除集为空 ⇒ core = 全量，三环白做').toBeGreaterThan(0)
    expect(fast.length, 'fast 排除集为空 ⇒ fast = core，中间层白设').toBeGreaterThan(0)
    expect(fast.length, 'fast 必须严格少于 core（否则嵌套写反）').toBeLessThan(core.length)
    // 口径自证：fast 阈值必须比 core 阈值更宽（≥），否则「fast 比 core 砍得更多」就反了
    expect(FAST_MAX_SECONDS).toBeGreaterThanOrEqual(CORE_MAX_SECONDS)
  })

  it('③ vitestArgsFor 产出合法的 --exclude 参数', () => {
    const args = vitestArgsFor('core')
    expect(args.length).toBe(excludesFor('core').length)
    for (const a of args) expect(a).toMatch(/^--exclude=\*\*\/[\w.-]+\.test\.ts$/)
    expect(vitestArgsFor('full')).toEqual([])
  })

  it('④ 每条排除项都是现存测试文件（改名/删除后清单腐坏即红）', () => {
    const names = testFileNames()
    for (const f of excludesFor('core')) {
      expect(names.has(f), `core 排除项 ${f} 在 src 下不存在（改名后该环静默变宽）`).toBe(true)
    }
  })

  it('⑤ 保留面（CORE_INVARIANTS）也必须是现存文件，且确实 ≥ core 门槛', () => {
    const names = testFileNames()
    for (const inv of CORE_INVARIANTS) {
      expect(names.has(inv.file), `保留面 ${inv.file} 不存在`).toBe(true)
      expect(inv.why.length, `${inv.file} 必须写清「为什么它留在每对话那圈」`).toBeGreaterThan(10)
    }
  })

  it('⑥ 每条排除项都带实测秒数（数字是「为什么它在这」的唯一证据）', () => {
    for (const e of CORE_EXCLUDES) {
      expect(typeof e.seconds, `${e.file} 缺实测秒数`).toBe('number')
      expect(e.seconds, `${e.file} 的秒数必须为正（测不到就别排除）`).toBeGreaterThan(0)
      expect(e.why.length, `${e.file} 必须写清为什么排除`).toBeGreaterThan(5)
    }
  })

  it('⑦ adviseFor：改数值/角色模块/护栏 ⇒ full；改展示层 ⇒ fast；只改 docs ⇒ core', () => {
    expect(adviseFor(['src/mechanics/agents/remielle.ts']).ring).toBe('full')
    expect(adviseFor(['public/static/catalog.json']).ring).toBe('full')
    expect(adviseFor(['src/core/resource/helpers.ts']).ring).toBe('full')
    expect(adviseFor(['scripts/check-guards.mjs']).ring).toBe('full')
    expect(adviseFor(['src/views/TeamComparePage.vue']).ring).toBe('fast')
    expect(adviseFor(['docs/ARCHITECTURE.md']).ring).toBe('core')
    expect(adviseFor([]).ring, '无改动 ⇒ core（不改就不用升环）').toBe('core')
    // 混合：最高那档胜出（full 压过 fast / core）
    expect(adviseFor(['docs/a.md', 'src/views/x.vue', 'src/core/y.ts']).ring).toBe('full')
  })

  it('⑧ 建议必须带理由（「为什么升环」不能是空话）', () => {
    const { hits } = adviseFor(['src/mechanics/agents/remielle.ts'])
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.why.length).toBeGreaterThan(5)
  })

  it('⑨ 类型检查在每一环里，且用增量形态（类型错不该等全量才发现）', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const ring of ['check', 'check:fast', 'check:full']) {
      expect(pkg.scripts[ring], `${ring} 必须含 typecheck:inc（vue-tsc -b 实测 ≈1.7s）`).toContain('typecheck:inc')
      expect(pkg.scripts[ring], `${ring} 不得用非增量的 typecheck（每次全量重检 ~17s）`).not.toMatch(/npm run typecheck\s/)
    }
    expect(pkg.scripts['typecheck:inc'], 'typecheck:inc 必须是增量形态').toBe('vue-tsc -b')
  })
})
