/**
 * CC-395 + CC-396 + CC-397（第 421 / 422 / 423 轮 · lane arena-C）：
 * **展示层 + 组装层**（views / components / composables / stores）既不许用 `as any` 强转读数据，
 * 也不许写裸 `any` 标注。
 *
 * **CC-395 为什么**：展示层是「数据字段没声明」的最后泄漏点。`(x as any).field` 让字段名失去编译期检查，
 * 拼错只在运行时静默变 undefined。CC-380 / 381 / 382 已在 mechanics / core / specs / composables
 * 清过同一类问题，展示层一直没锁。第 421 轮把 views + components 的 24 处清到 0（19 处字段本就已声明
 * = 冗余强转；5 处是本轮补声明的真实数据字段），并加这把锁。
 *
 * **CC-396 为什么连 `: any` 一起锁**：`render(row: any)` 与 `(x as any)` 是同一件事——整行数据失去类型，
 * 之后 `row.multipler`（拼错）编译期照样过。表格列 render 是这类标注最集中的地方（第 422 轮清了 28 处 /
 * 7 个文件），修法不是删标注了事，而是给列数组标 `DataTableColumns<RowType>`，让行类型从数据源推断出来。
 *
 * **CC-397 为什么扩到 composables / stores**：第 422 轮收尾时按同 6 条规则全仓复扫，发现展示层之外
 * 只剩 9 处 / 4 文件（hpSourceBreakdown 4、useStatLabel 2、stores/catalog 2、useResourceCalc 1）——
 * 数量小到「顺手清完 + 顺手锁上」比「留作下轮候选」更简单。且这 9 处的修法正好把上一轮的两种手法
 * 都用上了：`modificationValues` / `sourceLabel` 是 CC-395a 已补过声明的字段（强转纯冗余）；
 * `twoPiece as any` 与 421 轮 views 里同一处同修法（传 `{ scope: 'outOfCombat', effects }`）；
 * `computeStunCoverage(sp: any)` 连同 convergence.ts 的 `sp: unknown` 契约一起收窄成
 * `Pick<StunPoolResult, 'stunCount'>`（实现与消费端两边同时精确化，只改一边会因参数逆变编译不过）。
 *
 * **红了怎么办**（按顺序，别直接加豁免）：
 *   ① catalog / 引擎结果里真有这个字段 ⇒ 在 `src/types/` 对应接口补声明，注释里写数据出处；
 *   ② 是第三方组件库的 prop 联合（如 naive-ui 的 tag `type`）⇒ 把常量表按库导出类型标注
 *      （`Record<string, NonNullable<TagProps['type']>>`），让推断给出联合，而不是在模板里强转；
 *   ③ 行数据没类型（表格列 render）⇒ 给列数组标 `DataTableColumns<RowType>`，删掉 `row: any`；
 *   ④ 动态键容器（`row[r.id] = v`）⇒ 用 `Record<string, unknown>`，别用 `Record<string, any>`；
 *   ⑤ 只读一两个字段的入参 ⇒ 用 `Pick<真实类型, '字段'>` 写清契约，实现与消费端（deps 接口）同步改；
 *   ⑥ 数据形态比类型窄（如驱动盘 2 件套只有 `effects`）⇒ 在调用点补出缺失的语义字段
 *      （`{ scope: 'outOfCombat', effects }`），别把整个入参放宽成 any；
 *   ⑦ 上游是人工录入的封闭词表（spec 的 `targetSkillType` 一类）⇒ 把录入侧类型收窄成真联合，
 *      让拼错在编译期报错，而不是在装配处强转；
 *   ⑧ 确实需要一处 any（极少）⇒ 在 ALLOW 加一行 `文件:行号: 理由`，写清为什么前几条都不适用。
 *
 * **范围**：`src/views` / `src/components` / `src/composables` / `src/stores` 的非测试 `.vue` / `.ts`
 * （去掉注释后扫描）。七种违规都锁：`as any`、`: any`、`<any>`、`any[]`、`Record<…, any>`、`) => any`。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const DIRS = ['views', 'components', 'composables', 'stores']

/** 注释里提到 any 不算违规 */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/[^\n]*/g, '')
}

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const FILES = DIRS.flatMap(d => walk(join(SRC, d)))
  .map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), raw: readFileSync(p, 'utf-8') }))

