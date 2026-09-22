/**
 * 「JSON 重复键静默覆盖」扫描器（判据 21 的实现面）。
 *
 * ## 要拦的形态
 * 同一个 JSON 对象里出现 ≥2 次同名键。`JSON.parse` 的语义是**后者静默覆盖前者**：
 * 不报错、不警告，前一份值直接消失。
 *
 * ## 为什么值得做成判据（2026-09-22 实测事故，非假想）
 * `src/specs/agents/1091.json` 曾在 L110 有 `teamBuffs`（星见雅影画一：全队异常积蓄效率 +20%），
 * `2f4cc8b` 又在 L143 追加了一个 `"teamBuffs": []`。此后：
 * - `npm run validate:specs` 全绿（它 `JSON.parse` 后看到的就是空数组，**结构完全合法**）；
 * - `npm run validate:data`、`check-guards`、3383 条 vitest 全绿；
 * - 用户面：雅 C1 的「全队 +20% 积蓄」**静默失效**（值被空数组覆盖），无任何红灯。
 * 只有 `45b0f64` 逐字节比对文件才把它挖出来——**静态数据里最贵的一类缺陷：
 * 数据被静默丢弃，而所有机器判据看到的都是一份自洽的合法对象**。
 *
 * ## 判据定义（路径感知，宁漏不误伤）
 * Node 内置 `JSON.parse` **没有**重复键钩子（Python 的 `object_pairs_hook` 才有），
 * 所以本模块自带一个最小 JSON 分词器：跟踪对象/数组栈，**只在同一个对象内**查重。
 *
 * ⚠ 按「缩进层级 + 键名」判重是**错的**（v1 原型实测 **50/70 文件假阳性**）：
 * 数组里每个元素都是同一组键（`resources[0].id` 与 `resources[1].id` 同缩进同名）。
 * ⇒ 必须路径感知：不同对象（含数组不同下标）的同名键**完全合法**，不得报。
 *
 * ## 反空洞（为什么判据里必须带 detector 自证）
 * 「全库 0 命中」与「detector 坏了」在读数上**不可区分**。所以本模块导出
 * `detectorSelfTest()`：对一对**判别性 fixture** 自证——同对象重复必须报、不同对象同名必须不报。
 * 少任何一半都不成立（只报 = 误伤合法 JSON；不报 = 判据形同虚设）。
 *
 * @fact engine:guards/重复键判定 口径: JSON 重复键 = 同一对象内同名键 ≥2 次（后者静默覆盖前者），按 JSON 指针路径判重、不同对象/数组下标的同名键合法；扫描面 = 仓库内全部 .json（排除 node_modules/.git/.zc/dist 等生成或非源码目录），命中即红（无豁免清单——重复键没有任何合法用途） | 据 实测事故@2026-09-22（1091.json 重复 teamBuffs 键 ⇒ 雅 C1 全队积蓄+20% 静默失效，3383 测试全绿）·用户裁决@2026-09-22「防知识膨胀与转述失真：清单不是语义，能证明到哪里就写到哪里」 | 验 src/scripts/__tests__/jsonDupKeys.test.ts | 锚 scripts/lib/json-dup-keys.mjs#scanJsonDupKeys | 信 确认
 * ⟳复核: 若仓库改用 JSON5/JSONC（允许注释）或引入带 duplicate-key 钩子的解析器（如 jsonc-parser 的 parseTree），本扫描器可被替换 ⇒ 连同 JSON_DUP_SCAN_MIN_FILES 下限一起重审 | 到期 2027-03-31
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 不参与扫描的目录（生成产物 / 依赖 / 版本库 / 工作状态）。
 * `dist/` 是 `vite build` 的产物（会被重新生成）；`.zc/` 是 gitignore 的工作状态区。
 */
export const JSON_DUP_SKIP_DIRS = new Set([
  'node_modules', '.git', '.zc', '.claude', 'dist', 'coverage',
])

