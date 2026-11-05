/**
 * 命座分类表（`docs/cinema-classification.md`）的**全量护栏**。
 *
 * 为什么要有它：这张表是本卡的交付物，而交付物一落地就会**漂**——某个角色改了命座实现、
 * 状态表改了文案、引擎改了乘区，表里的「通道」与百分比立刻过期。
 * 于是这里每天（每次 core 环）重算一遍 384 级并**逐行比对**表文件：
 * 表与引擎不一致即红，报错里直接给出「哪一级、哪一列、期望 vs 实际」，可照着重生成。
 *
 * 更新方式（AGENTS 规则 10：基线是测量工具，先归因再更新）：
 * `CINEMA_CLASSIFY_UPDATE=1 npx vitest run src/composables/__tests__/cinemaClassify.test.ts`
 * —— 它会重写表文件。**不许无归因重生成**：delta 要能在提交说明里说清楚是哪个角色/哪条口径变了。
 *
 * 分类口径本身由 `cinemaUpliftBreakdown.test.ts` 的判据网守着（恒等式 / 执行级不漏报 / 不锁口径），
 * 本文件只管「表 == 引擎」这一条。
 *
 * 生成器住 `src/test/cinemaClassify.ts`（**测试侧**，不是生产代码）：它只被本文件消费，
 * 生产路径零调用点 ⇒ 按 `dead-channel-ls` 的口径「只被测试引用的导出 = 生产死代码」必须搬到测试侧，
 * 而不是登记测试接口豁免。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  CINEMA_CLASSIFY_HEADER, TIER_ORDER, cinemaClassifyRows, formatClassifyTable, loadConstellations, regenerateDoc,
  type CinemaClassifyRow,
} from '@/test/cinemaClassify'

const TABLE_URL = new URL('../../../docs/cinema-classification.md', import.meta.url)
const UPDATE = process.env.CINEMA_CLASSIFY_UPDATE === '1'

/**
 * `## 全表` 这一节的正文（到下一个 `## ` 为止）。
 *
 * 为什么必须切节：`docs/cinema-classification.md` 在表后面还有「为什么用单人夹具 / 28 格归因」等
 * **口径正文**，里面也有 markdown 表格。不切节的话，本判据会把那些行当成「384 级之外的多余行」
 * 报出来（2026-11-06 实测：假红 39 条）。
 */