/** 已登记例外：`文件:行号: 理由`。空 = 一处都不许有。 */
const ALLOW: readonly string[] = []

/** 锁的规则表：名字 + 正则。加规则只需在这里加一行，`describe` 自动多一项。 */
const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'as any 强转', re: /\bas any\b/ },
  { name: ': any 标注', re: /:\s*any\b/ },
  { name: '<any> 泛型实参', re: /<any>/ },
  { name: 'any[] 数组', re: /\bany\[\]/ },
  { name: 'Record<…, any> 动态容器', re: /Record\s*<[^,]+,\s*any\s*>/ },
  { name: ') => any 返回类型', re: /\)\s*=>\s*any\b/ },
]

/** 扫一段源码，返回 `文件:行号: 内容` 形式的违规清单（供 describe 与单测共用） */
function scan(raw: string, rel = '<inline>', rule = RULES[1].re): string[] {
  const bad: string[] = []
  stripComments(raw).split('\n').forEach((line, i) => {
    if (rule.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
  })
  return bad
}

describe('CC-395 / CC-396 / CC-397：展示层与组装层没有 as any，也没有裸 any 标注', () => {
  for (const r of RULES) {
    it(`views / components / composables / stores 里没有${r.name}`, () => {
      const bad = FILES.flatMap(f => scan(f.raw, f.rel, r.re))
      expect(bad.filter(b => !ALLOW.some(a => b.startsWith(a)))).toEqual([])
    })
  }

  it('扫描面真的覆盖四个目录（防目录被挪走导致锁静默失效）', () => {
    expect(FILES.length).toBeGreaterThan(100)
    const rels = FILES.map(f => f.rel)
    for (const must of [
      'views/TeamConfigPage.vue',
      'views/ResourceUtilizationPage.vue',
      'components/ResourceResultCard.vue',
      'components/charts/ResponseSurface3D.vue',
      'composables/hpSourceBreakdown.ts',
      'composables/useStatLabel.ts',
      'composables/useResourceCalc.ts',
      'stores/catalog.ts',
    ]) expect(rels).toContain(must)
  })

  it('检测函数本身有效：注入的违规行必须报出来，正常标注必须放过', () => {
    // 报出来
    expect(scan('const r: any = 1')).toHaveLength(1)
    expect(scan('function f(x: any) { return (x as any).y }')).toHaveLength(1)
    expect(scan('return (x as any).y', '<inline>', RULES[0].re)).toHaveLength(1)
    expect(scan('const p: Promise<any> = null', '<inline>', RULES[2].re)).toHaveLength(1)
    expect(scan('const a: any[] = []', '<inline>', RULES[3].re)).toHaveLength(1)
    expect(scan('const m: Record<string, any> = {}', '<inline>', RULES[4].re)).toHaveLength(1)
    expect(scan('render: (o: { label: string }) => any', '<inline>', RULES[5].re)).toHaveLength(1)
    // 放过：具名类型、unknown、类型谓词、注释
    expect(scan('const r: RowType = { a: 1 }')).toHaveLength(0)
    expect(scan('const m: Record<string, unknown> = {}')).toHaveLength(0)
    expect(scan('const v = row[key] as number | undefined')).toHaveLength(0)
    expect(scan('function f(sp: Pick<StunPoolResult, \'stunCount\'> | null) { return sp?.stunCount ?? 0 }')).toHaveLength(0)
    expect(scan('// 以前这里写过 row: any，已经修了')).toHaveLength(0)
    expect(scan('/* 多行注释里提到 as any 也不算 */')).toHaveLength(0)
  })
})