/**
 * 反空洞下限：扫描面小于这个数 ⇒ 「零命中」不可采信（多半是 walker 写坏/目录改名）。
 * 2026-09-22 实测 = 644 个 .json（`data/raw` 434 + `src/data` 127 + `src/specs` 63 + 其余 20）。
 * 取 600 留出正常增删余量；掉到 600 以下说明扫描面真的塌了，先查 walker 再改这个数。
 */
export const JSON_DUP_SCAN_MIN_FILES = 600

/**
 * 路径感知重复键扫描（最小 JSON 分词器，零依赖）。
 *
 * 实现要点：
 * - 用「帧」表示当前容器：`{ isObject, keys: Map<key, firstLine>, seg }`；
 * - 只有**字符串键**进键表（对象成员），数组元素不进；
 * - `{`/`[` 压栈、`}`/`]` 弹栈；读到的字符串后看下一个非空白字符是不是 `:` 来判键/值；
 * - 字符串内的 `\\` 转义按对跳过（否则 `"a\\""` 会提前截断，键名读错）。
 *
 * @param {string} text JSON 文本
 * @returns {{ key: string, path: string, line: number, firstLine: number }[]} 重复键清单（按出现顺序）
 */
export function findDuplicateKeys(text) {
  const dups = []
  const stack = []
  /** 刚读到的键名；容器/逗号后清空 —— 它决定下一个容器的路径段 */
  let pendingKey = null
  let i = 0
  let line = 1

  // JSON 指针（仅用于报告可读性；根对象 = 空串）
  const ptr = () => {
    const segs = stack.map(f => f.seg).filter(s => s !== '' && s != null)
    return segs.length ? '/' + segs.join('/') : ''
  }

  while (i < text.length) {
    const ch = text[i]
    if (ch === '\n') { line++; i++; continue }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue }

    if (ch === '{' || ch === '[') {
      // 路径段：根容器 = 空；键的值 = 键名；数组元素 = 该数组内的序号
      let seg = ''
      if (stack.length > 0) {
        if (pendingKey != null) {
          seg = pendingKey
        } else {
          const parent = stack[stack.length - 1]
          seg = String(parent.count)
          parent.count++
        }
      }
      stack.push({ isObject: ch === '{', keys: new Map(), seg, count: 0 })
      pendingKey = null
      i++
      continue
    }
    if (ch === '}' || ch === ']') { stack.pop(); pendingKey = null; i++; continue }
    if (ch === ',') { pendingKey = null; i++; continue }
    if (ch === ':') { i++; continue }

    if (ch === '"') {
      const startLine = line
      i++
      let raw = ''
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          raw += text[i]; i++
          if (i < text.length) { if (text[i] === '\n') line++; raw += text[i]; i++ }
          continue
        }
        if (text[i] === '\n') line++
        raw += text[i]; i++
      }
      i++ // 收尾引号
      // 键 vs 值：看后面第一个非空白字符是不是 ':'
      let j = i
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === ':' && stack.length && stack[stack.length - 1].isObject) {
        const frame = stack[stack.length - 1]
        let key
        try { key = JSON.parse(`"${raw}"`) } catch { key = raw }
        if (frame.keys.has(key)) {
          dups.push({ key, path: ptr(), line: startLine, firstLine: frame.keys.get(key) })
        } else {
          frame.keys.set(key, startLine)
        }
        pendingKey = key
      }
      continue
    }
    i++
  }
  return dups
}

/** 递归收集仓库内全部 `.json`（跳过 `JSON_DUP_SKIP_DIRS` 与隐藏**目录**；隐藏文件照扫）。 */
export function listJsonFiles(root) {
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        if (JSON_DUP_SKIP_DIRS.has(entry.name)) continue
        walk(join(dir, entry.name))
        continue
      }
      if (entry.name.endsWith('.json')) files.push(join(dir, entry.name))
    }
  }
  if (existsSync(root)) walk(root)
  return files.sort()
}

