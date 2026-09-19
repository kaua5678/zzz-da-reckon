# 录入层 → 编排层值倒置修复备忘（R35-J2 落地，2026-09-19 round 37）

> 定位：**决策与实测记录**，不是口径副本。口径的唯一事实源在代码：
> `scripts/lib/layer-inversion.mjs` 头注释（判据 19）、`src/data/moveTableQueries.ts` 头注释（落点）、
> `src/composables/resourceCalc/skillRows.ts` 头注释（壳）。本文只回答「为什么这样切、量到了什么、怎么证伪」。

## 1. 病灶（R35 取证，本任复核）

| 项 | 实测 |
|---|---|
| 边 | `src/mechanics/agents/claret.ts:15` `import { pickThirdNamedBasicSegment, fusedRowValue } from '@/composables/resourceCalc/helpers'` |
| 录入层对 `@/composables` 站点穷尽 | `src/mechanics/**` + `src/specs/**` 非测试 `.ts` **73 文件 / 9 站点 = 8 `import type`（全是 `CalcRoundThreads`）+ 1 值**（就是这条） |
| 后果 | 破坏 `ARCHITECTURE.md` §0「录入层被编排/引擎经 registry 消费」的单向性：claret ↔ helpers ↔ mechanics/index 成环 |
| 机器面盲区 | 判据 7 `exhibition-layer` 只扫 `views`/`components` 的 `.vue` 且禁令正则无 `composables`；判据 12 `core role-import` 只扫 `core/** → @/mechanics/agents/*` ⇒ 这条边此前**结构性无人监管** |

SCC 复测（本任，纯值边 Tarjan：静态 `import`/`export … from`，剔 `import type`，`src/**` 非测试 `.ts/.vue`）：

| 树 | 非平凡 SCC 数 | 含 claret 的 SCC |
|---|---|---|
| 基线 `cb29f1a` | 2 | **3 模块**：`claret.ts` / `resourceCalc/helpers.ts` / `mechanics/index.ts` |
| 修后 `89c840b` | 1 | **1**（claret 自身；剩下唯一的 2 模块 SCC 是 `panelPhases ↔ anomalyPanels`，R35 已论证为有意保留、无 TDZ 风险） |

R35 报的「8 模块 SCC」是把 `import type` 也算边的口径；两把尺都指向同一结论：**这条值边一删，claret 出环**。

## 2. 决策：选项 a（只下沉 claret 闭包的 4 个符号）

round36 §2.4 要求派活方不替工人决定的取舍：

| 选项 | 内容 | 棘轮覆盖面 | 裁决 |
|---|---|---|---|
| **a** | 只下沉 `getRowValue` / `fusedRowValue` / `findMoveById` / `pickThirdNamedBasicSegment`（claret 闭包，全纯） | `skillRows.ts` 留在 `listAgentBranchFiles()` 度量面内，其余 10 个符号不动 | **采用**：规则 12 最小阶梯；C 簇里 `getBasicComboMoves` / `averageBasicRows` 收 `catalogStore`，本来就不该进 `src/data/` |
| b | 整个 C 簇 14 符号下沉，`skillRows.ts` 变纯壳 | 这几类函数**整类逃出** agentId 棘轮（今天 0 条身份行，但覆盖面是永久取舍） | 不采用：换来的只是「少一层壳」，代价是永久缩小棘轮面 |

落点 `src/data/moveTableQueries.ts`：`src/data/` 在三层都可依赖的公共底（先例 `sharpCritMultiplier`，`core/resource.ts` 早已 import `@/data/moveFusions`），且在所有棘轮度量面之外。

壳形态（round36 §2.7 落点警告已验）：`skillRows.ts` 必须写 `import { … } from '@/data/moveTableQueries'` + 另起 `export { … }` 两行——`export … from` 不建本地绑定，而同文件 `getBasicComboMoves` / `averageBasicRows` 需要本地绑定（R22 刀 B 的 `ReferenceError` / TS2304 同款）。`skillRowsShell.test.ts` ④ 读源码钉这个形态，并断言三层（data / skillRows 壳 / helpers 壳）是**同一个函数绑定**。

## 3. 判据 19 `layer-inversion`（成对）

| 面 | 口径 | 红的条件 |
|---|---|---|
| 行为面 | 录入层对 `@/composables/*` 值导入数；语句级 `import type` / `export type … from` 豁免；`export … from` / 副作用 `import` / 动态 `import()` / 内联 `{ type X }` 按值计；类型位 `import('…').Name` 按 type 计；多行语句整条分类 | 值导入 > 0 |
| 反空洞下限 | 总站点（type + value）≥ 8（实测 8） | 总站点 < 8 ⇒「扫不到」与「真清零」不可区分 |
| 形状面 | `claret.ts` 源码任何位置（含注释）不得出现 `@/composables` 字面量 | 出现即红（给 grep 用的回归锁；只有行为面看不见「改 `import type` 再运行时 `import()`」这类绕行） |

