/**
 * 更新日志**解析口径**的判据（`scripts/lib/changelog.mjs`）。
 *
 * 为什么值得单测：更新日志是**产物**，它的正确性只有两条防线 ——
 *   ① 生成器与 git 一致（CI 漂移检查，`node scripts/gen-changelog.mjs --check`）；
 *   ② **解析口径本身对**（本文件）。
 * ②不测的话，①只能证明「文件与一个错误的解析器一致」——两者一起绿而日志内容全错
 * （把 166 条任务编号标题误判成类型、或把 docs 全丢掉，都能静默通过）。
 *
 * 下面每条断言都对应一个**实测**过的真实形态（数据取自本仓库 2460 条提交标题），
 * 不是构造出来的假想输入。
 */
import { describe, it, expect } from 'vitest'
import {
  buildChangelog,
  kindOfType,
  parseCommitSubject,
  sanitizeSummary,
  splitRecords,
  toEntry,
  FIELD_SEP,
  RECORD_SEP,
  GIT_LOG_FORMAT,
  KNOWN_TYPES,
  TYPE_META,
} from '../../../scripts/lib/changelog.mjs'

describe('parseCommitSubject：Conventional Commits 解析', () => {
  it('拆出 type / scope / 摘要，摘要 = 「scope：subject」', () => {
    const r = parseCommitSubject('feat(team): 预设队伍选择器 + 自定义组队并入选择池')
    expect(r).toMatchObject({ type: 'feat', scope: 'team', kind: 'feature', breaking: false, known: true })
    expect(r.summary).toBe('team：预设队伍选择器 + 自定义组队并入选择池')
  })

  it('无 scope 时摘要就是 subject（不补空冒号）', () => {
    const r = parseCommitSubject('docs: 同步性能判据换尺后的两处旧口径引用')
    expect(r).toMatchObject({ type: 'docs', scope: '', kind: 'docs' })
    expect(r.summary).toBe('同步性能判据换尺后的两处旧口径引用')
  })

  it('识别破坏性变更标记 `!`', () => {
    const r = parseCommitSubject('refactor(core)!: 删掉旧契约')
    expect(r.breaking).toBe(true)
    expect(r.type).toBe('refactor')
  })

  it('全角冒号也是合法分隔符（实测仓库里有这种写法）', () => {
    const r = parseCommitSubject('fix(calc)：全角冒号分隔')
    expect(r).toMatchObject({ type: 'fix', scope: 'calc', known: true })
    expect(r.summary).toBe('calc：全角冒号分隔')
  })

  /**
   * ★ 本文件最重要的一条：**大小写敏感**。
   * 仓库里 166 条 `CC-507:` / `T114:` / `R37-J5:` 这类任务编号开头的标题，
   * 若正则加了 `i` 标志，它们会被误判成 `<type>: <subject>`（`cc-507` 当成类型名）
   * ⇒ 全部落进 other，等于把近两成历史错误分类。实测：小写化后 typed 从 2159 掉到 1993。
   */
  it('任务编号开头的标题不得被误判成类型（大写不进 type 位）', () => {
    for (const s of [
      'CC-507: 面板额外能力触发判定只写一份 core/additionalAbilityActive.ts',
      'T114: §6 四选项逐条判定 —— ② 建成带护栏的 docs-only 快路',
      'R37-J5: 动态合轴第一版',
    ]) {
      const r = parseCommitSubject(s)
      expect(r.known, s).toBe(false)
      expect(r.type, s).toBe('')
      expect(r.kind, s).toBe('other')
      // 原措辞逐字保留（不改写、不截断、不去前缀）
      expect(r.summary, s).toBe(s)
    }
  })

  it('未识别标题保留原始措辞（裸描述 / 无类型）', () => {
    const s = 'r739 截断预算不再往返：拆出 truncateMoveRows，rowTimeLimit 契约收紧'
    const r = parseCommitSubject(s)
    expect(r).toMatchObject({ type: '', kind: 'other', known: false })
    expect(r.summary).toBe(s)
  })

  it('未知的小写类型也归 other（不编造类型名，但保留原文）', () => {
    const r = parseCommitSubject('tooling: 某次工具改动')
    expect(r).toMatchObject({ type: '', kind: 'other', known: false })
    expect(r.summary).toBe('tooling: 某次工具改动')
  })

  it('wip / merge 归 other（过程型提交不进主分类）', () => {
    expect(parseCommitSubject('wip(R37-J5 ⑦): 终态判据').kind).toBe('other')
    expect(kindOfType('wip')).toBe('other')
    expect(kindOfType('merge')).toBe('other')
    expect(kindOfType('')).toBe('other')
    expect(kindOfType('不存在的类型')).toBe('other')
  })
})

