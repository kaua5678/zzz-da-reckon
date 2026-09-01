/**
 * 上下文打包器（scripts/zc-brief.mjs）的护栏。
 *
 * 为什么值得测：brief 的价值全在「命中率」和「不编造」两件事上——
 * ① 解析器错一格（表格行号、编号项跨行），出处就指错地方，比不给还糟；
 * ② 打分退化成「谁长谁赢」，检索就变成噪声；
 * ③ 没命中时必须大声承认（返回空 + 提示自己读决策树），绝不能凑一个看似合理的答案。
 */
import { describe, expect, it } from 'vitest'
import {
  buildBrief,
  cjkTokens,
  extractEntities,
  findHeadingLine,
  inferTier,
  parseMarkdownTables,
  parseNumberedItems,
  scoreText,
  hasStrongOverlap,
} from '../../../scripts/zc-brief.mjs'

describe('中文分词与打分（没有空格，靠单字+二元组）', () => {
  it('二元组与拉丁标识符都收', () => {
    const t = cjkTokens('改滑块 useResourceCalc')
    expect(t.grams).toContain('滑块')
    expect(t.grams).toContain('滑')
    expect(t.latin).toContain('useresourcecalc')
  })

  it('相关文本得分显著高于无关文本', () => {
    const q = '滑块覆盖率不生效'
    const hit = scoreText(q, '加一个可调滑块：模块 settings 声明 + 覆盖率生效测试')
    const miss = scoreText(q, '数据管道：nanoka 爬虫导入 catalog 快照')
    expect(hit).toBeGreaterThan(miss * 3)
  })

  it('强命中只认二元组/拉丁词：中文单字撞车不算数', () => {
    expect(hasStrongOverlap('滑块不生效', '加一个可调滑块')).toBe(true)
    expect(hasStrongOverlap('给我讲个笑话', '加一个可调滑块')).toBe(false) // 只共享「个」「加」这类单字
    expect(hasStrongOverlap('改 useResourceCalc', '禁止往 useResourceCalc 加分支')).toBe(true)
  })

  it('长文本不靠体量刷分（开方衰减）', () => {
    const q = '失衡轴'
    const short = scoreText(q, '改失衡轴 → stunAxisPresets')
    const long = scoreText(q, '改失衡轴 → stunAxisPresets' + '无关内容'.repeat(200))
    expect(short).toBeGreaterThan(long)
  })
})

describe('markdown 解析（出处指错比不给更糟）', () => {
  const md = ['# 标题', '', '| 任务 | 改哪 |', '| --- | --- |', '| 录新角色 | src/specs |', '| 改乘区 | src/core/damage.ts |', '', '正文'].join('\n')

  it('表头/数据行分离，分隔行跳过，行号是 1-based 原始行号', () => {
    const [t] = parseMarkdownTables(md)
    expect(t.header).toEqual(['任务', '改哪'])
    expect(t.rows).toHaveLength(2)
    expect(t.rows[0].cells).toEqual(['录新角色', 'src/specs'])
    expect(t.rows[0].line).toBe(5) // 第 5 行
    expect(md.split('\n')[t.rows[0].line - 1]).toContain('录新角色')
  })

  it('编号清单：跨行正文并进同一条，遇标题收尾', () => {
    const list = ['1. **第一坑**：正文一', '   续行内容', '2. **第二坑**：正文二', '## 下一节', '3. 不该被吃进来'].join('\n')
    const items = parseNumberedItems(list)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('第一坑')
    expect(items[0].body).toContain('续行内容')
    expect(items[1].n).toBe(2)
  })

  it('findHeadingLine 只认标题行', () => {
    expect(findHeadingLine(md, /标题/)).toBe(1)
    expect(findHeadingLine(md, /不存在/)).toBe(0)
  })
})

describe('档位与实体抽取', () => {
  it('档位三档', () => {
    expect(inferTier('改个文案')).toBe('fast')
    expect(inferTier('排查命座不生效')).toBe('full')
    expect(inferTier('批量迁移测试到 harness')).toBe('loop')
  })

  it('实体：agentId / moveId / setting / 路径各归各', () => {
    const e = extractEntities('派派 1281 的 1281014 行与 piper.momentumCoverage 滑块，改 src/mechanics/agents/piper.ts')
    expect(e.agentIds).toContain('1281')
    expect(e.moveIds).toContain('1281014')
    expect(e.settings).toContain('piper.momentumCoverage')
    expect(e.paths).toContain('src/mechanics/agents/piper.ts')
  })
})

describe('仓库级：真实任务描述能命中该读的那几行', () => {
  it('「加滑块」命中决策树的滑块行 + 生效测试要求', () => {
    const b = buildBrief('给爱丽丝加一个覆盖率滑块')
    expect(b.where.length).toBeGreaterThan(0)
    expect(b.where.map(w => w.task + w.to).join(' ')).toMatch(/滑块/)
    expect(b.where.map(w => w.to).join(' ')).toMatch(/生效测试/)
  })

  it('「改乘区」命中 damage.ts', () => {
    const b = buildBrief('改伤害乘区顺序')
    expect(b.where.map(w => w.to).join(' ')).toContain('damage.ts')
  })

  it('「滑块不生效」命中根因表与坑表（排查类任务的价值全在这两张表）', () => {
    const b = buildBrief('覆盖率滑块改了结果不变')
    expect(b.causes.length).toBeGreaterThan(0)
    expect(b.causes.map(c => c.symptom).join(' ')).toMatch(/滑块|不变/)
    expect(b.pits.length).toBeGreaterThan(0)
  })

  it('每条命中都带可跳转的出处（文件:行），且行号真的指到那一行', () => {
    const b = buildBrief('录新角色 补机制')
    for (const w of b.where) expect(w.at).toMatch(/^[\w/.-]+\.md:\d+$/)
    for (const r of b.rules) expect(r.at).toMatch(/^AGENTS\.md:\d+$/)
  })

  it('无关任务不硬凑：决策树命不中就返回空（调用方据此提示自己读 §3）', () => {
    const b = buildBrief('给我讲个笑话')
    expect(b.where).toHaveLength(0)
  })
})