单一入口 `classifyImportSpecifierSites(content)` 纯函数，detector 单测用 fixture 自证可红性（12 条，`src/scripts/__tests__/layerInversion.test.ts`）。`check-guards.mjs` 接线后为第 19 条判据；`checkGuards.test.ts` 的结构断言 `toHaveLength(18)` → `19`，并要求名单含 `layer-inversion`。

## 4. 注入反验（独立 scratch worktree `/tmp/wt-r37`，每次只改一个自由度，做完 `git checkout -- <file>` 还原）

| # | 注入 | 期望 | 实测 |
|---|---|---|---|
| A | `claret.ts` 把 import 改回 `@/composables/resourceCalc/helpers` | 行为面 + 形状面同时红，点名 `claret.ts:16` | ✅ `值导入 1 处 … 形状锁 1 处`，`layerInversion.test.ts` 仓库级 1 红 11 绿 |
| B | `claret.ts` 只加一行注释 `// 旧路径备忘：@/composables/resourceCalc/helpers` | 行为面绿、形状面红 | ✅ `值导入 0 处 … 形状锁 1 处 → claret.ts:17` |
| C | `ENTRY_LAYER_DIRS` 写成 `src/mechanicz` | 反空洞下限红 | ✅ `总站点 0 < 8（扫 8 文件）——扫描器疑似失效` |

## 5. 证伪闸门（round36 §2.6）实测——**前提成立**

前提：「claret 对 helpers 的依赖是纯函数依赖，可下沉 `src/data/` 而不动语义」。假设为假时的可观察失败 = `timeGolden` / `allAgentsSweep` 任何非零 delta，或 `@fact` 锚数下降。

`npm run verify` 于干净隔离 worktree `/tmp/wt-r37`（`89c840b`，`node_modules` 软链）：**EXIT 0，162s**。

| 面 | 基线 `cb29f1a` | 修后 `89c840b` | delta 归因 |
|---|---|---|---|
| guard checks | 18 | **19** | +1 = 判据 19 |
| `@fact anchors` | 108/108 | **109/109** | +1 = `engine:guards/层倒置` |
| token checks | 12 | 12 | — |
| vitest files / tests | 238 passed / 2990 passed / 27 skipped | **239 passed（14 skipped）/ 3003 passed / 27 skipped** | +1 文件 = `layerInversion.test.ts`；+13 条 = 12（layerInversion）+ 1（skillRowsShell ④） |
| `timeGolden` | 9 ✓ | 9 ✓（「105 预设：伤害 / 失衡 / 留白 / 逐槽时间账」零差异） | **0** |
| `allAgentsSweep` | 311 ✓ | 311 ✓ | **0** |
| recording checks | 189 | 189 | — |
| `vue-tsc -b`（含在 build） | ✓ | ✓ | 主工作区的 TS 报错全在协作者 WIP（`rowTimeLimit` 尚未进 `CharacterOperationConfig`），与本刀无关 |

⇒ 闸门两行都没触发，不需要回滚，`claret.ts` 头注释不写「此边不可解」。

## 6. 顺手发现（分开提交，便于归因）

- `README.md` 在 `310ba51` 被整段粘回了带行号的读取输出：**98/105 行**以 `N: N: ` / `N: M: ` 开头（标题渲染成「1: 1: # ZZZ 伤害计算器」）。判据 9 按反引号路径匹配，对此不敏感 ⇒ 机器面全程没红。已在 `19ee738` 剥掉前缀（逐行只剥一次，`git diff --numstat` 98/98）。
- `claret.ts` 还有一对**私有**同形函数 `findMoveById`（与 data 版语义相同）/ `getRowValue`（**缺** `getRowFusionMultiplier` 逻辑编辑器行融合乘数）。测试态恒等（`activeRowFusions` 默认空），但用户在逻辑编辑器给克拉蕾招式行配融合规则时，平A两态秒均与 `claretExDamageMultiplier` 会与引擎其余路径分裂。今天路已铺好（`@/data/moveTableQueries` 就在同一 import 行），登记为 `.claude/OPEN-ITEMS.md` R37-J1，带证伪闸门，下一任做。

## 7. 改动清单

| 提交 | 文件 |
|---|---|
| `19ee738` fix(docs) | `README.md`（剥行号前缀） |
| `89c840b` fix(R37) | 新 `src/data/moveTableQueries.ts` / `scripts/lib/layer-inversion.mjs` / `src/scripts/__tests__/layerInversion.test.ts`；改 `src/composables/resourceCalc/skillRows.ts` / `src/mechanics/agents/claret.ts` / `scripts/check-guards.mjs` / `src/composables/resourceCalc/__tests__/skillRowsShell.test.ts` / `src/scripts/__tests__/checkGuards.test.ts` |
| docs(R37) | 本文 / `docs/ARCHITECTURE.md`（§0 依赖方向补一句 + §3 决策树一行）/ `README.md` §6（+1 行，20 → 21 份）/ `.claude/PROMPT-handoff-round37.md` |
