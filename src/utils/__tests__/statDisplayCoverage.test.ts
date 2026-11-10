/**
 * **展示完整性判据**（2026-11-09，用户原话驱动）。
 *
 * > 「面板该显示乘区的一切内容，所以会包含一切吧。你现在一个一个修补，肯定要漏。」
 *
 * ## 为什么需要它
 *
 * 伤害乘区的字段分散在三处：core 白名单（`core/damageFormulaFields`）、元素族（`elementStatKeys`
 * 生成）、角色专属（模块注册）。而**展示层原先靠手写行列举**——每加一个乘区字段，都要人去
 * 记得「顺手加一行展示」。忘了就变成**算而不显**：值确实进了伤害公式，可面板上一个字都没有，
 * 用户看到只会得出「你没算」的结论。这类漏项无法靠 review 拦住（没人会去数 36 个字段）。
 *
 * ## 判据
 *
 * `allDamageFormulaFields()` 里的每一个字段，都必须在**状态面板（StatPanel）或终局面板
 * （FinalPanel）**上出现（源码里能搜到该字段名）。缺一个就红，并点名缺哪个。
 *
 * ## 为什么「源码含字段名」够用
 *
 * 两个面板的展示形态都是「`panel.<field>` / `makeRow(..., '<field>', …)`」，字段名是硬写的；
 * 只要名字在场，就存在一条渲染路径。这条判据拦的是**漏登记**（最常见、也最难人工发现的形态），
 * 不试图证明「渲染条件永不为假」——那属于行为面，由各字段自己的生效测试负责。
 *
 * ## 豁免
 *
 * 确有不进伤害式却登记在白名单里的字段时，加进 `EXEMPT` 并写一句理由（棘轮只减不增）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allDamageFormulaFields } from '@/core/damageFormulaFields'
// 触发角色专属字段注册（`mechanics/index` 统一注册，副作用 import）
import '@/mechanics'

const SRC = join(__dirname, '..', '..')

/**
 * 白名单在册但**确实不该有展示行**的字段。
 *
 * 目前为空：36 条 core 字段 + 角色专属字段全部有展示口。
 * 新增豁免必须写理由，否则下一个人无从判断是「真不需要」还是「忘了」。
 */
const EXEMPT = new Map<string, string>()

function panelSources(): string {
  return [
    readFileSync(join(SRC, 'components/StatPanel.vue'), 'utf8'),
    readFileSync(join(SRC, 'components/FinalPanel.vue'), 'utf8'),
  ].join('\n')
}

describe('展示完整性：在册的伤害公式字段必须都能在面板上看到', () => {
  it('★ 每一条 `allDamageFormulaFields()` 都在 StatPanel / FinalPanel 里出现', () => {
    const sources = panelSources()
    const missing = allDamageFormulaFields()
      .map(f => f.stat)
      .filter(stat => !EXEMPT.has(stat))
      .filter(stat => !sources.includes(stat))
    expect(
      missing,
      `以下伤害公式字段在引擎里算了、面板上却看不到（用户会以为没算）——\n`
      + `请给 StatPanel/FinalPanel 各补一行展示，或在 EXEMPT 里写明「为什么不展示」：\n  `
      + missing.join('\n  '),
    ).toEqual([])
  })

  it('反空洞：白名单非空、面板源码非空（判据本身不能空转）', () => {
    expect(allDamageFormulaFields().length).toBeGreaterThanOrEqual(30)
    expect(panelSources().length).toBeGreaterThan(10_000)
  })

  it('异放专属层字段在册且被展示（2026-11-09 新增，防回退）', () => {
    const stats = allDamageFormulaFields().map(f => f.stat)
    expect(stats).toContain('enemyAnomalyReleaseDefReduction')
    expect(stats).toContain('enemyAnomalyReleaseResIgnore')
    const sources = panelSources()
    expect(sources).toContain('enemyAnomalyReleaseDefReduction')
    expect(sources).toContain('enemyAnomalyReleaseResIgnore')
  })
})
