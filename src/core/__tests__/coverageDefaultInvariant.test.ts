/**
 * R5 D20（`coverage`）数据前提钉：catalog 里所有 `coverage.default` 都是 1。
 *
 * 为什么钉：引擎有三处在「无用户记录」时**不读** `coverage.default`，而是直接当作 100%：
 *   - 驱动盘：`composables/resourceCalc/panelPhases.ts#mergeTeamDiscEffectCoverages` 用
 *     `discEffectCoverageOf`（`stores/selectionReads.ts`，无记录 = 100）覆盖每个 effect；
 *     界面侧 `stores/config.ts` getDiscEffectCoverage 同口径（默认 100）。
 *   - 队友 buff：`teammateBuffCoverageOf` 无记录 = 100。
 *   - 副词条优化：`core/substatOptimizer.ts#decomposeEffect` 对 `type: 'fixed'` 不乘覆盖率
 *     （`applyEffect` 会乘）。
 * 数据全为 1 时这三处与 `core/buff.ts#applyEffect` 的 `coverage.default` 回落等价（D20 结论）。
 * 若本测试失败（有人录入了 default ≠ 1）：先把上面三处改成回落到 `coverage.default`
 * （界面默认值同步），再放行数据；不要只改本测试。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as any

function collect(o: any, path: string, out: Array<[string, unknown]>): void {
  if (Array.isArray(o)) { o.forEach((v, i) => collect(v, `${path}/${v?.id ?? i}`, out)); return }
  if (!o || typeof o !== 'object') return
  if ('coverage' in o) out.push([path, (o.coverage as any)?.default])
  for (const [k, v] of Object.entries(o)) collect(v, `${path}/${k}`, out)
}

describe('R5 D20 coverage.default 数据前提', () => {
  it('音擎 / 驱动盘 / 角色的 coverage.default 全部为 1', () => {
    const out: Array<[string, unknown]> = []
    for (const key of ['wEngines', 'driveDiscSets', 'agents']) collect(cat[key], `/${key}`, out)
    expect(out.length).toBeGreaterThan(100)
    expect(out.filter(([, d]) => d !== 1)).toEqual([])
  })
})
