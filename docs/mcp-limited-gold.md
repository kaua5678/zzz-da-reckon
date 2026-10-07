# 限定金数：只算一处（r734）

> 代码提交 `20033566`（arena-G r734）；arch CC-516；r6 §8.0 #31 与 §8 第 734 行。
> 一句话：限定金数的公式原来有四份：归档侧的 `memberLimitedGold`，以及计算器侧的 `teamGoldOf` / `baseGoldOf` / `baseGoldOfTeam`。现在计算器侧三处都经 `teamGoldOf` 交给 `memberLimitedGold`，只做转发的 `isLimitedAgent` 删除。

## 1. 起点（origin `e9026873`）

| 函数 | 位置 | 输入 | 公式 | 调用方 |
|---|---|---|---|---|
| `memberLimitedGold` / `runLimitedGold` | `limitedGold.ts` | 归档成员 `{ agentId, mindscape, phase, weaponId }` | 限定角色：1 + 影画。限定音擎：max(1, ⌊phase⌋)，非有限值记 1 | pullValue、charIncrement、RunArchivePage、lowGoldFrontier |
| `teamGoldOf` | `teamCompare.ts` | 四个数组：角色 / 音擎 / 影画 / 精炼 | 限定角色：1 + max(0, 影画)。限定音擎：1 + max(0, 精炼 − 1)。空槽整槽不计；音擎 id 先经 catalog 解析别名 | TeamConfigPage「预设金数」 |
| `baseGoldOf` | `teamCompare.ts` | 预设 | 限定角色 1；预设声明的限定音擎 1 | computeTeamComparePoints、applyGoldToStore、difficultyCurve |
| `baseGoldOfTeam` | `teamTimelineStore.ts` | 队伍 + catalog | 限定角色 1；基础档音擎（`baseWEngineFor`）是限定的记 1 | computeOptimalTeamAllocation、budgetAwareStateFor、菲林模拟 3 处 |

`limitedGold.ts` 的头注释写着「单一事实源……三处共用同一口径，改口径只改这里」。可列出的三处全在归档侧；计算器侧的三份不在列表里，各自手写同一个公式。改口径时只要漏掉一份，配置页、队伍对比、时间线和实战归档的金数就会对不上。「限定角色」的判定在 CC-270 就因为两套定义分叉出过事故（潘引壶）。

另外，`teamCompare.isLimitedAgent` 自 CC-270 起只剩一行 `return isLimitedSAgentId(agentId)`：同一条规则有两个名字。

## 2. 改法

- **`teamGoldOf` 逐槽交给 `memberLimitedGold`**：写成 `runLimitedGold(agentIds.flatMap(...))`，本身只做两件事：
  - 空槽不计，槽里残留的音擎也不计。这是之前修空槽残留专武时加的，见 `mcp-stun-dual-source.md`。
  - 把 store 里的音擎 id 解析成 catalog 主 id（CC-271，旧 localStorage 里可能存的是别名）。
- **`mainWEngineId`（私有）**：别名解析抽成一个函数，`isLimitedWEngine` 也改用它。原先 `isLimitedWEngine` 第一行的空串短路移到这里，空串照旧不访问 store。
- **两个基础金改成「基础态的 `teamGoldOf`」**：
  - `baseGoldOf(preset)` = `teamGoldOf(preset.team, preset.wEngines ?? [], [0, 0, 0], [1, 1, 1])`；
  - `baseGoldOfTeam(team, catalog)` = 对 `baseStateFor(team, catalog)` 求 `teamGoldOf`。
  - 两段手写循环删除。
- **删除 `isLimitedAgent`**：4 处调用直接改用 `limitedGold.isLimitedSAgentId`：`buildGoldStepsFromConfig`、`teamTimelineStore` 里的 `baseWEngineFor` 和 `buildBudgetAwareGoldSteps`、`teamTimeline.nextGoldCandidates`。
- **测试**：
  - `teamCompare.test` 里 6 条 `isLimitedAgent` 断言删除。`limitedAgentSingleSource.test` 的 CC-270 锁已经把 catalog 里每个角色的 `isLimitedSAgentId` 与「S 级 ∧ 非常驻」逐个比对，覆盖这 6 个 id；`memberLimitedGold` 的用例里也另有 1031、1421 记 0 金。
  - `teamGoldOf` 用例补一条旧别名：`zzz_wiki_1664`（= 14105）精炼 2 计 5 金。去掉别名解析后这条报 3。
