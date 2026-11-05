/**
 * 命座提升率**全量分类表**（用户 2026-11-05 裁决的主交付物）。
 *
 * ## 它回答什么
 * 384 级影画（64 角色 × 6 级）每一级**动了哪条通道**：
 * - `RESOURCE` 资源型：次数 / 能量 / 喧响 / 失衡次数 / 异常触发次数；
 * - `EXEC`     执行级：招式 / 倍率 / 附伤 / 新招式行；
 * - `ATTR`     属性型：伤害公式字段（白名单 ∪ 元素族）——在**新资源基线**上乘出去的增益。
 *
 * 三者可任意组合（一级命座常常同时改面板与资源），标签顺序 = 分解三步的串联顺序。
 *
 * ## 分类不是猜的，是**引擎算出来的**
 * 每一级跑三次反事实（见 `cinemaUpliftBreakdown#computeCinemaBreakdown`）：
 * ① 只换资源 ⇒ `resourcePct`；② 再让它换执行级 ⇒ `execPct`；③ 最后乘面板增益 ⇒ `attrPct`。
 * 三段连乘恒等于总提升（定义式）。**没有关键词表、没有「面板变了就算属性」**——
 * 那两种旧做法分别会把 `1021C2`（能量效率 + 暴伤）、`1011C1`（能量效率 +12%）判错。
 *
 * ## 这张表怎么被守住
 * `__tests__/cinemaClassify.test.ts` 全量跑一遍并对 `docs/cinema-classification.md` 逐行比对；
 * 表与引擎不一致即红。要更新表就 `CINEMA_CLASSIFY_UPDATE=1` 重跑那个测试（见 AGENTS 规则 10：
 * 基线是测量工具，先归因再更新）。
 *
 * 表后面的**口径与归因正文**住在文档里、手写维护；重生成只替换 `## 全表` 这一节（`regenerateDoc`）
 * —— 正文若由本模块产出，prose 里的 agentId 就落进 `src/test`，会撞判据 26（id 字面量只许住 data/agents/specs）。
 */
import { readFileSync } from 'node:fs'
import { setupHarness } from './harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { bindPoolStore, computeCinemaBreakdown, type PanelFieldChange } from '@/composables/cinemaUpliftBreakdown'
import { localized } from '@/utils/format'

export interface CinemaClassifyRow {
  agentId: string
  name: string
  cinema: number
  status: string
  /** 状态表是否声明为 implemented* */
  declared: boolean
  totalPct: number
  resourcePct: number
  execPct: number
  attrPct: number
  tier: string
  coupled: boolean
  attrFields: string[]
  resourceFields: string[]
  execFields: string[]
  newRows: number
  /** 走资源管线的白名单字段（公式是乘区、实测面板增益≈0；非空 ≠ 缺陷） */
  attrFieldsViaResource: string[]
  implementedText: string
  pendingText: string
}

interface ConstellationsFile {
  characters: Record<string, {
    name?: { zhCN?: string }
    cinemas?: Array<{ cinema: number; status?: string; implemented?: string[]; pending?: string[] }>
  }>
}

/** 状态表的单一事实源（与 `cinemaUplift.test.ts` 读同一份文件） */
export function loadConstellations(): ConstellationsFile {
  return JSON.parse(
    readFileSync(new URL('../../public/static/character-constellations.json', import.meta.url), 'utf8'),
  ) as ConstellationsFile
}

/** 四舍五入到 0.01（表的可读性与比对稳定性） */
function round(v: number): number {
  return Math.round(v * 100) / 100
}

/** 分类标签的顺序（= 分解的串联顺序）；用于稳定排版与测试断言 */
export const TIER_ORDER = [
  'NONE', 'RESOURCE', 'EXEC', 'ATTR',
  'RESOURCE+EXEC', 'RESOURCE+ATTR', 'EXEC+ATTR', 'RESOURCE+EXEC+ATTR',
] as const

/**
 * 跑全量分类（64 角色 × 6 级）。
 *
 * **自由口径**（`stunCountLock = -1`）：用户 2026-11-05「还是不锁吧」——锁口径会把
 * 「加速失衡 / 加速积蓄 / 新招式」三条真实收益清零（实测 `banyue-roxy-lucia` 自由 +73.0%
 * vs 锁 +57.5%），那正好是本表要量的东西。
 */