/**
 * detector 自证（判别性 fixture 成对）：**少任何一半都不成立**。
 * - A 组（必报）：同一对象内 `teamBuffs` 出现两次 ⇒ 必须报 1 条，且 `firstLine` 指向第一处；
 * - B 组（必不报）：同名键分属不同对象 / 数组不同下标 ⇒ 一条都不许报
 *   （这正是 v1 原型 50 文件假阳性的形态）；
 * - C 组（必报）：嵌套对象内的重复（`a.b.c` 两层各一次）⇒ 只报内层那一条，路径要指到内层。
 *
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function detectorSelfTest() {
  const failures = []

  const dupSameObject = '{\n  "teamBuffs": [\n    1\n  ],\n  "additionalAbility": {},\n  "teamBuffs": []\n}'
  const a = findDuplicateKeys(dupSameObject)
  if (a.length !== 1 || a[0].key !== 'teamBuffs' || a[0].firstLine !== 2 || a[0].line !== 6) {
    failures.push(`A 组（同对象重复）应报 1 条 teamBuffs L2→L6，实得 ${JSON.stringify(a)}`)
  }

  const legalSiblings = '{\n  "resources": [\n    { "id": "a", "note": "x" },\n    { "id": "b", "note": "y" }\n  ],\n  "teamBuffs": [],\n  "additionalAbility": { "teamBuffs": [] }\n}'
  const b = findDuplicateKeys(legalSiblings)
  if (b.length !== 0) {
    failures.push(`B 组（不同对象/数组下标的同名键）必须零命中，实得 ${JSON.stringify(b)}`)
  }

  const nested = '{\n  "outer": {\n    "k": 1,\n    "inner": { "k": 2, "k": 3 }\n  }\n}'
  const c = findDuplicateKeys(nested)
  if (c.length !== 1 || c[0].key !== 'k' || c[0].path !== '/outer/inner') {
    failures.push(`C 组（嵌套对象内重复）应报 /outer/inner 的 k，实得 ${JSON.stringify(c)}`)
  }

  return { ok: failures.length === 0, failures }
}

/**
 * 全库扫描。
 * @param {string} root 仓库根
 * @returns {{ scanned: number, duplicates: {file:string,key:string,path:string,line:number,firstLine:number}[], selfTest: {ok:boolean,failures:string[]}, belowFloor: boolean, ok: boolean }}
 */
export function scanJsonDupKeys(root) {
  const files = listJsonFiles(root)
  const duplicates = []
  for (const abs of files) {
    const text = readFileSync(abs, 'utf8')
    for (const d of findDuplicateKeys(text)) {
      duplicates.push({ file: relative(root, abs).split(sep).join('/'), ...d })
    }
  }
  const selfTest = detectorSelfTest()
  const belowFloor = files.length < JSON_DUP_SCAN_MIN_FILES
  return {
    scanned: files.length,
    duplicates,
    selfTest,
    belowFloor,
    ok: selfTest.ok && !belowFloor && duplicates.length === 0,
  }
}

/** 把报告渲染成 check-guards 的 detail 行。 */
export function formatJsonDupKeys(report) {
  const lines = []
  for (const f of report.selfTest.failures) {
    lines.push(`  ✗ detector 自证失败：${f}`)
    lines.push('    → 判据本体坏了：修 findDuplicateKeys 后再看扫描结果（自证不过时「零命中」不可采信）')
  }
  if (report.belowFloor) {
    lines.push(`  ✗ 扫描面只有 ${report.scanned} 个 .json < 下限 ${JSON_DUP_SCAN_MIN_FILES} ⇒ 「零命中」不可采信`)
    lines.push('    → 多半是 listJsonFiles 的 walker 或跳过目录写坏；若仓库确实缩到这么小，同步下调下限')
  }
  for (const d of report.duplicates) {
    lines.push(`  ✗ ${d.file}：键 "${d.key}" 在 ${d.path || '(root)'} 重复（首次 L${d.firstLine}，再次 L${d.line}）`)
  }
  if (report.duplicates.length > 0) {
    lines.push('    → JSON.parse 语义 = 后者静默覆盖前者（前一份值直接消失，所有判据看到的仍是合法对象）')
    lines.push('      修法：删掉后出现的那一个键；若两份内容都要保留，合并成一个键的值')
    lines.push('      ⚠ 别用「跑生成脚本重写整份」当修法——生成脚本走 JSON.parse，会把**先出现的那份**静默丢掉')
  }
  return lines
}
