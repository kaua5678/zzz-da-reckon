/**
 * 「压缩数组按槽位号索引」扫描器（判据 17 的实现面）。
 *
 * ## 要拦的形态
 * `characters` / `panels` / `damagePanels` / `remielleEntryPanels` 四个数组由
 * `for (let i = 0; i < 3; i++) { const x = buildX(i); if (x) arr.push(x) }` 构建
 * ⇒ **按位置紧凑**（空槽被跳过）⇒ **槽位号 ≠ 下标**。
 * 任何 `arr[<槽位表达式>]` 都是缺陷：前导/中间空槽时静默取到 `undefined` 或**别人那份对象**。
 *
 * ## 为什么值得做成判据（2026-09-16 round 9 实测的三档后果）
 * - **静默错值**：队 `['', 1481, 1191]` ⇒ 艾莲影画4 冻结数 4→0、回能 16→0，**无任何测试变红**；
 * - **跨角色污染**：队 `['', 1181, 1041]` ⇒ 格雷丝的字段被写进**队友**那份 cfg；
 * - **硬崩**：队 `['', 1041, <1301|1331|1501>]` ⇒ 3 个角色直接抛 TypeError。
 * 现有测试网对它**零覆盖**：105 个 presets 全满槽、5758 条归档 slots=[1,2,3]、
 * 312 个 `setupHarness` 用例里前导/中间空槽 0 例 ⇒ 没有本判据就会重新长回来。
 *
 * ## 判据定义（只报**可证明**的违规，宁漏不误伤）
 * 违规 = 对上述四数组用**方括号下标**访问，且键表达式**不是**以下三类安全形态：
 *   ① 纯数字字面量（`arr[0]`）—— 索引语义明确，作者自担（生产侧已无此类）；
 *   ② 循环下标变量（`arr[i]`，i 来自 `for (let i = 0; …)` 且**与数组自身同序迭代**）；
 *   ③ 已知的**下标而非槽位**用法（见 `IDX_SAFE_ALLOWLIST`，逐条带理由）。
 * 其余一律违规：含 `slot` / `input.slot` / `row.slot` / `c.slot` / 具名槽位变量
 * （`banyueSlot` / `janeSlot` / `windSlot` …——这些名字里就写着「槽位」）。
 *
 * 安全替代写法（判据**不**拦）：
 *   · `.find(x => x.slot === slot)` —— 按身份查（生产侧既有 ~20 处就是这个写法）；
 *   · `panelAt(panels, slot)` —— 面板族专用（`src/core/panel.ts`，带未盖章密集数组兜底）；
 *   · `characters.map/some/filter(...)` —— 整体消费者，无下标语义。
 *
 * @fact engine:压缩数组/按槽位索引 口径: `characters`/`panels`/`damagePanels`/`remielleEntryPanels` 按位置压缩（空槽跳过）⇒ 槽位号 ≠ 下标，四数组一律禁止 `arr[<槽位表达式>]` 下标访问；模块内取自己那份 cfg 用 `AgentTeamConfigInput.cfg` / `AgentNextRoundFeedbackInput.cfg`（派发器直给），取队友那份或面板一律 `.find(x => x.slot === slot)` / `panelAt(panels, slot)` | 据 用户@2026-09-16「你挖出结构性缺陷就直接动手做」+ 本会话实测三档后果（艾莲影画4 静默归零 / 格雷丝写进队友 cfg / 奥菲丝·薇薇安·蕾米埃尔硬崩）| 验 src/composables/__tests__/compactedSlotIndex.test.ts | 锚 scripts/lib/compacted-slot-index.mjs#scanCompactedSlotIndex | 信 确认
 * ⟳复核: 若 `characters`/`panels` 的 producer 改成「槽位对齐」（不再压缩）或改由专门的 `.slot` 键控 Map 承载，本判据的前提消失 ⇒ 连同 IDX_SAFE_ALLOWLIST 一起重审或删除 | 到期 2027-03-31
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 受判据约束的四个压缩数组名 */
export const COMPACTED_ARRAYS = ['characters', 'panels', 'damagePanels', 'remielleEntryPanels']

/**
 * 逐条豁免：**下标语义**（不是槽位语义）的访问点。每条必须写明理由，且随代码消失即销号。
 * 判据按「文件 + 数组名 + 键表达式」匹配（行号敏感会被无关改动打红，故不记行号）。
 */
export const IDX_SAFE_ALLOWLIST = [
  {
    file: 'src/core/panel.ts',
    array: 'panels',
    key: 'slot',
    reason: 'panelAt 的**兜底分支**：仅在「整个数组都没盖章」时按下标取（此时下标 == 槽位号），'
      + '且该分支只读不写、不盖章（盖章会让后续查找把密集数组误判成压缩数组 —— 实测踩过）。',
  },
  {
    file: 'src/mechanics/agents/alice.ts',
    array: 'panels',
    key: 'aliceIdx',
    reason: '`aliceIdx` 是 `panels.findIndex(p => p.aliceEnabled)` 的**返回值**，即数组下标本身，'
      + '不是槽位号 —— 下标当下标用，语义正确。',
  },
  {
    file: 'src/mechanics/agents/lighter.ts',
    array: 'characters',
    key: 'i',
    reason: '`for (let i = 0; i < characters.length; i++)` 的**同序迭代**：与 `exCounts[i]` 配对读取，'
      + 'i 是位置而非槽位号（该函数按「第几个有角色的槽」对齐两份数组，语义自洽）。',
  },
  {
    file: 'src/stores/catalog.ts',
    array: 'characters',
    key: 'agentId',
    reason: '`buildRecommendations.value?.characters[agentId]`：这是**按 agentId 键控的对象**'
      + '（Record<string, …>），与压缩数组同名但不同物。',
  },
]

/** 循环下标变量名（这些名字作键 ⇒ 视为「同序迭代」，安全） */
const LOOP_INDEX_NAMES = new Set(['i', 'j', 'k', 'n', 'idx', 'index'])

/**
 * 扫描 `src/**`（不含测试与声明文件）里的压缩数组槽位索引。
 * @returns {{ violations: {file:string,line:number,array:string,key:string,text:string}[], scanned:number }}
 */
export function scanCompactedSlotIndex(root) {
  const violations = []
  let scanned = 0
  const arraysAlt = COMPACTED_ARRAYS.join('|')
  // 方括号索引 + 变量键（排除纯数字字面量：`arr[0]` 是显式索引语义）
  const re = new RegExp(`\\b(${arraysAlt})\\s*\\[\\s*([A-Za-z_$][A-Za-z0-9_$.]*)\\s*\\]`, 'g')

  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) {
        if (n === '__tests__' || n === 'node_modules') continue
        walk(p)
        continue
      }
      if (!n.endsWith('.ts') || n.endsWith('.d.ts') || n.endsWith('.test.ts')) continue
      const rel = relative(root, p).split(sep).join('/')
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        scanned++
        re.lastIndex = 0
        let m
        while ((m = re.exec(line)) !== null) {
          const array = m[1]
          const key = m[2]
          // ① 循环下标变量名 ⇒ 同序迭代，安全
          if (LOOP_INDEX_NAMES.has(key)) continue
          // ② 逐条豁免（下标语义）
          if (IDX_SAFE_ALLOWLIST.some(a => a.file === rel && a.array === array && a.key === key)) continue
          violations.push({ file: rel, line: i + 1, array, key, text: t.slice(0, 110) })
        }
      })
    }
  }
  walk(join(root, 'src'))
  return { violations, scanned }
}