export async function cinemaClassifyRows(
  constellations: ConstellationsFile = loadConstellations(),
): Promise<CinemaClassifyRow[]> {
  const ids = Object.keys(constellations.characters).sort()
  const out: CinemaClassifyRow[] = []
  /** 状态表按 agentId 索引（不是按槽位——这里根本不是槽位数组，判据 17 的扫描面会误认） */
  const cinemaEntriesOf = (agentId: string) => constellations.characters[agentId]?.cinemas ?? []
  // 显示名走单一解析器（CC-456：源码里禁止手抄 LocalizedString 的 zhCN 回退链）
  const displayNameOf = (agentId: string) => localized(constellations.characters[agentId]?.name, '')
  for (const agentId of ids) {
    const { config } = await setupHarness([{ agentId }])
    config.enemy.stunCountLock = -1
    const calc = useResourceCalc()
    const shots: Array<{ ctx: ReturnType<typeof bindPoolStore>; panels: never[] }> = []
    for (let c = 0; c <= 6; c++) {
      config.setCinemaLevel(0, c)
      config.syncTeammateBuffsFromTeam()
      const ctx = calc.damagePoolContext.value
      shots.push({ ctx: bindPoolStore(ctx, { 0: c }), panels: [...ctx.damagePanels] as never[] })
    }
    for (let c = 1; c <= 6; c++) {
      const before = shots[c - 1]
      const after = shots[c]
      const b = computeCinemaBreakdown({
        beforeCtx: before.ctx,
        afterCtx: after.ctx,
        beforePanels: before.panels,
        afterPanels: after.panels,
        withPanels: (ctx, next) => calc.damagePoolContextWithPanels(next, ctx),
        slots: [0],
      })
      const entry = cinemaEntriesOf(agentId).find(x => x.cinema === c)
      const status = entry?.status ?? '(missing)'
      const fmt = (f: PanelFieldChange) => `${f.stat} ${f.before.toFixed(1)}→${f.after.toFixed(1)}`
      out.push({
        agentId,
        name: displayNameOf(agentId),
        cinema: c,
        status,
        declared: status.startsWith('implemented'),
        totalPct: round(b.totalPct),
        resourcePct: round(b.resourcePct),
        execPct: round(b.execPct),
        attrPct: round(b.attrPct),
        tier: b.tier,
        coupled: b.coupled,
        attrFields: b.attrFields.map(fmt),
        resourceFields: b.resourceFields.map(fmt),
        execFields: b.execFields.map(fmt),
        newRows: b.newRows.length,
        attrFieldsViaResource: b.attrFieldsViaResource,
        implementedText: (entry?.implemented ?? []).join(' | '),
        pendingText: (entry?.pending ?? []).join(' | '),
      })
    }
  }
  return out
}

/**
 * 表头之后的**口径与归因正文**（生成器持有 ⇒ 重生成表时不会把它们冲掉）。
 *
 * 为什么放在这里、不手写在 markdown 里：`cinemaClassify.test.ts` 的更新模式会**整份重写**
 * `docs/cinema-classification.md` 的 `## 全表` 之后部分。口径正文若只活在文档里，
 * 下一次重生成就没了（2026-11-06 实测：更新分支写的是 `header + ## 全表 + 表`，
 * 表之后的任何内容都会被丢掉）。所以正文必须由生成器产出。
 *
 * 内容 = ① 「为什么用单人夹具」+「夹具不可换」的证伪记录（2026-11-06 实测）
 *        ② 29 格「声明 implemented 却 NONE」的逐格归因；判据 = `__tests__/cinemaNone28.test.ts`。
 */
/** 一行 → markdown 表格行（列 = 表头，见 `CINEMA_CLASSIFY_HEADER`） */
export function formatClassifyRow(r: CinemaClassifyRow): string {
  const cells = [
    `${r.agentId}C${r.cinema}`,
    r.name,
    r.declared ? r.status.replace('implemented_', 'impl_') : `**${r.status}**`,
    r.tier,
    r.totalPct.toFixed(2),
    r.resourcePct.toFixed(2),
    r.execPct.toFixed(2),
    r.attrPct.toFixed(2),
    r.attrFields.length ? r.attrFields.map(f => (r.attrFieldsViaResource.includes(f.split(' ')[0]) ? `${f}（走资源）` : f)).join('; ') : '—',
    r.resourceFields.length ? r.resourceFields.join('; ') : '—',
    r.execFields.length ? r.execFields.join('; ') : '—',
    r.newRows ? String(r.newRows) : '—',
  ]
  return `| ${cells.join(' | ')} |`
}

export const CINEMA_CLASSIFY_HEADER = [
  '级', '角色', '状态', '通道', '总 %', '资源 %', '执行 %', '面板 %', '面板字段（旧→新）', '资源字段（旧→新）', '执行字段（旧→新）', '新行',
]

/** 全表 → markdown（只含表格；判据按行比对的就是这一段） */
export function formatClassifyTable(rows: readonly CinemaClassifyRow[]): string {
  const byTier = new Map<string, CinemaClassifyRow[]>()
  for (const r of rows) {
    const list = byTier.get(r.tier) ?? []
    list.push(r)
    byTier.set(r.tier, list)
  }
  const lines: string[] = [
    `| ${CINEMA_CLASSIFY_HEADER.join(' | ')} |`,
    `|${CINEMA_CLASSIFY_HEADER.map(() => '---').join('|')}|`,
  ]
  for (const tier of TIER_ORDER) {
    const list = byTier.get(tier)
    if (!list?.length) continue
    lines.push(`| **${tier}**（${list.length} 级） |||||||||||`)
    for (const r of list) lines.push(formatClassifyRow(r))
  }
  return lines.join('\n')
}

/**
 * **重生成只替换 `## 全表` 这一节**，文档其余部分（表头说明 + 表后面的口径/归因正文）逐字保留。
 *
 * 为什么必须这样（2026-11-06）：旧更新路径写的是 `header + 表` —— 把表之后的一切
 * **整份丢弃**。于是「为什么用单人夹具 / 28 格归因」这类手写正文活不过一次重生成；而把它们塞进
 * 生成器又会把 agentId 字面量带进 `src/test`（判据 26：id 字面量只许住 src/data | mechanics/agents | specs）。
 * ⇒ 正文住文档、重生成外科式替换表格。
 */
export function regenerateDoc(current: string, renderedTable: string): string {
  const table = `## 全表\n\n${renderedTable}`
  const start = current.indexOf('## 全表')
  if (start < 0) return `${current.replace(/\n*$/, '\n\n')}${table}\n`
  const rest = current.slice(start)
  // 表后面若有下一个 `## ` 节，原样接回（正文逐字保留）
  const next = rest.search(/\n## /)
  const tail = next < 0 ? '' : rest.slice(next)
  return `${current.slice(0, start)}${table}${tail || '\n'}`
}