function tableSectionOf(markdown: string): string {
  const start = markdown.indexOf('## 全表')
  if (start < 0) return markdown
  const rest = markdown.slice(start + '## 全表'.length)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

/** 表文件里的 markdown 表格行（以 `| ` 开头且不是表头/分隔行） */
function tableRowsOf(markdown: string): string[] {
  return tableSectionOf(markdown).split('\n').filter(line => (
    line.startsWith('| ')
    && !line.startsWith('| 级 ')
    && !line.startsWith('| **')
    && !line.startsWith('|----')
  ))
}

const body = (rows: readonly CinemaClassifyRow[]) => formatClassifyTable(rows)

describe('命座分类表：表 == 引擎（384 级全量）', () => {
  it('分类表与引擎逐行一致（不一致 ⇒ 用 CINEMA_CLASSIFY_UPDATE=1 重生成并归因）', async () => {
    const rows = await cinemaClassifyRows()
    expect(rows, '分类行数不是 64 × 6 = 384（有角色被漏掉或重复）').toHaveLength(384)
    const rendered = body(rows)
    const expected = tableRowsOf(rendered)

    if (UPDATE) {
      writeFileSync(TABLE_URL, regenerateDoc(readFileSync(TABLE_URL, 'utf8'), rendered))
      return
    }

    const current = tableRowsOf(readFileSync(TABLE_URL, 'utf8'))
    // 逐行 diff：报出第一条不一致的「级」，比整表 diff 好定位
    const byKey = (line: string) => line.slice(2, line.indexOf(' |', 2))
    const currentMap = new Map(current.map(line => [byKey(line), line]))
    const mismatches: string[] = []
    for (const line of expected) {
      const key = byKey(line)
      const have = currentMap.get(key)
      if (have === undefined) mismatches.push(`${key}：表里缺这一级`)
      else if (have !== line) mismatches.push(`${key}：\n    表里 ${have}\n    引擎 ${line}`)
      currentMap.delete(key)
    }
    for (const key of currentMap.keys()) mismatches.push(`${key}：引擎已没有这一级（表里多余）`)
    expect(
      mismatches.slice(0, 5),
      `分类表与引擎有 ${mismatches.length} 处不一致（只列前 5）。`
      + '归因后跑 CINEMA_CLASSIFY_UPDATE=1 重生成 docs/cinema-classification.md',
    ).toEqual([])
  })

  it('表结构自洽：每级恰好一个通道标签、通道标签在登记表内', async () => {
    const rows = await cinemaClassifyRows()
    for (const r of rows) {
      expect(TIER_ORDER as readonly string[], `${r.agentId}C${r.cinema} 通道标签 ${r.tier} 未登记`).toContain(r.tier)
    }
    // 表头列数与每行列数必须一致（否则 markdown 会错位，人读到的是错的）
    const cols = CINEMA_CLASSIFY_HEADER.length
    for (const line of tableRowsOf(body(rows))) {
      expect(line.split('|').length - 2, `列数不对：${line.slice(0, 40)}`).toBe(cols)
    }
  })

  it('状态表对照：声明 implemented 却零收益的级必须点得出来（不许静默）', async () => {
    const constellations = loadConstellations()
    const rows = await cinemaClassifyRows(constellations)
    // 每一条「声明已实现 + 三通道全零」都是一个**待查项**：要么是如实无收益（范围扩大类），
    // 要么是死数据。本判据不判它该是哪一种，只要求它**出现在表里**（tier === 'NONE' 且 declared）。
    const noneButDeclared = rows.filter(r => r.declared && r.tier === 'NONE')
    for (const r of noneButDeclared) {
      const status = constellations.characters[r.agentId]?.cinemas?.find(c => c.cinema === r.cinema)?.status
      expect(status, `${r.agentId}C${r.cinema} 被标成 NONE 却没有状态行`).toBeTruthy()
    }
    // 反向：状态表里 status 以 not_described 开头的级**必须**是 NONE（否则状态表落后于实现）
    const notDescribed = rows.filter(r => r.status.startsWith('not_described'))
    for (const r of notDescribed) {
      expect(r.tier, `${r.agentId}C${r.cinema} 状态说「未描述未实现」，引擎却动了`).toBe('NONE')
    }
  })

  /**
   * ★ 标签不许与读数自相矛盾（2026-11-05 实机 DOM 读回抓到的缺陷）。
   *
   * 修前：`1091C1`（异常积蓄效率 +20%）在**白名单**里 ⇒ 旧判据把它标进 `ATTR`，
   * 但它的效果走**资源管线**（积蓄效率决定触发次数），换面板重跑伤害池的 `attrPct` 实测是 **0.00**
   * ⇒ 表格印出「`ATTR` … 面板 0.00」，读者看到的是「标了面板通道却没有面板收益」。
   * 现在通道以**实测**为准：`ATTR` 在场必须意味着 `|attrPct| ≥ ε`（唯一例外是全零级的兜底分支）。
   */
  it('★ 通道标签与读数一致：标了 ATTR 就必须真有面板增益', async () => {
    const rows = await cinemaClassifyRows()
    const liars = rows.filter(r => (
      r.tier.split('+').includes('ATTR')
      && Math.abs(r.attrPct) < 0.05
      // 兜底分支：三段实测全零时按「有字段变化」定标签（1011C1 那类），此时允许 ATTR 但必须有 viaResource 说明
      && r.attrFieldsViaResource.length === 0
    ))
    expect(
      liars.map(r => `${r.agentId}C${r.cinema}（面板 ${r.attrPct.toFixed(2)}%）`),
      '这些级标了 ATTR 通道却量不到面板增益，且没有「走资源管线」的说明',
    ).toEqual([])
  })

  it('★ 走资源管线的字段必须被点出来，不许当成「面板没收益」的缺陷报出去', async () => {
    const rows = await cinemaClassifyRows()
    // 雅 C1：异常积蓄效率 25→45（白名单字段，效果体现在触发次数上）
    const ya = rows.find(r => r.agentId === '1091' && r.cinema === 1)!
    expect(ya.attrFields.some(f => f.startsWith('anomalyBuildUpEfficiency')), '夹具漂移：雅C1 不再改积蓄效率').toBe(true)
    expect(ya.attrFieldsViaResource, '雅C1 的积蓄效率没被标成「走资源」').toContain('anomalyBuildUpEfficiency')
    expect(ya.tier, '雅C1 仍被标成 ATTR（标签与读数矛盾）').not.toContain('ATTR')
    expect(Math.abs(ya.totalPct), '雅C1 的收益应当归到资源/执行段').toBeGreaterThan(1)
  })
})