- **顺手**：
  - `teamTimelineStore.ts`、`teamTimelineFilm.ts` 头注释里「teamTimeline.ts 原样转出公开名」已不成立，改成「直接从本文件导入」；
  - `limitedGold.ts` 头注释补上计算器侧的调用方；
  - FEATURES_GUIDE「预设金数」一节指到 `memberLimitedGold`。

## 3. 行为

有效输入（影画为 0–6 的整数，精炼为 1–5 的整数）上结果不变。只有不可能出现的输入会不同：

- 负影画不再钳到 0；
- 非整数精炼向下取整，原先记小数；
- NaN 精炼记 1，原先结果是 NaN。

这些输入进不来：store 的 `setCinemaLevel` / `setWEngineModLevel` 写入时已钳到 0–6 / 1–5；配置页弹窗的草稿由滑块和数字框限在同样的范围，清空时回到 0 / 1。

## 4. 验证

- vue-tsc 0；guards 29（判据 28 / 29 = 0/0，扫 297 个文件）；zc.test + checkGuards.test 207；
- tokens 12 / data 161 / specs 462 / recording 189；
- vitest 261/2165 + 263/2342 = 524/4507，与 r733 基线相同；
- zd DUMP 0 / ROWS 0；build `index-Ciafw_XE.js` 1599.17 kB（`e9026873` 为 1599.31 kB）；zc drift 154/0/0。
- **探针**（不入库，`calc-arch/g734/zz734probe.test.ts`）：同一工作区改前、改后各跑一次，逐字段相同。
  - c，金数普查：
    - 104 个预设的 `baseGoldOf`；
    - 104 支预设队加 6 支队的 `baseGoldOfTeam`；
    - `teamGoldOf`：104 个预设 × 5 档 × 3 种音擎写法（主 id / 旧别名 id / 中槽清空），其中 1495 个槽位换成了别名。
  - a，队伍对比：19 个带 goldSteps 的预设，目标金 0–14，开最优加金并收集试算（175 个点、655 条试算）。
  - b，时间线：6 队，预算 12。
- **反例**：把 `teamGoldOf` 里的 `mainWEngineId(...)` 换成原始 id，别名用例报 `expected 3 to be 5`。
- **普查**（`zz734census.test.ts`，不入库）：104 个预设共 540 条 goldSteps，全部指向限定角色或限定音擎；standardSteps 0 条。所以第 5 节第一条说的「按步数计金」与公式在现有数据上相等。

## 5. 不做

- **按步数计金不改成「对配装态求公式」**。队伍对比和时间线的总金是「基础金 + 已选步数 + 仍穿着的限定下位件数」。现有数据上两者相等（见第 4 节普查），但按步数计金还负责目标金的钳制与分档（`resolveGoldLevel`）。另外，作者若在 goldSteps 里给非限定角色写影画步，按步数会计 1 金，按公式计 0。要改，得先定这类步算数据错误还是算金。
- **`teamGoldOf` 的签名不改成 `(team, TeamGoldState)`**：配置页的草稿是 `number[]`，不是三元组，改了得加断言。四个数组的签名照旧。
- **`isLimitedWEngine` 不删**：它比 `isLimitedSWengineId` 多一步别名解析，store 侧要用。
- **`teamGoldOf` 不搬进 `limitedGold.ts`**：`limitedGold.ts` 刻意不依赖 catalog store，归档统计直接用它；别名解析要用 catalog，所以留在 teamCompare。
- **不加「金数公式只许写在 limitedGold.ts」的源码锁**：用正则锁 `gold += 1` 之类的写法太脆。靠头注释和本文档。

## 6. 下一轮候选（r735 已做）

**下位音擎择优有两份实现**。`teamCompare.computeAutoEnginePicks` 和 `freeCompare/engine.ts#pickDowngradeByDamage` 做的是同一件事：逐件试穿，读全队伤害，留下最高的。两份的差别：

- 精炼口径（A 级 5、常驻 S 3）各写一遍；
- 队伍对比那份不跳过非有限读数：第一件读数是 NaN 时它会被选中；
- `engine.ts` 的 `mods` 参数，生产代码从没传过；
- `engine.ts` 注释里引用 teamCompare 的行号（`:530-533`、`:651-653`、`:523-524`）已经过期。

可以收成一份「试穿择优」，候选来源两边各留各的。是否值得做，要先用探针确认队伍对比的自动下位与自由对比的无专武档都零差。

> r735（`6163ff4c`）已做：收成 `downgradeWEngine.ts`，四组探针改前 / 改后逐字段相同。见 `docs/mcp-downgrade-wengine.md`、arch CC-517。

## 7. 回退

`git revert 20033566`（文档另提交）。