describe('kindOfType / TYPE_META：分类表是单一来源', () => {
  it('每个已知类型都能映射到已登记的 kind', () => {
    for (const t of KNOWN_TYPES) {
      const kind = kindOfType(t)
      expect(kind, t).not.toBe('other')
      expect(TYPE_META[t].kind, t).toBe(kind)
    }
  })

  it('kind 覆盖：feat/perf → feature，fix → fix，test/refactor/chore → refactor，docs → docs', () => {
    expect(kindOfType('feat')).toBe('feature')
    expect(kindOfType('perf')).toBe('feature')
    expect(kindOfType('fix')).toBe('fix')
    expect(kindOfType('refactor')).toBe('refactor')
    expect(kindOfType('test')).toBe('refactor')
    expect(kindOfType('chore')).toBe('refactor')
    expect(kindOfType('docs')).toBe('docs')
  })
})

describe('toEntry：git log 记录 → 产物条目', () => {
  it('解析 `%h<US>%ad<US>%s` 三字段，产出展示就绪的紧凑条目', () => {
    const line = ['abc1234', '2026-10-12', 'feat(ui): 新增更新日志弹层'].join(FIELD_SEP)
    expect(toEntry(line)).toEqual({
      h: 'abc1234',
      d: '2026-10-12',
      t: '新功能',
      k: 'feature',
      s: 'ui：新增更新日志弹层',
    })
  })

  it('破坏性变更带 bc:1（且只有为真时才写这个键）', () => {
    expect(toEntry(['a', '2026-01-01', 'feat!: 破坏性'].join(FIELD_SEP)).bc).toBe(1)
    expect(toEntry(['a', '2026-01-01', 'feat: 正常'].join(FIELD_SEP))).not.toHaveProperty('bc')
  })

  it('未识别类型落 other，类型名取 KIND_META 的「其他」', () => {
    const e = toEntry(['a', '2026-01-01', 'CC-1: 某事'].join(FIELD_SEP))
    expect(e).toMatchObject({ t: '其他', k: 'other', s: 'CC-1: 某事' })
  })

  it('标题里含字段分隔符也不会把字段切错（hash/日期取前两段，其余全算标题）', () => {
    const e = toEntry(['abc', '2026-01-01', `fix: 含${FIELD_SEP}分隔符的标题`].join(FIELD_SEP))
    expect(e.h).toBe('abc')
    expect(e.d).toBe('2026-01-01')
    expect(e.s).toBe(`含${FIELD_SEP}分隔符的标题`)
  })

  /**
   * ★ 标题里的 `NaN` / `Infinity` 必须规范化（实测：本仓库真有两提交标题在讲这两个词）。
   * 它们会让 `ui-check` 的 DOM 体检判「页面出现未格式化数值」⇒ 日志弹层一开就实机点通失败。
   * 处置是规范**产物文本**，不是放松那条闸门（它同时防着真的数值外露）。
   */
  it('摘要里的 NaN / Infinity 换成「非数 / ∞」（防 ui-check 数值体检误判）', () => {
    expect(sanitizeSummary('体检判 NaN / Infinity 即失败')).toBe('体检判 非数 / ∞ 即失败')
    expect(sanitizeSummary('含 +Infinity 透传')).toBe('含 +∞ 透传')
    expect(toEntry(['a', '2026-01-01', 'feat: 判 NaN 即失败'].join(FIELD_SEP)).s).toBe('判 非数 即失败')
    // 不该误伤：词内出现不算（`InfinityLoop` 没有词边界）
    expect(sanitizeSummary('InfinityLoop 与 NaNs')).toBe('InfinityLoop 与 NaNs')
  })
})

