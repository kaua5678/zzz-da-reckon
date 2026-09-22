/**
 * 判据 21「JSON 重复键静默覆盖」测试（2026-09-22 无人值守班次）。
 *
 * ① detector 单测（构造 fixture，**可红性自证**）：
 *    同对象重复键**必须报**、不同对象/数组下标的同名键**必须不报**——这一对是判据的
 *    discriminating pair（只报 = 误伤合法 JSON，不报 = 判据形同虚设，两种都会让判据被绕过或关闭）。
 * ② 仓库级：真实仓库当前重复键 = 0，且**扫描面非空洞**（文件数 ≥ 下限）+ detector 自证通过。
 *
 * 立项依据 = 2026-09-22 实测事故（详见 `scripts/lib/json-dup-keys.mjs` 头注释）：
 * `src/specs/agents/1091.json` 的重复 `teamBuffs` 键让「雅 C1 全队积蓄 +20%」静默失效，
 * 而 validate:data / validate:specs / check-guards / 3383 条 vitest **全绿**。
 *
 * ⚠ 本判据必须能抓住**用户面后果**，所以除 detector 单测外，还锁一条行为面：
 * 把重复键 fixture 喂给「spec teamBuffs 消费者」的口径（JSON.parse 后者覆盖前者）——
 * 见 `JSON.parse 语义 = 后者静默覆盖前者` 用例：这是缺陷的**因果本体**，不是实现细节。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  JSON_DUP_SCAN_MIN_FILES,
  JSON_DUP_SKIP_DIRS,
  detectorSelfTest,
  findDuplicateKeys,
  formatJsonDupKeys,
  listJsonFiles,
  scanJsonDupKeys,
} from '../../../scripts/lib/json-dup-keys.mjs'

const ROOT = join(__dirname, '..', '..', '..')

/** 在临时目录里造一个「仓库」，跑扫描后清掉 */
function withTempRepo(files: Record<string, string>, fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'json-dup-'))
  try {
    for (const [rel, text] of Object.entries(files)) {
      const abs = join(root, rel)
      mkdirSync(join(abs, '..'), { recursive: true })
      writeFileSync(abs, text, 'utf8')
    }
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('判据 21 detector：可红性自证（discriminating pair）', () => {
  it('同一对象内重复键必须报（且 firstLine 指向先出现的那一处）', () => {
    const hits = findDuplicateKeys('{\n  "teamBuffs": [\n    1\n  ],\n  "additionalAbility": {},\n  "teamBuffs": []\n}')
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe('teamBuffs')
    expect(hits[0].firstLine).toBe(2)
    expect(hits[0].line).toBe(6)
    expect(hits[0].path).toBe('')
  })

  it('不同对象 / 数组不同下标的同名键**必须不报**（v1 原型 50 文件假阳性的形态）', () => {
    const legal = [
      '{\n  "resources": [\n    { "id": "a", "note": "x" },\n    { "id": "b", "note": "y" }\n  ],\n  "teamBuffs": [],\n  "additionalAbility": { "teamBuffs": [] }\n}',
      // 数组元素同名键 + 同名键在不同层
      '{\n  "a": { "k": 1, "sub": { "k": 2 } },\n  "b": { "k": 3 }\n}',
    ]
    for (const text of legal) expect(findDuplicateKeys(text)).toEqual([])
  })

  it('嵌套对象内的重复：只报内层那一条，路径要指到内层', () => {
    const hits = findDuplicateKeys('{\n  "outer": {\n    "k": 1,\n    "inner": { "k": 2, "k": 3 }\n  }\n}')
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe('k')
    expect(hits[0].path).toBe('/outer/inner')
  })

  it('数组内对象的路径带下标（报告要能定位到具体哪一条）', () => {
    const hits = findDuplicateKeys('{\n  "resources": [\n    { "id": "a" },\n    { "id": "b", "id": "c" }\n  ]\n}')
    expect(hits).toHaveLength(1)
    expect(hits[0].path).toBe('/resources/1')
  })

  it('转义引号不打断键名读取（`"a\\""` 这类键不许把后面的内容错认成键）', () => {
    // 键名里带转义引号；后面那个 "x" 是值不是键 ⇒ 零重复
    expect(findDuplicateKeys('{\n  "a\\"b": "x"\n}')).toEqual([])
    // 同样的转义键出现两次 ⇒ 必须报
    const hits = findDuplicateKeys('{\n  "a\\"b": 1,\n  "a\\"b": 2\n}')
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe('a"b')
  })

  it('detectorSelfTest 三组 fixture 全过（判据自身坏了要先红）', () => {
    expect(detectorSelfTest()).toEqual({ ok: true, failures: [] })
  })
})

describe('判据 21 语义面：JSON.parse 后者静默覆盖前者（缺陷的因果本体）', () => {
  it('重复键 = 前一份值直接消失，而解析结果**结构完全合法**（所以所有静态判据都看不见）', () => {
    const dup = '{"teamBuffs":[{"id":"miyabi_c1_team_buildup"}],"teamBuffs":[]}'
    const parsed = JSON.parse(dup) as { teamBuffs: unknown[] }
    expect(parsed.teamBuffs).toEqual([]) // ← 先出现的那份（真正的机制）被静默丢弃
    expect(findDuplicateKeys(dup)).toHaveLength(1) // ← 只有本判据能看见
  })
})

describe('判据 21 仓库级（真实扫描）', () => {
  it('扫描面非空洞：仓库 .json 数 ≥ 反空洞下限，且跳过目录真的被跳过', () => {
    const files = listJsonFiles(ROOT)
    expect(files.length).toBeGreaterThanOrEqual(JSON_DUP_SCAN_MIN_FILES)
    for (const dir of JSON_DUP_SKIP_DIRS) {
      expect(files.some(f => f.includes(`/${dir}/`))).toBe(false)
    }
    // 扫描面必须包含本次事故的现场与核心数据源
    expect(files.some(f => f.endsWith('src/specs/agents/1091.json'))).toBe(true)
    expect(files.some(f => f.endsWith('public/static/catalog.json'))).toBe(true)
  })

  it('仓库当前零重复键，且 detector 自证通过（判据 21 全绿）', () => {
    const report = scanJsonDupKeys(ROOT)
    if (!report.ok) console.log(formatJsonDupKeys(report).join('\n'))
    expect(report.selfTest.ok).toBe(true)
    expect(report.belowFloor).toBe(false)
    expect(report.duplicates).toEqual([])
  })

  it('负控（可红性自证）：把事故现场原样注入临时仓库 ⇒ 精确命中该文件该键', () => {
    // 事故现场 = 1091.json 的真实形态：L110 有 teamBuffs，L143 又一个空 teamBuffs
    const accident = '{\n  "id": "1091",\n  "teamBuffs": [\n    { "id": "miyabi_c1_team_buildup" }\n  ],\n  "notes": [],\n  "teamBuffs": []\n}'
    withTempRepo({ 'src/specs/agents/1091.json': accident }, (root) => {
      const report = scanJsonDupKeys(root)
      expect(report.duplicates).toHaveLength(1)
      expect(report.duplicates[0].file).toBe('src/specs/agents/1091.json')
      expect(report.duplicates[0].key).toBe('teamBuffs')
      expect(report.duplicates[0].firstLine).toBe(3)
      expect(report.duplicates[0].line).toBe(7)
      expect(report.ok).toBe(false)
    })
  })

  it('反空洞：扫描面塌陷时必须红（「零命中」与「detector 坏了」不可区分 ⇒ 用下限区分）', () => {
    withTempRepo({ 'src/specs/agents/ok.json': '{ "a": 1 }' }, (root) => {
      const report = scanJsonDupKeys(root)
      expect(report.duplicates).toEqual([]) // 没有重复键……
      expect(report.belowFloor).toBe(true)  // ……但扫描面只有 1 个文件
      expect(report.ok).toBe(false)         // ⇒ 不许判绿
    })
  })
})