describe('splitRecords：git log 整段输出切分', () => {
  it('按记录分隔符切开并滤掉空记录', () => {
    const out = `a${FIELD_SEP}2026-01-01${FIELD_SEP}feat: x\u001e\nb${FIELD_SEP}2026-01-02${FIELD_SEP}fix: y\u001e`
    expect(splitRecords(out)).toHaveLength(2)
    expect(splitRecords('')).toEqual([])
    expect(splitRecords('\u001e')).toEqual([])
  })

  it('格式串由 FIELD_SEP / RECORD_SEP 常量拼出（切分与格式同一来源，不手抄转义）', () => {
    expect(GIT_LOG_FORMAT).toBe(`%h${FIELD_SEP}%ad${FIELD_SEP}%s${RECORD_SEP}`)
    // 真实往返：格式串切出来的第一段必须是 hash（防「格式串与 splitRecords 用了不同分隔符」）
    const line = `abc1234${FIELD_SEP}2026-01-01${FIELD_SEP}feat: x`
    expect(splitRecords(`${line}${RECORD_SEP}`)).toEqual([line])
  })
})

describe('buildChangelog：分组与统计', () => {
  const mk = (h: string, d: string, s: string) => toEntry([h, d, s].join(FIELD_SEP))

  it('按日期倒序分组，组内保持输入顺序（= git 时间倒序）', () => {
    const data = buildChangelog([
      mk('a1', '2026-10-11', 'feat: 新'),
      mk('a2', '2026-10-12', 'fix: 修'),
      mk('a3', '2026-10-11', 'docs: 文'),
    ])
    expect(data.days.map(d => d.d)).toEqual(['2026-10-12', '2026-10-11'])
    expect(data.days[1].entries.map(e => e.h)).toEqual(['a1', 'a3'])
  })

  it('组内条目剥掉 d（日期由外层承载，避免两份可能不一致）', () => {
    const data = buildChangelog([mk('a1', '2026-10-11', 'feat: 新')])
    expect(data.days[0].entries[0]).not.toHaveProperty('d')
    expect(data.days[0].d).toBe('2026-10-11')
  })

  it('kinds 只出实际出现过的分类，带条数且按 order 排序', () => {
    const data = buildChangelog([
      mk('a1', '2026-10-11', 'docs: 文'),
      mk('a2', '2026-10-11', 'feat: 新'),
      mk('a3', '2026-10-11', 'feat: 又新'),
      mk('a4', '2026-10-11', 'CC-1: 其他'),
    ])
    expect(data.kinds.map(k => k.id)).toEqual(['feature', 'docs', 'other'])
    expect(data.kinds[0]).toMatchObject({ id: 'feature', label: '功能', count: 2 })
    expect(data.kinds.find(k => k.id === 'fix')).toBeUndefined()
  })

  it('total 等于全部条目数（含 other —— 分类不等于删除）', () => {
    const data = buildChangelog([
      mk('a1', '2026-10-11', 'feat: 新'),
      mk('a2', '2026-10-11', 'CC-1: 其他'),
    ])
    expect(data.total).toBe(2)
  })

  it('缺 h / 缺 d 的条目被丢弃（防 undefined 混进产物）', () => {
    const data = buildChangelog([
      { h: '', d: '2026-10-11', t: '新功能', k: 'feature', s: 'x' },
      { h: 'a1', d: '', t: '新功能', k: 'feature', s: 'x' },
      mk('a2', '2026-10-11', 'feat: 有效'),
    ])
    expect(data.total).toBe(1)
  })

  it('meta 写进产物（generatedFrom / head，排障用）', () => {
    const data = buildChangelog([], { generatedFrom: 'git log --no-merges', head: 'abc1234' })
    expect(data).toMatchObject({ generatedFrom: 'git log --no-merges', head: 'abc1234', total: 0 })
    expect(data.days).toEqual([])
    expect(data.kinds).toEqual([])
  })
})
